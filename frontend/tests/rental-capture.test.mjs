import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";

test("multi-view handoff and return retain a blocked comparison; reshooting replaces only that view", async () => {
  const dom = new JSDOM('<main id="screen"></main><nav id="navigation"></nav><dialog id="dialog"></dialog><div id="toast" hidden></div>',
    { url: "http://localhost:8790/#trade/test", pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage, location: window.location });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.HTMLMediaElement.prototype.play = async () => {};
  Object.defineProperty(window.HTMLVideoElement.prototype, "videoWidth", { get: () => 640 });
  Object.defineProperty(window.HTMLVideoElement.prototype, "videoHeight", { get: () => 480 });
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  let photoCount = 0, comparisons = 0;
  window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob([`camera-frame-${++photoCount}`], { type: "image/png" }));
  // Form inputs come from the DOM; binary photo payloads use Node Blob objects.
  globalThis.FormData = class {
    constructor(form) { this.values = form ? [...new window.FormData(form)] : []; }
    get(key) { return this.values.find(([k]) => k === key)?.[1] ?? null; }
    getAll(key) { return this.values.filter(([k]) => k === key).map(([, v]) => v); }
    append(key, value) { this.values.push([key, value]); }
    set(key, value) { this.values = this.values.filter(([k]) => k !== key); this.append(key, value); }
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/photo-comparison");
    assert.match(await options.body.get("before").text(), /^camera-frame-/);
    assert.match(await options.body.get("after").text(), /^camera-frame-/);
    comparisons++;
    return new Response(JSON.stringify({ status: comparisons === 1 ? "retake" : "clear", reason: comparisons === 1 ? "alignment" : null, regions: [] }), { status: 200 });
  };
  const key = "neighbor-storage-demo-v1";
  localStorage.setItem(key, JSON.stringify({ role: "lender", rentals: [{ id: "test", itemId: "drill", lenderId: "lender", renterId: "renter", status: "confirmed", start: "2026-11-28", end: "2026-11-29", total: 10000 }] }));
  const rental = () => JSON.parse(localStorage.getItem(key)).rentals[0];
  const wait = async (condition) => {
    for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise((resolve) => setTimeout(resolve, 2)); }
    assert.fail("UI state did not settle");
  };
  const click = (selector) => { const button = document.querySelector(selector); assert.ok(button, selector); button.click(); };
  const submit = () => document.querySelector("#dialog form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const shoot = async (id) => {
    click(`[data-action="capture-evidence"][data-id="${id}"]`);
    click('[data-camera="start"]'); await wait(() => !document.querySelector('[data-camera="shoot"]').hidden);
    click('[data-camera="shoot"]'); await wait(() => !document.querySelector('[data-camera="use"]').hidden);
    click('[data-camera="use"]'); await wait(() => !document.querySelector(".camera-dialog"));
  };
  try {
    await import("../src/app.js?rental-test");
    click('[data-action="trade-action"][data-id="handoff"]');
    submit(); await wait(() => document.querySelector(".form-error").textContent.includes("모든 부위"));
    assert.equal(rental().status, "confirmed");
    for (const id of ["left", "right", "chuck", "battery"]) await shoot(id);
    document.querySelectorAll('[name="check"]').forEach((input) => input.click());
    submit(); await wait(() => rental().status === "handover");
    assert.equal(Object.keys(rental().inspection.before).length, 4);
    location.hash = "#profile"; await wait(() => document.querySelector('[data-action="role"][data-id="renter"]'));
    click('[data-action="role"][data-id="renter"]');
    location.hash = "#trade/test"; await wait(() => document.querySelector('[data-id="receive"]'));
    click('[data-id="receive"]'); click('[data-id="return"]');
    for (const id of ["left", "right", "chuck", "battery"]) await shoot(id);
    document.querySelectorAll('[name="check"]').forEach((input) => input.click());
    submit(); await wait(() => comparisons === 4 && !document.querySelector('[data-id="reshoot"]').disabled);
    assert.equal(rental().status, "checking");
    assert.equal(rental().inspection.results.left.status, "retake");
    const previous = rental().inspection.after;
    click('[data-id="reshoot"]'); await shoot("left"); submit();
    await wait(() => comparisons === 5 && rental().inspection.results.left.status === "clear");
    const updated = rental().inspection;
    assert.notEqual(updated.after.left.source, previous.left.source);
    assert.equal(updated.after.right.source, previous.right.source);
    assert.equal(updated.returnHistory.length, 1);
    assert.equal(rental().status, "checking");
    assert.ok(!document.querySelector("#screen").textContent.includes("LPIPS"));
  } finally {
    document.querySelectorAll("dialog").forEach((dialog) => dialog.close());
    dom.window.close();
  }
});

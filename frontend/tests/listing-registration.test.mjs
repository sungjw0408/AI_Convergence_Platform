import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";
import { photoBlob } from "../src/photo-store.js";

test("multi-angle registration persists originals and cover; gallery keeps dates; trade needs new photos", async () => {
  const dom = new JSDOM('<main id="screen"></main><nav id="navigation"></nav><dialog id="dialog"></dialog><div id="toast" hidden></div>',
    { url: "http://localhost:8790/#new", pretendToBeVisual: true });
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
  let counter = 0;
  window.HTMLCanvasElement.prototype.toBlob = (cb) => cb(new Blob([`listing-camera-${++counter}`], { type: "image/png" }));
  globalThis.FormData = class {
    constructor(form) { this.values = form ? [...new window.FormData(form)] : []; }
    get(key) { return this.values.find(([k]) => k === key)?.[1] ?? null; }
    getAll(key) { return this.values.filter(([k]) => k === key).map(([, value]) => value); }
  };
  const key = "neighbor-storage-demo-v1";
  localStorage.setItem(key, JSON.stringify({ role: "lender" }));
  const wait = async (predicate) => { for (let i=0;i<200;i++) { if (predicate()) return; await new Promise((r) => setTimeout(r,2)); } assert.fail("UI did not settle"); };
  const click = (selector) => { const el = document.querySelector(selector); assert.ok(el, selector); el.click(); };
  const fill = (name, value) => { const el = document.querySelector(`[name="${name}"]`); el.value = value; el.dispatchEvent(new window.Event("input", { bubbles:true })); el.dispatchEvent(new window.Event("change", { bubbles:true })); };
  const submit = () => document.querySelector('[data-form="register"]').dispatchEvent(new window.Event("submit", { bubbles:true, cancelable:true }));
  try {
    await import("../src/app.js?listing-test");
    const step = () => Number(document.querySelector('[data-form="register"]').dataset.step);
    assert.equal(step(), 0);
    assert.equal(document.querySelector('[name="price"]'), null);
    submit(); assert.match(document.querySelector(".form-error").textContent, /물품명/);
    fill("title", "무선 전동드릴"); fill("category", "공구"); fill("description", "배터리와 충전기를 함께 빌려드려요.");
    submit(); assert.equal(step(), 1);
    assert.equal(document.querySelector('[type="submit"]').disabled, false);
    submit(); assert.equal(step(), 2);
    const photoStep = () => document.querySelectorAll(".registration-steps li")[1];
    assert.equal(photoStep().classList.contains("done"), false);
    assert.equal(photoStep().querySelector("svg"), null);
    fill("price", "5000"); fill("deposit", "10000");
    submit(); assert.equal(step(), 2);
    assert.equal(document.querySelector("#dialog").open, true);
    assert.match(document.querySelector("#dialog").textContent, /사진 촬영 단계가 완료되지 않았어요/);
    assert.equal(JSON.parse(localStorage.getItem(key)).listings?.length || 0, 0);
    click('#dialog [data-action="close"]');
    assert.equal(document.querySelector('[name="price"]').value, "5000");
    click('[data-action="listing-review-photos"]'); assert.equal(step(), 1);
    assert.equal(document.querySelector('input[type="file"]'), null);
    click('[data-action="listing-camera"]'); click('[data-camera="start"]');
    await wait(() => !document.querySelector('[data-camera="shoot"]').hidden);
    for (let i=0; i<4; i++) {
      const position = i === 0 ? 1 : i, total = i === 0 ? 4 : 3;
      assert.match(document.querySelector(".camera-face").textContent, new RegExp(`${position} / ${total}`));
      click('[data-camera="shoot"]');
      await wait(() => i === 3 ? !document.querySelector(".camera-dialog") : document.querySelector(".camera-face").textContent.startsWith(`${position + 1} / ${total}`));
      if (i === 0) {
        // A partial capture can also move on; publishing still requires the rest.
        click('[data-camera="close"]');
        submit(); assert.equal(step(), 2);
        assert.equal(photoStep().classList.contains("done"), false);
        submit(); assert.equal(step(), 2);
        assert.match(document.querySelector("#dialog").textContent, /오른쪽 면/);
        click('#dialog [data-action="listing-review-photos"]');
        assert.equal(step(), 1); assert.equal(document.querySelector("#dialog").open, false);
        click('[data-action="listing-camera"]'); click('[data-camera="start"]');
        await wait(() => !document.querySelector('[data-camera="shoot"]').hidden);
      }
    }
    assert.equal(step(), 1);
    assert.equal(document.querySelectorAll(".listing-photo-tile").length, 4);
    // Going back keeps all fields and captured originals, without publishing.
    click('[data-action="listing-prev"]'); assert.equal(step(), 0);
    assert.equal(document.querySelector('[name="title"]').value, "무선 전동드릴");
    assert.match(document.querySelector('[name="description"]').value, /배터리/);
    submit(); assert.equal(step(), 1);
    const coverButton = document.querySelectorAll('[data-action="listing-cover"]')[1]; const coverId = coverButton.dataset.id; coverButton.click();
    // Cancelled retakes retain the original; successful retakes replace one view.
    click(`[data-action="listing-photo-retake"][data-id="${coverId}"]`);
    click('[data-camera="close"]');
    assert.equal(document.querySelectorAll(".listing-photo-tile").length, 4);
    click(`[data-action="listing-photo-retake"][data-id="${coverId}"]`);
    click('[data-camera="start"]'); await wait(() => !document.querySelector('[data-camera="shoot"]').hidden);
    click('[data-camera="shoot"]'); await wait(() => !document.querySelector(".camera-dialog"));
    assert.equal(document.querySelectorAll(".listing-photo-tile").length, 4);
    assert.equal(document.querySelector('[data-action="listing-cover"][aria-pressed="true"]').dataset.id, coverId);
    assert.equal(JSON.parse(localStorage.getItem(key)).listings?.length || 0, 0);
    submit(); assert.equal(step(), 2);
    assert.equal(photoStep().classList.contains("done"), true);
    assert.ok(photoStep().querySelector("svg"));
    fill("price", "");
    submit(); assert.match(document.querySelector(".form-error").textContent, /대여료/);
    fill("price", "5000"); fill("deposit", "10000");
    // Opening the final photo review preserves entered terms.
    click('[data-action="listing-review-photos"]'); assert.equal(step(), 1);
    submit(); assert.equal(step(), 2);
    assert.equal(document.querySelector('[name="price"]').value, "5000");
    submit(); await wait(() => JSON.parse(localStorage.getItem(key)).listings?.length === 1);
    const item = JSON.parse(localStorage.getItem(key)).listings[0];
    assert.equal(item.photos.length, 4); assert.equal(item.coverPhotoId, coverId); assert.equal(item.deposit, 10000);
    assert.equal(item.image, item.photos[1].source);
    assert.equal(await (await photoBlob(item.photos[0].source)).text(), "listing-camera-1");
    assert.equal(await (await photoBlob(item.photos[1].source)).text(), "listing-camera-5");
    assert.ok(item.photos.every((p) => p.origin === "camera" && p.capturedAt));
    assert.ok(!localStorage.getItem(key).includes("data:image"));
    location.hash = "#profile"; await wait(() => document.querySelector('[data-action="role"][data-id="renter"]'));
    click('[data-action="role"][data-id="renter"]'); location.hash = `#item/${item.id}`;
    await wait(() => document.querySelector(".item-gallery-thumbnails"));
    fill("start", "2026-11-28"); fill("end", "2026-11-29");
    click(`[data-action="listing-gallery"][data-id="${item.photos[0].id}"]`);
    assert.equal(document.querySelector('[name="start"]').value, "2026-11-28");
    assert.equal(document.querySelectorAll(".item-gallery-thumbnails button").length, 4);
    document.querySelector('[data-form="request"]').dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
    await wait(() => JSON.parse(localStorage.getItem(key)).rentals.length === 1);
    assert.equal(JSON.parse(localStorage.getItem(key)).rentals[0].before, undefined);
  } finally { document.querySelectorAll("dialog").forEach((d)=>d.close()); dom.window.close(); }
});

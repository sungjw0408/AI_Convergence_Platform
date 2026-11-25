import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";
import { openCapture } from "../src/capture.js";
import { saveOriginal, photoBlob, photoUrl, preparePhotos } from "../src/photo-store.js";

let dom, stopped, draws;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const media = () => ({ getTracks: () => [{ stop() { stopped++; } }] });

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:8790", pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => media() }, configurable: true });
  Object.defineProperty(window.HTMLVideoElement.prototype, "videoWidth", { get: () => 640 });
  Object.defineProperty(window.HTMLVideoElement.prototype, "videoHeight", { get: () => 480 });
  window.HTMLMediaElement.prototype.play = async function () {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  stopped = 0; draws = [];
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage(...args) { draws.push(args); } });
  window.HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob(["unmodified-video-frame"], { type: "image/png" }));
});

afterEach(() => { document.querySelectorAll("dialog").forEach((dialog) => dialog.close()); dom.window.close(); });

test("captures only video; guide opacity never enters saved pixels; closes camera", async () => {
  let capture;
  const dialog = openCapture({ reference: "/assets/proof-before.webp", face: "오른쪽 면", onCapture(value) { capture = value; } });
  dialog.querySelector('[data-camera="start"]').click(); await tick();
  assert.equal(dialog.querySelector(".camera-reference").hidden, false);
  const opacity = dialog.querySelector('[name="opacity"]'); opacity.value = "60";
  opacity.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(dialog.querySelector(".camera-reference").style.opacity, "0.6");
  dialog.querySelector('[data-camera="shoot"]').click(); await tick();
  assert.equal(draws.length, 1);
  assert.equal(draws[0][0], dialog.querySelector("video"));
  assert.equal(stopped, 1);
  dialog.querySelector('[data-camera="use"]').click();
  assert.equal(capture.face, "오른쪽 면");
  assert.equal(capture.source, "camera");
  assert.equal(capture.width, 640);
  assert.equal(await capture.blob.text(), "unmodified-video-frame");
  assert.equal(document.querySelector("dialog"), null);
});

test("late camera permission resolution after closing immediately stops tracks", async () => {
  let allow;
  navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { allow = resolve; });
  const dialog = openCapture({ onCapture() { assert.fail("must not capture"); } });
  dialog.querySelector('[data-camera="start"]').click();
  dialog.close(); allow(media()); await tick();
  assert.equal(stopped, 1);
});

test("permission denial offers retry; cancellation does not save a photo", async () => {
  navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error(), { name: "NotAllowedError" }); };
  const dialog = openCapture({ onCapture() { assert.fail("must not capture"); } });
  dialog.querySelector('[data-camera="start"]').click(); await tick();
  assert.match(dialog.querySelector(".camera-status").textContent, /권한/);
  assert.equal(dialog.querySelector('[data-camera="start"]').disabled, false);
  dialog.close(); assert.equal(stopped, 0);
});

test("navigation closes live camera and stops tracks", async () => {
  const dialog = openCapture({ onCapture() {} });
  dialog.querySelector('[data-camera="start"]').click(); await tick();
  window.dispatchEvent(new window.Event("hashchange"));
  assert.equal(stopped, 1);
  assert.equal(document.querySelector("dialog"), null);
});

test("IndexedDB round trip preserves PNG bytes and provides a display URL", async () => {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: "image/png" });
  const ref = await saveOriginal({ blob, capturedAt: new Date().toISOString(), face: "정면", width: 640, height: 480 });
  assert.match(ref, /^capture:/);
  const restored = await photoBlob(ref);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()), new Uint8Array(await blob.arrayBuffer()));
  assert.equal(restored.type, "image/png");
  await preparePhotos([ref]);
  assert.match(photoUrl(ref), /^blob:/);
  await assert.rejects(photoBlob("capture:missing"), /원본을 찾을 수/);
});

test("guided sequence keeps one camera stream and advances without accepting each frame", async () => {
  const saved = [];
  let completed = 0, opened = 0;
  navigator.mediaDevices.getUserMedia = async () => { opened++; return media(); };
  const dialog = openCapture({ sequence: [{ id: "front", label: "앞면" }, { id: "back", label: "뒷면" }],
    onCapture(photo, view) { saved.push({ photo, view }); }, onComplete() { completed++; } });
  dialog.querySelector('[data-camera="start"]').click(); await tick();
  dialog.querySelector('[data-camera="shoot"]').click(); await tick();
  assert.match(dialog.querySelector(".camera-face").textContent, /2 \/ 2 · 뒷면/);
  assert.equal(dialog.querySelector('[data-camera="use"]').hidden, true);
  assert.equal(stopped, 0);
  dialog.querySelector('[data-camera="shoot"]').click(); await tick();
  assert.equal(opened, 1); assert.equal(stopped, 1); assert.equal(completed, 1);
  assert.deepEqual(saved.map(({ view }) => view.id), ["front", "back"]);
  assert.deepEqual(saved.map(({ photo }) => photo.face), ["앞면", "뒷면"]);
  assert.equal(document.querySelector("dialog"), null);
});

test("cancelling a sequence keeps accepted photos and stops without completing", async () => {
  let count = 0;
  const dialog = openCapture({ sequence: [{ id: "front", label: "앞면" }, { id: "back", label: "뒷면" }],
    onCapture() { count++; }, onComplete() { assert.fail("incomplete sequence"); } });
  dialog.querySelector('[data-camera="start"]').click(); await tick();
  dialog.querySelector('[data-camera="shoot"]').click(); await tick();
  dialog.close();
  assert.equal(count, 1); assert.equal(stopped, 1);
});

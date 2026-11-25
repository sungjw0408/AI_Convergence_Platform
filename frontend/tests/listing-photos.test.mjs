import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { openCapture } from "../src/capture.js";
import { addListingPhotos, assignListingView, hasOnlyListingCameraPhotos, listingCaptureContext, maxListingPhotos, missingListingViews, newListingDraft, removeListingPhoto, syncListingPlan } from "../src/listing-photos.js";
import { inspectionRecord } from "../src/inspection.js";
import { registerPage } from "../src/views.js";

let dom, sequence = 0;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:8790", pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
  Object.defineProperty(window.HTMLVideoElement.prototype, "videoWidth", { get: () => 640 });
  Object.defineProperty(window.HTMLVideoElement.prototype, "videoHeight", { get: () => 480 });
  window.HTMLMediaElement.prototype.play = async () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toBlob = (cb) => cb(new Blob([`frame-${++sequence}`], { type: "image/png" }));
});
afterEach(() => { document.querySelectorAll("dialog").forEach((d) => d.close()); dom.window.close(); });

async function capture(draft) {
  let photo;
  const dialog = openCapture({ context: listingCaptureContext(draft), onCapture(value) { photo = value; } });
  dialog.querySelector('[data-camera="start"]').click(); await tick();
  dialog.querySelector('[data-camera="shoot"]').click(); await tick();
  dialog.querySelector('[data-camera="use"]').click();
  assert.ok(photo);
  return photo;
}

test("fresh captures fill required views and remain available for relabelling", async () => {
  const draft = newListingDraft("죽전동");
  for (let i = 0; i < 3; i++) addListingPhotos(draft, [await capture(draft)]);
  assert.equal(draft.photos.length, 3);
  assert.equal(missingListingViews(draft).length, 0);
  assert.equal(hasOnlyListingCameraPhotos(draft), true);
  assignListingView(draft, draft.photos[2].id, "back");
  assert.equal(draft.photos[1].viewId, "");
  assert.equal(draft.photos.length, 3);
});

test("album files and forged camera flags are rejected without changing the draft", () => {
  const draft = newListingDraft("죽전동");
  const forged = { blob: new Blob(["edited-album"], { type: "image/png" }), origin: "camera", capturedAt: new Date().toISOString(), width: 640, height: 480 };
  assert.throws(() => addListingPhotos(draft, [forged]), /앱 카메라로 촬영한 원본/);
  assert.equal(draft.photos.length, 0);
  draft.photos.push(forged);
  assert.equal(hasOnlyListingCameraPhotos(draft), false);
});

test("replacing a frame's bytes or using a different registration session is rejected", async () => {
  const draft = newListingDraft("죽전동"), other = newListingDraft("죽전동");
  const photo = await capture(draft);
  assert.throws(() => addListingPhotos(other, [photo]), /이번 등록 과정/);
  assert.throws(() => addListingPhotos(draft, [photo, photo]), /같은 사진/);
  addListingPhotos(draft, [photo]);
  draft.photos[0].blob = new Blob(["edited-pixels"], { type: "image/png" });
  assert.equal(hasOnlyListingCameraPhotos(draft), false);
});

test("changing item type preserves captured originals and cover", async () => {
  const draft = newListingDraft("죽전동");
  addListingPhotos(draft, [await capture(draft)]);
  const cover = draft.coverId;
  draft.fields.title = "무선 전동드릴";
  assert.equal(syncListingPlan(draft), true);
  assert.equal(draft.plan.views.length, 4);
  assert.equal(draft.photos.length, 1);
  assert.equal(draft.coverId, cover);
  assert.equal(draft.photos[0].viewId, "");
  assert.equal(missingListingViews(draft).length, 4);
  assert.equal(hasOnlyListingCameraPhotos(draft), true);
});

test("photo limit and cover reassignment still work with camera-only photos", async () => {
  const draft = newListingDraft("죽전동");
  for (let i=0; i<maxListingPhotos; i++) addListingPhotos(draft, [await capture(draft)]);
  assert.throws(() => addListingPhotos(draft, [{}]), /최대 8장/);
  removeListingPhoto(draft, draft.coverId);
  assert.equal(draft.photos.length, 7);
  assert.equal(draft.coverId, draft.photos[0].id);
});

test("registration exposes no album button or hidden file input", () => {
  const html = registerPage("lender", "죽전동");
  assert.match(html, /사진 촬영/);
  assert.ok(!html.includes("앨범에서 선택"));
  assert.ok(!html.includes('type="file"'));
  assert.ok(!html.includes("listing-album"));
});

test("listing photos do not become handoff evidence", () => {
  const draft = newListingDraft("죽전동");
  const record = inspectionRecord({}, { title: "드릴", inspectionPlan: draft.plan, photos: [{ source: "capture:listing" }] });
  assert.deepEqual(record.before, {});
  assert.deepEqual(record.after, {});
  assert.equal(record.plan.id, draft.plan.id);
});

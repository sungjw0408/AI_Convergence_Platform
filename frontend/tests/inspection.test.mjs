import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonSummary, completeDraft, currentResult, inspectionPlan, inspectionRecord } from "../src/inspection.js";
import { profilePage, tradePage } from "../src/views.js";

test("plans require multiple item-specific views; flexible kits use direct checks", () => {
  for (const title of ["전동드릴", "빔프로젝터", "접이식 사다리", "미니 카메라"]) {
    const plan = inspectionPlan({ title });
    assert.ok(plan.views.length >= 3);
    assert.equal(new Set(plan.views.map((v) => v.id)).size, plan.views.length);
  }
  const tent = inspectionPlan({ title: "4인용 텐트" });
  assert.ok(tent.views.every((v) => !v.compare));
  assert.ok(tent.checks.length > 0);
});

test("submission requires all views AND the manual checks", () => {
  const plan = inspectionPlan({ title: "드릴" });
  const draft = { plan, photos: {}, checks: [] };
  assert.equal(completeDraft(draft), false);
  for (const v of plan.views) draft.photos[v.id] = { source: `capture:${v.id}` };
  assert.equal(completeDraft(draft), false);
  draft.checks = plan.checks.map((c) => c.id);
  assert.equal(completeDraft(draft), true);
  delete draft.photos[plan.views[0].id];
  assert.equal(completeDraft(draft), false);
});

test("historical evidence remains a single real view without fabricated completion", () => {
  const record = inspectionRecord({ before: "/before.png", after: "/after.png", photoFace: "오른쪽 면" }, { title: "드릴" });
  assert.equal(record.plan.views.length, 1);
  assert.equal(record.before.legacy.source, "/before.png");
  assert.equal(record.plan.views[0].label, "오른쪽 면");
});

test("old responses cannot be reused after one view is reshot", () => {
  const record = { before: { left: { source: "before" } }, after: { left: { source: "new" } },
    results: { left: { beforeSource: "before", afterSource: "old", status: "clear" } } };
  assert.equal(currentResult(record, "left"), null);
});

test("retake and incomplete views never become an all-clear summary", () => {
  const plan = inspectionPlan({ title: "드릴" });
  const record = { plan, before: {}, after: {}, results: {} };
  for (const view of plan.views) {
    record.before[view.id] = { source: "before" };
    record.after[view.id] = { source: "after" };
    record.results[view.id] = { beforeSource: "before", afterSource: "after", status: "clear" };
  }
  assert.equal(comparisonSummary(record).kind, "clear");
  record.results.left.status = "retake";
  assert.equal(comparisonSummary(record).kind, "retake");
  delete record.results.left;
  assert.equal(comparisonSummary(record).kind, "pending");
  delete record.after.left;
  assert.equal(comparisonSummary(record).kind, "pending");
});

test("service pages expose transaction evidence without technical or evaluation controls", () => {
  assert.ok(!profilePage("renter", 0, 0).includes('href="#compare"'));
  const item = { title: "드릴", price: 5000, image: "/drill.png" };
  const html = tradePage({ id: "test", lenderId: "lender", renterId: "renter", status: "checking", start: "2026-11-28", end: "2026-11-29", total: 5000,
    before: "/before.png", after: "/after.png", photoAnalysis: { status: "retake", reason: "blur", failedPhoto: "after", model: "LPIPS", durationMs: 98, regions: [] } }, item, "renter");
  assert.match(html, /반납 요청은 유지돼요/);
  assert.match(html, /반납 사진 다시 촬영/);
  for (const text of ["LPIPS", "SqueezeNet", "ms", "모델 단독", "평가 실행", "기본 화질", "픽셀 차이"]) assert.ok(!html.includes(text), text);
});

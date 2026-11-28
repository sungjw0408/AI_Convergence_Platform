import assert from "node:assert/strict";
import { test } from "node:test";
import { depositPolicyLabel, depositQuote, itemValueFrom, rentalDepositSnapshot } from "../src/listing-pricing.js";
import { pricingContextFrom, ruleDraft } from "../src/listing-advice.js";
import { rankListings, recommendationCandidates } from "../src/listing-recommendations.js";
import { priceRecommendationResult } from "../src/listing-registration-view.js";
import { itemPage } from "../src/views.js";

const valuation = { valueWon: "80000", valueEvidence: "비교한 중고 거래 2건" };
const oldPolicy = { version: "test-a", rateBps: 1000, minWon: 1000, maxWon: 7000 };
const newPolicy = { version: "test-b", rateBps: 2500, minWon: null, maxWon: null };

test("the policy label and quote show the percentage and cap supplied by the server", () => {
  const policy = { version: "rento-demo-v2", rateBps: 3000, minWon: null, maxWon: 200000 };
  assert.equal(depositPolicyLabel(policy), "중고 가액의 30% · 최대 200,000원");
  assert.equal(depositQuote({ amountWon: 80000 }, policy).amountWon, 24000);
  assert.equal(depositQuote({ amountWon: 200000 }, policy).amountWon, 60000);
  assert.equal(depositQuote({ amountWon: 1000000 }, policy).amountWon, 200000);
});

test("deposit waits for policy and a rental holds the amount and policy at request time", () => {
  const item = { itemValue: itemValueFrom(valuation) };
  assert.equal(depositQuote(item.itemValue, null), null);
  assert.equal(rentalDepositSnapshot(item, null), null);
  assert.equal(rentalDepositSnapshot({ deposit: 1500 }, null).deposit, 1500);
  assert.equal(itemValueFrom({ ...valuation, valueEvidence: " " }), null);
  const accepted = rentalDepositSnapshot(item, oldPolicy);
  assert.equal(accepted.deposit, 7000);
  assert.equal(accepted.itemValue.amountWon, 80000);
  assert.equal(rentalDepositSnapshot(item, newPolicy).deposit, 20000);
  assert.deepEqual(accepted.depositPolicy, oldPolicy);
  assert.equal(accepted.deposit, 7000);
});

test("listing price context preserves comparison details and draft examples do not set prices", () => {
  assert.deepEqual(pricingContextFrom({ modelName: "  HF85JA ", condition: "사용감 있음",
    usageHistory: "월 2회", purchaseMonth: "2025-12" }),
  { modelName: "HF85JA", condition: "사용감 있음", usageHistory: "월 2회", purchaseMonth: "2025-12" });
  assert.equal(ruleDraft("전동드릴").category, "공구");
  assert.equal(ruleDraft("알 수 없는 이름").category, "");
  assert.equal(Object.hasOwn(ruleDraft("전동드릴"), "price"), false);
});

test("ranking is reproducible, filters hard conditions, and gives a cold-start user local choices", () => {
  const item = (id, neighborhood, price = 2500, extras = {}) => ({
    id, title: "전동드릴 " + id, category: "공구", owner: "supplier", neighborhood, price, ...extras,
  });
  const items = [item("near", "죽전동"), item("other", "보정동"), item("expensive", "죽전동", 9000),
    item("booked", "죽전동"), item("waiting", "죽전동", 2500, { itemValue: itemValueFrom(valuation) }),
    item("mine", "죽전동", 2500, { owner: "viewer" })];
  const context = { items, rentals: [], availability: [{ itemId: "booked", status: "confirmed", start: "2026-11-26", end: "2026-11-27" }],
    uid: "viewer", area: "죽전동", isFavorite: () => false, policy: null, today: "2026-11-26",
    filters: { query: "드릴", category: "공구", maxPrice: 5000, date: { start: "2026-11-26", end: "2026-11-26" } } };
  const candidates = recommendationCandidates(context);
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["near", "other"]);
  assert.deepEqual(candidates[0].reasons, ["물품명 검색 일치", "내 동네"]);
  assert.deepEqual(recommendationCandidates({ ...context, items: [...items].reverse() }), candidates);
  const today = rankListings({ ...context, filters: { ...context.filters, date: {} } });
  assert.equal(today.find((row) => row.item.id === "booked").available, false);
  assert.ok(!recommendationCandidates({ ...context, filters: { ...context.filters, maxPrice: 1500 } }).length);
});

test("favorites and completed rental categories personalize ranked candidates", () => {
  const items = [
    { id: "tool", title: "드릴", category: "공구", owner: "seller", neighborhood: "보정동", price: 1000 },
    { id: "camera", title: "카메라", category: "디지털", owner: "seller", neighborhood: "보정동", price: 2000 },
  ];
  const [first] = recommendationCandidates({ items, uid: "renter", area: "죽전동",
    rentals: [{ itemId: "camera", renterId: "renter", status: "complete" }], isFavorite: (id) => id === "camera",
    filters: {}, today: "2026-11-26" });
  assert.equal(first.id, "camera");
  assert.deepEqual(first.reasons, ["관심 물품", "관심·대여 이력과 같은 분류"]);
});

test("legacy account listings await evidence and only the owner can add it", () => {
  const item = { id: "legacy", title: "전동드릴", owner: "seller", category: "공구", neighborhood: "죽전동", price: 5000, deposit: 2000 };
  const buyerView = itemPage(item, "renter", {}, undefined, oldPolicy, true);
  assert.match(buyerView, /중고 가액 등록 대기/);
  assert.doesNotMatch(buyerView, /data-form="(?:request|listing-valuation)"|2,000원/);
  assert.match(itemPage(item, "seller", {}, undefined, oldPolicy, true), /data-form="listing-valuation"/);
  const context = { items: [item], rentals: [], uid: "renter", area: "죽전동", isFavorite: () => false,
    filters: {}, policy: oldPolicy, requireValue: true, today: "2026-11-28" };
  assert.deepEqual(recommendationCandidates(context), []);
  assert.equal(recommendationCandidates({ ...context, items: [{ ...item, itemValue: itemValueFrom(valuation) }] })[0].id, item.id);
});

test("used prices show the range and identify a single historic reference", () => {
  const policy = { version: "demo", rateBps: 3000, minWon: null, maxWon: 200000 };
  const first = { title: "Jabra Speak2 40", amountWon: 120000, url: "https://web.joongna.com/product/1",
    source: "중고나라 · 과거 검색 기록" };
  const history = priceRecommendationResult("value", { match: "recorded-used", amountWon: 120000,
    references: [first] }, policy, String);
  assert.match(history, /중고 게시가 120,000원/);
  assert.match(history, /과거 중고 게시가 1건/);
  assert.match(history, /참고 보증금 36,000원/);
  assert.doesNotMatch(history, /게시가 범위|data-action="listing-apply-price"/);
  const live = priceRecommendationResult("value", { match: "web-used", amountWon: 135000, references: [
    first, { ...first, amountWon: 150000, url: "https://web.joongna.com/product/2" },
  ] }, policy, String);
  assert.match(live, /중고 게시가 범위 120,000원~150,000원/);
  assert.match(live, /중앙값 135,000원/);
  assert.match(live, /예상 보증금 40,500원/);
});

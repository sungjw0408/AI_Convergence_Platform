export const MAX_VALUE_WON = 100_000_000;
export const MAX_DAILY_WON = 10_000_000;
export const DEPOSIT_PENDING = "보증금 정책 결정 대기";
export const VALUE_PENDING = "중고 가액 등록 대기";

export function depositBlock(item, policy, requireValue = false) {
  if (!item.itemValue && requireValue) return VALUE_PENDING;
  if (item.itemValue && !policy) return DEPOSIT_PENDING;
  return "";
}

export function wonInput(value, max = MAX_VALUE_WON, min = 0) {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= min && amount <= max ? amount : null;
}

export function itemValueFrom(fields) {
  const amountWon = wonInput(fields.valueWon, MAX_VALUE_WON, 1);
  const evidence = (fields.valueEvidence ?? "").trim();
  if (amountWon === null || !evidence || evidence.length > 500) return null;
  return { amountWon, evidence, verification: "pending" };
}

export function depositQuote(value, policy) {
  if (!value || !policy) return null;
  const computed = Math.floor((value.amountWon * policy.rateBps + 5000) / 10000);
  const amountWon = Math.max(policy.minWon ?? 0, Math.min(policy.maxWon ?? Infinity, computed));
  return { amountWon, policy: { ...policy } };
}

export function depositPolicyLabel(policy) {
  const formatter = new Intl.NumberFormat("ko-KR");
  const terms = [`중고 가액의 ${formatter.format(policy.rateBps / 100)}%`];
  if (policy.minWon !== null) terms.push(`최소 ${formatter.format(policy.minWon)}원`);
  if (policy.maxWon !== null) terms.push(`최대 ${formatter.format(policy.maxWon)}원`);
  return terms.join(" · ");
}

export function listingDeposit(item, policy) {
  return item.itemValue ? depositQuote(item.itemValue, policy)?.amountWon ?? null : item.deposit ?? 0;
}

export function rentalDepositSnapshot(item, policy) {
  if (!item.itemValue) return { deposit: item.deposit ?? 0 };
  const quote = depositQuote(item.itemValue, policy);
  if (!quote) return null;
  return { deposit: quote.amountWon, itemValue: { ...item.itemValue }, depositPolicy: quote.policy };
}

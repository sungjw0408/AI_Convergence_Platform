import { categories } from "./model.js?v=rento-home-5-ren";
import { MAX_DAILY_WON, MAX_VALUE_WON } from "./listing-pricing.js";

export const conditions = ["새것에 가까움", "사용감 있음", "수리 이력 있음"];

export function pricingContextFrom(fields) {
  return {
    modelName: (fields.modelName ?? "").trim(),
    condition: fields.condition ?? "",
    usageHistory: (fields.usageHistory ?? "").trim(),
    purchaseMonth: fields.purchaseMonth ?? "",
  };
}

export async function getPriceRecommendation(kind, fields) {
  let response;
  try {
    response = await fetch("/api/listing-price-advice", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(125000),
      body: JSON.stringify({
        kind, title: fields.title.trim(), category: fields.category,
        neighborhood: fields.neighborhood, ...pricingContextFrom(fields),
      }),
    });
  } catch {
    throw new Error("렌토 추천에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "렌토 추천을 불러오지 못했어요.");
  if (typeof result?.message === "string") return result;
  const max = kind === "rate" ? MAX_DAILY_WON : MAX_VALUE_WON;
  const validAmount = (value) => Number.isInteger(value) && value >= 1 && value <= max;
  const validReference = (ref) => validAmount(ref?.amountWon) && typeof ref.title === "string"
    && typeof ref.source === "string" && typeof ref.url === "string"
    && /^(https:\/\/|#item\/[A-Za-z0-9_-]+$)/.test(ref.url);
  const minimum = kind === "value" ? 1 : 2;
  if (!validAmount(result?.amountWon) || !Array.isArray(result.references)
      || result.references.length < minimum || result.references.length > 5
      || !result.references.every(validReference)) {
    throw new Error("추천 금액의 근거를 확인하지 못했어요.");
  }
  return result;
}

export function ruleDraft(title) {
  const category = [
    [/드릴|드라이버|공구|렌치|톱/, "공구"],
    [/빔|프로젝터|카메라|노트북|스피커|태블릿/, "디지털"],
    [/텐트|캠핑|타프|침낭|등산|캠핑의자/, "캠핑·레저"],
    [/사다리|청소기|다리미|카트/, "생활용품"],
  ].find(([pattern]) => pattern.test(title))?.[1] ?? "";
  return { category, description: `${title}을(를) 빌려드려요. 물품 상태: [확인 후 입력] · 사용 가능한 구성품: [확인 후 입력]`, source: "rules" };
}

export async function getListingDraft(fields) {
  const title = fields.title.trim();
  try {
    const response = await fetch("/api/listing-assistance", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ title, condition: fields.condition, usageHistory: fields.usageHistory,
        purchaseMonth: fields.purchaseMonth }),
    });
    if (response.ok) {
      const result = await response.json();
      if (categories.slice(1).includes(result.category) && typeof result.description === "string"
          && result.description.trim() && result.description.length <= 600
          && ["gemini", "ollama"].includes(result.source)) return result;
    }
  } catch { /* Local static mode and unavailable model use the labelled rule result. */ }
  return ruleDraft(title);
}

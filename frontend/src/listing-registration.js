import { itemValueFrom, MAX_DAILY_WON, MAX_VALUE_WON, wonInput } from "./listing-pricing.js";
import { categories, localDay, neighborhoods, rentalDays } from "./model.js?v=rento-home-5-ren";
import { hasOnlyListingCameraPhotos, missingListingViews } from "./listing-photos.js";

// Validate the entire draft, rather than relying on controls from another step.
export function validateListingStep(draft, step) {
  const fields = draft.fields;
  if (step === 0) {
    if (!fields.title.trim() || fields.title.trim().length > 48) return { field: "title", message: "물품명을 48자 이내로 입력해 주세요." };
    if (!categories.slice(1).includes(fields.category)) return { field: "category", message: "카테고리를 선택해 주세요." };
    if (!fields.description.trim() || fields.description.trim().length > 600) return { field: "description", message: "물품 상태와 구성품을 600자 이내로 소개해 주세요." };
    if (!neighborhoods.includes(fields.neighborhood)) return { field: "neighborhood", message: "거래 지역을 선택해 주세요." };
  } else if (step === 1) {
    const missing = missingListingViews(draft);
    if (missing.length) return { message: `사진 촬영 단계가 완료되지 않았어요. ${missing.map((view) => view.label).join(" · ")} 사진을 촬영해 주세요.` };
    if (!hasOnlyListingCameraPhotos(draft)) return { message: "앱 카메라로 각 부위를 다시 촬영해 주세요." };
    if (draft.photoMode !== "review") return { message: "촬영한 사진을 전체 확인해 주세요." };
  } else if (step === 2) {
    if (wonInput(fields.price, MAX_DAILY_WON) === null) return { field: "price", message: "하루 대여료를 0원부터 1,000만 원까지 1원 단위로 입력해 주세요." };
    if (wonInput(fields.valueWon, MAX_VALUE_WON, 1) === null) return { field: "valueWon", message: "현재 중고 가액을 1원부터 1억 원까지 입력해 주세요." };
    if (!itemValueFrom(fields)) return { field: "valueEvidence", message: "가액을 판단한 근거를 500자 이내로 입력해 주세요." };
    if (fields.purchaseMonth && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fields.purchaseMonth) || fields.purchaseMonth > localDay().slice(0, 7))) {
      return { field: "purchaseMonth", message: "구매 시기는 이번 달 이내로 입력해 주세요." };
    }
    if ((fields.start || fields.end) && (!(rentalDays(fields.start, fields.end) >= 1) || fields.start < localDay())) return { field: "start", message: "대여 가능 기간의 시작일과 종료일을 확인해 주세요." };
  }
  return null;
}

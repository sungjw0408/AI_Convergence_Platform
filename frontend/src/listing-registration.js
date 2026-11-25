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
    const price = Number(fields.price), deposit = Number(fields.deposit);
    if (!fields.price.trim() || !Number.isSafeInteger(price) || price < 0 || price > 10000000) return { field: "price", message: "하루 대여료를 0원부터 1,000만 원까지 1원 단위로 입력해 주세요." };
    if (!Number.isSafeInteger(deposit) || deposit < 0 || deposit > 10000000) return { field: "deposit", message: "보증금은 0원부터 1,000만 원까지 1원 단위로 입력해 주세요." };
    if ((fields.start || fields.end) && (!(rentalDays(fields.start, fields.end) >= 1) || fields.start < localDay())) return { field: "start", message: "대여 가능 기간의 시작일과 종료일을 확인해 주세요." };
  }
  return null;
}

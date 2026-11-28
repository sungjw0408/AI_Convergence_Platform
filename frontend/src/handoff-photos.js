export const listingStatePhoto = (item, viewId) =>
  item.photos?.find(photo => photo.viewId === viewId && ["camera", "file"].includes(photo.origin));

export function registrationBaseline(item) {
  const plan = item.inspectionPlan;
  if (!plan?.views?.length) return null;
  const photos = {};
  for (const view of plan.views) {
    const photo = listingStatePhoto(item, view.id);
    if (!photo?.source) return null;
    photos[view.id] = {...photo, listingPhotoId:photo.id, sourceKind:'listing'};
  }
  return {plan, photos};
}
export function photoTiming(photo) {
  const date = photo?.capturedAt && new Date(photo.capturedAt);
  const time = date && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR') : '촬영일 정보 없음';
  const label = photo?.sourceKind === "listing"
    ? (photo.origin === "file" ? "등록 사진" : "등록 때 촬영")
    : "인도 전 촬영";
  return `${label} · ${time}`;
}

import { icon } from "./icons.js?v=rento-home-5-ren";
import { photoUrl } from "./photo-store.js";
import { maxListingPhotos, missingListingViews } from "./listing-photos.js";

// Capture the required parts first, then review photos together.
export function listingPhotoPanel(draft, escape) {
  const missing = missingListingViews(draft);
  const review = draft.photoMode === "review";
  const disabled = draft.busy || draft.photos.length >= maxListingPhotos;
  const rows = draft.plan.views.map((view, i) => {
    const photo = draft.photos.find((entry) => entry.viewId === view.id);
    return `<li class="${photo ? "done" : ""}"><span class="listing-shot-number">${photo ? icon("check") : i + 1}</span><span><strong>${escape(view.label)}</strong><small>${photo ? "촬영 완료" : "촬영 대기"}</small></span>${photo ? `<button type="button" data-action="listing-photo-retake" data-id="${photo.id}" ${draft.busy ? "disabled" : ""}>다시 촬영</button>` : ""}</li>`;
  }).join("");
  const grid = draft.photos.map((photo, i) => {
    const view = draft.plan.views.find((entry) => entry.id === photo.viewId);
    return `<article class="listing-photo-tile">
      <div class="listing-photo-preview"><button type="button" class="listing-preview-button" data-action="listing-preview" data-id="${photo.id}" aria-label="${escape(view?.label || `${i + 1}번 사진`)} 확대"><img src="${escape(photo.preview || photoUrl(photo.source))}" alt="${escape(view?.label || `등록할 물품 사진 ${i + 1}`)}"></button>
        ${photo.id === draft.coverId ? '<span class="listing-cover-badge">대표 사진</span>' : ""}
        <button type="button" class="listing-photo-remove" data-action="listing-photo-remove" data-id="${photo.id}" aria-label="${i + 1}번 사진 삭제" ${draft.busy ? "disabled" : ""}>${icon("close")}</button></div>
      <div class="listing-photo-options">${view ? `<strong>${escape(view.label)}</strong><button type="button" data-action="listing-photo-retake" data-id="${photo.id}" ${draft.busy ? "disabled" : ""}>다시 촬영</button>` : `<label><span>촬영 부위</span><select data-listing-view="${photo.id}" ${draft.busy ? "disabled" : ""}><option value="">부위를 선택해 주세요</option>${draft.plan.views.map((entry) => `<option value="${entry.id}">${escape(entry.label)}</option>`).join("")}</select></label>`}
        <button type="button" data-action="listing-cover" data-id="${photo.id}" aria-pressed="${photo.id === draft.coverId}" ${draft.busy ? "disabled" : ""}>${photo.id === draft.coverId ? "대표 사진" : "대표로 지정"}</button></div></article>`;
  }).join("");
  return `<section class="listing-photo-panel" id="listing-photo-panel" aria-labelledby="listing-photo-heading">
    <div class="listing-photo-heading"><h3 id="listing-photo-heading">${review ? "전체 사진" : "촬영할 부위"}</h3><span>${draft.plan.views.length - missing.length} / ${draft.plan.views.length} 부위 완료</span></div>
    ${review ? `<div class="listing-photo-grid">${grid}</div>` : `<ol class="listing-shot-list">${rows}</ol>`}
    ${missing.length ? `<button type="button" class="photo-method camera" data-action="listing-camera" ${disabled ? "disabled" : ""}>
      <span class="photo-method-icon">${icon("camera")}</span><span class="photo-method-copy"><strong>${draft.photos.length ? "남은 부위 촬영하기" : "사진 촬영 시작"}</strong><span>${escape(missing[0].label)}부터 ${missing.length}개 부위를 촬영해요</span></span>${icon("right")}</button>` : !review ? '<button type="button" class="button secondary" data-action="listing-review-photos">전체 사진 확인</button>' : ""}
    ${review && missing.length ? `<p class="listing-photo-feedback">${missing.map((view) => escape(view.label)).join(" · ")} 사진이 필요해요.</p>` : ""}
    <p class="listing-camera-policy">앱 카메라로 지금 촬영한 사진만 등록할 수 있어요.</p>
    <p class="listing-photo-feedback" role="status" aria-live="polite">${escape(draft.error)}</p>
  </section>`;
}

export function itemGallery(item, selectedId, escape) {
  const photos = item.photos?.length ? item.photos : item.image ? [{ id: "legacy", source: item.image, label: item.title }] : [];
  const selected = photos.find((p) => p.id === selectedId) || photos.find((p) => p.id === item.coverPhotoId) || photos[0];
  if (!selected) return `<section class="item-gallery" id="item-gallery"><div class="listing-gallery-empty">${icon("photo")}<span>등록된 사진이 없어요</span></div></section>`;
  return `<section class="item-gallery" id="item-gallery" aria-label="물품 사진">
    <button type="button" class="item-gallery-main" data-action="listing-photo-enlarge" data-id="${selected.id}" aria-label="${escape(selected.label || item.title)} 사진 확대"><img src="${escape(photoUrl(selected.source))}" alt="${escape(selected.label || item.title)}"><span>${photos.indexOf(selected)+1} / ${photos.length}</span></button>
    ${photos.length > 1 ? `<div class="item-gallery-thumbnails" aria-label="물품 사진 선택">${photos.map((photo) => `<button type="button" data-action="listing-gallery" data-id="${photo.id}" aria-pressed="${photo.id === selected.id}"><img src="${escape(photoUrl(photo.source))}" alt="${escape(photo.label || "물품")} 사진"><span>${escape(photo.label || "추가 사진")}</span></button>`).join("")}</div>` : ""}
  </section>`;
}

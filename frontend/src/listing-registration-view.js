import { icon } from "./icons.js?v=rento-home-5-ren";
import { categories, localDay, neighborhoods } from "./model.js?v=rento-home-5-ren";
import { listingPhotoPanel } from "./listing-photo-view.js";
import { validateListingStep } from "./listing-registration.js";
import { photoUrl } from "./photo-store.js";

const steps = ["기본 정보", "사진 촬영", "대여 조건"];

export function registrationForm(draft, escape) {
  const { fields, step } = draft;
  const cover = draft.photos.find((photo) => photo.id === draft.coverId) || draft.photos[0];
  const titles = ["어떤 물품을 빌려주시나요?", draft.photoMode === "review" ? "촬영한 사진을 확인해 주세요" : "물품의 여러 부위를 촬영해요", "대여 조건을 정해 주세요"];
  const hints = ["물품 상태와 함께 제공하는 구성품을 소개해 주세요.", draft.photoMode === "review" ? "대표 사진을 고르고, 필요한 사진만 다시 촬영할 수 있어요." : "촬영하면 다음 부위로 이동해요. 마지막에 한 번에 확인해요.", "이웃이 확인할 대여료와 대여 가능 기간을 입력해 주세요."];
  const intro = `<div class="registration-stage-heading"><span>${step + 1} / 3</span><h2 id="registration-stage-title" tabindex="-1">${titles[step]}</h2><p>${hints[step]}</p></div>`;
  const assist = `<button type="button" class="registration-assist" data-action="draft">${icon("sparkle")}작성 도움받기${icon("right")}</button>`;
  let content;
  if (step === 0) content = `<div class="registration-fields">
    <label>물품명<input name="title" maxlength="48" placeholder="예: 미니 빔프로젝터" value="${escape(fields.title)}" required></label>
    ${assist}
    <label>카테고리<select name="category" required><option value="">선택해 주세요</option>${categories.slice(1).map((name) => `<option ${fields.category === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>
    <label>물품 설명<textarea name="description" rows="5" maxlength="600" placeholder="사용감, 작동 상태, 함께 빌려주는 구성품을 알려 주세요." required>${escape(fields.description)}</textarea></label>
    <label>거래 지역<select name="neighborhood">${neighborhoods.map((name) => `<option ${fields.neighborhood === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>
  </div>`;
  else if (step === 1) content = listingPhotoPanel(draft, escape);
  else content = `<div class="registration-fields">
    <button type="button" class="registration-summary" data-action="listing-review-photos">${cover ? `<img src="${escape(cover.preview || photoUrl(cover.source))}" alt="선택한 대표 사진">` : ""}<span><strong>${escape(fields.title)}</strong><small>${escape(fields.category)} · 사진 ${draft.photos.length}장</small></span>${icon("right")}</button>
    <label>하루 대여료 (원)<input type="number" name="price" inputmode="numeric" min="0" max="10000000" step="1" placeholder="하루 기준 금액" value="${escape(fields.price)}" required></label>
    <label>보증금 (원)<input type="number" name="deposit" inputmode="numeric" min="0" max="10000000" step="1" placeholder="없으면 0원" value="${escape(fields.deposit)}"></label>
    <fieldset><legend>대여 가능 기간 <span class="hint">선택</span></legend><div class="field-pair">
      <label>시작일<input name="start" type="date" min="${localDay()}" value="${escape(fields.start)}"></label>
      <label>종료일<input name="end" type="date" min="${fields.start || localDay()}" value="${escape(fields.end)}"></label>
    </div><p class="hint registration-date-hint">기간을 정하려면 시작일과 종료일을 모두 선택해 주세요.</p></fieldset>
  </div>`;
  return `<form class="form-card plain registration-form registration-wizard" data-form="register" data-step="${step}" novalidate aria-labelledby="registration-stage-title">
    <ol class="registration-steps" aria-label="물품 등록 단계">${steps.map((name, i) => {
      const complete = i < step && !validateListingStep(draft, i);
      return `<li${i === step ? ' aria-current="step"' : ""} class="${complete ? "done" : ""}"><span>${complete ? icon("check") : i + 1}</span><strong>${name}</strong></li>`;
    }).join("")}</ol>
    ${intro}${content}
    <p class="form-error" role="alert" tabindex="-1" hidden></p>
    <div class="registration-actions">${step ? '<button type="button" class="button secondary" data-action="listing-prev">이전</button>' : ""}
      <button class="button primary" type="submit" ${draft.busy ? "disabled" : ""}>${draft.busy ? "게시하고 있어요…" : ["사진 촬영으로", "대여 조건으로", "물품 게시하기"][step]}</button>
    </div>
  </form>`;
}

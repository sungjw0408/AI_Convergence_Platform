import { conditions } from "./listing-advice.js";
import { depositPolicyLabel, depositQuote, DEPOSIT_PENDING, itemValueFrom } from "./listing-pricing.js";
import { icon } from "./icons.js?v=rento-home-5-ren";
import { categories, localDay, neighborhoods } from "./model.js?v=rento-home-5-ren";
import { listingPhotoPanel, introductionPhotoPanel } from "./listing-photo-view.js";
import { validateListingStep } from "./listing-registration.js";

const won = (amount) => new Intl.NumberFormat("ko-KR").format(amount) + "원";

export function depositPreview(fields, policy, escape) {
  const quote = depositQuote(itemValueFrom(fields), policy);
  return `<p id="deposit-preview" class="hint" aria-live="polite">${quote
    ? `예상 보증금 ${won(quote.amountWon)} · 가액 근거 확인 대기`
    : policy ? "가액과 근거를 입력하면 예상 보증금을 계산해요."
    : `${DEPOSIT_PENDING} · 확정될 때까지 새 물품의 대여 신청은 대기해요.`}</p>`;
}

export function valuationFields(fields, policy, escape) {
  return `<fieldset class="stack compact"><legend>물품 가액과 보증금</legend>
    <label>현재 중고 가액 (원)<input type="number" name="valueWon" inputmode="numeric" min="1" max="100000000" step="1" value="${escape(fields.valueWon)}" required></label>
    <label>가액 근거<textarea name="valueEvidence" rows="2" maxlength="500" placeholder="예: 비교한 중고 거래 링크와 확인일" required>${escape(fields.valueEvidence)}</textarea></label>
    ${policy ? `<p class="hint">${escape(depositPolicyLabel(policy))}</p>` : ""}
    ${depositPreview(fields, policy, escape)}
  </fieldset>`;
}

export function listingEditForm(item, escape) {
  const options = (choices, current) => choices.map((choice) =>
    `<option ${choice === current ? "selected" : ""}>${escape(choice)}</option>`).join("");
  return `<form class="form-card plain" data-form="listing-edit" data-id="${escape(item.id)}">
    <label>물품명<input name="title" value="${escape(item.title)}" maxlength="48" required></label>
    <label>카테고리<select name="category" required>${options(categories.slice(1), item.category)}</select></label>
    <label>물품 설명<textarea name="description" rows="4" maxlength="600" required>${escape(item.description)}</textarea></label>
    <label>거래 지역<select name="neighborhood" required>${options(neighborhoods, item.neighborhood)}</select></label>
    <label>하루 대여료 (원)<input type="number" name="price" min="0" max="10000000" step="1" value="${escape(item.price)}" required></label>
    <fieldset class="stack compact">
      <legend>대여 가능 기간</legend>
      <div class="field-pair">
        <label>시작일<input type="date" name="start" value="${escape(item.availableFrom)}"></label>
        <label>종료일<input type="date" name="end" value="${escape(item.availableTo)}"></label>
      </div>
      <p class="hint">날짜를 모두 비우면 기간 제한이 없어요.</p>
    </fieldset>
    <p class="form-error" role="alert" hidden></p>
    <button class="button primary" type="submit">변경 사항 저장</button>
  </form>`;
}

export function priceRecommendationForm(kind, fields, policy, escape) {
  const deposit = kind === "value";
  return `<div class="listing-price-dialog stack compact">
    <form class="form-card plain" data-form="listing-price-advice" data-id="${kind}">
      <p class="hint">${escape(fields.title)} · ${escape(fields.neighborhood)}</p>
      <label><span>브랜드·모델명 <small class="hint">선택</small></span>
        <input name="modelName" maxlength="80" value="${escape(fields.modelName)}" placeholder="예: Jabra Speak2 40"></label>
      <label>현재 상태
        <select name="condition" required><option value="">상태를 선택해 주세요</option>
          ${conditions.map((condition) => `<option ${fields.condition === condition ? "selected" : ""}>${condition}</option>`).join("")}
        </select></label>
      <details class="listing-price-extra"><summary>구매 시기와 사용 이력 <span class="hint">선택</span></summary>
        <label>구매 시기<input type="month" name="purchaseMonth" max="${localDay().slice(0, 7)}" value="${escape(fields.purchaseMonth)}"></label>
        <label>사용 이력<textarea name="usageHistory" rows="2" maxlength="250">${escape(fields.usageHistory)}</textarea></label>
      </details>
      <p class="form-error" role="alert" hidden></p>
      <button class="button primary" type="submit">${deposit ? "웹에서 중고가 찾기" : "대여료 추천받기"}</button>
      <div class="listing-price-output" aria-live="polite"></div>
    </form>
    ${deposit ? `<details class="listing-price-extra" ${fields.valueWon ? "open" : ""}>
      <summary>중고 가액 직접 입력</summary>
      <form class="form-card plain" data-form="listing-deposit-basis">
        ${valuationFields(fields, policy, escape)}
        <p class="form-error" role="alert" hidden></p>
        <button type="submit" class="button secondary">이 가액으로 보증금 계산</button>
      </form>
    </details>` : ""}
  </div>`;
}

function priceSources(references, escape) {
  return `<ul class="listing-price-sources">${references.map((ref) => `<li>
    <a href="${escape(ref.url.startsWith("#") ? "./" + ref.url : ref.url)}" target="_blank" rel="noopener noreferrer">${escape(ref.title)}</a>
    <span>${won(ref.amountWon)}</span>
    <small>${escape(ref.source)}${ref.neighborhood ? ` · ${escape(ref.neighborhood)}` : ""}${ref.observedOn ? ` · ${escape(ref.observedOn)} 확인` : ""}</small>
  </li>`).join("")}</ul>`;
}

export function priceRecommendationResult(kind, result, policy, escape) {
  if (result.message) return `<p class="hint" role="status">${escape(result.message)}</p>`;
  const deposit = kind === "value";
  const referenceCount = result.references.length;
  const recorded = result.match === "recorded-used";
  const singleRecorded = recorded && referenceCount === 1;
  const minimum = Math.min(...result.references.map((ref) => ref.amountWon));
  const maximum = Math.max(...result.references.map((ref) => ref.amountWon));
  const range = `${won(minimum)}~${won(maximum)}`;
  const quote = deposit && depositQuote(result, policy);
  const sample = result.match === "demo";
  const rateLabel = sample ? "시연용 대여료" : "추천 대여료";
  const rateBasis = sample ? "렌토 시연용 가격" : "Gemini가 고른 비교 사례";
  const usedBasis = recorded ? "확인한 과거 중고 게시가" : "Gemini가 고른 동일 모델의 판매 중 게시가";
  const summary = deposit
    ? `<strong>${referenceCount > 1 ? `중고 게시가 범위 ${range}` : `중고 게시가 ${won(result.amountWon)}`}</strong>
       <p class="hint">${usedBasis} ${referenceCount}건${referenceCount > 1 ? ` · 중앙값 ${won(result.amountWon)}` : " · 참고 가격"}</p>`
    : `<strong>${rateLabel} 하루 ${won(result.amountWon)}</strong>
       <p class="hint">${rateBasis} ${referenceCount}건의 중앙값 · ${range}</p>`;
  return `<div class="listing-price-result stack compact">
    ${summary}
    ${quote ? `<strong>${singleRecorded ? "참고 보증금" : "예상 보증금"} ${won(quote.amountWon)}</strong><p class="hint">${escape(depositPolicyLabel(policy))}</p>` : ""}
    ${deposit ? '<p class="hint">물품 상태와 구성품을 확인한 뒤 중고 가액을 정해 주세요.</p>' : ""}
    ${priceSources(result.references, escape)}
    ${singleRecorded ? "" : `<button type="button" class="button secondary" data-action="listing-apply-price">${deposit ? "이 가액으로 보증금 적용" : "이 대여료 적용"}</button>`}
  </div>`;
}

const steps = ["기본 정보", "사진 촬영", "대여 조건"];
const providers = { gemini: "Gemini", ollama: "Ollama" };

export function registrationForm(draft, escape, policy = null) {
  const { fields, step } = draft;
  const titles = ["어떤 물품을 빌려주시나요?", draft.photoMode === "review" ? "촬영한 사진을 확인해 주세요" : "물품의 여러 부위를 촬영해요", "대여 조건을 정해 주세요"];
  const hints = ["물품 상태와 함께 제공하는 구성품을 소개해 주세요.", draft.photoMode === "review" ? "대표 사진을 고르고, 필요한 사진만 다시 촬영할 수 있어요." : "촬영하면 다음 부위로 이동해요. 마지막에 한 번에 확인해요."];
  const intro = `<div class="registration-stage-heading">${step < 2 ? `<span>${step + 1} / 3</span>` : ""}<h2 id="registration-stage-title" tabindex="-1">${titles[step]}</h2>${hints[step] ? `<p>${hints[step]}</p>` : ""}</div>`;
  const provider = providers[draft.advice?.source];
  const assist = `<button type="button" class="registration-assist" data-action="draft" ${draft.adviceBusy ? "disabled" : ""}>${icon("sparkle")}${draft.adviceBusy ? "제안을 불러오는 중…" : "작성 도움받기"}${icon("right")}</button>
    ${draft.advice?.title === fields.title.trim() ? `<div class="stack compact" aria-live="polite">
      <strong>${provider ? `${provider} 제안 · ${escape(draft.advice.model)}` : "규칙 기반 작성 예시"}</strong>
      <p class="hint">분류 · ${escape(draft.advice.category || "직접 선택")}</p>
      <p>${escape(draft.advice.description)}</p>
      ${draft.advice.category ? '<button type="button" class="button secondary" data-action="apply-category">분류 적용</button>' : ""}
      <button type="button" class="button secondary" data-action="apply-draft">초안 적용</button>
    </div>` : ""}`;
  let content;
  if (step === 0) content = `<div class="registration-fields">
    ${introductionPhotoPanel(draft, escape)}
    <label>물품명<input name="title" maxlength="48" placeholder="예: 미니 빔프로젝터" value="${escape(fields.title)}" required></label>
    ${assist}
    <label>카테고리<select name="category" required><option value="">선택해 주세요</option>${categories.slice(1).map((name) => `<option ${fields.category === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>
    <label>물품 설명<textarea name="description" rows="5" maxlength="600" placeholder="사용감, 작동 상태, 함께 빌려주는 구성품을 알려 주세요." required>${escape(fields.description)}</textarea></label>
    <label>거래 지역<select name="neighborhood">${neighborhoods.map((name) => `<option ${fields.neighborhood === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>
  </div>`;
  else if (step === 1) content = listingPhotoPanel(draft, escape);
  else {
    const value = itemValueFrom(fields);
    const quote = depositQuote(value, policy);
    content = `<div class="listing-terms">
      <section class="listing-term" aria-labelledby="term-rate">
        <header><h3 id="term-rate">하루 대여료</h3>
          <button type="button" class="listing-term-recommend" data-action="listing-price-recommend" data-id="rate" aria-label="하루 대여료 렌토 추천">${icon("sparkle")}렌토 추천</button>
        </header>
        <label class="listing-term-amount"><span class="sr-only">하루 대여료 (원)</span>
          <input type="number" name="price" inputmode="numeric" min="0" max="10000000" step="1" placeholder="금액 입력" value="${escape(fields.price)}" required>
          <span aria-hidden="true">원 / 일</span>
        </label>
      </section>
      <section class="listing-term" aria-labelledby="term-deposit">
        <header><h3 id="term-deposit">보증금</h3>
          <button type="button" class="listing-term-recommend" data-action="listing-price-recommend" data-id="value" aria-label="보증금 렌토 추천">${icon("sparkle")}렌토 추천</button>
        </header>
        <p class="listing-term-quote">${quote ? won(quote.amountWon) : value ? DEPOSIT_PENDING : "중고 가액을 정해 주세요"}</p>
        ${policy ? `<p class="hint">${value ? `중고 가액 ${won(value.amountWon)} · ` : ""}${escape(depositPolicyLabel(policy))}</p>` : ""}
      </section>
      <section class="listing-term" aria-labelledby="term-period">
        <header><h3 id="term-period">대여 가능 기간</h3><span class="hint">선택</span></header>
        <div class="field-pair">
          <label>시작일<input name="start" type="date" min="${localDay()}" value="${escape(fields.start)}"></label>
          <label>종료일<input name="end" type="date" min="${fields.start || localDay()}" value="${escape(fields.end)}"></label>
        </div>
      </section>
    </div>`;
  }
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

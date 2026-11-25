import { icon } from "./icons.js?v=rento-home-5-ren";
import { photoUrl } from "./photo-store.js";
import { comparisonSummary, currentResult, inspectionRecord } from "./inspection.js";

function markers(result) {
  return (result?.regions || []).map(([x, y, w, h], i) =>
    `<span class="diff-box" style="left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%"><b>${i+1}</b></span>`).join("");
}

function photo(record, view, phase, escape, enlarged = false) {
  const source = photoUrl(record[phase][view.id]?.source);
  const label = phase === "before" ? "대여 전" : "반납 후";
  const result = currentResult(record, view.id);
  const content = source ? `<div class="diff-canvas"><img src="${escape(source)}" alt="${escape(view.label)} ${label} 사진">${phase === "after" ? markers(result) : ""}</div>`
    : `<div class="inspection-photo-empty">${icon("photo")}<span>${record[phase][view.id] ? "사진을 불러올 수 없어요" : "사진 등록 전"}</span></div>`;
  return `<figure class="inspection-photo">${!enlarged && source ? `<button type="button" data-action="view-inspection" data-id="${view.id}" aria-label="${escape(view.label)} ${label} 사진 확대">${content}</button>` : content}
    <figcaption>${label}${enlarged && source && record[phase][view.id]?.capturedAt ? ` · <a href="${escape(source)}" download="${phase}-original.png">원본 저장</a>` : ""}</figcaption></figure>`;
}

const retakeMessage = (result) => {
  const phase = result.failedPhoto === "before" ? "대여 전 사진" : "반납 사진";
  return ({ blur: `${phase}이 흐려 자세한 상태를 확인하기 어려워요.`, dark: `${phase}이 너무 어두워요.`,
    bright: `${phase}에 강한 빛이 있어 세부 모습이 보이지 않아요.`,
    alignment: "같은 부위를 비슷한 거리와 각도로 촬영해 주세요.",
    appearance: "조명이나 구도 차이가 커서 상태를 비교하기 어려워요." })[result.reason] || "두 사진을 비교하기 어려워요. 같은 부위가 선명하게 보이도록 다시 찍어 주세요.";
};

export function inspectionCard(rental, item, feedback, selected, escape) {
  const record = inspectionRecord(rental, item);
  if (!Object.keys(record.before).length && !Object.keys(record.after).length) return "";
  const views = record.plan.views;
  const view = views.find((v) => v.id === selected)
    || views.find((v) => currentResult(record, v.id)?.status === "changes")
    || views.find((v) => currentResult(record, v.id)?.status === "retake") || views[0];
  const result = currentResult(record, view.id);
  const summary = comparisonSummary(record, feedback);
  const pair = Boolean(record.before[view.id] && record.after[view.id]);
  const waiting = !Object.keys(record.after).length;
  return `<section class="inspection-card" aria-labelledby="inspection-title">
    <div class="inspection-heading"><h2 id="inspection-title">물품 상태 확인</h2><span>${views.length}개 부위</span></div>
    <div class="inspection-summary ${summary.kind}" role="status">${icon(summary.kind === "clear" ? "check" : "photo")}<div><strong>${summary.title}</strong><p>${summary.detail}</p></div></div>
    ${views.length > 1 ? `<div class="inspection-tabs" aria-label="촬영 부위">${views.map((v) => {
      const r = currentResult(record, v.id);
      return `<button type="button" data-action="inspection-view" data-id="${v.id}" aria-pressed="${v.id === view.id}">${escape(v.label)}${["changes", "retake"].includes(r?.status) ? '<span class="inspection-dot" aria-label="확인 필요"></span>' : ""}</button>`;
    }).join("")}</div>` : `<p class="inspection-view-name">${escape(view.label)}</p>`}
    <div class="inspection-pair">${photo(record, view, "before", escape)}${photo(record, view, "after", escape)}</div>
    ${pair ? `<div class="inspection-detail">${!view.compare ? '<p>사진과 함께 구성품·실물 상태를 직접 확인해 주세요.</p>'
      : result?.status === "changes" ? `<p><strong>표시된 ${result.regions.length}곳을 확인해 주세요.</strong> 빛이나 그림자 때문에 다르게 보일 수도 있어요.</p>`
      : result?.status === "retake" ? `<p>${retakeMessage(result)}</p><p>반납 요청은 유지돼요. 재촬영하거나 상대방과 상태를 확인해 주세요.</p>`
      : result?.status === "clear" ? '<p>이 부위에서 눈에 띄는 변화가 발견되지 않았어요.</p>' : ""}</div>` : ""}
    ${record.plan.checks.length ? `<details class="inspection-check-summary"><summary>구성품·작동 확인</summary><ul>${record.plan.checks.map((check) => `<li><span>${escape(check.label)}</span><small>대여 전 ${(record.beforeChecks || []).includes(check.id) ? "확인" : "미확인"} · 반납 ${(record.afterChecks || []).includes(check.id) ? "확인" : "확인 전"}</small></li>`).join("")}</ul></details>` : ""}
    ${record.beforeNote || record.afterNote ? `<div class="inspection-notes">${record.beforeNote ? `<p><strong>대여 전 메모</strong><span>${escape(record.beforeNote)}</span></p>` : ""}${record.afterNote ? `<p><strong>반납 메모</strong><span>${escape(record.afterNote)}</span></p>` : ""}</div>` : ""}
    ${!waiting && views.some((v) => v.compare) ? `<button class="inspection-retry" type="button" data-action="analyze-trade" ${feedback?.busy ? "disabled" : ""}>${feedback?.busy ? "사진 확인 중…" : feedback?.error || views.some((v) => v.compare && !currentResult(record, v.id)) ? "사진 확인 다시 시도" : "사진 다시 확인"}</button>` : ""}
  </section>`;
}

export function inspectionPhotoDialog(rental, item, viewId, escape) {
  const record = inspectionRecord(rental, item);
  const view = record.plan.views.find((v) => v.id === viewId);
  return view ? `<div class="inspection-enlarged">${photo(record, view, "before", escape, true)}${photo(record, view, "after", escape, true)}</div>` : "";
}

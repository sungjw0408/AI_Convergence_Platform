// Photos are sent only to the comparison service on the app's own origin.
import { photoBlob, photoUrl } from "./photo-store.js";

export async function comparePhotos(before, after, options = {}) {
  const form = new FormData();
  for (const [name, source] of Object.entries({ before, after })) {
    form.append(name, await photoBlob(source), name + ".img");
  }
  form.set("method", options.method || "lpips");
  form.set("mode", options.mode || "pipeline");
  let response;
  try {
    response = await fetch("/api/photo-comparison", {
      method: "POST", body: form, signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error("비교 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !["retake", "changes", "clear"].includes(result?.status)) {
    throw new Error(result?.error || "AI 비교 서버를 실행한 뒤 다시 시도해 주세요.");
  }
  return result;
}

const reasons = {
  blur: "사진이 심하게 흐려요. 물품에 초점을 맞추고 흔들리지 않게 다시 촬영해 주세요.",
  dark: "사진이 너무 어두워요. 밝은 곳에서 다시 촬영해 주세요.",
  bright: "사진이 너무 밝아 세부 모습이 사라졌어요. 강한 빛과 반사를 피해 주세요.",
  alignment: "대응하는 특징을 충분히 찾지 못했어요. 같은 면을 비슷한 크기와 각도로 맞춰 주세요.",
  appearance: "사진 전반의 차이가 커서 손상과 촬영 환경의 차이를 구분하기 어려워요.",
  size: "모델 단독 비교는 가로·세로 크기가 같은 사진 두 장이 필요해요.",
};
export function diagnosticMarkup(result, escape) {
  if (!result?.stages) return "";
  const names = { quality: "기본 화질", alignment: "특징 정합·정렬", comparison: "변화 비교" };
  const statuses = { passed: "통과", blocked: "보류", skipped: "생략" };
  return `<div class="comparison-diagnostics"><ol>${result.stages.map((stage) => `<li class="${stage.status}">${names[stage.name]} <b>${statuses[stage.status]}</b></li>`).join("")}</ol>
    <p class="hint">${escape(result.model)} · ${(result.durationMs / 1000).toFixed(2)}초 (서버 처리)</p>
    <p class="hint">특징 정합은 동일 면을 보증하지 않으며, 화질 검사는 가림·반사를 모두 검출하지 못해요.</p></div>`;
}

function locationText([x, y, width, height]) {
  const cx = x + width / 2, cy = y + height / 2;
  const col = cx < 1 / 3 ? "왼쪽" : cx > 2 / 3 ? "오른쪽" : "가운데";
  const row = cy < 1 / 3 ? "위" : cy > 2 / 3 ? "아래" : "중간";
  return col + " " + row;
}

export function comparisonResult(result, after, escape) {
  if (!result) return "";
  if (result.status === "retake") {
    const who = result.failedPhoto === "before" ? "인도 사진: " : result.failedPhoto === "after" ? "반납 사진: " : "";
    return `<p class="notice"><strong>현재 사진으로 비교하기 어려워요</strong><br>${who}${escape(reasons[result.reason] || "같은 면을 비슷한 거리와 조명에서 다시 촬영해 주세요.")}</p>${diagnosticMarkup(result, escape)}`;
  }
  if (result.status === "clear") {
    return '<p class="notice"><strong>뚜렷한 변화 후보가 없어요</strong><br>미세한 흠집이나 작동 상태는 직접 확인해 주세요.</p>' + diagnosticMarkup(result, escape);
  }
  const regions = result.regions;
  const boxes = regions.map(([x, y, w, h], i) =>
    `<span class="diff-box" style="left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%"><b>${i+1}</b></span>`).join("");
  return `<section class="diff-result"><h3>변화 후보 ${regions.length}곳</h3>
    <div class="diff-canvas"><img src="${escape(photoUrl(after))}" alt="변화 후보를 표시한 반납 사진">${boxes}</div>
    <ol class="diff-locations">${regions.map((box, i) => `<li><b>${i+1}</b> ${locationText(box)}</li>`).join("")}</ol>
    <p class="hint">표시된 위치를 원본과 대조해 주세요. 반사나 그림자도 변화로 보일 수 있어요.</p>${diagnosticMarkup(result, escape)}</section>`;
}

const labels = { clear: "후보 없음", changes: "변화 후보", retake: "비교 보류" };

function summary(cases, key) {
  const applicable = cases.filter((c) => c[key]);
  const damaged = applicable.filter((c) => c.expected === "changes");
  const clear = applicable.filter((c) => c.expected === "clear");
  return `<div class="evaluation-metrics"><p><strong>${applicable.filter((c) => c[key].passed).length}/${applicable.length}</strong><span>기대 결과 일치</span></p>
    <p><strong>${damaged.filter((c) => c[key].targetHit).length}/${damaged.length}</strong><span>목표 지점 포함</span></p>
    <p><strong>${clear.filter((c) => c[key].status === "changes").length}/${clear.length}</strong><span>정상 사례 오탐</span></p>
    <p><strong>${applicable.filter((c) => c[key].status === "retake").length}/${applicable.length}</strong><span>전체 비교 보류</span></p></div>`;
}

function boxes(result) {
  return result.regions.map(([x, y, w, h], i) => `<span class="diff-box" style="left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%"><b>${i+1}</b></span>`).join("");
}

export function evaluationPage(state, pageHeader, escape) {
  const cases = state.result?.cases || [];
  return pageHeader("사진 비교 평가", "#dev/compare") + `<div class="content stack">
    <section class="stack compact"><h2>같은 조건으로 다시 확인하기</h2>
      <p>시연 사진과 인공 변형 9건을 LPIPS와 픽셀 차이 방식으로 비교해요. 모델 단독 비교는 미리 위치가 맞춰진 3건으로 실행해요.</p>
      <p class="notice">개발용 점검 자료예요. 실제 대여 사진의 정확도나 손상 판정 성능을 의미하지 않아요.</p>
      <button class="button primary" data-action="run-evaluation" ${state.busy ? "disabled" : ""}>${state.busy ? "9가지 사례 평가 중…" : "평가 실행"}</button>
      ${state.error ? `<p class="form-error" role="alert">${escape(state.error)}</p>` : ""}
      <p class="hint" aria-live="polite">${state.busy ? "사진의 품질 검사, 정렬, 모델 비교를 차례로 실행하고 있어요." : ""}</p></section>
    ${cases.length ? `<section><h2>전체 흐름 · LPIPS</h2>${summary(cases, "model")}</section>
      <section><h2>전체 흐름 · 픽셀 차이</h2>${summary(cases, "pixel")}</section>
      <details><summary>모델 단독 · LPIPS (정렬된 3건)</summary>${summary(cases, "isolated")}</details>
      <p class="hint">정상 사례에서 비교 보류된 건은 오탐 수에 포함되지 않지만, 기대 결과 불일치에 포함돼요. 목표 지점 포함은 후보 상자가 지정 지점을 포함하는지만 확인해요.</p>
      <button class="button secondary" data-action="download-evaluation">평가 결과 JSON 저장</button>
      <section class="stack"><h2>사례별 결과</h2>${cases.map((c) => `<article class="evaluation-case">
        <div class="evaluation-case-title"><h3>${escape(c.name)}</h3><span class="evaluation-tag ${c.model.passed ? "pass" : "fail"}">${c.model.passed ? "일치" : "확인 필요"}</span></div>
        <p class="hint">기대 결과 · ${labels[c.expected]}</p><div class="comparison"><figure><img src="${c.before}" alt="${escape(c.name)} 인도 사진"><figcaption>인도</figcaption></figure>
        <figure><div class="diff-canvas"><img src="${c.after}" alt="${escape(c.name)} 반납 사진">${boxes(c.model)}${c.target ? `<span class="evaluation-target" style="left:${c.target[0]*100}%;top:${c.target[1]*100}%" title="확인할 목표 지점">+</span>` : ""}</div><figcaption>반납 · LPIPS 후보</figcaption></figure></div>
        <dl class="evaluation-results"><dt>LPIPS</dt><dd>${labels[c.model.status]} · ${c.model.regions.length}곳 · ${c.model.durationMs}ms</dd>
          <dt>픽셀 차이</dt><dd>${labels[c.pixel.status]} · ${c.pixel.regions.length}곳 · ${c.pixel.durationMs}ms</dd>
          ${c.isolated ? `<dt>모델 단독</dt><dd>${labels[c.isolated.status]} · ${c.isolated.durationMs}ms</dd>` : ""}</dl>
        ${c.expected === "retake" ? `<p class="hint">보류 사유 · ${escape(c.model.reason || "없음")}</p>` : ""}</article>`).join("")}</section>
      <p class="notice">${escape(state.result.limitations)}</p>` : ""}</div>`;
}

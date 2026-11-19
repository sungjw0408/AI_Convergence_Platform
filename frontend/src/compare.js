// Photos are sent only to the comparison service on the app's own origin.
export async function comparePhotos(before, after) {
  const form = new FormData();
  for (const [name, source] of Object.entries({ before, after })) {
    const url = new URL(source, document.baseURI);
    if (url.protocol !== "data:" && url.origin !== location.origin) {
      throw new Error("이 앱에서 등록한 사진을 선택해 주세요.");
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error("비교할 사진을 열 수 없어요.");
    form.append(name, await response.blob(), name + ".img");
  }
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

function locationText([x, y, width, height]) {
  const cx = x + width / 2, cy = y + height / 2;
  const col = cx < 1 / 3 ? "왼쪽" : cx > 2 / 3 ? "오른쪽" : "가운데";
  const row = cy < 1 / 3 ? "위" : cy > 2 / 3 ? "아래" : "중간";
  return col + " " + row;
}

export function comparisonResult(result, after, escape) {
  if (!result) return "";
  if (result.status === "retake") {
    return '<p class="notice"><strong>현재 사진으로 비교하기 어려워요</strong><br>같은 면이 비슷한 크기로 보이도록 촬영해 주세요. 조명과 배경도 맞추면 좋아요.</p>';
  }
  if (result.status === "clear") {
    return '<p class="notice"><strong>뚜렷한 변화 후보가 없어요</strong><br>미세한 흠집이나 작동 상태는 직접 확인해 주세요.</p>';
  }
  const regions = result.regions;
  const boxes = regions.map(([x, y, w, h], i) =>
    `<span class="diff-box" style="left:${x*100}%;top:${y*100}%;width:${w*100}%;height:${h*100}%"><b>${i+1}</b></span>`).join("");
  return `<section class="diff-result"><h3>변화 후보 ${regions.length}곳</h3>
    <div class="diff-canvas"><img src="${escape(after)}" alt="변화 후보를 표시한 반납 사진">${boxes}</div>
    <ol class="diff-locations">${regions.map((box, i) => `<li><b>${i+1}</b> ${locationText(box)}</li>`).join("")}</ol>
    <p class="hint">표시된 위치를 원본과 대조해 주세요. 반사나 그림자도 변화로 보일 수 있어요.</p></section>`;
}

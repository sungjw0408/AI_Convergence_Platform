const view = (id, label, instruction, compare = true) => ({ id, label, instruction, compare });
const plan = (id, views, checks = []) => ({ id, version: 1, views,
  checks: checks.map((label, i) => ({ id: `check-${i}`, label })) });

export function inspectionPlan(item) {
  const title = item.title || "";
  if (/텐트|타프|침낭|가방|의류/.test(title)) return plan("manual-kit", [
    view("packed", "보관 상태", "포장 또는 보관 상태가 전체적으로 보이게 찍어 주세요.", false),
    view("contents", "구성품", "꺼내서 확인할 수 있는 구성품을 함께 찍어 주세요.", false),
  ], ["구성품 종류와 수량을 상대방과 확인했어요", "사진으로 확인하기 어려운 오염·손상 여부를 상대방과 확인했어요"]);
  if (/드릴/.test(title)) return plan("drill", [
    view("left", "왼쪽 면", "손잡이와 본체가 모두 보이도록 왼쪽 옆면을 찍어 주세요."),
    view("right", "오른쪽 면", "본체 반대편과 버튼이 보이도록 찍어 주세요."),
    view("chuck", "앞면 · 척", "비트를 고정하는 척과 본체 앞부분을 찍어 주세요."),
    view("battery", "하단 · 배터리", "배터리 연결부와 하단 상태를 찍어 주세요."),
  ], ["전원과 회전 작동을 확인했어요", "배터리·충전기·비트 등 약속한 구성품을 확인했어요"]);
  if (/프로젝터|빔/.test(title)) return plan("projector", [
    view("front", "앞면 · 렌즈", "렌즈와 앞면이 선명하게 보이도록 찍어 주세요."),
    view("rear", "뒷면 · 연결부", "전원과 영상 연결 단자가 보이도록 찍어 주세요."),
    view("left", "왼쪽 면", "본체 왼쪽 옆면 전체를 찍어 주세요."),
    view("right", "오른쪽 면", "본체 오른쪽 옆면 전체를 찍어 주세요."),
  ], ["전원과 화면 출력을 확인했어요", "리모컨·전원 어댑터 등 약속한 구성품을 확인했어요"]);
  if (/사다리/.test(title)) return plan("ladder", [
    view("whole", "펼친 전체 모습", "사다리를 안전하게 펼치고 전체가 보이도록 찍어 주세요."),
    view("steps", "발판", "발판의 변형이나 균열을 확인할 수 있게 찍어 주세요."),
    view("hinges", "힌지 · 고정부", "접히는 부분과 고정부를 가까이 찍어 주세요."),
  ], ["펼침·접힘과 고정 상태를 확인했어요"]);
  return plan("general", [
    view("front", "앞면", "물품 앞면 전체가 보이도록 찍어 주세요."),
    view("back", "뒷면", "물품을 돌려 뒷면 전체를 찍어 주세요."),
    view("detail", "주요 사용 부위", "손잡이·연결부 등 상태 확인이 필요한 부분을 찍어 주세요."),
  ], ["약속한 구성품과 작동 상태를 확인했어요"]);
}

// Older transactions retain their original evidence instead of inventing missing views.
export function inspectionRecord(rental, item) {
  if (rental.inspection) return rental.inspection;
  if (rental.before) return {
    plan: plan("legacy", [view("legacy", rental.photoFace || "물품 상태", "대여 전 사진과 같은 면·구도로 찍어 주세요.")]),
    before: { legacy: { ...rental.beforeEvidence, source: rental.before } },
    after: rental.after ? { legacy: { ...rental.afterEvidence, source: rental.after } } : {},
    results: rental.photoAnalysis ? { legacy: { ...rental.photoAnalysis, beforeSource: rental.before, afterSource: rental.after } } : {},
  };
  return { plan: item.inspectionPlan || inspectionPlan(item), before: {}, after: {}, results: {} };
}

export function currentResult(record, id) {
  if (record.beforePhotoSkipped || record.afterPhotoSkipped) return null;
  const result = record.results?.[id];
  return result?.beforeSource === record.before[id]?.source && result?.afterSource === record.after[id]?.source ? result : null;
}

export function inspectionSources(rental) {
  return [rental.before, rental.after, ...Object.values(rental.inspection?.before || {}).map((p) => p.source),
    ...Object.values(rental.inspection?.after || {}).map((p) => p.source)].filter(Boolean);
}

export function completeDraft(draft) {
  return draft.plan.views.every((v) => draft.photos[v.id]?.source || draft.photos[v.id]?.blob)
    && draft.plan.checks.every((c) => draft.checks.includes(c.id));
}

export function comparisonSummary(record, feedback) {
  if (record.beforePhotoSkipped || record.afterPhotoSkipped) return { kind: "manual", title: "사진 미등록 · AI 비교 생략", detail: "테스트용으로 사진 촬영을 생략한 거래예요. 물품 상태는 직접 확인해 주세요." };
  const views = record.plan.views.filter((v) => v.compare);
  const results = views.map((v) => currentResult(record, v.id));
  if (feedback?.busy) return { kind: "pending", title: "반납 사진을 확인하고 있어요", detail: `사진 확인 ${feedback.completed || 0}/${feedback.total || views.length}` };
  if (!Object.keys(record.after).length) return { kind: "waiting", title: "대여 전 상태를 기록했어요", detail: "반납할 때 같은 부위를 촬영해 상태를 확인해요." };
  if (!views.length) return { kind: "manual", title: "함께 상태를 확인해 주세요", detail: "구성품과 사진에 보이지 않는 부분은 직접 확인해 주세요." };
  const changes = results.filter((r) => r?.status === "changes").length;
  const retakes = results.filter((r) => r?.status === "retake").length;
  const missing = results.filter((r) => !r).length;
  if (changes) return { kind: "changes", title: "확인이 필요한 부분이 있어요", detail: `${changes}개 부위에 표시된 부분을 대여 전 사진과 비교해 주세요.${retakes || missing ? " 확인하지 못한 사진도 함께 살펴봐 주세요." : ""}` };
  if (retakes) return { kind: "retake", title: "사진을 다시 확인해 주세요", detail: `${retakes}개 부위를 비교하기 어려워요. 다시 촬영하거나 상대방과 직접 확인해 주세요.` };
  if (missing) return { kind: "pending", title: "사진 확인을 완료하지 못했어요", detail: "등록한 사진은 보관돼 있어요. 다시 시도하거나 상대방과 직접 확인해 주세요." };
  return { kind: "clear", title: "사진에서 눈에 띄는 변화가 없어요", detail: "구성품과 작동 상태도 확인한 뒤 반납을 마무리해 주세요." };
}

// Separate from participant conversations. Memory lasts for this browser tab only.
export const newAIConversation = () => ({messages: [], draft: "", busy: false, pending: "", error: "", model: ""});

export async function askAI(messages, items, today) {
  let response;
  try {
    response = await fetch("/api/ai-room", {
      method: "POST", headers: {"Content-Type": "application/json"},
      signal: AbortSignal.timeout(185_000), body: JSON.stringify({messages, items, today}),
    });
  } catch { throw new Error("AI 서버에 연결하지 못했어요. 서버 실행 상태를 확인한 뒤 다시 보내 주세요."); }
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.text !== "string" || !Array.isArray(result?.item_ids)) {
    throw new Error(result?.error || "AI 답변을 받지 못했어요. 다시 보내 주세요.");
  }
  return result;
}

export async function sendAIMessage(session, items, today, request = askAI) {
  if (session.busy) return false;
  const text = session.draft.trim();
  if (!text || text.length > 500) { session.error = "질문을 1~500자로 입력해 주세요."; return false; }
  if (session.messages.length >= 20) { session.error = "대화가 길어졌어요. 새 대화를 시작해 주세요."; return false; }
  session.busy = true;
  session.pending = text;
  session.draft = "";
  session.error = "";
  try {
    const result = await request([...session.messages.map(({role, text}) => ({role, text})), {role: "user", text}], items, today);
    const allowed = new Set(items.map(item => item.id));
    const ids = result.item_ids;
    if (typeof result.text !== "string" || !result.text.trim() || !Array.isArray(ids)
        || /\bitem_ids?\s*\[/i.test(result.text) || ids.length > 3
        || ids.some(id => typeof id !== "string" || !allowed.has(id))) throw new Error("AI 물품 정보를 확인할 수 없어요. 다시 보내 주세요.");
    session.messages.push({role: "user", text}, {role: "assistant", text: result.text, itemIds: [...new Set(ids)]});
    session.model = result.model;
    return true;
  } catch (error) {
    session.error = error.message;
    session.draft = text;
    return false;
  } finally {
    session.busy = false;
    session.pending = "";
  }
}

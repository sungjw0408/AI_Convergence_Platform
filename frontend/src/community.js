export const week = 7 * 86400000;
export function feedback(rental) {
  return {...(rental.review ? {renter: rental.review} : {}), ...rental.feedback};
}
export function seat(rental, uid) {
  return rental.renterId === uid ? "renter" : rental.lenderId === uid ? "lender" : null;
}
export function canReview(rental, uid, now = Date.now()) {
  const side = seat(rental, uid);
  return rental.status === "complete" && !!side && !feedback(rental)[side] &&
    Number.isFinite(rental.completedAt) && now >= rental.completedAt && now < rental.completedAt + week;
}
export function publicFeedback(rental, now = Date.now()) {
  const entries = feedback(rental);
  if (rental.status !== "complete") return {};
  if ((entries.renter && entries.lender) || now >= rental.completedAt + week) return entries;
  // Older, already published renter reviews have no completion timestamp.
  return !rental.completedAt && rental.review ? {renter: rental.review} : {};
}
export function reputation(rentals, uid) {
  const trades = rentals.filter(r => r.status === "complete" && seat(r, uid));
  const reviews = trades.flatMap(r => publicFeedback(r)[uid === r.renterId ? "lender" : "renter"] || []);
  return {completed: trades.length, reviews};
}
export function unread(messages, uid) {
  return (messages || []).filter(m => m.sender !== uid && !m.read).length;
}
export function quota(plan, month) {
  const granted = plan?.grants?.[month];
  if (!Number.isInteger(granted) || granted < 0) return null;
  return Math.max(0, granted - (plan.actions || []).filter(a => a.type === "promote" && a.month === month).length);
}

export function membershipPanel(uid, plan, listings, rentals, month, escape, demo) {
  const active = plan?.active === true;
  const balance = quota(plan, month);
  const history = plan?.actions || [];
  const own = listings.filter(i => i.owner === uid);
  const activeRentals = rentals.filter(r => r.renterId === uid && r.status === "active");
  const title = id => listings.find(i => i.id === id)?.title || "물품";
  const used = (type,target) => history.some(a => a.type === type && a.target === target &&
    (type === "pickup" || a.month === month));
  const button = (kind,id,text) => `<button class="button secondary" data-action="${kind}" data-id="${escape(id)}">${escape(text)}</button>`;
  return `<section class="content stack"><h2>내 혜택</h2><p>${active ? "구독 중" : "기본 이용자"} · ${month} 홍보권 ${active && balance !== null ? balance + "장 남음" : "지급 미설정"}</p>
    ${demo ? button("demo-subscription","",active ? "시연 구독 종료" : "시연 구독 시작") : ""}
    ${active && demo ? button("demo-grant","","이번 달 시연 홍보권 1장 지급") : ""}
    ${active && balance > 0 ? own.filter(i=>!used("promote",i.id)).map(i=>button("promote",i.id,i.title+" 홍보권 사용")).join("") : ""}
    ${active ? activeRentals.filter(r=>!used("pickup",r.id)).map(r=>button("pickup",r.id,title(r.itemId)+" 반납 픽업 신청")).join("") : ""}
    <h3>사용 내역</h3>${history.length ? history.map(a => `<p>${escape(a.month)} · ${escape(a.type === "promote" ? title(a.target)+" 홍보권 사용" : title(rentals.find(r=>r.id===a.target)?.itemId)+" 픽업 · "+(plan.pickupStatus?.[a.target] || "신청 접수"))}</p>`).join("") : "<p>아직 사용 내역이 없어요.</p>"}</section>`;
}

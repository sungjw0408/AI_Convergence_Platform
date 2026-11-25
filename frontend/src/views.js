import { comparisonResult } from "./compare.js";
import { icon } from "./icons.js?v=rento-home-5-ren";
import { categories, localDay, people, rentalDays, statuses } from "./model.js?v=rento-home-5-ren";

export function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export const won = (value) => new Intl.NumberFormat("ko-KR").format(value) + "원";
export const dates = (start, end) => start === end ? start : `${start} ~ ${end}`;
const empty = (heading, detail) => `<div class="empty"><strong>${heading}</strong><p>${detail}</p></div>`;
const badge = (status) => `<span class="badge" data-status="${status}">${statuses[status]}</span>`;
const button = (text, cls = "primary") => `<button class="button ${cls}" type="submit">${text}</button>`;

export function pageHeader(title, back) {
  return `<header class="page-header">
    ${back ? `<a class="icon-button" href="${back}" aria-label="뒤로">${icon("back")}</a>` : ""}
    <h1>${title}</h1>
  </header>`;
}

function image(item, classes = "", label = "") {
  return item.image
    ? `<img class="${classes}" src="${escape(item.image)}" alt="${escape(label)}">`
    : `<span class="photo-placeholder ${classes}" aria-label="등록된 사진 없음">${icon("photo")}</span>`;
}

export function listingRows(items, isFavorite, availability) {
  if (!items.length) return empty("조건에 맞는 물품이 없어요", "다른 검색어나 대여 날짜로 찾아보세요.");
  return items.map((item) => {
    const selected = isFavorite(item.id);
    const status = availability(item);
    return `<article class="listing">
      <a class="listing-link" href="#item/${item.id}">
        ${image(item, "listing-photo", item.title)}
        <div class="listing-info">
          <h3>${escape(item.title)}</h3>
          <p class="location">${escape(item.neighborhood)}${item.distance ? ` · ${escape(item.distance)}` : ""}</p>
          <div class="listing-bottom">
            <strong class="rate">${won(item.price)} <span>/ 일</span></strong>
            <span class="availability${status === "예약 중" ? " unavailable" : ""}">${status}</span>
          </div>
        </div>
      </a>
      <button class="icon-button favorite${selected ? " selected" : ""}" data-action="favorite" data-id="${item.id}" aria-pressed="${selected}" aria-label="${escape(item.title)} 관심 물품">${icon("heart")}</button>
    </article>`;
  }).join("");
}

export function home({ area, query, category, date, maxPrice, rows, unread }) {
  const categoryIcons = { "전체": "grid", "공구": "tool", "디지털": "digital", "생활용품": "living", "캠핑·레저": "tent" };
  const filterSummary = [date.start && dates(date.start, date.end), maxPrice !== null && `하루 ${won(maxPrice)} 이하`].filter(Boolean).join(" · ");
  return `
    <div class="home-hero">
    <header class="home-header">
      <h1 class="brand" aria-label="렌토 RENTO"><span class="brand-symbol">${icon("mark")}</span><span>RENTO</span></h1>
      <div class="header-actions">
        <button class="area-button" data-action="area" aria-label="동네 변경">${icon("pin")}<span>${area}</span>${icon("chevronDown")}</button>
        <button class="icon-button notification" data-action="notices" aria-label="알림">${icon("bell")}${unread ? '<i aria-label="새 알림"></i>' : ""}</button>
      </div>
    </header>
    <div class="hero-content">
      <div class="home-intro"><h2>사는 대신 빌려요,</h2><p class="brand-slogan" lang="en"><span class="slogan-ren">REN</span><span class="slogan-t">t</span>, <span class="slogan-to">TO</span>gether!</p><p class="hero-description">우리 동네에서 시작되는 새로운 공유 라이프</p></div>
      <label class="search">${icon("search")}<input id="search" type="search" aria-label="물품 검색" placeholder="어떤 물건을 빌릴까요?" value="${escape(query)}"></label>
    </div>
    </div>
    <div class="home-main">
      <div class="categories" aria-label="물품 분류">${categories.map((name) =>
        `<button type="button" class="chip" aria-pressed="${name === category}" data-action="category" data-id="${name}">${icon(categoryIcons[name])}<span>${name}</span></button>`).join("")}</div>
      <div class="shortcuts home-shortcuts">
        <button type="button" class="rental-date-button" data-action="filter-dates"><span class="date-icon">${icon("calendar")}</span><span class="date-copy"><strong>언제 빌릴까요?</strong><span>${date.start ? `${dates(date.start, date.end)} · 변경하기` : "대여할 날짜를 선택해 주세요"}</span></span>${icon("right")}</button>
        <button type="button" class="ai-recommend-card" data-action="recommend">${icon("sparkle")}<span class="ai-recommend-copy"><strong>뭘 빌려야 할지 고민된다면?</strong><span>렌토 AI가 필요한 물건을 찾아드려요</span></span>${icon("right")}</button>
      </div>
      ${filterSummary ? `<div class="applied-filter">${filterSummary}<button class="icon-button" data-action="clear-filters" aria-label="날짜 및 가격 필터 지우기">${icon("close")}</button></div>` : ""}
      <section aria-labelledby="listing-title">
        <div class="feed-title"><h2 id="listing-title">우리 동네 대여 물품</h2><a class="button primary add-link" href="#new">${icon("plus")}물품 등록</a></div>
        <div id="listings" aria-live="polite">${rows}</div>
      </section>
    </div>`;
}

export function rentalEstimate(item, start, end) {
  const days = rentalDays(start, end);
  if (!(days >= 1)) return "시작일과 종료일을 선택해 주세요.";
  const fee = item.price * days;
  return `대여료 ${won(fee)} (${days}일) + 보증금 ${won(item.deposit ?? 0)} = ${won(fee + (item.deposit ?? 0))}`;
}

export function itemPage(item, role, date) {
  return pageHeader("물품 상세", "#home") + `<div class="content">
    ${image(item, "detail-photo", item.title)}
    <section class="detail-info">
      <p class="muted">${escape(item.category)} · ${escape(item.neighborhood)}</p>
      <h2>${escape(item.title)}</h2>
      <p class="detail-rate">${won(item.price)} <span>/ 일</span></p>
      <p>보증금 · ${item.deposit ? won(item.deposit) + " (거래당 1회)" : "없음"}</p>
      <p>${escape(item.description)}</p>
      ${item.weekends ? '<p class="availability">주말 대여 가능</p>' : ""}
      ${item.availableFrom ? `<p class="availability">대여 가능 기간 · ${dates(item.availableFrom, item.availableTo)}</p>` : ""}
    </section>
    ${role === "admin" || role === item.owner ? '<p class="notice">대여자 프로필로 전환하면 이 물품에 대여를 신청할 수 있어요.</p>' :
    `<form data-form="request" data-id="${item.id}" class="form-card">
      <h2>대여 신청</h2>
      ${dateInputs(date)}
      <p id="estimate" aria-live="polite">${rentalEstimate(item, date.start, date.end)}</p>
      <p class="hint">신청 시 금액이 거래 내역에 저장돼요. 보증금 수령과 반환은 당사자가 직접 확인해 주세요.</p>
      <p class="form-error" role="alert" hidden></p>
      ${button("대여 신청하기")}
    </form>`}
  </div>`;
}

export function dateInputs(date = {}, { required = true } = {}) {
  const min = localDay();
  return `<div class="field-pair">
    <label>시작일<input name="start" type="date" min="${min}" value="${date.start ?? ""}" ${required ? "required" : ""}></label>
    <label>종료일<input name="end" type="date" min="${date.start || min}" value="${date.end ?? ""}" ${required ? "required" : ""}></label>
  </div>`;
}

export function registerPage(role, area) {
  return accountHeader("물품 등록", "쓰지 않는 물품에 새로운 쓰임을 더해요.", "plus") + `<div class="content register-content"><a class="page-back-link" href="#home">${icon("back")}홈으로</a>${role === "admin" ?
    '<p class="notice">대여자 또는 공급자 프로필에서 물품을 등록할 수 있어요.</p>' :
    `<form class="form-card plain" data-form="register">
      <section class="register-section"><div class="form-section-heading"><span>01</span><h2>어떤 물품인가요?</h2></div><label class="upload-field">물품 사진 <span class="hint">선택</span><input type="file" name="photo" accept="image/*"></label>
      <label>물품명<input name="title" maxlength="48" placeholder="예시 · 미니 빔프로젝터" required></label>
      <button type="button" class="button secondary" data-action="draft">${icon("sparkle")}분류·초안·대여료 제안</button>
      <p class="hint">AI 등록 지원은 예시 결과를 보여줘요.</p>
      </section><section class="register-section"><div class="form-section-heading"><span>02</span><h2>대여 조건을 알려주세요</h2></div><div class="field-pair">
        <label>카테고리<select name="category" required><option value="">선택</option>${categories.slice(1).map((name) => `<option>${name}</option>`).join("")}</select></label>
        <label>하루 대여료 (원)<input type="number" name="price" inputmode="numeric" min="0" max="10000000" step="1" required></label>
      </div>
      <label>거래 지역<select name="neighborhood"><option>${area}</option><option>${area === "죽전동" ? "보정동" : "죽전동"}</option></select></label>
      <label>보증금 (원)<input type="number" name="deposit" inputmode="numeric" min="0" max="10000000" step="1" placeholder="없으면 0원"></label>
      <fieldset><legend>대여 가능 기간 <span class="hint">선택</span></legend>${dateInputs({}, { required: false })}</fieldset>
      </section><section class="register-section"><div class="form-section-heading"><span>03</span><h2>물품을 소개해 주세요</h2></div><label>물품 설명<textarea name="description" rows="4" maxlength="600" placeholder="물품 상태나 함께 제공하는 구성품을 적어주세요." required></textarea></label>
      <p class="hint">상태와 구성품, 사용 시 주의할 점을 적으면 이웃에게 도움이 돼요.</p></section><div class="register-submit"><p class="hint">게시 전 대여료와 대여 가능 기간을 확인해 주세요.</p><p class="form-error" role="alert" hidden></p>
      ${button("물품 게시하기")}</div>
    </form>`}</div>`;
}

function rentalRow(rental, item, destination = "trade") {
  return `<a class="trade-row" data-rental-status="${escape(rental.status)}" href="#${destination}/${rental.id}">
    ${image(item, "trade-thumbnail")}
    <div><strong>${escape(item.title)}</strong><small>${dates(rental.start, rental.end)}</small></div>
    ${badge(rental.status)}${icon("right")}
  </a>`;
}

function accountHeader(title, description, symbol) {
  const heading = ["calendar", "chat", "user", "plus", "heart", "photo"].includes(symbol) ? `<header class="page-header"><h1 class="account-icon-title"><span class="account-title-icon" aria-hidden="true">${icon(symbol)}</span>${title}</h1></header>` : pageHeader(title);
  return `<div class="account-hero">${heading}<p class="account-description">${description}</p></div>`;
}

export function rentalsPage(historical, catalog, role, direction) {
  const admin = role === "admin";
  const visible = historical.filter((rental) => admin ? rental.status === "disputed"
    : direction === "out" ? rental.lenderId === role : rental.renterId === role);
  return accountHeader(admin ? "분쟁 검토" : "내 대여", admin ? "이웃의 안전한 거래를 함께 살펴봐요." : "빌리고 나누는 일상, 여기서 한눈에 확인해요.", "calendar") + `<div class="content rentals-content">
    <div class="rental-summary"><span>${admin ? "검토 대기" : direction === "out" ? "빌려주는 물품" : "빌리는 물품"}<strong>${visible.length}<small>건</small></strong></span><span class="summary-art">${icon("calendar")}</span></div>
    ${admin ? "" : `<div class="segments" aria-label="대여 역할">
      <button data-action="direction" data-id="in" aria-pressed="${direction === "in"}">빌리는 물품</button>
      <button data-action="direction" data-id="out" aria-pressed="${direction === "out"}">빌려주는 물품</button>
    </div>`}
    ${!admin && visible.length ? `<div class="rental-filters" aria-label="거래 상태">${[["all", "전체"], ["pending", "승인 대기"], ["progress", "진행 중"], ["complete", "완료"]].map(([value, label]) => `<button type="button" data-action="rental-filter" data-id="${value}" aria-pressed="${value === "all"}">${label}</button>`).join("")}</div><p class="filter-empty" role="status" hidden>이 상태의 거래가 없어요.</p>` : ""}
    ${visible.length ? visible.map((rental) => rentalRow(rental, catalog(rental.itemId))).join("")
    : `<div class="account-empty"><span class="empty-illustration">${icon("calendar")}</span>${empty(admin ? "검토할 분쟁이 없어요" : "아직 거래가 없어요", admin ? "신고가 접수되면 여기에 표시돼요." : "가까운 이웃의 물품으로 첫 대여를 시작해 보세요.")}${admin ? "" : '<a class="button primary" href="#home">우리 동네 물품 둘러보기</a>'}</div>`}
    ${admin ? "" : `<section class="rental-guide" aria-labelledby="rental-guide-title"><div class="rental-guide-heading"><h2 id="rental-guide-title">대여는 이렇게 진행돼요</h2><span>이용 가이드</span></div><ol><li><span>01</span><div><strong>마음에 드는 물품 찾기</strong><p>날짜를 선택하고 이웃에게 대여를 신청해요.</p></div></li><li><span>02</span><div><strong>승인 후 채팅으로 약속하기</strong><p>예약이 확정되면 만날 시간과 장소를 정해요.</p></div></li><li><span>03</span><div><strong>사진으로 확인하고 반납하기</strong><p>인도·반납 사진으로 물품 상태를 함께 확인해요.</p></div></li></ol><div class="rental-guide-actions"><a href="#home">${icon("search")}물품 찾기${icon("right")}</a><a href="#new">${icon("plus")}내 물품 등록${icon("right")}</a></div></section>`}
  </div>`;
}

function tradeButton(title, type, cls = "primary") {
  return `<button class="button ${cls}" data-action="trade-action" data-id="${type}">${title}</button>`;
}

function evidence(rental, feedback) {
  if (!rental.before && !rental.after) return "";
  return `<section class="stack">
    <h2>대여 전후 사진</h2>
    <div class="comparison">
      <figure>${image({ image: rental.before }, "", "대여 전 상태")}<figcaption>대여 전</figcaption></figure>
      <figure>${image({ image: rental.after }, "", "반납 후 상태")}<figcaption>반납 후</figcaption></figure>
    </div>
    ${rental.before && rental.after ? `<div class="stack compact">
      <h3>AI 사진 비교</h3>
      ${comparisonResult(rental.photoAnalysis, rental.after, escape)}
      <p class="hint" aria-live="polite">${escape(feedback?.message)}</p>
      <button class="button secondary" data-action="analyze-trade" ${feedback?.busy ? "disabled" : ""}>
        ${feedback?.busy ? "두 사진 비교 중…" : rental.photoAnalysis ? "다시 비교하기" : "사진 비교하기"}</button>
    </div>` : ""}
  </section>`;
}

export function tradePage(rental, item, role, feedback) {
  const owns = role === rental.lenderId;
  const borrows = role === rental.renterId;
  const status = rental.status;
  let actions = "";
  if (status === "pending") actions = owns ? tradeButton("신청 승인", "confirm") + tradeButton("거절", "reject", "secondary")
    : borrows ? tradeButton("신청 철회", "cancel", "secondary") : "";
  else if (status === "confirmed") actions = (owns ? tradeButton("인도 사진 등록", "handoff") : "") + tradeButton("예약 취소", "cancel", "secondary");
  else if (status === "handover" && borrows) actions = tradeButton("물품·구성품 수령 확인", "receive");
  else if (status === "active" && borrows) actions = tradeButton("반납 사진 등록 및 요청", "return");
  else if (status === "checking" && owns) actions = tradeButton("이상 없음 · 거래 완료", "complete") + tradeButton("손상·누락 신고", "dispute", "secondary");
  else if (status === "disputed" && role === "admin") actions = tradeButton("검토 후 반납 확인으로 돌리기", "resolve");
  else if (status === "complete" && borrows && !rental.review) actions = tradeButton("별점·후기 작성", "review");

  return pageHeader("거래 상세", "#rentals") + `<div class="content stack">
    <section class="trade-overview">
      ${image(item, "trade-thumbnail")}
      <div><h2>${escape(item.title)}</h2><p class="muted">${dates(rental.start, rental.end)}</p>
        <p>신청 대여료 ${won(rental.total)} · 보증금 ${won(rental.deposit ?? 0)}</p>
        <strong>신청 당시 합계 ${won(rental.total + (rental.deposit ?? 0))}</strong></div>
      ${badge(status)}
    </section>
    ${status === "active" && owns ? '<p class="notice">대여자의 반납 요청을 기다리고 있어요.</p>' : ""}
    ${status === "handover" && owns ? '<p class="notice">대여자의 수령 확인을 기다리고 있어요.</p>' : ""}
    ${status === "checking" && borrows ? '<p class="notice">공급자가 반납 상태를 확인하면 거래가 완료돼요.</p>' : ""}
    ${(owns || borrows) && ["confirmed", "handover", "active", "checking", "disputed", "complete"].includes(status)
      ? `<a class="button secondary" href="#chat/${rental.id}">${icon("chat")}거래 채팅</a>` : ""}
    ${evidence(rental, feedback)}
    ${rental.dispute ? `<section class="notice"><strong>분쟁 기록</strong><p>${escape(rental.dispute)}</p>${rental.resolution ? `<p>검토 의견 · ${escape(rental.resolution)}</p>` : ""}</section>` : ""}
    ${rental.review ? `<section class="notice"><strong>${"★".repeat(rental.review.rating)} · 후기</strong><p>${escape(rental.review.text)}</p></section>` : ""}
    ${actions ? `<div class="action-row">${actions}</div>` : ""}
  </div>`;
}

const partnerName = (rental, role) =>
  people[role === rental.renterId ? rental.lenderId : rental.renterId]?.name ?? "거래 상대";
const chatDay = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const chatClock = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const messageDate = (message) => Number.isFinite(message?.sentAt)
  && Number.isFinite(new Date(message.sentAt).getTime()) ? new Date(message.sentAt) : null;

export function chatPage(rentals, catalog, role, threads, canChat) {
  const conversations = rentals.filter((rental) => (rental.renterId === role || rental.lenderId === role)
    && canChat(rental)).map((rental) => ({ rental, last: threads[rental.id]?.at(-1) }))
    .sort((a, b) => (messageDate(b.last)?.getTime() ?? 0) - (messageDate(a.last)?.getTime() ?? 0));
  return accountHeader("채팅", "이웃과 나누는 대화, 더 편안한 거래의 시작", "chat") + `<div class="content chat-list"><label class="account-search">${icon("search")}<input type="search" id="chat-search" placeholder="물품명이나 대화 상대 검색" aria-label="대화 검색"></label><div class="account-section-title"><h2>거래 대화</h2><span>${conversations.length}개</span></div><p class="filter-empty" role="status" hidden>검색한 대화가 없어요.</p>${conversations.length
    ? conversations.map(({ rental, last }) => {
      const item = catalog(rental.itemId);
      const time = messageDate(last);
      return `<a class="conversation-row" data-chat-search="${escape((item.title + " " + partnerName(rental, role)).toLowerCase())}" href="#chat/${escape(rental.id)}">
        <span class="avatar">${icon("user")}</span>
        <div class="conversation-summary"><div class="conversation-heading"><strong>${escape(partnerName(rental, role))}</strong>${badge(rental.status)}</div>
          <p>${escape(item.title)}</p><p>${last ? (last.sender === role ? "나: " : "") + escape(last.text) : "아직 메시지가 없어요."}</p>
          <small>${dates(rental.start, rental.end)}${time ? ` · <time datetime="${time.toISOString()}">${localDay(time) === localDay() ? chatClock.format(time) : chatDay.format(time)}</time>` : ""}</small></div>
        ${image(item, "chat-thumbnail", item.title)}
      </a>`;
    }).join("")
    : `<div class="account-empty"><span class="empty-illustration peach">${icon("chat")}</span>${empty("아직 대화가 없어요", "예약이 확정되면 이곳에서 만날 시간과 장소를 정해요.")}<a class="button primary" href="#home">빌릴 물품 둘러보기</a></div>`}
    <section class="chat-guide" aria-labelledby="chat-guide-title"><div class="rental-guide-heading"><h2 id="chat-guide-title">이웃과의 약속, 채팅으로 편하게</h2><span>대화 가이드</span></div><div class="chat-guide-tips"><article><span class="chat-tip-icon">${icon("calendar")}</span><div><h3>언제 어디서 만날까요?</h3><p>예약 확정 후 만날 시간과 장소를 함께 정해요.</p></div></article><article><span class="chat-tip-icon">${icon("photo")}</span><div><h3>물품 상태도 미리 확인해요</h3><p>구성품과 사용 방법을 물어보고 인도 전 상태를 확인해요.</p></div></article></div><div class="rental-guide-actions"><a href="#rentals">${icon("calendar")}내 대여 확인${icon("right")}</a><a href="#home">${icon("search")}물품 둘러보기${icon("right")}</a></div></section>
    </div>`;
}

export function conversationPage(rental, item, messages, role) {
  const partner = escape(partnerName(rental, role));
  let lastDay = null;
  const bubbles = messages.map((message) => {
    const time = messageDate(message);
    const day = time ? localDay(time) : null;
    const divider = day && day !== lastDay
      ? `<div class="chat-day"><time datetime="${day}">${chatDay.format(time)}</time></div>` : "";
    lastDay = day;
    const mine = message.sender === role;
    return divider + `<div class="message${mine ? " outgoing" : ""}">
      <small>${mine ? "나" : partner}</small>
      <p>${escape(message.text)}</p>
      ${time ? `<time class="message-time" datetime="${time.toISOString()}">${chatClock.format(time)}</time>` : ""}
    </div>`;
  }).join("");
  return pageHeader(escape(item.title), "#chat") + `<div class="content stack conversation-content">
    <a class="conversation-item" href="#trade/${escape(rental.id)}">${image(item, "trade-thumbnail", item.title)}<div><strong>${escape(item.title)}</strong><p>${won(item.price)} <span>/ 일</span></p></div>${icon("right")}</a>
    <p class="conversation-notice">${icon("check")}약속한 시간과 장소를 함께 확인해 주세요.</p>
    <div class="messages chat-history" role="log" aria-label="대화 내역" tabindex="0">${bubbles
      || empty("첫 메시지를 보내보세요", "인도 시간과 만날 장소를 정해보세요.")}</div>
    <form class="compose" data-form="message" data-id="${escape(rental.id)}">
      <input name="message" maxlength="350" aria-label="메시지" placeholder="이웃에게 메시지를 보내보세요" required>
      <button type="submit" class="button primary">보내기</button>
    </form>
  </div>`;
}

export function profilePage(role, savedCount, listingCount) {
  return accountHeader("내 정보", "함께 나누는 나의 일상을 모아봤어요.", "user") + `<div class="content stack profile-content">
    <div class="profile"><div class="avatar">${icon("user")}</div><div><p class="eyebrow">반가워요!</p><h2>${people[role].name}님</h2><p class="muted">${people[role].neighborhood} · 데모 프로필</p></div></div>
    <div class="profile-quick-actions"><button type="button" data-action="area">${icon("pin")}동네 변경${icon("right")}</button><button type="button" data-action="notices">${icon("bell")}내 알림${icon("right")}</button></div><div class="profile-stats"><a href="#saved"><strong>${savedCount}</strong><span>관심 물품</span></a><a href="#my-listings"><strong>${listingCount}</strong><span>등록한 물품</span></a><a href="#rentals">${icon("calendar")}<span>대여 내역</span></a></div>
    <section class="profile-section"><h2>나의 활동</h2><p class="section-description">나의 물품과 거래를 편하게 관리해요.</p><div class="menu-list">
      <a href="#rentals">${icon("calendar")}대여 내역${icon("right")}</a>
      <a href="#saved">${icon("heart")}관심 물품<span>${savedCount}개</span>${icon("right")}</a>
      <a href="#my-listings">${icon("photo")}내가 올린 물품<span>${listingCount}개</span>${icon("right")}</a>
      <a href="#compare">${icon("photo")}대여 전후 사진 비교${icon("right")}</a>
      <a href="#membership">${icon("sparkle")}구독 혜택${icon("right")}</a>
    </div></section>
  </div>`;
}

export function comparePage(demo) {
  return pageHeader("대여 전후 사진 비교", "#profile") + `<div class="content stack">
    <form class="form-card plain" data-form="compare-demo">
      <label>비교할 사진<select name="source" ${demo.busy ? "disabled" : ""}>
        <option value="sample" ${demo.custom ? "" : "selected"}>빔프로젝터 예시</option>
        <option value="custom" ${demo.custom ? "selected" : ""}>내 사진 두 장</option>
      </select></label>
      <div class="comparison">${["before","after"].map((key, i) => `<figure>
        ${image({ image: demo[key] }, "", i ? "반납 사진" : "인도 사진")}
        <figcaption>${i ? "반납 후" : "대여 전"}</figcaption>
        ${demo.custom ? `<input type="file" accept="image/*" data-compare-file="${key}" aria-label="${i ? "반납 후" : "대여 전"} 사진 선택" ${demo.busy ? "disabled" : ""}>` : ""}
      </figure>`).join("")}</div>
      <p class="hint">같은 물품의 같은 면을 비슷한 거리와 조명에서 찍어 주세요.</p>
      <button class="button primary" type="submit" ${demo.busy || !demo.before || !demo.after ? "disabled" : ""}>
        ${demo.busy ? "두 사진 비교 중…" : "변화 위치 찾기"}</button>
    </form>
    <div aria-live="polite">${demo.error ? `<p class="notice">${escape(demo.error)}</p>` : ""}
      ${comparisonResult(demo.result, demo.after, escape)}</div>
  </div>`;
}

export function membershipPage() {
  const benefits = [
    ["photo", "월간 게시글 홍보권", "원하는 물품을 검색 결과의 광고 영역에 노출하는 공급자 혜택이에요."],
    ["calendar", "예약 수수료 할인", "플랫폼 결제를 도입하면 대여자의 예약 수수료에 할인을 적용해요."],
    ["pin", "반납 픽업", "서비스 가능 지역에서 월 1회, 대여자에게서 물품을 받아 공급자에게 돌려줘요."],
  ];
  return pageHeader("구독 혜택", "#profile") + `<div class="content stack">
    ${benefits.map(([symbol, heading, detail]) => `<article class="benefit">${icon(symbol)}<div><h2>${heading}</h2><p>${detail}</p></div></article>`).join("")}
    <p class="notice">구독료·홍보 횟수·수수료 할인율·픽업 가능 지역은 추후 확정돼요.</p>
  </div>`;
}

export function modal(title, content) {
  return `<header class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="닫기">${icon("close")}</button></header>${content}`;
}

export function missingPage() {
  return pageHeader("화면을 열 수 없어요", "#home") + `<div class="content">${empty("찾을 수 없는 화면이에요", "홈에서 다시 시작해 주세요.")}</div>`;
}


export function aiRoomPage(session, itemById) {
  const suggestions = ["주말에 집에서 영화 보고 싶어요", "가구 조립에 쓸 공구가 필요해요", "하루 5천 원 이하로 추천해 주세요"];
  const bubbles = session.messages.map(message => {
    const mine = message.role === "user";
    const items = (message.itemIds ?? []).map(itemById).filter(Boolean);
    return `<article class="message${mine ? " outgoing" : ""}">
      <small>${mine ? "나" : "렌토 AI"}</small>
      <p>${escape(message.text)}</p>
      ${items.length ? `<div class="ai-room-items">${items.map(item => `<a class="ai-room-item" href="#item/${escape(item.id)}">
        ${image(item, "trade-thumbnail", item.title)}<div><strong>${escape(item.title)}</strong><p>${won(item.price)} / 일 · ${escape(item.neighborhood)}</p><small>상세에서 대여 날짜와 조건 확인</small></div>${icon("right")}</a>`).join("")}</div>` : ""}
    </article>`;
  }).join("");
  return pageHeader("AI에게 물어보기", "#home") + `<div class="content stack conversation-content ai-room">
    <div class="ai-room-intro"><span class="ai-room-avatar">${icon("sparkle")}</span><div><strong>렌토 AI</strong><p>필요한 물건을 함께 찾아봐요.</p></div>
      <button type="button" class="button secondary" data-action="ai-new"${session.busy ? " disabled" : ""}>새 대화</button></div>
    <p class="hint ai-room-note">이곳에 입력한 질문과 물품 목록을 로컬 AI가 참고해요. 이웃과 나눈 채팅은 전달하지 않아요. 답변은 참고용이며 예약은 직접 신청해 주세요.</p>
    <div class="messages chat-history ai-room-history" role="log" aria-label="AI와의 대화" tabindex="0">
      ${bubbles || `<article class="message"><small>렌토 AI</small><p>안녕하세요! 어떤 일에 쓸 물건을 찾고 계세요? 용도나 예산을 알려주시면 등록된 물품에서 찾아드릴게요.</p></article>`}
      ${session.busy ? `<article class="message outgoing"><small>나</small><p>${escape(session.pending)}</p></article><p class="ai-room-pending" role="status">렌토 AI가 답변을 준비하고 있어요…</p>` : ""}
    </div>
    ${!session.messages.length && !session.busy ? `<div class="ai-room-examples">${suggestions.map(text => `<button type="button" data-action="ai-example" data-text="${escape(text)}">${escape(text)}</button>`).join("")}</div>` : ""}
    ${session.error ? `<div class="ai-room-error" role="alert"><p>${escape(session.error)}</p><button type="button" class="button secondary" data-action="ai-retry">다시 보내기</button></div>` : ""}
    <form class="compose ai-room-compose" data-form="ai-room">
      <label class="sr-only" for="ai-question">AI에게 보낼 질문</label>
      <textarea id="ai-question" name="question" rows="1" maxlength="500" placeholder="용도나 궁금한 점을 물어보세요" required${session.busy ? " disabled" : ""}>${escape(session.draft)}</textarea>
      <button type="submit" class="button primary"${session.busy ? " disabled" : ""}>${session.busy ? "답변 중" : "보내기"}</button>
    </form>
    <p class="hint">Enter로 전송 · Shift+Enter로 줄바꿈 · 대화는 현재 탭에서만 유지돼요.</p>
  </div>`;
}

export function collectionPage(kind, count, rows) {
  const saved = kind === "saved";
  return accountHeader(saved ? "관심 물품" : "등록한 물품", saved ? "다음에 빌리고 싶은 물품을 한곳에 모았어요." : "이웃과 나눌 나의 물품을 관리해요.", saved ? "heart" : "photo") + `<div class="content collection-content"><div class="collection-toolbar"><a class="page-back-link" href="#profile">${icon("back")}내 정보</a><a class="button secondary" href="${saved ? "#home" : "#new"}">${icon(saved ? "search" : "plus")}${saved ? "물품 찾기" : "새 물품 등록"}</a></div><div class="account-section-title"><h2>${saved ? "마음에 담은 물품" : "나의 등록 물품"}</h2><span>${count}개</span></div>${count ? rows : `<div class="account-empty"><span class="empty-illustration ${saved ? "peach" : ""}">${icon(saved ? "heart" : "photo")}</span>${empty(saved ? "아직 관심 물품이 없어요" : "아직 등록한 물품이 없어요", saved ? "마음에 드는 물품의 하트를 눌러 보관해 보세요." : "집에서 쉬고 있는 물품을 이웃과 나눠보세요.")}<a class="button primary" href="${saved ? "#home" : "#new"}">${saved ? "우리 동네 물품 둘러보기" : "첫 물품 등록하기"}</a></div>`}</div>`;
}

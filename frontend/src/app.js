import { depositBlock, depositQuote, itemValueFrom, rentalDepositSnapshot } from "./listing-pricing.js";
import { getListingDraft, getPriceRecommendation, pricingContextFrom } from "./listing-advice.js";
import { rankListings, recommendationCandidates } from "./listing-recommendations.js";
import { depositPreview, listingEditForm, priceRecommendationForm, priceRecommendationResult } from "./listing-registration-view.js";
import { accountPage, accountRequest, profileEditForm, profileImage, readProfileSettings } from "./accounts.js";
import { connectRentalDatabase } from "./rental-database.js";
import { newAIConversation, sendAIMessage } from "./ai-room.js";
import { comparePhotos } from "./compare.js";
import { openCapture } from "./capture.js";
import { preparePhotos, photoUrl, saveOriginal } from "./photo-store.js";
import { evaluationPage } from "./evaluation.js";
import { completeDraft, currentResult, inspectionRecord, inspectionSources } from "./inspection.js";
import { inspectionPhotoDialog } from "./inspection-view.js";
import { addListingPhotos, assignListingView, hasOnlyListingCameraPhotos, listingCaptureContext, listingSources, maxListingPhotos, missingListingViews, newListingDraft, removeListingPhoto, replaceListingPhoto, syncListingPlan } from "./listing-photos.js";
import { validateListingStep } from "./listing-registration.js";
import { itemGallery, listingPhotoPanel } from "./listing-photo-view.js";
import { icon } from "./icons.js?v=rento-home-5-ren";
import {
  catalog, categories, findAvailability, initialState, localDay, neighborhoods, people, readState,
  publicListing, rentalDays, writeState,
} from "./model.js?v=rento-home-5-ren";
import {
  aiRoomPage, chatPage, comparePage, conversationPage, inquiryPage, dateInputs, escape, home, itemPage, listingRows,
  membershipPage, missingPage, modal, pageHeader, profilePage, registerPage,
  rentalEstimate, rentalsPage, tradePage,
} from "./views.js?v=rento-home-5-ren";

import { canReview, reputation, seat, unread, quota, membershipPanel } from "./community.js";
import {
  findInquiry,
  createInquiry,
  inquiryPartner,
  isInquiryParty
} from "./inquiry.js";
const screen = document.querySelector("#screen");
const navigation = document.querySelector("#navigation");
const dialog = document.querySelector("#dialog");
const toast = document.querySelector("#toast");
const databaseMode = document.querySelector('meta[name="rento-database"]')?.content;
const accountMode = databaseMode === "accounts";
const depositPolicy = JSON.parse(document.querySelector('meta[name="rento-deposit-policy"]')?.content ?? "null");
const preferencesKey = "rento-firestore-preferences-v1";
const state = accountMode ? initialState() : readState(databaseMode ? preferencesKey : undefined);
let account = null;
let persistDatabase;

function databaseError(error) {
  if (dialog.open) dialog.close();
  screen.replaceChildren();
  navigation.replaceChildren();
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.setAttribute("role", "alert");
  const message = error.name === "TimeoutError"
    ? "Firebase 응답이 늦어 요청을 완료하지 못했어요."
    : error.message;
  notice.textContent = message + " DB 내용을 다시 불러온 뒤 변경 사항을 확인해 주세요.";
  const retry = document.createElement("button");
  retry.className = "button secondary";
  retry.textContent = "다시 불러오기";
  retry.onclick = () => location.reload();
  screen.append(notice, retry);
}

let databaseFailed = false;
if (databaseMode) {
  try {
    if (accountMode) {
      ({ account } = await accountRequest("session"));
      if (account) state.role = account.uid;
    }
    if (!accountMode || account) persistDatabase = await connectRentalDatabase(state, account?.uid);
  } catch (error) { databaseFailed = true; databaseError(error); }
}
const filters = { query: "", category: "전체", date: {}, maxPrice: null };
let direction = state.role === "lender" ? "out" : "in";
let toastTimeout;

const samplePair = { before: "./assets/proof-before.webp", after: "./assets/proof-after.webp" };
let demo = { ...samplePair, custom: false };
const comparisonFeedback = new Map();
const evidenceDrafts = new Map();
const inspectionViews = new Map();
const listingDrafts = new Map();
const listingPriceResults = new WeakMap();
const gallerySelections = new Map();
const listingSavedSources = new WeakMap();
function listingDraft(role = state.role) {
  if (!listingDrafts.has(role)) listingDrafts.set(role, newListingDraft(state.area));
  return listingDrafts.get(role);
}
const evaluation = { busy: false };
let photoStorageError = "";
try { await preparePhotos([...state.rentals.flatMap(inspectionSources), ...state.listings.flatMap(listingSources)]); }
catch (error) { photoStorageError = error.message; }

async function analyzeTrade(rental, force = false) {
  if (comparisonFeedback.get(rental.id)?.busy) return;
  const record = inspectionRecord(rental, itemById(rental.itemId));
  const views = record.plan.views.filter((view) => view.compare && record.before[view.id] && record.after[view.id]);
  if (!views.length) return;
  const progress = { busy: true, completed: 0, total: views.length };
  comparisonFeedback.set(rental.id, progress);
  const refresh = () => { if (route()[0] === "trade" && route()[1] === rental.id) render(); };
  refresh();
  let stale = false;
  for (const view of views) {
    if (!force && currentResult(record, view.id)) { progress.completed++; continue; }
    const before = record.before[view.id].source, after = record.after[view.id].source;
    try {
      const result = await comparePhotos(before, after);
      const latest = inspectionRecord(rental, itemById(rental.itemId));
      if (latest.before[view.id]?.source !== before || latest.after[view.id]?.source !== after) { stale = true; continue; }
      if (rental.inspection) (latest.results ??= {})[view.id] = { ...result, beforeSource: before, afterSource: after };
      else rental.photoAnalysis = result;
      const saving = save();
      if (saving && !await saving) return;
    } catch { progress.error = true; }
    progress.completed++;
    refresh();
  }
  progress.busy = false;
  if (!progress.error) comparisonFeedback.delete(rental.id);
  refresh();
  if (stale && rental.status === "checking") analyzeTrade(rental);
}

const allItems = () => accountMode ? state.listings : [...catalog, ...state.listings];
const itemById = (id) => allItems().find((item) => item.id === id);
const rentalById = (id) => state.rentals.find((rental) => rental.id === id);
const listedItems = () => allItems().filter(publicListing);
const myListings = () => state.listings.filter((item) => item.owner === state.role && item.visibility !== "deleted");

function visibleListing(id) {
  const item = itemById(id);
  if (item && (publicListing(item) || (item.visibility === "private" && item.owner === state.role))) return item;
}

state.inquiries ??= [];

const inquiryById = (id) =>
  state.inquiries.find(room => room.id === id);

function totalChatUnread(role = state.role) {
  const rentalCount = state.rentals
    .filter(r => isParty(r) && chatAllowed(r))
    .reduce((n, r) => n + unread(state.messages[r.id], role), 0);

  const inquiryCount = state.inquiries
    .filter(room => isInquiryParty(room, role))
    .reduce((n, room) => n + unread(state.messages[room.id], role), 0);

  return rentalCount + inquiryCount;
}

let openingInquiry = false;

async function startInquiry(partnerId) {
  const role = state.role;

  if (openingInquiry || !partnerId ||
      partnerId === role || role === "admin") return;

  openingInquiry = true;

  try {
    let room = findInquiry(state.inquiries, role, partnerId);

    if (!room) {
      if (!listedItems().some(item => item.owner === partnerId)) {
        showToast("등록된 물품이 없는 상대예요.");
        return;
      }

      room = createInquiry(state.inquiries, role, partnerId);

      const saving = save();
      if (saving && !await saving) return;
    }

    if (state.role === role) {
      navigate(`#chat/${room.id}`);
    }
  } finally {
    openingInquiry = false;
  }
}
const isParty = (rental) => rental && [rental.lenderId, rental.renterId].includes(state.role);
const favoriteKey = (id) => accountMode ? id : state.role + "/" + id;
const isFavorite = (id) => state.favorites.includes(favoriteKey(id));
const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
const route = () => (location.hash.slice(1) || "home").split("/");

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.hidden = false;
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 3200);
}

async function saveToDatabase() {
  try { await persistDatabase(state); }
  catch (error) {
    databaseFailed = true;
    databaseError(error);
    return false;
  }
  if (accountMode) return true;
  const { role, area, favorites } = state;
  if (!writeState({ role, area, favorites }, preferencesKey)) showToast("화면 설정을 이 브라우저에 저장하지 못했어요.");
  return true;
}

function save() {
  if (databaseMode) return saveToDatabase();
  if (!writeState(state)) showToast("브라우저 저장 공간이 부족해요. 현재 화면에서 계속 이용할 수 있어요.");
}

async function saveListingChange(item, changes, message) {
  if (Object.keys(changes).every((key) => item[key] === changes[key])) return true;
  const index = state.listings.indexOf(item);
  const updated = { ...item, ...changes };
  state.listings[index] = updated;
  const saved = databaseMode ? await saveToDatabase() : writeState(state);
  if (!saved) {
    if (state.listings[index] === updated) state.listings[index] = item;
    if (!databaseMode) showToast("변경 사항을 저장하지 못했어요.");
    return false;
  }
  if (route()[0] === "my-listings") render();
  showToast(message);
  return true;
}

async function setListingVisibility(id, visibility) {
  const item = myListings().find((listing) => listing.id === id);
  if (!item || (item.visibility ?? "public") === visibility) return false;
  const message = {
    private: "물품을 비공개로 전환했어요.",
    public: "물품을 다시 공개했어요.",
    deleted: "물품을 삭제했어요.",
  };
  return saveListingChange(item, { visibility }, message[visibility]);
}

function announce(role, rental, message) {
  state.notices.unshift({ id: newId(), createdAt: Date.now(), role, rentalId: rental.id, message, read: false });
}

const blockedRentals = () => [...state.rentals, ...(state.blockedPeriods ?? [])];

function availabilityLabel(item, filtered) {
  if (item.visibility === "private") return "비공개";
  if (item.owner === state.role) return "내 등록 물품";
  const blocked = depositBlock(item, depositPolicy, accountMode);
  if (blocked) return blocked;
  if (state.role === "admin") return "관리자 열람";
  if (filtered && filters.date.start) return "선택한 날짜 대여 가능";
  const today = localDay();
  const error = findAvailability(item, today, today, blockedRentals());
  if (!error) return "오늘 대여 가능";
  if (item.weekends && error.startsWith("이 물품")) return "주말 대여 전용";
  if (item.availableFrom && item.availableFrom > today) return "날짜 확인";
  if (item.availableTo && item.availableTo < today) return "대여 기간 종료";
  return "예약 중";
}

const recommendationContext = () => ({ items: allItems(), rentals: state.rentals,
  availability: blockedRentals(), uid: state.role, area: state.area, isFavorite, filters, policy: depositPolicy, requireValue: accountMode });
const rowsFor = (items, managing = false) =>
  listingRows(items, isFavorite, (item) => availabilityLabel(item, false), undefined, state.displayNames, managing, state.profilePhotos);

function homeRows() {
  const ranked = rankListings(recommendationContext());
  const reasons = new Map(ranked.filter((row) => row.available).map((row) => [row.item.id, row.reasons]));
  return listingRows(ranked.map((row) => row.item), isFavorite, (item) => availabilityLabel(item, true),
    reasons, state.displayNames, false, state.profilePhotos);
}

function render() {
  if (databaseFailed) return;
  const [page, id] = route();
  if (accountMode && !account) {
    navigation.replaceChildren();
    screen.innerHTML = accountPage(page === "signup", escape);
    return;
  }
  if (page === "compare") { location.replace("#rentals"); return; }
  if (page === "photo-evaluation") { location.replace("#dev/photo-evaluation"); return; }
  const role = state.role;
  let content;
  if (page === "home") content = home({
    area: state.area, ...filters, rows: homeRows(),
    unread: state.notices.some((notice) => notice.role === role && !notice.read),
  });
  else if (page === "assistant") content = aiRoomPage(assistantSession(), visibleListing);
  else if (page === "item") {
    const item = visibleListing(id);
    if (item) content = itemPage(item, role, filters.date, gallerySelections.get(id), depositPolicy, accountMode);
  }
  else if (page === "new") content = registerPage(role, state.area, listingDraft(), depositPolicy);
  else if (page === "rentals") content = rentalsPage(state.rentals, itemById, role, direction);
  else if (page === "trade") {
    const rental = rentalById(id);
    if (rental && (isParty(rental) || role === "admin")) content = tradePage(rental, itemById(rental.itemId), role, comparisonFeedback.get(id), inspectionViews.get(id));
  } else if (page === "chat" && !id) {
    content = chatPage(
      state.rentals,
      itemById,
      role,
      state.messages,
      chatAllowed,
      state.inquiries
    );
  } else if (page === "chat") {
    const room = inquiryById(id);
    const rental = rentalById(id);

    if (room && isInquiryParty(room, role)) {
      content = inquiryPage(
        room,
        state.messages[id] ?? [],
        role
      );
    } else if (isParty(rental) && chatAllowed(rental)) {
      content = conversationPage(
        rental,
        itemById(rental.itemId),
        state.messages[id] ?? [],
        role
      );
    }
  } else if (page === "profile") {
    content = profilePage(role, listedItems().filter((item) => isFavorite(item.id)).length,
      myListings().length, account, ownProfile());
    if (id === "setup") content += '<p class="notice" role="status">가입을 완료했어요. 프로필 수정에서 이름, 거주 지역과 사진을 저장해 주세요.</p>';
  }
  else if (!accountMode && page === "dev" && id === "compare") content = comparePage(demo);
  else if (!accountMode && page === "dev" && id === "photo-evaluation") content = evaluationPage(evaluation, pageHeader, escape);
  else if (page === "membership") content = membershipPage() + membershipPanel(role, state.memberships[role], listedItems(), state.rentals, billingMonth(), escape, !accountMode);
  else if (page === "saved" || page === "my-listings") {
    const managing = page === "my-listings";
    const items = managing ? myListings() : listedItems().filter((item) => isFavorite(item.id));
    const title = managing ? "내가 올린 물품" : "관심 물품";
    content = pageHeader(title, "#profile") + `<div class="content">${items.length ? rowsFor(items, managing)
      : `<p class="notice">${page === "saved" ? "아직 관심 물품이 없어요." : "아직 올린 물품이 없어요."}</p>`}</div>`;
  }
   if ((page === "profile" || page === "person") &&
      (page === "profile" || id)) {

    const uid = page === "profile" ? role : id;

    const stats = state.publicReputation?.[uid]
      ?? reputation(state.rentals, uid);

    const mean = stats.reviews.length
      ? (stats.reviews.reduce((n, r) => n + r.rating, 0)
        / stats.reviews.length).toFixed(1)
      : "평가 전";

    const name = state.displayNames?.[uid] || people[uid]?.name || "이웃";

    const ownerItems = listedItems().filter((item) => item.owner === uid);

    const reputationHTML = `
      <div class="person-stats">
        <div>
          <strong>${mean}</strong>
          <span>평균 별점</span>
        </div>
        <div>
          <strong>${stats.reviews.length}</strong>
          <span>거래 후기</span>
        </div>
        <div>
          <strong>${stats.completed}</strong>
          <span>완료 거래</span>
        </div>
      </div>`;

    const reviewsHTML = `
      <section class="person-section">
        <h2>거래 후기</h2>

        ${stats.reviews.length
          ? stats.reviews.map(r => `
            <div class="person-review">
              <strong class="review-stars">
                ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}
              </strong>
              <p>${escape(r.text)}</p>
            </div>
          `).join("")
          : `<p class="person-empty">
               아직 등록된 거래 후기가 없어요.
             </p>`}
      </section>`;

    if (page === "profile") {
      content += `
        <section class="content stack">
          <h2>거래 평판</h2>
          ${reputationHTML}
          ${reviewsHTML}
        </section>`;
    } else {
      content = pageHeader("상대방 프로필", "#home") + `
        <div class="content stack person-page">

          <section class="person-card">

            <div class="person-avatar">
              ${profileImage(state.profilePhotos?.[uid], escape) || icon("user")}
            </div>

            <h2>${escape(name)}</h2>

            ${reputationHTML}

            ${uid !== role && role !== "admin" ? `
              <button
                class="button primary person-chat-button"
                data-action="start-inquiry"
                data-id="${escape(uid)}">
                ${icon("chat")}
                채팅하기
              </button>
            ` : ""}

          </section>

          <section class="person-section">
            <h2>등록한 물품 (${ownerItems.length})</h2>

            ${ownerItems.length
              ? rowsFor(ownerItems)
              : `<p class="person-empty">
                   등록한 물품이 없어요.
                 </p>`}
          </section>

          ${reviewsHTML}

        </div>`;
    }
  }
  screen.innerHTML = content ?? missingPage();
  const history = screen.querySelector(".chat-history");
  if (history) history.scrollTop = history.scrollHeight;
  observeMessages();
  const aiHistory = screen.querySelector(".ai-room-history");
  if (aiHistory) aiHistory.scrollTop = aiHistory.scrollHeight;

  const parent = ({ assistant: "home", dev: "rentals", item: "home", new: "home", trade: "rentals", saved: "profile", membership: "profile", "my-listings": "profile" })[page] ?? page;
  const tabs = [
    ["home", "home", "홈"], ["rentals", "calendar", role === "admin" ? "분쟁 검토" : "내 대여"],
    ["chat", "chat", "채팅"], ["profile", "user", "내 정보"],
  ];
  const totalUnread = totalChatUnread(role);
  navigation.innerHTML = tabs.map(([target, symbol, label]) =>
    `<a href="#${target}"${target === parent ? ' aria-current="page"' : ""}><span class="nav-icon">${icon(symbol)}${target === "chat" ? `<b class="nav-unread" aria-label="안 읽은 메시지 ${totalUnread}개" ${totalUnread ? "" : "hidden"}>${totalUnread > 99 ? "99+" : totalUnread}</b>` : ""}</span><span>${label}</span></a>`).join("");
}

let messageObserver;
function observeMessages() {
  messageObserver?.disconnect();
  const [page,id] = route(), role = state.role;
  const history = screen.querySelector(".chat-history");
  if (page !== "chat" || !id || !history || document.hidden || dialog.open || !globalThis.IntersectionObserver) return;
  const thread = state.messages[id] || [];
  messageObserver = new IntersectionObserver(entries => {
    if (document.hidden || dialog.open || route()[0] !== "chat" || route()[1] !== id || state.role !== role) return;
    let changed = false;
    for (const entry of entries) {
      const msg = thread[Number(entry.target.dataset.messageIndex)];
      if (entry.target.isConnected && entry.isIntersecting && entry.intersectionRatio > 0 && msg && msg.sender !== role && !msg.read) {
        msg.read = true;
        changed = true;
      }
    }
    if (changed) {
      save();
      const count = totalChatUnread(role);
      const label = navigation.querySelector(".nav-unread");
      if (label) { label.hidden = !count; label.textContent = count > 99 ? "99+" : count; label.setAttribute("aria-label", `안 읽은 메시지 ${count}개`); }
    }
  }, {threshold: [0, 0.01]});
  history.querySelectorAll("[data-message-index]").forEach(el => messageObserver.observe(el));
}
document.addEventListener("visibilitychange", observeMessages);
dialog.addEventListener("close", observeMessages);

function billingMonth() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0,7);
}

async function benefitAction(action, id) {
  const uid = state.role, month = billingMonth();
  const plan = state.memberships[uid] || {id: uid, active: false, grants: {}, actions: []};
  if (action === "demo-subscription" && !accountMode) plan.active = !plan.active;
  else if (action === "demo-grant" && !accountMode && plan.active) {
    (plan.grants ??= {})[month] = (plan.grants[month] || 0) + 1;
  } else {
    if (!plan.active || (plan.actions || []).some(a => a.type === action && a.target === id && (action === "pickup" || a.month === month))) return;
    if (action === "promote" && (!(quota(plan,month) > 0) || itemById(id)?.owner !== uid)) return;
    if (action === "pickup" && (rentalById(id)?.renterId !== uid || rentalById(id)?.status !== "active")) return;
    if (!["promote","pickup"].includes(action)) return;
    (plan.actions ??= []).push({type: action, target: id, month});
  }
  state.memberships[uid] = plan;
  const saving = save();
  if (!saving || await saving) render();
}

function chatAllowed(rental) {
  return ["confirmed", "handover", "active", "checking", "disputed", "complete"].includes(rental.status);
}

function ownProfile() {
  const uid = state.role;
  return { displayName: state.displayNames?.[uid] ?? account?.displayName,
    area: state.area, photo: state.profilePhotos?.[uid] };
}

function navigate(hash) {
  if (dialog.open) dialog.close();
  if (location.hash === hash) render();
  else location.hash = hash;
}

function showDialog(title, body) {
  dialog.innerHTML = modal(title, body);
  dialog.setAttribute("aria-labelledby", "dialog-title");
  if (!dialog.open) dialog.showModal();
}

function formError(form, message) {
  const output = form.querySelector(".form-error");
  output.textContent = message;
  output.hidden = !message;
}

const formErrorMarkup = '<p class="form-error" role="alert" hidden></p>';

async function tradeAction(action) {
  const rental = rentalById(route()[1]);
  if (!rental) return;
  const owns = state.role === rental.lenderId;
  const borrows = state.role === rental.renterId;
  const tradeItem = itemById(rental.itemId);
  if (action === "confirm" && owns && rental.status === "pending") {
    if (accountMode && (!rental.itemValue || !rental.depositPolicy)) {
      showDialog("이 신청은 승인할 수 없어요", '<p class="notice">가액과 보증금 기준이 저장되지 않았어요. 물품 상세에서 가액을 등록하고 보증금 정책이 적용된 뒤 다시 신청해 주세요.</p>');
      return;
    }
    const error = findAvailability(tradeItem, rental.start, rental.end, blockedRentals(), rental.id);
    if (error) {
      showDialog("예약을 확정할 수 없어요", `<p class="notice">${escape(error)}</p>`);
      return;
    }
    await updateTrade(rental, "confirmed", rental.renterId, "대여 신청이 승인됐어요.");
  } else if (action === "reject" && owns && rental.status === "pending") {
    await updateTrade(rental, "rejected", rental.renterId, "대여 신청이 거절됐어요.");
  } else if (action === "cancel" && ((borrows && rental.status === "pending")
      || ((owns || borrows) && rental.status === "confirmed"))) {
    showDialog("예약 취소", `<form data-form="cancel" data-id="${rental.id}" class="form-card plain">
      <p>이 대여 신청을 취소하시겠어요?</p><button class="button primary" type="submit">취소 확정</button>
    </form>`);
  } else if (action === "handoff" && owns && rental.status === "confirmed") {
    showDialog("대여 전 사진 촬영", evidenceForm("handoff", rental));
  } else if (action === "receive" && borrows && rental.status === "handover") {
    await updateTrade(rental, "active", rental.lenderId, "대여자가 물품 수령을 확인했어요.");
  } else if (action === "return" && borrows && rental.status === "active") {
    showDialog("반납 사진 촬영", evidenceForm("return", rental));
  } else if (action === "reshoot" && borrows && rental.status === "checking" && !comparisonFeedback.get(rental.id)?.busy) {
    showDialog("반납 사진 다시 촬영", evidenceForm("return-update", rental));
  } else if (action === "complete" && owns && rental.status === "checking") {
    await updateTrade(rental, "complete", rental.renterId, "공급자가 반납을 확인했어요.");
  } else if (action === "dispute" && owns && rental.status === "checking") {
    showDialog("손상·누락 신고", noteForm("dispute", rental, "확인한 손상이나 누락 내용을 적어주세요.", "신고 접수"));
  } else if (action === "resolve" && state.role === "admin" && rental.status === "disputed") {
    showDialog("관리자 검토", noteForm("resolve", rental, "검토 의견을 적어주세요.", "검토 완료"));
  } else if (action === "review" && canReview(rental, state.role)) {
    showDialog("별점·후기 작성", noteForm("review", rental, "대여 경험을 적어주세요.", "후기 등록",
      '<label>별점<select name="rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label>'));
  }
}

function noteForm(kind, rental, placeholder, action, fields = "") {
  return `<form data-form="${kind}" data-id="${rental.id}" class="form-card plain">
    ${fields}<label>내용<textarea name="note" maxlength="500" rows="4" placeholder="${placeholder}" required></textarea></label>
    ${formErrorMarkup}<button class="button primary" type="submit">${action}</button>
  </form>`;
}

function evidenceDraft(kind, rental) {
  const key = `${rental.id}:${kind}`;
  if (!evidenceDrafts.has(key)) {
    const record = inspectionRecord(rental, itemById(rental.itemId));
    evidenceDrafts.set(key, { plan: structuredClone(record.plan),
      photos: kind === "return-update" ? { ...record.after } : {},
      checks: kind === "return-update" ? [...(record.afterChecks || [])] : [],
      note: kind === "return-update" ? record.afterNote || "" : "" });
  }
  return evidenceDrafts.get(key);
}

function evidenceForm(kind, rental) {
  const draft = evidenceDraft(kind, rental);
  const count = draft.plan.views.filter((view) => draft.photos[view.id]).length;
  const returning = kind !== "handoff";
  return `<form data-form="${kind}" data-id="${rental.id}" class="form-card plain inspection-form">
    <p class="inspection-intro">${returning ? "대여 전 사진에 맞춰 각 부위를 촬영해 주세요." : "물품을 전달하기 전, 아래 부위의 상태를 기록해 주세요."}</p>
    <div class="inspection-progress"><strong>사진 ${count}/${draft.plan.views.length}</strong><span>${count === draft.plan.views.length ? "촬영 완료" : "모든 부위를 촬영해 주세요"}</span></div>
    <div class="inspection-capture-grid">${draft.plan.views.map((view, i) => {
      const picture = draft.photos[view.id];
      const source = picture?.preview || photoUrl(picture?.source);
      return `<button type="button" class="inspection-capture-tile ${picture ? "captured" : ""}" data-action="capture-evidence" data-id="${view.id}">
        ${source ? `<img src="${escape(source)}" alt="${escape(view.label)} 촬영 사진">` : `<span class="inspection-capture-placeholder">${icon("photo")}</span>`}
        <span class="inspection-capture-label"><strong>${i+1}. ${escape(view.label)}</strong><span>${picture ? "다시 촬영" : "촬영하기"}</span></span></button>`;
    }).join("")}</div>
    ${draft.plan.checks.length ? `<fieldset class="inspection-checks"><legend>직접 확인해 주세요</legend>${draft.plan.checks.map((check) => `<label><input type="checkbox" name="check" value="${check.id}" ${draft.checks.includes(check.id) ? "checked" : ""}><span>${escape(check.label)}</span></label>`).join("")}</fieldset>` : ""}
    <label><span>알려둘 상태 <small class="hint">선택</small></span><textarea name="condition-note" maxlength="500" rows="2" placeholder="${returning ? "사용 중 발견한 변화나 구성품 상태를 적어 주세요." : "기존 흠집이나 구성품의 특이사항을 적어 주세요."}">${escape(draft.note)}</textarea></label>
    ${returning ? '<p class="hint">사진 비교가 어려워도 반납 요청은 유지되며, 상대방이 직접 상태를 확인할 수 있어요.</p>' : ""}
    ${formErrorMarkup}<button class="button primary" type="submit">${kind === "handoff" ? "사진 등록 · 물품 전달" : kind === "return-update" ? "사진 업데이트" : "사진 등록 · 반납 요청"}</button>
  </form>`;
}

function rememberListingFields(form) {
  const draft = listingDraft();
  for (const name of Object.keys(draft.fields)) if (form.elements[name]) draft.fields[name] = form.elements[name].value;
  return draft;
}

function refreshListingPhotos(form, draft = listingDraft()) {
  if (!form?.isConnected || form.dataset.form !== "register") return;
  const panel = form.querySelector("#listing-photo-panel");
  if (panel) panel.outerHTML = listingPhotoPanel(draft, escape);
  const submit = form.querySelector('[type="submit"]');
  if (submit) {
    submit.disabled = draft.busy;
    if (draft.step === 2) submit.textContent = draft.busy ? "게시하고 있어요…" : "물품 게시하기";
  }
  form.querySelectorAll('[data-action="listing-prev"]').forEach((button) => { button.disabled = draft.busy; });
}

function showListingStep(step, error) {
  const draft = listingDraft();
  draft.step = step;
  render();
  window.scrollTo(0, 0);
  const form = screen.querySelector('[data-form="register"]');
  if (error) {
    formError(form, error.message);
    const depositButton = ["valueWon", "valueEvidence"].includes(error.field)
      && form.querySelector('[data-action="listing-price-recommend"][data-id="value"]');
    (form.elements[error.field] || depositButton || form.querySelector(".form-error")).focus();
  } else screen.querySelector("#registration-stage-title")?.focus({ preventScroll: true });
}

function applyListingTerms(draft, fields, kind) {
  Object.assign(draft.fields, fields);
  dialog.close();
  render();
  screen.querySelector(`[data-action="listing-price-recommend"][data-id="${kind}"]`)?.focus({ preventScroll: true });
}

function updateListingPlan(form) {
  const draft = rememberListingFields(form);
  if (draft.busy) return;
  if (syncListingPlan(draft)) {
    if (draft.photos.length) draft.error = "촬영 목록이 바뀌었어요. 추가한 사진의 부위를 다시 선택해 주세요.";
    refreshListingPhotos(form, draft);
  }
}

function openListingCamera(form, photoId) {
  if (!form || state.role === "admin" || listingDraft().step !== 1) return;
  updateListingPlan(form);
  const draft = listingDraft(), role = state.role;
  const previous = draft.photos.find((photo) => photo.id === photoId);
  if (draft.busy || (!previous && draft.photos.length >= maxListingPhotos)) return;
  const sequence = previous ? draft.plan.views.filter((view) => view.id === previous.viewId) : missingListingViews(draft);
  if (!sequence.length) return;
  if (!previous && draft.photos.length + sequence.length > maxListingPhotos) {
    draft.error = "기존 사진의 촬영 부위를 지정하거나 불필요한 사진을 삭제한 뒤 이어서 촬영해 주세요.";
    refreshListingPhotos(form, draft);
    return;
  }
  const available = () => role === state.role && form.isConnected && draft.step === 1;
  openCapture({ title: previous ? "사진 다시 촬영" : "물품 사진 촬영", context: listingCaptureContext(draft), sequence, onCapture(capture, view) {
    if (!available()) return false;
    const photo = { blob: capture.blob, preview: URL.createObjectURL(capture.blob), width: capture.width,
      height: capture.height, capturedAt: capture.capturedAt, addedAt: capture.capturedAt, origin: "camera" };
    try {
      if (previous) replaceListingPhoto(draft, previous.id, photo);
      else { draft.activeViewId = view.id; addListingPhotos(draft, [photo]); }
      draft.error = "";
    } catch (error) { URL.revokeObjectURL(photo.preview); throw error; }
    refreshListingPhotos(form, draft);
  }, onComplete() {
    if (!available()) return;
    if (missingListingViews(draft).length === 0) draft.photoMode = "review";
    showListingStep(1);
  } });
}


function discardDemoPhotos() {
  for (const source of [demo.before, demo.after]) if (source?.startsWith("blob:")) URL.revokeObjectURL(source);
}

function captureDemo(slot) {
  const current = demo;
  if (current.busy || !["before", "after"].includes(slot) || (slot === "after" && !current.before)) return;
  openCapture({ reference: slot === "after" ? current.before : null, face: current.face || "정면", onCapture(capture) {
    if (current !== demo || !(route()[0] === "dev" && route()[1] === "compare")) return;
    if (current[slot]?.startsWith("blob:")) URL.revokeObjectURL(current[slot]);
    if (slot === "before") {
      if (current.after?.startsWith("blob:")) URL.revokeObjectURL(current.after);
      delete current.after;
    }
    current[slot] = URL.createObjectURL(capture.blob);
    current.result = null; current.error = "";
    render();
  } });
}

function canSubmitEvidence(kind, rental, role = state.role) {
  return kind === "handoff" ? rental.lenderId === role && rental.status === "confirmed"
    : rental.renterId === role && (kind === "return" ? rental.status === "active" : kind === "return-update" && rental.status === "checking");
}

function captureEvidence(form, viewId) {
  if (!form) return;
  const rental = rentalById(form.dataset.id), role = state.role;
  const kind = form.dataset.form;
  if (!rental || !canSubmitEvidence(kind, rental)) return;
  const draft = evidenceDraft(kind, rental), view = draft.plan.views.find((v) => v.id === viewId);
  if (!view) return;
  const status = rental.status;
  const record = inspectionRecord(rental, itemById(rental.itemId));
  openCapture({ reference: kind === "handoff" ? null : record.before[view.id]?.source,
    face: view.label, instruction: view.instruction, returning: kind !== "handoff", onCapture(capture) {
    if (!form.isConnected || state.role !== role || rental.status !== status || !dialog.open) return;
    const previous = draft.photos[view.id];
    if (previous?.preview) URL.revokeObjectURL(previous.preview);
    capture.preview = URL.createObjectURL(capture.blob);
    draft.photos[view.id] = capture;
    showDialog(kind === "handoff" ? "대여 전 사진 촬영" : "반납 사진 촬영", evidenceForm(kind, rental));
  } });
}

async function submitEvidence(form, rental, kind) {
  const role = state.role, status = rental.status;
  const draft = evidenceDraft(kind, rental);
  draft.checks = new FormData(form).getAll("check");
  draft.note = form.elements["condition-note"].value.trim();
  if (!completeDraft(draft)) { formError(form, "모든 부위의 사진을 촬영하고 확인 항목을 체크해 주세요."); return; }
  const photos = {};
  for (const view of draft.plan.views) {
    const capture = draft.photos[view.id];
    photos[view.id] = capture.blob ? { source: await saveOriginal(capture), capturedAt: capture.capturedAt,
      width: capture.width, height: capture.height, face: view.label } : capture;
  }
  if (!form.isConnected || role !== state.role || status !== rental.status || !dialog.open) return;
  if (kind === "handoff") {
    rental.inspection = { plan: draft.plan, before: photos, after: {}, beforeChecks: draft.checks, afterChecks: [], beforeNote: draft.note, results: {} };
    rental.before = photos[draft.plan.views[0].id].source;
    delete rental.sample;
  } else {
    const previous = inspectionRecord(rental, itemById(rental.itemId));
    rental.inspection = { ...previous, after: photos, afterChecks: draft.checks, afterNote: draft.note,
      returnHistory: [...(previous.returnHistory || []), { photos: previous.after, replacedAt: new Date().toISOString() }].filter((entry) => Object.keys(entry.photos).length) };
    rental.after = photos[draft.plan.views[0].id].source;
    delete rental.photoAnalysis;
  }
  const recipient = kind === "handoff" ? rental.renterId : rental.lenderId;
  const message = kind === "handoff" ? "대여 전 상태 사진이 등록됐어요. 물품을 받으면 수령을 확인해 주세요."
    : kind === "return-update" ? "반납 상태 사진이 업데이트됐어요." : "반납 요청과 상태 사진이 도착했어요.";
  if (!await updateTrade(rental, kind === "handoff" ? "handover" : "checking", recipient, message)) return;
  for (const capture of Object.values(draft.photos)) if (capture.preview) URL.revokeObjectURL(capture.preview);
  evidenceDrafts.delete(`${rental.id}:${kind}`);
  if (kind !== "handoff") await analyzeTrade(rental);
}

async function runEvaluation() {
  if (evaluation.busy) return;
  evaluation.busy = true; evaluation.error = ""; render();
  try {
    const response = await fetch("/api/photo-evaluation", { method: "POST", signal: AbortSignal.timeout(180_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "평가에 실패했어요.");
    evaluation.result = data;
  } catch (error) { evaluation.error = error.name === "TimeoutError" ? "평가가 오래 걸리고 있어요. 서버 상태를 확인해 주세요." : error.message; }
  finally { evaluation.busy = false; if (route()[0] === "dev" && route()[1] === "photo-evaluation") render(); }
}

async function updateTrade(rental, status, recipient, message) {
  if (status === "complete" && rental.status !== status) rental.completedAt = Date.now();
  rental.status = status;
  if (recipient) announce(recipient, rental, message);
  const saving = save();
  if (saving && !await saving) return;
  if (dialog.open) dialog.close();
  render();
  return true;
}

async function openNotices() {
  const notices = state.notices.filter((notice) => notice.role === state.role);
  for (const notice of notices) notice.read = true;
  const saving = save();
  if (saving && !await saving) return;
  const indicator = screen.querySelector(".notification i");
  if (indicator) indicator.remove();
  showDialog("알림", notices.length ? `<div class="menu-list">${notices.map((notice) =>
    `<a href="#trade/${notice.rentalId}">${escape(notice.message)}${icon("right")}</a>`).join("")}</div>`
    : '<p class="notice">새 알림이 없어요.</p>');
}

function refreshHomeRows() {
  document.querySelector("#listings").innerHTML = homeRows();
}

const assistantSessions = new Map();
function assistantSession(role = state.role) {
  if (!assistantSessions.has(role)) assistantSessions.set(role, newAIConversation());
  return assistantSessions.get(role);
}

async function sendAssistant() {
  const role = state.role, session = assistantSession(role);
  if (session.busy) return;
  const items = recommendationCandidates(recommendationContext());
  if (!items.length) {
    session.error = accountMode && !depositPolicy && allItems().some((item) => item.owner !== role)
      ? "보증금 정책이 결정되면 대여 가능한 물품을 추천할 수 있어요."
      : "조건에 맞는 물품이 없어요. 날짜나 예산을 조정해 주세요.";
    render();
    return;
  }
  const request = sendAIMessage(session, items, localDay());
  render();
  await request;
  if (route()[0] === "assistant" && state.role === role) {
    render();
    screen.querySelector('[name="question"]')?.focus();
  }
}

document.addEventListener("input", ({target}) => {
  if (target.matches('.ai-room-compose textarea')) assistantSession().draft = target.value;
});
document.addEventListener("keydown", event => {
  if (event.target.matches('.ai-room-compose textarea') && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
});

document.addEventListener("click", async (event) => {
  if (databaseFailed || (accountMode && !account)) return;
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === "start-inquiry") {
    await startInquiry(id);
    return;
  }
  if (["demo-subscription","demo-grant","promote","pickup"].includes(action)) {
    await benefitAction(action,id); return;
  }
  if (action === "edit-profile") {
    if (account && route()[0] === "profile") showDialog("프로필 수정", profileEditForm(ownProfile(), escape));
    return;
  }
  if (action === "edit-listing" || action === "manage-listing") {
    const item = myListings().find((listing) => listing.id === id);
    if (!item || route()[0] !== "my-listings") return;
    if (action === "edit-listing") {
      showDialog("물품 정보 수정", listingEditForm(item, escape));
      return;
    }
    const { visibility } = target.dataset;
    if (visibility === "deleted") {
      showDialog("물품 삭제", `<form data-form="listing-delete" data-id="${escape(id)}" class="form-card plain">
        <p>‘${escape(item.title)}’을 삭제할까요? 기존 대여 거래는 내역에 남아요.</p>
        <p class="form-error" role="alert" hidden></p>
        <button class="button primary" type="submit">물품 삭제</button>
      </form>`);
    } else if (visibility === "private" || visibility === "public") {
      target.disabled = true;
      try { await setListingVisibility(id, visibility); }
      finally { target.disabled = false; }
    }
    return;
  }
  if (action.startsWith("listing-")) {
    if (["listing-gallery", "listing-photo-enlarge"].includes(action)) {
      const item = visibleListing(route()[1]);
      if (!item) return;
      const photos = item.photos?.length ? item.photos : [{ id: "legacy", source: item.image, label: item.title }];
      const photo = photos.find((p) => p.id === id);
      if (!photo) return;
      if (action === "listing-gallery") {
        gallerySelections.set(item.id, id);
        screen.querySelector("#item-gallery").outerHTML = itemGallery(item, id, escape);
      } else showDialog(photo.label || item.title, `<img class="listing-enlarged" src="${escape(photoUrl(photo.source))}" alt="${escape(photo.label || item.title)}">`);
      return;
    }
    const form = target.form?.dataset.form === "register" ? target.form : screen.querySelector('[data-form="register"]');
    if (form?.dataset.form !== "register" || state.role === "admin") return;
    const draft = rememberListingFields(form);
    if (draft.busy) return;
    if (action === "listing-price-recommend" && draft.step === 2) {
      const heading = id === "value" ? "보증금 렌토 추천" : "하루 대여료 렌토 추천";
      showDialog(heading, priceRecommendationForm(id, draft.fields, depositPolicy, escape));
      return;
    }
    if (action === "listing-apply-price" && draft.step === 2 && dialog.open) {
      const result = listingPriceResults.get(target.form);
      if (!result?.amountWon) return;
      const kind = target.form.dataset.id;
      const details = pricingContextFrom(Object.fromEntries(new FormData(target.form)));
      if (kind === "value") {
        const sources = result.references.slice(0, 3).map((ref) => `${ref.url} (${ref.amountWon}원)`);
        const valueEvidence = `렌토 비교 중고 가액 · ${sources.join(" · ")}`.slice(0, 500);
        applyListingTerms(draft, { ...details, valueWon: String(result.amountWon), valueEvidence }, kind);
      } else {
        applyListingTerms(draft, { ...details, price: String(result.amountWon) }, kind);
      }
      return;
    }
    if (action === "listing-prev") { showListingStep(Math.max(0, draft.step - 1)); return; }
    if (action === "listing-review-photos") {
      if (dialog.open) dialog.close();
      draft.photoMode = draft.photos.length ? "review" : "capture";
      showListingStep(1);
      return;
    }
    if (action === "listing-preview") {
      const photo = draft.photos.find((entry) => entry.id === id);
      if (photo) showDialog("사진 확인", `<img class="listing-enlarged" src="${escape(photo.preview || photoUrl(photo.source))}" alt="촬영한 물품 사진">`);
      return;
    }
    if (action === "listing-camera") { openListingCamera(form); return; }
    if (action === "listing-photo-retake") { openListingCamera(form, id); return; }
    if (action === "listing-target" && draft.plan.views.some((v) => v.id === id)) draft.activeViewId = id;
    else if (action === "listing-photo-remove") removeListingPhoto(draft, id);
    else if (action === "listing-cover" && draft.photos.some((p) => p.id === id)) draft.coverId = id;
    draft.error = "";
    refreshListingPhotos(form, draft);
    return;
  }
  if (action === "inspection-view") {
    const rental = rentalById(route()[1]);
    if (rental && (isParty(rental) || state.role === "admin")) { inspectionViews.set(rental.id, id); render(); }
    return;
  }
  if (action === "view-inspection") {
    const rental = rentalById(route()[1]);
    if (rental && (isParty(rental) || state.role === "admin")) {
      const record = inspectionRecord(rental, itemById(rental.itemId));
      const view = record.plan.views.find((v) => v.id === id);
      if (view) showDialog(view.label + " 상태 사진", inspectionPhotoDialog(rental, itemById(rental.itemId), id, escape));
    }
    return;
  }
  if (action === "capture-demo") { captureDemo(id); return; }
  if (action === "capture-evidence") { captureEvidence(target.form, id); return; }
  if (action === "analyze-trade") {
    const rental = rentalById(route()[1]);
    if ((rental?.inspection?.after || rental?.after) && (isParty(rental) || state.role === "admin")) analyzeTrade(rental, true);
    return;
  }
  if (action === "run-evaluation") { runEvaluation(); return; }
  if (action === "download-evaluation" && evaluation.result) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(evaluation.result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "photo-evaluation.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  if (action === "close") dialog.close();
  else if (action === "category" && categories.includes(id)) {
    filters.category = id;
    screen.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", String(chip === target)));
    refreshHomeRows();
  } else if (action === "filter-dates") {
    showDialog("대여 날짜 선택", `<form data-form="filter" class="form-card plain">
      ${dateInputs(filters.date, { required: false })}
      <label>최대 하루 대여료 (원)<input type="number" min="0" max="10000000" step="1" name="maxPrice" placeholder="제한 없음" value="${filters.maxPrice ?? ""}"></label>
      ${formErrorMarkup}<button class="button primary" type="submit">필터 적용</button></form>`);
  } else if (action === "clear-filters") {
    filters.date = {};
    filters.maxPrice = null;
    render();
    screen.querySelector('[data-action="filter-dates"]').focus();
  } else if (action === "recommend") {
    navigate("assistant");
  } else if (action === "ai-new") {
    if (assistantSession().busy) return;
    assistantSessions.set(state.role, newAIConversation());
    render();
    screen.querySelector('[name="question"]')?.focus();
  } else if (action === "ai-example") {
    if (assistantSession().busy) return;
    assistantSession().draft = target.dataset.text;
    render();
    screen.querySelector('.ai-room-compose')?.requestSubmit();
  } else if (action === "ai-retry") {
    screen.querySelector('.ai-room-compose')?.requestSubmit();
  } else if (action === "favorite" && itemById(id)) {
    const selected = !isFavorite(id);
    state.favorites = selected ? [...state.favorites, favoriteKey(id)] : state.favorites.filter((key) => key !== favoriteKey(id));
    const saving = save();
    if (saving && !await saving) return;
    if (route()[0] === "saved") render();
    else if (route()[0] === "home") {
      refreshHomeRows();
      screen.querySelector(`[data-action="favorite"][data-id="${id}"]`)?.focus();
    } else {
      target.classList.toggle("selected", selected);
      target.setAttribute("aria-pressed", String(selected));
    }
  } else if (action === "area") {
    showDialog("동네 변경", `<div class="menu-list">${neighborhoods.map((area) =>
      `<button data-action="set-area" data-id="${area}">${area}${area === state.area ? icon("check") : ""}</button>`).join("")}</div>`);
  } else if (action === "set-area" && neighborhoods.includes(id)) {
    state.area = id;
    const saving = save();
    if (saving && !await saving) return;
    dialog.close();
    render();
  } else if (action === "notices") await openNotices();
  else if (action === "role" && !accountMode && Object.hasOwn(people, id)) {
    state.role = id;
    direction = id === "lender" ? "out" : "in";
    const saving = save();
    if (saving && !await saving) return;
    render();
    screen.querySelector(`[data-action="role"][data-id="${id}"]`)?.focus();
  } else if (action === "direction") {
    direction = id;
    render();
    screen.querySelector(`[data-action="direction"][data-id="${id}"]`).focus();
  } else if (action === "trade-action") await tradeAction(id);
  else if (["draft", "apply-category", "apply-draft"].includes(action)) {
    const form = target.form;
    if (!form?.isConnected) return;
    const draft = rememberListingFields(form);
    const title = draft.fields.title.trim();
    if (action === "draft") {
      if (!title) { formError(form, "물품명을 먼저 입력해 주세요."); return; }
      if (draft.adviceBusy) return;
      draft.adviceBusy = true;
      target.disabled = true;
      formError(form, "");
      try {
        const result = await getListingDraft(draft.fields);
        if (!form.isConnected || draft.fields.title.trim() !== title) return;
        draft.advice = { ...result, title };
        draft.adviceBusy = false;
        showListingStep(draft.step);
      } finally {
        draft.adviceBusy = false;
        target.disabled = false;
      }
    } else if (action === "apply-category" || action === "apply-draft") {
      if (draft.advice?.title !== title) return;
      if (action === "apply-category" && draft.advice.category) draft.fields.category = draft.advice.category;
      if (action === "apply-draft") draft.fields.description = draft.advice.description;
      syncListingPlan(draft);
      showListingStep(draft.step);
    }
  }
});

document.addEventListener("input", (event) => {
  const pricingForm = event.target.form;
  if (pricingForm?.dataset.form === "register") rememberListingFields(pricingForm);
  if (pricingForm?.dataset.form === "listing-price-advice") {
    listingPriceResults.delete(pricingForm);
    pricingForm.querySelector(".listing-price-output").replaceChildren();
    formError(pricingForm, "");
  }
  if (["listing-valuation", "listing-deposit-basis"].includes(pricingForm?.dataset.form)) {
    const preview = pricingForm.querySelector("#deposit-preview");
    if (preview) {
      const { valueWon, valueEvidence } = pricingForm.elements;
      preview.outerHTML = depositPreview({ valueWon: valueWon.value, valueEvidence: valueEvidence.value }, depositPolicy, escape);
    }
  }
  if (event.target.name === "condition-note" && ["handoff", "return", "return-update"].includes(event.target.form?.dataset.form)) {
    const rental = rentalById(event.target.form.dataset.id);
    if (rental) evidenceDraft(event.target.form.dataset.form, rental).note = event.target.value;
  }
  if (event.target.id === "search") {
    filters.query = event.target.value;
    refreshHomeRows();
  }
  const form = event.target.form;
  if ((event.target.name === "start" || event.target.name === "end") && form?.elements.end
      && form.dataset.form !== "listing-edit") {
    const start = form.elements.start.value;
    const end = form.elements.end.value;
    form.elements.end.min = start || localDay();
    if (start && end && end < start) form.elements.end.value = start;
    if (form.dataset.form === "request") {
      const item = itemById(form.dataset.id);
      form.querySelector("#estimate").textContent = rentalEstimate(item, start, form.elements.end.value, depositPolicy);
      formError(form, "");
    }
  }
});

async function readPhoto(file, evidence = false, maxLength = Infinity) {
  if (!file?.size) return "";
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) {
    throw new Error("12MB 이하 이미지 파일을 선택해 주세요.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const factor = Math.min(1, 850 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * factor));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * factor));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    if (evidence) {
      // Avoid adding compression artifacts to fine scratches. Keep a per-photo
      // space budget because transaction evidence lives in browser storage.
      const lossless = canvas.toDataURL("image/png");
      if (lossless.length < 480_000) return lossless;
    }
    const quality = evidence ? 0.94 : 0.75;
    let encoded = canvas.toDataURL("image/webp", quality);
    while (encoded.length > maxLength) {
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.floor(canvas.height * 0.75));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      encoded = canvas.toDataURL("image/webp", quality);
    }
    return encoded;
  } catch {
    throw new Error("사진을 열 수 없어요. JPG, PNG 또는 WebP 사진을 선택해 주세요.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

document.addEventListener("change", async ({ target }) => {
  if (target.form?.dataset.form === "register") {
    const form = target.form, draft = rememberListingFields(form);
    if (target.dataset.listingView) {
      if (!draft.busy) { assignListingView(draft, target.dataset.listingView, target.value); draft.error = ""; refreshListingPhotos(form, draft); }
      return;
    }
    if (["title", "category"].includes(target.name)) updateListingPlan(form);
    return;
  }
  if (["handoff", "return", "return-update"].includes(target.form?.dataset.form)) {
    const rental = rentalById(target.form.dataset.id);
    if (rental && target.name === "check") evidenceDraft(target.form.dataset.form, rental).checks = new FormData(target.form).getAll("check");
    return;
  }
  if (target.form?.dataset.form !== "compare-demo") return;
  if (["face", "method", "mode"].includes(target.name)) { demo[target.name] = target.value; demo.result = null; render(); return; }
  if (target.name === "source") {
    discardDemoPhotos();
    demo = target.value === "sample" ? { ...samplePair, custom: false } : { custom: true, source: target.value, face: "정면" };
    render();
    return;
  }
  const slot = target.dataset.compareFile;
  if (!slot || !target.files[0]) return;
  const current = demo;
  demo.busy = true;
  demo.result = null;
  demo.error = "";
  const file = target.files[0];
  render();
  try {
    current[slot] = await readPhoto(file, true);
  } catch (error) {
    current[slot] = "";
    current.error = error.message;
  } finally {
    current.busy = false;
    if (route()[0] === "dev" && route()[1] === "compare" && current === demo) render();
  }
});

async function submit(form) {
  const { form: kind, id } = form.dataset;
  const fields = new FormData(form);
  if (accountMode && (kind === "login" || kind === "signup")) {
    const credentials = { email: fields.get("email"), password: fields.get("password") };
    if (kind === "signup") credentials.profile = await readProfileSettings(fields);
    const result = await accountRequest(kind, credentials);
    location.replace(location.pathname + (result.profileSaved === false ? "#profile/setup" : "#home"));
    location.reload();
    return;
  }
  if (accountMode && kind === "logout") {
    await accountRequest("logout");
    location.replace(location.pathname + "#login");
    location.reload();
    return;
  }
  if (accountMode && !account) return;
  if (kind === "edit-profile") {
    if (!account || !dialog.open || !dialog.contains(form) || route()[0] !== "profile") return;
    const details = await readProfileSettings(fields, state.profilePhotos?.[state.role]);
    if (!dialog.open || !dialog.contains(form) || route()[0] !== "profile") return;
    const previous = { area: state.area, displayNames: state.displayNames, profilePhotos: state.profilePhotos };
    state.area = details.area;
    state.displayNames = { ...state.displayNames, [state.role]: details.displayName };
    state.profilePhotos = { ...state.profilePhotos, [state.role]: details.photo };
    if (!await saveToDatabase()) {
      Object.assign(state, previous);
      return;
    }
    if (dialog.contains(form)) dialog.close();
    if (route()[0] === "profile") navigate("#profile");
    showToast("프로필을 저장했어요.");
    return;
  }
  const date = { start: fields.get("start"), end: fields.get("end") };

  if (kind === "compare-demo") {
    const current = demo;
    if (current.busy || !current.before || !current.after) return;
    current.busy = true;
    current.result = null;
    current.error = "";
    render();
    try {
      current.result = await comparePhotos(current.before, current.after, { method: current.method, mode: current.mode });
    } catch (error) {
      current.error = error.message;
    } finally {
      current.busy = false;
      if (route()[0] === "dev" && route()[1] === "compare" && current === demo) render();
    }
    return;
  }

  if (kind === "filter") {
    if ((date.start || date.end) && (!(rentalDays(date.start, date.end) >= 1) || date.start < localDay())) {
      formError(form, "올바른 날짜를 선택해 주세요.");
      return;
    }
    filters.date = date.start ? date : {};
    const maximum = fields.get("maxPrice");
    filters.maxPrice = maximum === "" ? null : Number(maximum);
    dialog.close();
    render();
    return;
  }

  if (kind === "ai-room") {
    assistantSession().draft = fields.get("question") ?? "";
    await sendAssistant();
    return;
  }

  if (kind === "listing-price-advice" || kind === "listing-deposit-basis") {
    const mainForm = screen.querySelector('[data-form="register"]');
    if (!mainForm || !dialog.open || route()[0] !== "new") return;
    const draft = rememberListingFields(mainForm);
    if (draft.step !== 2 || draft.busy) return;

    if (kind === "listing-deposit-basis") {
      const value = itemValueFrom({ valueWon: fields.get("valueWon"), valueEvidence: fields.get("valueEvidence") });
      if (!value) { formError(form, "현재 중고 가액과 근거를 확인해 주세요."); return; }
      applyListingTerms(draft, { valueWon: String(value.amountWon), valueEvidence: value.evidence }, "value");
      return;
    }

    const output = form.querySelector(".listing-price-output");
    const formFields = Object.fromEntries(fields);
    const fingerprint = JSON.stringify(formFields);
    const mode = form.dataset.id;
    formError(form, "");
    listingPriceResults.delete(form);
    output.innerHTML = `<p class="hint" role="status">${mode === "value" ? "웹에서 같은 모델의 중고가를 찾고 있어요…" : "비교할 사례를 찾고 있어요…"}</p>`;
    try {
      const result = await getPriceRecommendation(mode, { ...draft.fields, ...formFields });
      if (!form.isConnected || !dialog.open || JSON.stringify(Object.fromEntries(new FormData(form))) !== fingerprint) return;
      listingPriceResults.set(form, result);
      output.innerHTML = priceRecommendationResult(mode, result, depositPolicy, escape);
      if (mode === "value" && (result.message
          || (result.match === "recorded-used" && result.references.length === 1))) {
        const manual = dialog.querySelector('[data-form="listing-deposit-basis"]');
        if (manual) manual.closest("details").open = true;
      }
    } catch (error) {
      if (form.isConnected && dialog.open && JSON.stringify(Object.fromEntries(new FormData(form))) === fingerprint) {
        output.replaceChildren();
        formError(form, error.message);
      }
    }
    return;
  }

  if (kind === "listing-edit") {
    if (!dialog.open || !dialog.contains(form) || route()[0] !== "my-listings") return;
    const item = myListings().find((listing) => listing.id === id);
    if (!item) return;
    const title = fields.get("title").trim(), description = fields.get("description").trim();
    const category = fields.get("category"), neighborhood = fields.get("neighborhood");
    const price = Number(fields.get("price"));
    if (!title || !description || !categories.slice(1).includes(category) || !neighborhoods.includes(neighborhood)
        || !fields.get("price") || !Number.isInteger(price) || price < 0 || price > 10_000_000) {
      formError(form, "물품 정보와 하루 대여료를 확인해 주세요.");
      return;
    }
    const { start, end } = date;
    const changedDates = start !== (item.availableFrom ?? "") || end !== (item.availableTo ?? "");
    if (changedDates && (start || end)) {
      const today = localDay();
      if (!(rentalDays(start, end) >= 1) || end < today || (start !== item.availableFrom && start < today)) {
        formError(form, "대여 가능 기간의 시작일과 종료일을 확인해 주세요.");
        return;
      }
      const outside = state.rentals.some((rental) => rental.itemId === id && rental.end >= today
        && ["pending", "confirmed", "handover", "active", "checking", "disputed"].includes(rental.status)
        && (start > (rental.start < today ? today : rental.start) || end < rental.end));
      if (outside) {
        formError(form, "대여 가능 기간에 이미 신청되었거나 진행 중인 거래 날짜를 포함해 주세요.");
        return;
      }
    }
    const changes = { title, description, category, neighborhood, price };
    if (changedDates) Object.assign(changes, { availableFrom: start, availableTo: end });
    if (await saveListingChange(item, changes, "물품 정보를 수정했어요.") && dialog.contains(form)) dialog.close();
    return;
  }

  if (kind === "listing-delete") {
    if (!dialog.open || !dialog.contains(form) || route()[0] !== "my-listings") return;
    if (await setListingVisibility(id, "deleted")) dialog.close();
    return;
  }

  if (kind === "listing-valuation" && accountMode) {
    const item = visibleListing(id);
    if (!item || item.owner !== state.role || item.itemValue) return;
    const itemValue = itemValueFrom(Object.fromEntries(fields));
    if (!itemValue) { formError(form, "현재 중고 가액과 근거를 확인해 주세요."); return; }
    const deposit = depositQuote(itemValue, depositPolicy)?.amountWon ?? null;
    const index = state.listings.indexOf(item);
    const updated = { ...item, itemValue, deposit };
    state.listings[index] = updated;
    if (!await saveToDatabase()) {
      if (state.listings[index] === updated) state.listings[index] = item;
      return;
    }
    if (route()[0] === "item" && route()[1] === id) render();
    showToast("중고 가액과 근거를 저장했어요.");
    return;
  }

  if (kind === "request") {
    const item = itemById(id);
    if (!item || !publicListing(item) || item.owner === state.role || state.role === "admin") return;
    const blocked = depositBlock(item, depositPolicy, accountMode);
    if (blocked) { formError(form, blocked); return; }
    const money = rentalDepositSnapshot(item, depositPolicy);
    const error = findAvailability(item, date.start, date.end, blockedRentals());
    const same = state.rentals.some((rental) => rental.status === "pending" && rental.itemId === id
      && rental.renterId === state.role && rental.start <= date.end && date.start <= rental.end);
    if (error || same) {
      formError(form, error || "승인 대기 중인 내 신청과 날짜가 겹쳐요. 거래 내역에서 기존 신청을 철회한 뒤 다시 신청해 주세요.");
      return;
    }
    const rental = { id: newId(), createdAt: Date.now(), itemId: id, renterId: state.role, lenderId: item.owner,
      ...date, ...money, total: item.price * rentalDays(date.start, date.end), status: "pending" };
    state.rentals.unshift(rental);
    announce(item.owner, rental, "새 대여 신청이 도착했어요.");
    const saving = save();
    if (saving && !await saving) return;
    direction = "in";
    navigate(`#trade/${rental.id}`);
    return;
  }

  if (kind === "register" && state.role !== "admin") {
    updateListingPlan(form);
    const draft = listingDraft(), role = state.role;
    if (draft.busy) return;
    if (draft.step < 2) {
      // Photo completion is required for publishing, not for viewing the terms.
      const error = draft.step === 0 ? validateListingStep(draft, 0) : null;
      if (error) {
        formError(form, error.message);
        (form.elements[error.field] || form.querySelector(".form-error")).focus();
        return;
      }
      showListingStep(draft.step + 1);
      return;
    }
    // Recheck previous steps too: the item type or date may have changed.
    for (let step = 0; step < 3; step++) {
      const issue = validateListingStep(draft, step);
      if (issue) {
        if (step === 1) {
          formError(form, issue.message);
          showDialog("사진 촬영을 완료해 주세요", `<p class="registration-photo-prompt">${escape(issue.message)}</p>
            <div class="registration-photo-prompt-actions"><button type="button" class="button secondary" data-action="close">계속 입력하기</button>
            <button type="button" class="button primary" data-action="listing-review-photos">사진 촬영하기</button></div>`);
        } else showListingStep(step, issue);
        return;
      }
    }
    const title = draft.fields.title.trim(), description = draft.fields.description.trim();
    const price = Number(draft.fields.price);
    const itemValue = itemValueFrom(draft.fields);
    const deposit = depositQuote(itemValue, depositPolicy)?.amountWon ?? null;
    const pricingContext = pricingContextFrom(draft.fields);
    const category = draft.fields.category, area = draft.fields.neighborhood;
    const date = { start: draft.fields.start, end: draft.fields.end };
    const fieldSnapshot = JSON.stringify(draft.fields);
    draft.busy = true;
    refreshListingPhotos(form, draft);
    try {
      const photos = [];
      for (const photo of draft.photos) {
        let source = listingSavedSources.get(photo.blob);
        if (!source) {
          const original = await saveOriginal({ blob: photo.blob, capturedAt: photo.capturedAt, width: photo.width,
            height: photo.height, origin: "camera", addedAt: photo.addedAt,
            face: draft.plan.views.find((v) => v.id === photo.viewId)?.label || "추가 사진" });
          // Keep the camera original locally and use a bounded copy for other browsers.
          source = databaseMode ? await readPhoto(photo.blob, false, 95_000) : original;
          listingSavedSources.set(photo.blob, source);
        }
        photos.push({ id: photo.id, source, viewId: photo.viewId,
          label: draft.plan.views.find((v) => v.id === photo.viewId)?.label || "추가 사진", origin: "camera",
          capturedAt: photo.capturedAt || null, addedAt: photo.addedAt, width: photo.width, height: photo.height });
      }
      if (role !== state.role || !form.isConnected) return;
      if (JSON.stringify(rememberListingFields(form).fields) !== fieldSnapshot) {
        draft.busy = false;
        updateListingPlan(form);
        formError(form, "입력 내용이 변경됐어요. 촬영 부위와 내용을 확인한 뒤 다시 게시해 주세요.");
        return;
      }
      if (!hasOnlyListingCameraPhotos(draft)) {
        formError(form, "촬영 원본을 확인할 수 없어요. 앱 카메라로 다시 촬영해 주세요.");
        return;
      }
      const cover = photos.find((photo) => photo.id === draft.coverId) || photos[0];
      const listing = { id: newId(), createdAt: Date.now(), title, description, price, deposit, itemValue, pricingContext, owner: role, category,
        neighborhood: area, image: cover.source, photos, coverPhotoId: cover.id, inspectionPlan: structuredClone(draft.plan),
        availableFrom: date.start, availableTo: date.end };
      state.listings.unshift(listing);
      const saved = databaseMode ? await saveToDatabase() : writeState(state);
      if (!saved) {
        state.listings = state.listings.filter((item) => item !== listing);
        if (form.isConnected) formError(form, "저장하지 못했어요. 사진과 입력 내용은 유지돼요.");
        return;
      }
      draft.photos.forEach((photo) => { if (photo.preview) URL.revokeObjectURL(photo.preview); });
      listingDrafts.delete(role);
    } finally {
      draft.busy = false;
      refreshListingPhotos(form, draft);
    }
    filters.query = "";
    filters.category = "전체";
    filters.date = {};
    filters.maxPrice = null;
    navigate("#home");
    return;
  }

  if (kind === "inquiry-message") {
    const room = inquiryById(id);

    if (!room || !isInquiryParty(room, state.role)) return;

    const message = String(fields.get("message") ?? "").trim();

    if (!message || message.length > 350) return;

    (state.messages[id] ??= []).push({
      id: newId(),
      sender: state.role,
      text: message,
      sentAt: Date.now()
    });

    const saving = save();
    if (saving && !await saving) return;

    if (route()[0] === "chat" && route()[1] === id) {
      render();
      screen.querySelector(".compose input")?.focus();
    }

    return;
  }

  const rental = rentalById(id);
  if (!rental) return;
  const owns = state.role === rental.lenderId;
  const borrows = state.role === rental.renterId;
  if (kind === "message" && (owns || borrows) && chatAllowed(rental)) {
    const message = fields.get("message").trim();
    if (!message || message.length > 350) return;
    (state.messages[id] ??= []).push({ id: newId(), sender: state.role, text: message, sentAt: Date.now() });
    const saving = save();
    if (saving && !await saving) return;
    render();
    document.querySelector(".compose input")?.focus();
  } else if (kind === "cancel" && ((borrows && rental.status === "pending")
      || ((owns || borrows) && rental.status === "confirmed"))) {
    await updateTrade(rental, "canceled", owns ? rental.renterId : rental.lenderId, "대여 신청이 취소됐어요.");
  } else if (["handoff", "return", "return-update"].includes(kind) && canSubmitEvidence(kind, rental)) {
    await submitEvidence(form, rental, kind);
  } else if (["dispute", "resolve", "review"].includes(kind)) {
    const note = fields.get("note").trim();
    if (!note) {
      formError(form, "내용을 입력해 주세요.");
      return;
    }
    if (kind === "dispute" && owns && rental.status === "checking") {
      rental.dispute = note;
      rental.resolution = "";
      if (!accountMode) announce("admin", rental, "새 분쟁이 접수됐어요.");
      await updateTrade(rental, "disputed", rental.renterId, "공급자가 반납 상태에 이의를 제기했어요.");
    } else if (kind === "resolve" && state.role === "admin" && rental.status === "disputed") {
      rental.resolution = note;
      announce(rental.lenderId, rental, "관리자 검토가 끝났어요. 반납 상태를 확인해 주세요.");
      await updateTrade(rental, "checking", rental.renterId, "관리자가 신고 내용을 검토했어요.");
    } else if (kind === "review" && canReview(rental, state.role)) {
      const rating = Number(fields.get("rating"));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
      (rental.feedback ??= {})[seat(rental, state.role)] = { rating, text: note };
      if (await updateTrade(rental, "complete") && accountMode) location.reload();
    }
  }
}

document.addEventListener("submit", async (event) => {
  if (databaseFailed) return;
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await submit(form);
  } catch (error) {
    if (form.querySelector(".form-error")) formError(form, error.message);
    else showToast("처리 중 문제가 생겼어요. 다시 시도해 주세요.");
  } finally {
    if (button) button.disabled = false;
  }
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  }
});

window.addEventListener("hashchange", () => {
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
  screen.focus({ preventScroll: true });
});
if (accountMode) {
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
}
render();

if (persistDatabase) {
  let refreshing = false;
  setInterval(async () => {
    if (refreshing || databaseFailed || document.hidden || dialog.open) return;
    refreshing = true;
    try {
      const previousIds = new Set(Object.values(state.messages).flat().map(m => m.id));
      if (!await persistDatabase.refresh()) return;
      const arrived = Object.values(state.messages).flat().some(m => !previousIds.has(m.id) && m.sender !== state.role && !m.read);
      if (arrived) showToast("새 채팅 메시지가 도착했어요.");
      const [page, id] = route();
      if ((["chat", "profile", "person", "membership", "trade", "my-listings", "saved"].includes(page)
          || (page === "item" && !visibleListing(id))) && !dialog.open) {
        const input = screen.querySelector('[name="message"]');
        const draft = input?.value, focused = input && document.activeElement === input;
        const history = screen.querySelector(".chat-history");
        const scroll = history && history.scrollHeight - history.scrollTop - history.clientHeight > 4 ? history.scrollTop : null;
        render();
        const updated = screen.querySelector('[name="message"]');
        if (updated && draft !== undefined) { updated.value = draft; if (focused) updated.focus({preventScroll:true}); }
        if (scroll !== null && screen.querySelector(".chat-history")) screen.querySelector(".chat-history").scrollTop = scroll;
      } else {
        if (page === "home") refreshHomeRows();
        const count = totalChatUnread();
        const label = navigation.querySelector(".nav-unread");
        if (label) { label.hidden = !count; label.textContent = count > 99 ? "99+" : count; label.setAttribute("aria-label", `안 읽은 메시지 ${count}개`); }
      }
    } catch { /* Connection can recover on the next foreground refresh. */ }
    finally { refreshing = false; }
  }, 5000);
}
if (photoStorageError) showToast(photoStorageError);

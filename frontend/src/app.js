import { icon } from "./icons.js?v=rento-home-5-ren";
import {
  catalog, categories, findAvailability, localDay, neighborhoods, people, readState,
  rentalDays, suggestedFields, writeState,
} from "./model.js?v=rento-home-5-ren";
import {
  chatPage, conversationPage, dateInputs, escape, home, itemPage, listingRows,
  membershipPage, missingPage, modal, pageHeader, profilePage, registerPage,
  rentalsPage, tradePage, won,
} from "./views.js?v=rento-home-5-ren";

const screen = document.querySelector("#screen");
const navigation = document.querySelector("#navigation");
const dialog = document.querySelector("#dialog");
const toast = document.querySelector("#toast");
const state = readState();
const filters = { query: "", category: "전체", date: {}, maxPrice: null };
let direction = state.role === "lender" ? "out" : "in";
let toastTimeout;

const allItems = () => [...catalog, ...state.listings];
const itemById = (id) => allItems().find((item) => item.id === id);
const rentalById = (id) => state.rentals.find((rental) => rental.id === id);
const isParty = (rental) => rental && [rental.lenderId, rental.renterId].includes(state.role);
const favoriteKey = (id) => state.role + "/" + id;
const isFavorite = (id) => state.favorites.includes(favoriteKey(id));
const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
const route = () => (location.hash.slice(1) || "home").split("/");

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.hidden = false;
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 3200);
}

function save() {
  const persisted = writeState(state);
  if (!persisted) showToast("브라우저 저장 공간이 부족해요. 현재 화면에서 계속 이용할 수 있어요.");
  return persisted;
}

function announce(role, rental, message) {
  state.notices.unshift({ role, rentalId: rental.id, message, read: false });
}

function availabilityLabel(item, filtered) {
  if (filtered && filters.date.start) return "선택한 날짜 대여 가능";
  const today = localDay();
  const error = findAvailability(item, today, today, state.rentals);
  if (!error) return "오늘 대여 가능";
  if (item.weekends && error.startsWith("이 물품")) return "주말 대여 가능";
  if (item.availableFrom && item.availableFrom > today) return "날짜 확인";
  if (item.availableTo && item.availableTo < today) return "대여 기간 종료";
  return "예약 중";
}

function filteredListings() {
  const search = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let items = allItems().filter((item) => {
    const text = [item.title, item.category, item.neighborhood, item.description].join(" ").toLowerCase();
    return (filters.category === "전체" || item.category === filters.category)
      && search.every((term) => text.includes(term))
      && (filters.maxPrice === null || item.price <= filters.maxPrice)
      && (!filters.date.start || !findAvailability(item, filters.date.start, filters.date.end, state.rentals));
  });
  if (state.area !== "죽전동") {
    items = items.sort((a, b) => Number(b.neighborhood === state.area) - Number(a.neighborhood === state.area));
  }
  return items;
}

const rowsFor = (items, filtered = false) => listingRows(items, isFavorite, (item) => availabilityLabel(item, filtered));

function render() {
  const [page, id] = route();
  const role = state.role;
  let content;
  if (page === "home") content = home({
    area: state.area, ...filters, rows: rowsFor(filteredListings(), true),
    unread: state.notices.some((notice) => notice.role === role && !notice.read),
  });
  else if (page === "item" && itemById(id)) content = itemPage(itemById(id), role, filters.date);
  else if (page === "new") content = registerPage(role, state.area);
  else if (page === "rentals") content = rentalsPage(state.rentals, itemById, role, direction);
  else if (page === "trade") {
    const rental = rentalById(id);
    if (rental && (isParty(rental) || role === "admin")) content = tradePage(rental, itemById(rental.itemId), role);
  } else if (page === "chat" && !id) content = chatPage(state.rentals, itemById, role);
  else if (page === "chat") {
    const rental = rentalById(id);
    if (isParty(rental) && chatAllowed(rental)) content = conversationPage(rental, itemById(rental.itemId), state.messages[id] ?? [], role);
  } else if (page === "profile") content = profilePage(role, allItems().filter((item) => isFavorite(item.id)).length,
    allItems().filter((item) => item.owner === role).length);
  else if (page === "membership") content = membershipPage();
  else if (page === "saved" || page === "my-listings") {
    const items = allItems().filter((item) => page === "saved" ? isFavorite(item.id) : item.owner === role);
    const title = page === "saved" ? "관심 물품" : "내가 올린 물품";
    content = pageHeader(title, "#profile") + `<div class="content">${items.length ? rowsFor(items)
      : `<p class="notice">${page === "saved" ? "아직 관심 물품이 없어요." : "아직 올린 물품이 없어요."}</p>`}</div>`;
  }
  screen.innerHTML = content ?? missingPage();

  const parent = ({ item: "home", new: "home", trade: "rentals", saved: "profile", membership: "profile", "my-listings": "profile" })[page] ?? page;
  const tabs = [
    ["home", "home", "홈"], ["rentals", "calendar", role === "admin" ? "분쟁 검토" : "내 대여"],
    ["chat", "chat", "채팅"], ["profile", "user", "내 정보"],
  ];
  navigation.innerHTML = tabs.map(([target, symbol, label]) =>
    `<a href="#${target}"${target === parent ? ' aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span></a>`).join("");
}

function chatAllowed(rental) {
  return ["confirmed", "handover", "active", "checking", "disputed", "complete"].includes(rental.status);
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
const fileField = '<label>사진 첨부<input name="photo" type="file" accept="image/*"></label>';

function tradeAction(action) {
  const rental = rentalById(route()[1]);
  if (!rental) return;
  const owns = state.role === rental.lenderId;
  const borrows = state.role === rental.renterId;
  const tradeItem = itemById(rental.itemId);
  if (action === "confirm" && owns && rental.status === "pending") {
    const error = findAvailability(tradeItem, rental.start, rental.end, state.rentals, rental.id);
    if (error) {
      showDialog("예약을 확정할 수 없어요", `<p class="notice">${escape(error)}</p>`);
      return;
    }
    updateTrade(rental, "confirmed", rental.renterId, "대여 신청이 승인됐어요.");
  } else if (action === "reject" && owns && rental.status === "pending") {
    updateTrade(rental, "rejected", rental.renterId, "대여 신청이 거절됐어요.");
  } else if (action === "cancel" && ((borrows && rental.status === "pending")
      || ((owns || borrows) && rental.status === "confirmed"))) {
    showDialog("예약 취소", `<form data-form="cancel" data-id="${rental.id}" class="form-card plain">
      <p>이 대여 신청을 취소하시겠어요?</p><button class="button primary" type="submit">취소 확정</button>
    </form>`);
  } else if (action === "handoff" && owns && rental.status === "confirmed") {
    showDialog("인도 사진 등록", evidenceForm("handoff", rental, '<option value="clear">정상 반납 예시</option><option value="damage">손상 신고 예시 (빔프로젝터)</option>'));
  } else if (action === "receive" && borrows && rental.status === "handover") {
    updateTrade(rental, "active", rental.lenderId, "대여자가 물품 수령을 확인했어요.");
  } else if (action === "return" && borrows && rental.status === "active") {
    showDialog("반납 사진 등록", evidenceForm("return", rental, rental.sample === "damage"
      ? '<option value="damage">손상 신고 예시</option>' : '<option value="clear">정상 반납 예시</option>'));
  } else if (action === "complete" && owns && rental.status === "checking") {
    updateTrade(rental, "complete", rental.renterId, "공급자가 반납을 확인했어요.");
  } else if (action === "dispute" && owns && rental.status === "checking") {
    showDialog("손상·누락 신고", noteForm("dispute", rental, "확인한 손상이나 누락 내용을 적어주세요.", "신고 접수"));
  } else if (action === "resolve" && state.role === "admin" && rental.status === "disputed") {
    showDialog("관리자 검토", noteForm("resolve", rental, "검토 의견을 적어주세요.", "검토 완료"));
  } else if (action === "review" && borrows && rental.status === "complete" && !rental.review) {
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

function evidenceForm(kind, rental, options) {
  const customOnly = kind === "return" && !rental.sample;
  return `<form data-form="${kind}" data-id="${rental.id}" class="form-card plain">
    ${fileField}
    ${customOnly ? "" : `<label>사진이 없을 때 시연용 예시 선택<select name="sample"><option value="">직접 사진 첨부</option>${options}</select></label>`}
    ${formErrorMarkup}<button class="button primary" type="submit">${kind === "return" ? "반납 요청" : "인도 확인"}</button>
  </form>`;
}

function updateTrade(rental, status, recipient, message) {
  rental.status = status;
  if (recipient) announce(recipient, rental, message);
  save();
  if (dialog.open) dialog.close();
  render();
}

function openNotices() {
  const notices = state.notices.filter((notice) => notice.role === state.role);
  for (const notice of notices) notice.read = true;
  save();
  const indicator = screen.querySelector(".notification i");
  if (indicator) indicator.remove();
  showDialog("알림", notices.length ? `<div class="menu-list">${notices.map((notice) =>
    `<a href="#trade/${notice.rentalId}">${escape(notice.message)}${icon("right")}</a>`).join("")}</div>`
    : '<p class="notice">새 알림이 없어요.</p>');
}

function refreshHomeRows() {
  document.querySelector("#listings").innerHTML = rowsFor(filteredListings(), true);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
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
    showDialog("AI에게 물어보기", `<form data-form="recommend" class="form-card plain">
      <p class="hint">시연용 물품을 용도에 맞춰 추천해요.</p>
      <label>어떤 물건이 필요하세요?<input name="prompt" maxlength="150" placeholder="예시 · 주말에 영화 보고 싶어" required></label>
      <button class="button primary" type="submit">추천 받기</button>
      <div id="recommendation" aria-live="polite"></div></form>`);
  } else if (action === "favorite" && itemById(id)) {
    const selected = !isFavorite(id);
    state.favorites = selected ? [...state.favorites, favoriteKey(id)] : state.favorites.filter((key) => key !== favoriteKey(id));
    save();
    if (route()[0] === "saved") render();
    else {
      target.classList.toggle("selected", selected);
      target.setAttribute("aria-pressed", String(selected));
    }
  } else if (action === "area") {
    showDialog("동네 변경", `<div class="menu-list">${neighborhoods.map((area) =>
      `<button data-action="set-area" data-id="${area}">${area}${area === state.area ? icon("check") : ""}</button>`).join("")}</div>`);
  } else if (action === "set-area" && neighborhoods.includes(id)) {
    state.area = id;
    save();
    dialog.close();
    render();
  } else if (action === "notices") openNotices();
  else if (action === "role" && Object.hasOwn(people, id)) {
    state.role = id;
    direction = id === "lender" ? "out" : "in";
    save();
    render();
    screen.querySelector(`[data-action="role"][data-id="${id}"]`).focus();
  } else if (action === "direction") {
    direction = id;
    render();
    screen.querySelector(`[data-action="direction"][data-id="${id}"]`).focus();
  } else if (action === "trade-action") tradeAction(id);
  else if (action === "draft") {
    const form = target.form;
    const title = form.elements.title.value.trim();
    if (!title) {
      formError(form, "물품명을 먼저 입력해 주세요.");
      return;
    }
    formError(form, "");
    const suggestion = suggestedFields(title);
    form.elements.category.value = suggestion.category;
    form.elements.price.value = suggestion.price;
    if (!form.elements.description.value.trim()) {
      form.elements.description.value = `${title}을(를) 빌려드려요. 물품 상태와 구성품을 적어주세요.`;
    }
    showToast("예시 제안을 채웠어요. 게시 전에 확인해 주세요.");
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    filters.query = event.target.value;
    refreshHomeRows();
  }
  const form = event.target.form;
  if ((event.target.name === "start" || event.target.name === "end") && form?.elements.end) {
    const start = form.elements.start.value;
    const end = form.elements.end.value;
    form.elements.end.min = start || localDay();
    if (start && end && end < start) form.elements.end.value = start;
    if (form.dataset.form === "request") {
      const item = itemById(form.dataset.id);
      const days = rentalDays(start, form.elements.end.value);
      document.querySelector("#estimate").textContent = days > 0 ? won(item.price * days) : "날짜를 선택해 주세요";
      formError(form, "");
    }
  }
});

async function readPhoto(file) {
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
    return canvas.toDataURL("image/webp", 0.75);
  } catch {
    throw new Error("사진을 열 수 없어요. JPG, PNG 또는 WebP 사진을 선택해 주세요.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function submit(form) {
  const { form: kind, id } = form.dataset;
  const fields = new FormData(form);
  const date = { start: fields.get("start"), end: fields.get("end") };

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

  if (kind === "recommend") {
    const prompt = fields.get("prompt").trim();
    const category = /영화|촬영|프로젝터|전자|카메라|화면|영상/.test(prompt) ? "디지털"
      : /조립|수리|드릴|공구|선반/.test(prompt) ? "공구"
      : /청소|높은|사다리|전구|정리|생활/.test(prompt) ? "생활용품" : "";
    const available = allItems().filter((item) => item.owner !== state.role
      && (filters.maxPrice === null || item.price <= filters.maxPrice)
      && (!filters.date.start || !findAvailability(item, filters.date.start, filters.date.end, state.rentals)));
    const suggestions = category ? available.filter((item) => item.category === category)
      : available.filter((item) => prompt.includes(item.title));
    form.querySelector("#recommendation").innerHTML = suggestions.length
      ? `<div class="menu-list">${suggestions.slice(0, 3).map((item) =>
        `<a href="#item/${item.id}">${escape(item.title)} <span>${won(item.price)}/일</span>${icon("right")}</a>`).join("")}</div>`
      : '<p class="notice">조건에 맞는 예시 물품을 찾지 못했어요. 용도를 조금 더 구체적으로 입력해 보세요.</p>';
    return;
  }

  if (kind === "request") {
    const item = itemById(id);
    if (!item || item.owner === state.role || state.role === "admin") return;
    const error = findAvailability(item, date.start, date.end, state.rentals);
    const same = state.rentals.some((rental) => rental.status === "pending" && rental.itemId === id
      && rental.renterId === state.role && rental.start === date.start && rental.end === date.end);
    if (error || same) {
      formError(form, error || "같은 날짜로 이미 신청했어요.");
      return;
    }
    const rental = { id: newId(), itemId: id, renterId: state.role, lenderId: item.owner,
      ...date, total: item.price * rentalDays(date.start, date.end), status: "pending" };
    state.rentals.unshift(rental);
    announce(item.owner, rental, "새 대여 신청이 도착했어요.");
    save();
    direction = "in";
    navigate(`#trade/${rental.id}`);
    return;
  }

  if (kind === "register" && state.role !== "admin") {
    const title = fields.get("title").trim();
    const description = fields.get("description").trim();
    const price = Number(fields.get("price"));
    const category = fields.get("category");
    const area = fields.get("neighborhood");
    if (!title || !description || !categories.slice(1).includes(category) || !neighborhoods.includes(area)
      || !Number.isSafeInteger(price) || price < 0 || price > 10000000) {
      formError(form, "물품명, 설명, 카테고리와 대여료를 확인해 주세요.");
      return;
    }
    if ((date.start || date.end) && (!(rentalDays(date.start, date.end) >= 1) || date.start < localDay())) {
      formError(form, "대여 가능 기간의 시작일과 종료일을 확인해 주세요.");
      return;
    }
    const role = state.role;
    const photo = await readPhoto(fields.get("photo"));
    if (role !== state.role || !form.isConnected) return;
    state.listings.unshift({ id: newId(), title, description, price, owner: role, category,
      neighborhood: area, image: photo, availableFrom: date.start, availableTo: date.end });
    save();
    filters.query = "";
    filters.category = "전체";
    filters.date = {};
    filters.maxPrice = null;
    navigate("#home");
    return;
  }

  const rental = rentalById(id);
  if (!rental) return;
  const owns = state.role === rental.lenderId;
  const borrows = state.role === rental.renterId;
  if (kind === "message" && (owns || borrows) && chatAllowed(rental)) {
    const message = fields.get("message").trim();
    if (!message) return;
    (state.messages[id] ??= []).push({ sender: state.role, text: message });
    save();
    render();
    document.querySelector(".compose input").focus();
  } else if (kind === "cancel" && ((borrows && rental.status === "pending")
      || ((owns || borrows) && rental.status === "confirmed"))) {
    updateTrade(rental, "canceled", owns ? rental.renterId : rental.lenderId, "대여 신청이 취소됐어요.");
  } else if ((kind === "handoff" && owns && rental.status === "confirmed")
      || (kind === "return" && borrows && rental.status === "active")) {
    const sample = fields.get("sample");
    const role = state.role;
    const status = rental.status;
    const photo = await readPhoto(fields.get("photo"));
    if (role !== state.role || status !== rental.status || !dialog.open) return;
    if (!photo && !sample) {
      formError(form, "사진을 첨부하거나 시연용 예시를 선택해 주세요.");
      return;
    }
    if (kind === "handoff") {
      if (!photo && sample === "damage" && rental.itemId !== "projector") {
        formError(form, "손상 사진 예시는 미니 빔프로젝터 거래에서 사용해 주세요.");
        return;
      }
      rental.sample = photo ? "" : sample;
      rental.before = photo || (sample === "damage" ? "./assets/proof-before.webp" : itemById(rental.itemId).image);
      if (!rental.before) {
        formError(form, "등록 사진이 없는 물품은 인도 사진을 첨부해 주세요.");
        return;
      }
      updateTrade(rental, "handover", rental.renterId, "인도 사진이 등록됐어요. 물품을 받으면 수령을 확인해 주세요.");
    } else {
      rental.after = photo || (sample === "damage" ? "./assets/proof-after.webp" : rental.before);
      rental.comparison = photo ? "" : sample;
      updateTrade(rental, "checking", rental.lenderId, "반납 요청과 사진이 도착했어요.");
    }
  } else if (["dispute", "resolve", "review"].includes(kind)) {
    const note = fields.get("note").trim();
    if (!note) {
      formError(form, "내용을 입력해 주세요.");
      return;
    }
    if (kind === "dispute" && owns && rental.status === "checking") {
      rental.dispute = note;
      rental.resolution = "";
      announce("admin", rental, "새 분쟁이 접수됐어요.");
      updateTrade(rental, "disputed", rental.renterId, "공급자가 반납 상태에 이의를 제기했어요.");
    } else if (kind === "resolve" && state.role === "admin" && rental.status === "disputed") {
      rental.resolution = note;
      announce(rental.lenderId, rental, "관리자 검토가 끝났어요. 반납 상태를 확인해 주세요.");
      updateTrade(rental, "checking", rental.renterId, "관리자가 신고 내용을 검토했어요.");
    } else if (kind === "review" && borrows && rental.status === "complete" && !rental.review) {
      const rating = Number(fields.get("rating"));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
      rental.review = { rating, text: note };
      updateTrade(rental, "complete");
    }
  }
}

document.addEventListener("submit", async (event) => {
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
render();

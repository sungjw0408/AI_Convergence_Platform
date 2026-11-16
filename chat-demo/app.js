"use strict";
const el = id => document.getElementById(id);
let user = null, room = "", generation = 0, rendered = "", timer = null, pending = null;
const status = value => { el("status").textContent = value; };
const endpoint = id => "/api/rentals/" + encodeURIComponent(id) + "/messages";

async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), {status: response.status});
  return data;
}

function signedOut() {
  generation++;
  clearTimeout(timer);
  user = null;
  room = "";
  pending = null;
  rendered = "";
  el("message").value = "";
  el("messages").replaceChildren();
  el("room").replaceChildren();
  el("login-panel").hidden = false;
  el("chat-panel").hidden = true;
}
function draw(rows) {
  const key = rows.length + ":" + (rows.at(-1)?.id ?? 0);
  if (rendered === key) return;
  rendered = key;
  const list = el("messages");
  const follow = !list.childElementCount || list.scrollHeight - list.scrollTop - list.clientHeight < 45;
  const top = list.scrollTop;
  list.replaceChildren(...rows.map(row => {
    const li = document.createElement("li");
    li.classList.toggle("mine", row.sender_id === user.id);
    const meta = document.createElement("small");
    meta.textContent = (row.sender_id === user.id ? "나" : el("room").selectedOptions[0].dataset.partner)
      + " · " + new Date(row.sent_at).toLocaleTimeString("ko-KR", {hour:"2-digit", minute:"2-digit"});
    const body = document.createElement("p");
    body.className = "body";
    body.textContent = row.body;
    li.append(meta, body);
    return li;
  }));
  list.scrollTop = follow ? list.scrollHeight : top;
}

async function poll(epoch, id) {
  try {
    const rows = await api(endpoint(id));
    if (epoch === generation) draw(rows);
  } catch (err) {
    if (epoch !== generation) return;
    if (err.status === 401) signedOut();
    status(err.message);
  } finally {
    if (epoch === generation) timer = setTimeout(() => poll(epoch, id), 1000);
  }
}
function selectRoom() {
  clearTimeout(timer);
  room = el("room").value;
  pending = null;
  rendered = "";
  el("messages").replaceChildren();
  el("message").value = "";
  status("");
  const epoch = ++generation;
  el("send").hidden = !room;
  if (room) poll(epoch, room);
  else status("확정된 거래가 없어요.");
}
async function openChat(account) {
  const rentals = await api("/api/rentals");
  user = account;
  el("who").textContent = account.name;
  el("room").replaceChildren(...rentals.map(r => {
    const option = new Option(r.item + " · " + r.partner, r.id);
    option.dataset.partner = r.partner;
    return option;
  }));
  el("login-panel").hidden = true;
  el("chat-panel").hidden = false;
  selectRoom();
}
el("login").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await openChat(await api("/api/login", {username: el("username").value.trim(), password: el("password").value}));
    el("password").value = "";
  } catch (err) { status(err.message); }
  finally { button.disabled = false; }
});
el("logout").addEventListener("click", async () => {
  try { await api("/api/logout", {}); signedOut(); status(""); }
  catch (err) { status(err.message); }
});
el("room").addEventListener("change", selectRoom);
el("send").addEventListener("submit", async event => {
  event.preventDefault();
  const button = el("send-button");
  if (!room || button.disabled) return;
  const body = el("message").value.trim(), id = room, epoch = generation;
  if (!body) { status("메시지를 입력해 주세요."); return; }
  if (!pending || pending.body !== body) pending = {body, request_id: crypto.randomUUID()};
  button.disabled = true;
  try {
    await api(endpoint(id), pending);
    if (epoch === generation) {
      if (el("message").value.trim() === body) el("message").value = "";
      pending = null;
      status("");
    }
  } catch (err) {
    if (epoch === generation) {
      if (err.status === 401) signedOut();
      status("전송 실패: " + err.message);
    }
  } finally { button.disabled = false; }
});
api("/api/me").then(openChat).catch(err => { if (err.status !== 401) status(err.message); });

const endpoint = "/api/rental-database";

function documents(state, uid) {
  const records = {
    listings: state.listings,
    rentals: state.rentals,
    messages: Object.entries(state.messages).flatMap(([rentalId, thread]) =>
      thread.map((message) => ({ ...message, rentalId }))),
    notices: state.notices,
  };
  if (uid) records.profiles = [{ id: uid, area: state.area, favorites: state.favorites }];
  return records;
}

function documentIndex(records) {
  const index = new Map();
  for (const name of Object.keys(records)) {
    for (const record of records[name]) index.set(name + "/" + record.id, JSON.stringify(record));
  }
  return index;
}

async function request(uid, options) {
  const headers = new Headers(options?.headers);
  if (uid) headers.set("X-Rento-Account", uid);
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000), ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Firestore 요청을 완료하지 못했어요.");
  return result;
}

export async function connectRentalDatabase(state, uid) {
  const snapshot = await request(uid);
  const records = snapshot.records;
  for (const name of ["listings", "rentals", "notices"]) {
    state[name] = records[name].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }
  state.messages = {};
  for (const record of records.messages.sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id))) {
    (state.messages[record.rentalId] ??= []).push(record);
  }

  if (uid && records.profiles[0]) {
    state.area = records.profiles[0].area;
    state.favorites = records.profiles[0].favorites;
  }
  let previous = documentIndex(documents(state, uid));
  let revision = snapshot.revision;
  let pending = Promise.resolve();
  return function save(state) {
    const records = documents(state, uid);
    const next = documentIndex(records);
    const changes = [];
    for (const collection of Object.keys(records)) {
      for (const record of records[collection]) {
        const key = collection + "/" + record.id;
        if (next.get(key) !== previous.get(key)) changes.push({ collection, record });
      }
    }
    if (!changes.length) return pending;
    // Snapshot now: subsequent edits must not change a queued transaction's payload.
    const payload = structuredClone(changes);
    previous = next;
    pending = pending.then(async () => {
      const result = await request(uid, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, changes: payload }) });
      revision = result.revision;
    });
    return pending;
  };
}

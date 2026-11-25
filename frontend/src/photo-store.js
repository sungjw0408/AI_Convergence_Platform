// Photo originals live in IndexedDB; localStorage holds only their references.
const prefix = "capture:";
const urls = new Map();
let database;

function openStore() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("rento-camera-originals", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("사진 원본을 저장할 수 없어요. 브라우저 저장 공간을 확인해 주세요."));
    request.onblocked = () => reject(new Error("다른 렌토 탭을 닫고 다시 시도해 주세요."));
  });
  return database.catch((error) => { database = undefined; throw error; });
}

export async function photoBlob(source) {
  if (source?.startsWith(prefix)) {
    const db = await openStore();
    return new Promise((resolve, reject) => {
      const request = db.transaction("photos").objectStore("photos").get(source);
      request.onsuccess = () => request.result ? resolve(request.result.blob)
        : reject(new Error("이 브라우저에서 사진 원본을 찾을 수 없어요."));
      request.onerror = () => reject(new Error("사진 원본을 읽을 수 없어요."));
    });
  }
  const url = new URL(source, document.baseURI);
  if (url.protocol !== "data:" && url.origin !== location.origin) {
    throw new Error("이 앱에서 등록한 사진을 선택해 주세요.");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("비교할 사진을 열 수 없어요.");
  return response.blob();
}

export function photoUrl(source) {
  return source?.startsWith(prefix) ? urls.get(source) || "" : source || "";
}

export async function preparePhotos(sources) {
  await Promise.all([...new Set(sources)].filter((source) => source?.startsWith(prefix) && !urls.has(source))
    .map(async (source) => { urls.set(source, URL.createObjectURL(await photoBlob(source))); }));
}

export async function saveOriginal(capture) {
  const db = await openStore();
  const source = prefix + crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("photos", "readwrite");
    transaction.objectStore("photos").add({ blob: capture.blob, capturedAt: capture.capturedAt,
      width: capture.width, height: capture.height, face: capture.face,
      origin: capture.origin || "camera", name: capture.name, addedAt: capture.addedAt }, source);
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(new Error("사진 원본을 저장하지 못했어요. 공간을 확보하고 다시 시도해 주세요."));
  });
  urls.set(source, URL.createObjectURL(capture.blob));
  return source;
}

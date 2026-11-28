import { inspectionPlan } from "./inspection.js";
import { isDirectCapture } from "./capture.js";

export const maxListingPhotos = 8;
const captureContexts = new WeakMap();

export function newListingDraft(area) {
  const plan = inspectionPlan({ title: "" });
  const draft = { fields: { title: "", description: "", category: "", price: "", neighborhood: area, start: "", end: "",
      valueWon: "", valueEvidence: "", modelName: "", condition: "", usageHistory: "", purchaseMonth: "" },
    plan, photos: [], introPhotos: [], advice: null, coverId: null, activeViewId: plan.views[0].id, step: 0, photoMode: "capture", busy: false, error: "" };
  captureContexts.set(draft, {});
  return draft;
}

export const listingCaptureContext = (draft) => captureContexts.get(draft);
export function hasOnlyListingCameraPhotos(draft) {
  const context = listingCaptureContext(draft);
  return Boolean(context && draft.photos.length && draft.photos.length <= maxListingPhotos
    && new Set(draft.photos.map((photo) => photo.blob)).size === draft.photos.length
    && draft.photos.every((photo) => isDirectCapture(photo, context)));
}

export function syncListingPlan(draft) {
  const next = inspectionPlan(draft.fields);
  if (next.id === draft.plan.id) return false;
  // Keep every photo when the item type changes. The user confirms new labels.
  draft.photos.forEach((photo) => { photo.viewId = ""; });
  draft.plan = next;
  draft.activeViewId = next.views[0].id;
  draft.photoMode = draft.photos.length ? "review" : "capture";
  return true;
}

export const missingListingViews = (draft) => draft.plan.views.filter((view) => !draft.photos.some((photo) => photo.viewId === view.id));

export function assignListingView(draft, photoId, viewId) {
  const photo = draft.photos.find((p) => p.id === photoId);
  if (!photo || (viewId && !draft.plan.views.some((v) => v.id === viewId))) return;
  for (const other of draft.photos) if (other.id !== photoId && other.viewId === viewId && viewId) other.viewId = "";
  photo.viewId = viewId;
  draft.activeViewId = missingListingViews(draft)[0]?.id || draft.plan.views[0].id;
}

export function addListingPhotos(draft, photos) {
  if (draft.photos.length + photos.length > maxListingPhotos) throw new Error(`사진은 최대 ${maxListingPhotos}장까지 등록할 수 있어요.`);
  const context = listingCaptureContext(draft);
  if (!context || photos.some((photo) => !isDirectCapture(photo, context))) {
    throw new Error("이번 등록 과정에서 앱 카메라로 촬영한 원본 사진만 사용할 수 있어요.");
  }
  const blobs = [...draft.photos, ...photos].map((photo) => photo.blob);
  if (new Set(blobs).size !== blobs.length) throw new Error("같은 사진을 여러 부위에 사용할 수 없어요. 각 부위를 새로 촬영해 주세요.");
  for (let i = 0; i < photos.length; i++) {
    const photo = { ...photos[i], origin: "camera", id: crypto.randomUUID(), viewId: "" };
    draft.photos.push(photo);
    if (i === 0) assignListingView(draft, photo.id, draft.activeViewId);
  }
  draft.coverId ||= draft.photos[0]?.id;
}

export function removeListingPhoto(draft, photoId) {
  const photo = draft.photos.find((p) => p.id === photoId);
  if (photo?.preview) URL.revokeObjectURL(photo.preview);
  draft.photos = draft.photos.filter((p) => p.id !== photoId);
  if (draft.publicPhotoIds) draft.publicPhotoIds = draft.publicPhotoIds.filter(id => id !== photoId);
  if (draft.coverId === photoId) draft.coverId = draft.publicPhotoIds?.[0] || draft.photos[0]?.id || draft.introPhotos?.[0]?.id || null;
  draft.activeViewId = missingListingViews(draft)[0]?.id || draft.plan.views[0].id;
}

export function replaceListingPhoto(draft, photoId, capture) {
  const index = draft.photos.findIndex((photo) => photo.id === photoId);
  if (index < 0) throw new Error("다시 촬영할 사진을 찾을 수 없어요.");
  if (!isDirectCapture(capture, listingCaptureContext(draft))) throw new Error("앱 카메라로 촬영한 원본만 사용할 수 있어요.");
  if (draft.photos.some((photo, i) => i !== index && photo.blob === capture.blob)) throw new Error("각 부위를 새로 촬영해 주세요.");
  const previous = draft.photos[index];
  draft.photos[index] = { ...capture, id: previous.id, viewId: previous.viewId, origin: "camera" };
  if (previous.preview) URL.revokeObjectURL(previous.preview);
}

export function listingSources(item) {
  return [item.image, ...(item.photos || []).map((photo) => photo.source), ...(item.presentationPhotos || []).map(photo => photo.source)].filter(Boolean);
}

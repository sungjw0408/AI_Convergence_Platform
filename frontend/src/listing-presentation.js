// Introduction photos may come from an album; inspection evidence never does.
export const maxIntroductionPhotos = 8;
export const introductionPool = draft => [...draft.photos, ...(draft.introPhotos || [])];
export const introductionIds = draft => draft.publicPhotoIds ?? draft.photos.map(p => p.id);
export function toggleIntroductionPhoto(draft, id) {
  const ids = introductionIds(draft);
  if (ids.includes(id)) {
    if (ids.length === 1) throw new Error('게시글에 보여줄 사진을 한 장 이상 선택해 주세요.');
    draft.publicPhotoIds = ids.filter(value => value !== id);
    if (draft.coverId === id) draft.coverId = draft.publicPhotoIds[0];
  } else {
    if (ids.length >= maxIntroductionPhotos) throw new Error('소개 사진은 최대 8장까지 선택할 수 있어요.');
    draft.publicPhotoIds = [...ids, id];
  }
}
export function setIntroductionCover(draft, id) {
  if (!introductionPool(draft).some(photo => photo.id === id)) return;
  if (!introductionIds(draft).includes(id)) toggleIntroductionPhoto(draft,id);
  draft.coverId = id;
}
export function introductionPhotos(item) {
  if (!item.presentationPhotos) return item.photos?.length ? item.photos : item.image ? [{id:'legacy',source:item.image,label:item.title}] : [];
  return item.presentationPhotos.map(photo => photo.photoId ? (item.photos || []).find(p => p.id === photo.photoId) : photo).filter(Boolean);
}

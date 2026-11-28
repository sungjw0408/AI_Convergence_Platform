import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introductionPhotos, toggleIntroductionPhoto, setIntroductionCover } from '../src/listing-presentation.js';
import { registrationBaseline } from '../src/handoff-photos.js';
import { itemGallery, listingStatePhotos } from '../src/listing-photo-view.js';
const esc=s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
const camera={id:'front',viewId:'front',source:'/front.png',origin:'camera',capturedAt:'2026-10-01T00:00:00Z',label:'앞면'};
const item={id:'item',title:'물품',coverPhotoId:'album',image:'/intro.png',inspectionPlan:{views:[{id:'front',label:'앞면'}],checks:[]},
 photos:[camera],presentationPhotos:[{id:'album',source:'/intro.png',origin:'album',label:'소개 사진'}]};
test('introduction albums remain outside the complete state gallery and rental baseline',()=>{
 assert.deepEqual(introductionPhotos(item).map(p=>p.id),['album']);
 const gallery=itemGallery(item,null,esc),states=listingStatePhotos(item,esc),baseline=registrationBaseline(item);
 assert.match(gallery,/intro.png/);assert.ok(!gallery.includes('src="/front.png"'));
 assert.match(gallery,/전체 상태 사진 보기/);assert.match(states,/front.png/);assert.ok(!states.includes('intro.png'));
 assert.equal(baseline.photos.front.capturedAt,camera.capturedAt);
 assert.equal(baseline.photos.front.sourceKind,'listing');assert.equal(baseline.photos.front.listingPhotoId,'front');
 assert.equal(registrationBaseline({...item,photos:[{...camera,origin:'album'}]}),null);
});
test('publishing choices and album cover do not remove mandatory inspection photos',()=>{
 const draft={photos:[camera],introPhotos:[item.presentationPhotos[0]],coverId:'front'};
 setIntroductionCover(draft,'album');toggleIntroductionPhoto(draft,'front');
 assert.equal(draft.coverId,'album');assert.deepEqual(draft.publicPhotoIds,['album']);assert.equal(draft.photos.length,1);
 assert.throws(()=>toggleIntroductionPhoto(draft,'album'),/한 장 이상/);
});

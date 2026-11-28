import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { reservationPicker, bindReservationPicker } from '../src/reservation-picker.js';
import { listingRows, itemPage } from '../src/views.js';
import { chargedDays } from '../src/rental-lifecycle.js';

test('supplier profile appears only in item detail and preserves account identity', () => {
  const item = { id:'drill', owner:'lender', title:'전동드릴', price:5000, deposit:0, category:'공구', neighborhood:'죽전동', description:'설명' };
  const names = { lender:'공구 이웃' }, photos = {};
  const list = new JSDOM(listingRows([item],()=>false,()=>'대여 가능',new Map(),names));
  assert.equal(list.window.document.querySelector('a[href="#person/lender"]'), null);
  assert.ok(list.window.document.querySelector('a[href="#item/drill"]'));
  const detail = new JSDOM(itemPage(item,'renter',{},null,null,false,true,{displayNames:names,profilePhotos:photos}));
  assert.match(detail.window.document.querySelector('.detail-owner').textContent,/공구 이웃/);
  assert.equal(detail.window.document.querySelector('.detail-owner').getAttribute('href'),'#person/lender');
  list.window.close(); detail.window.close();
});

test('calendar and time controls retain precise values, calculate fees, and prevent reverse times', () => {
  const now = new Date(); now.setDate(now.getDate()+2);
  const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dom = new JSDOM(`<form>${reservationPicker({start:key+'T09:00',end:key+'T18:00'})}</form>`);
  const doc = dom.window.document; bindReservationPicker(doc);
  const click = selector => doc.querySelector(selector).click();
  let changes = 0; doc.addEventListener('input',()=>changes++);
  click('[data-picker="date"][data-side="start"]');
  click(`[data-day="${key}"]`);
  assert.equal(doc.querySelector('.reservation-calendar').dataset.side,'end');
  click(`[data-day="${key}"]`);
  assert.ok(doc.querySelector('.reservation-calendar').hidden);
  click('[data-picker="time"][data-side="end"]');
  click('[data-hour="08"]'); click('[data-picker="apply-time"]');
  assert.equal(doc.querySelector('[name="end"]').value,key+'T18:00');
  assert.equal(doc.querySelector('.reservation-time-error').hidden,false);
  click('[data-hour="17"]'); click('[data-minute="13"]');
  click('[data-picker="apply-time"]');
  assert.equal(doc.querySelector('[name="end"]').value,key+'T17:13');
  assert.equal(chargedDays(key+'T09:00',key+'T17:13'),1);
  assert.ok(changes >= 3);
  assert.equal(doc.querySelector('input[type="datetime-local"]'),null);
  dom.window.close();
});

test('choosing a time before a date keeps it when the calendar date is selected', () => {
  const dom = new JSDOM(`<form>${reservationPicker()}</form>`), doc = dom.window.document;
  bindReservationPicker(doc);
  doc.querySelector('[data-picker="time"][data-side="start"]').click();
  doc.querySelector('[data-hour="14"]').click();
  doc.querySelector('[data-minute="30"]').click();
  doc.querySelector('[data-picker="apply-time"]').click();
  doc.querySelector('[data-picker="day"]:not(:disabled)').click();
  assert.ok(doc.querySelector('[name="start"]').value.endsWith('T14:30'));
  dom.window.close();
});

test('home date filter keeps day-only values and uses the shared calendar', () => {
  const dom=new JSDOM(`<form>${reservationPicker({}, {dateOnly:true})}</form>`),doc=dom.window.document;
  bindReservationPicker(doc);
  doc.querySelector('[data-picker="date"][data-side="start"]').click();
  const day=doc.querySelector('[data-picker="day"]:not(:disabled)').dataset.day;
  doc.querySelector(`[data-day="${day}"]`).click();doc.querySelector(`[data-day="${day}"]`).click();
  assert.equal(doc.querySelector('[name="start"]').value,day);
  assert.equal(doc.querySelector('[name="end"]').value,day);
  assert.equal(doc.querySelector('.reservation-times'),null);
  dom.window.close();
});

test('wheel scrolling and keyboard changes apply exact hours and minutes', () => {
  const dom=new JSDOM(`<form>${reservationPicker({start:'2035-01-01T09:00',end:'2035-01-02T18:00'})}</form>`),doc=dom.window.document;
  bindReservationPicker(doc);doc.querySelector('[data-picker="time"][data-side="end"]').click();
  const hour=doc.querySelector('[data-unit="hour"]'),minute=doc.querySelector('[data-unit="minute"]');
  hour.scrollTop=10*44;hour.dispatchEvent(new dom.window.Event('scroll'));
  minute.scrollTop=12*44;minute.dispatchEvent(new dom.window.Event('scroll'));
  minute.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  doc.querySelector('[data-picker="apply-time"]').click();
  assert.equal(doc.querySelector('[name="end"]').value,'2035-01-02T10:13');
  dom.window.close();
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {chargedDays, reservationInputs, sendRentalCommand, lifecyclePanel, commandForm} from '../src/rental-lifecycle.js';
const esc = value => String(value ?? '').replaceAll('<','&lt;').replaceAll('"','&quot;');
const won = value => value+'원';
const sample = {lifecycleVersion:1,id:'r1',renterId:'renter',lenderId:'lender',status:'payment_pending',startAt:1795737600000,endAt:1795824000000,timeZone:'Asia/Seoul',total:5000,deposit:10000,paymentDueAt:1795727600000,finance:{paid:false,depositReturned:false,depositHolds:[],lateDue:0},ledger:[]};

test('reservation retains date and time after gallery navigation; 24-hour billing rounds up',()=>{
  const dom = new JSDOM(reservationInputs({start:'2026-11-28T09:00',end:'2026-11-29T11:00'},'Asia/Seoul'));
  assert.equal(dom.window.document.querySelector('[name=start]').value,'2026-11-28T09:00');
  assert.equal(dom.window.document.querySelector('[name=end]').value,'2026-11-29T11:00');
  assert.equal(chargedDays('2026-11-28T09:00+09:00','2026-11-29T09:00+09:00'),1);
  assert.equal(chargedDays('2026-11-28T09:00+09:00','2026-11-29T11:00+09:00'),2);
  assert.equal(chargedDays('bad','bad'),0);
  dom.window.close();
});

test('payment button is renter-only and the UI explicitly labels test-only money',()=>{
  const renter=lifecyclePanel(sample,'renter',esc,won);
  assert.match(renter,/실제 청구 없음/);
  assert.match(renter,/data-id="pay"/);
  assert.doesNotMatch(lifecyclePanel(sample,'lender',esc,won),/data-id="pay"/);
  assert.match(commandForm('pay',sample,esc,won),/value="failure"/);
});

test('return and compensation holds remain visible separately from settled rent',()=>{
  const r=structuredClone(sample);r.status='complete';r.finance.baseSettled=true;r.finance.lateDue=5000;r.finance.depositHolds=['damage','late_unpaid'];
  const html=lifecyclePanel(r,'renter',esc,won);
  assert.match(html,/보증금 반환 보류/);assert.match(html,/대여료 정산은 별도 진행/);assert.match(html,/data-id="pay_late"/);
});

test('ambiguous network retry reuses the request ID without allowing a new payload',async()=>{
  const originalFetch=globalThis.fetch;
  const memory=new Map();globalThis.sessionStorage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const bodies=[];
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,'/api/rental-lifecycle');assert.equal(options.headers['X-Rento-Demo-Actor'],'renter');
    bodies.push(JSON.parse(options.body));
    if(bodies.length===1)throw new Error('response lost');
    return new Response(JSON.stringify({rental:sample}),{status:200});
  };
  try {
    await assert.rejects(sendRentalCommand('pay',{rentalId:'r1',outcome:'success'},'renter'),/response lost/);
    await sendRentalCommand('pay',{rentalId:'r1',outcome:'success'},'renter');
    assert.equal(bodies[0].requestId,bodies[1].requestId);assert.equal(memory.size,0);
  } finally {globalThis.fetch=originalFetch;delete globalThis.sessionStorage;}
});

test('compensation consent is explicit and tied to the displayed proposal',()=>{
  const r={...sample,compensationProposal:{id:'proposal-1',amount:15000,evidence:'repair quote'}};
  const html=commandForm('consent_compensation',r,esc,won);
  assert.match(html,/type="checkbox" name="consent" required/);assert.match(html,/name="proposalId" value="proposal-1"/);
});

test('objection details remain readable to parties and in the admin review form', () => {
  const r = structuredClone(sample);
  r.status = 'checking';
  r.amountObjection = '<img src=x onerror=alert(1)>금액 확인 요청';
  for (const role of ['renter', 'lender', 'admin']) {
    const dom = new JSDOM(lifecyclePanel(r, role, esc, won));
    assert.match(dom.window.document.querySelector('.objection-details').textContent, /금액 확인 요청/);
    assert.equal(dom.window.document.querySelector('.objection-details img'), null);
    dom.window.close();
  }
  assert.match(commandForm('resolve_objection', r, esc, won), /금액 확인 요청/);
  r.amountObjection = '';
  r.objectionHistory = [{amountObjection:'금액 확인 요청', resolution:'계산 근거 확인 완료'}];
  const html = lifecyclePanel(r, 'renter', esc, won);
  assert.match(html, /이의 검토 완료/);
  assert.match(html, /금액 확인 요청/);
  assert.match(html, /계산 근거 확인 완료/);
  assert.doesNotMatch(html, /금액 이의 · 검토 대기/);
});

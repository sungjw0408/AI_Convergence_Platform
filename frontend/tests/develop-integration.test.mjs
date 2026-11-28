import test from 'node:test';
import assert from 'node:assert/strict';
import {connectRentalDatabase} from '../src/rental-database.js';

test('role headers, incremental refresh and saved reviews coexist with inquiry data', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const records = {listings:[],rentals:[{id:'r1',createdAt:1,status:'complete',finance:{paid:true}}],messages:[],notices:[],inquiries:[{id:'inquiry_a',participants:['renter','lender']}],memberships:[]};
  globalThis.fetch = async (url, options) => {
    calls.push({url,options});
    assert.equal(options.headers.get('X-Rento-Demo-Actor'),'renter');
    if (options.method === 'POST') return new Response(JSON.stringify({revision:2}));
    if (url.includes('?since=1')) return new Response(JSON.stringify({revision:2,records}));
    if (url.includes('?since=2')) return new Response(JSON.stringify({revision:2}));
    return new Response(JSON.stringify({revision:1,records}));
  };
  try {
    const state = {role:'renter',messages:{},listings:[],rentals:[],notices:[]};
    const save = await connectRentalDatabase(state);
    assert.equal(state.inquiries[0].id,'inquiry_a');
    state.rentals[0].feedback = {renter:{rating:5,text:'감사합니다'}};
    await save(state);
    const sent = JSON.parse(calls.find(c=>c.options.method==='POST').options.body);
    assert.equal(sent.changes[0].record.feedback.renter.rating,5);
    assert.equal(await save.refresh(),true);
    assert.equal(await save.refresh(),false);
    assert.equal(calls.at(-1).url,'/api/rental-database?since=2');
  } finally { globalThis.fetch=original; }
});

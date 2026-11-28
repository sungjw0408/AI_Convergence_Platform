import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindSelectPickers } from '../src/select-picker.js';

test('themed selections preserve required validation, submitted values and change events', () => {
  const dom=new JSDOM('<form><label>카테고리<select name="category" required><option value="">선택해 주세요</option><option value="tools">공구</option><option value="digital">디지털</option></select></label></form>');
  const doc=dom.window.document, stop=bindSelectPickers(doc), select=doc.querySelector('select');
  let changes=0;select.addEventListener('change',()=>changes++);
  assert.equal(doc.querySelector('form').checkValidity(),false);
  assert.equal(doc.querySelector('[role="combobox"]').getAttribute('aria-expanded'),'true');
  doc.querySelector('[data-index="1"]').click();
  assert.equal(select.value,'tools');assert.equal(changes,1);
  assert.equal(new dom.window.FormData(doc.querySelector('form')).get('category'),'tools');
  assert.equal(doc.querySelector('[role="combobox"] span').textContent,'공구');
  assert.equal(doc.querySelector('form').checkValidity(),true);
  doc.querySelector('[role="combobox"]').click();
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(doc.activeElement.textContent,'디지털');
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(doc.querySelector('[role="combobox"]').getAttribute('aria-expanded'),'false');
  stop();dom.window.close();
});

test('dynamically rendered selections and disabled state use the same controls', async () => {
  const dom=new JSDOM('<main></main>'),doc=dom.window.document,stop=bindSelectPickers(doc);
  doc.querySelector('main').innerHTML='<label>지역<select name="area"><option>죽전동</option><option>보정동</option></select></label>';
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(doc.querySelector('[role="combobox"]').getAttribute('aria-label'),'지역');
  doc.querySelector('select').disabled=true;
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(doc.querySelector('[role="combobox"]').disabled,true);
  stop();dom.window.close();
});

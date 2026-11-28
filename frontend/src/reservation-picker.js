import { icon } from './icons.js';
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const valid = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '') ? value : /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? `${value}T09:00` : '';
const label = value => value ? new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString('ko-KR', {month:'long',day:'numeric',weekday:'short'}) : '날짜 선택';

export function reservationPicker(date = {}, { dateOnly = false } = {}) {
  const start = valid(date.start), end = valid(date.end?.length === 10 ? date.end + 'T18:00' : date.end);
  return `<div class="reservation-picker" data-date-only="${dateOnly}"><input type="hidden" name="start" value="${dateOnly ? start.slice(0,10) : start}"><input type="hidden" name="end" value="${dateOnly ? end.slice(0,10) : end}">
    <div class="reservation-dates">${['start','end'].map((side, i) => `<button type="button" class="reservation-date" data-picker="date" data-side="${side}" aria-expanded="false"><span>${i ? '반납 예정' : '대여 시작'}</span><strong data-date-label="${side}">${label(i ? end : start)}</strong>${icon('calendar')}</button>`).join('')}<span class="reservation-arrow" aria-hidden="true">→</span></div>
    <div class="reservation-calendar" hidden></div>
    ${dateOnly ? "" : `<div class="reservation-times">${['start','end'].map((side, i) => `<button type="button" data-picker="time" data-side="${side}" aria-expanded="false"><span>${i ? '반납 시간' : '대여 시간'}</span><strong data-time-label="${side}">${(i ? end : start).slice(11) || (i ? '18:00' : '09:00')}</strong>${icon('chevronDown')}</button>`).join('')}</div>
    <div class="reservation-clock" hidden></div>`}<p class="hint reservation-guide">${dateOnly ? "대여할 시작일과 종료일을 선택해 주세요." : "시작일과 반납일을 고른 뒤 시간을 확인해 주세요."}</p></div>`;
}

function refresh(root) {
  for (const side of ['start','end']) {
    const value = root.querySelector(`[name="${side}"]`).value;
    root.querySelector(`[data-date-label="${side}"]`).textContent = label(value);
    if (root.querySelector(`[data-time-label="${side}"]`)) root.querySelector(`[data-time-label="${side}"]`).textContent = value.slice(11) || root.dataset[side + 'Time'] || (side === 'start' ? '09:00' : '18:00');
  }
}
function notify(root) {
  // Reuse the existing estimate and validation path with unchanged form field names.
  root.querySelector('[name="start"]').dispatchEvent(new root.ownerDocument.defaultView.Event('input', {bubbles:true}));
  refresh(root);
}
function close(root, panel) {
  const target = root.querySelector(panel);
  if (target) target.hidden = true;
  root.querySelectorAll('[data-picker="date"], [data-picker="time"]').forEach(button => button.setAttribute('aria-expanded','false'));
}
function calendar(root, side, month) {
  const today = dayKey(new Date());
  const start = root.querySelector('[name="start"]').value.slice(0,10), end = root.querySelector('[name="end"]').value.slice(0,10);
  const date = new Date(`${month}-01T12:00:00`), year = date.getFullYear(), index = date.getMonth();
  const count = new Date(year, index+1, 0).getDate();
  const panel = root.querySelector('.reservation-calendar');
  panel.dataset.side = side; panel.dataset.month = month; panel.hidden = false;
  panel.innerHTML = `<div class="reservation-month"><button type="button" data-picker="month" data-offset="-1" aria-label="이전 달">${icon('back')}</button><strong aria-live="polite">${year}년 ${index+1}월</strong><button type="button" data-picker="month" data-offset="1" aria-label="다음 달">${icon('right')}</button></div>
    <p class="reservation-calendar-caption" role="status">${side === 'start' ? '대여를 시작할 날짜를 선택해 주세요' : '반납할 날짜를 선택해 주세요'}</p>
    <div class="reservation-week" aria-hidden="true">${[...'일월화수목금토'].map(v=>`<span>${v}</span>`).join('')}</div><div class="reservation-days">${'<span></span>'.repeat(date.getDay())}${Array.from({length:count},(_,i)=>{
      const key = `${month}-${pad(i+1)}`, selected = key === start || key === end;
      return `<button type="button" data-picker="day" data-day="${key}" aria-label="${year}년 ${index+1}월 ${i+1}일" aria-pressed="${selected}" ${key < today || (side === 'end' && start && key < start) ? 'disabled' : ''} class="${selected ? 'selected' : start && end && key > start && key < end ? 'in-range' : ''} ${key === today ? 'today' : ''}">${i+1}</button>`;
    }).join('')}</div>`;
  root.querySelector(`[data-picker="date"][data-side="${side}"]`).setAttribute('aria-expanded','true');
}
const WHEEL_ROW = 44;
function wheelValue(wheel) {
  return Math.max(0, Math.min(Number(wheel.dataset.max), Math.round(wheel.scrollTop / WHEEL_ROW)));
}
function updateWheel(wheel, value = wheelValue(wheel)) {
  const panel = wheel.closest('.reservation-clock');
  panel.dataset[wheel.dataset.unit] = pad(value);
  wheel.setAttribute('aria-valuenow', value);
  wheel.setAttribute('aria-valuetext', `${value}${wheel.dataset.unit === 'hour' ? '시' : '분'}`);
  wheel.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset[wheel.dataset.unit]) === value)));
}
function selectWheel(wheel, value) {
  wheel.scrollTop = value * WHEEL_ROW;
  updateWheel(wheel, value);
}
function clock(root, side) {
  const value = root.querySelector(`[name="${side}"]`).value.slice(11) || root.dataset[side + 'Time'] || (side === 'start' ? '09:00' : '18:00');
  const panel = root.querySelector('.reservation-clock');
  panel.hidden = false; panel.dataset.side = side;
  panel.innerHTML = `<div class="reservation-clock-title"><strong>${side === 'start' ? '대여' : '반납'} 시간</strong><span>24시간 기준</span></div>
    <div class="reservation-wheel-labels" aria-hidden="true"><span>시</span><span>분</span></div>
    <div class="reservation-dials"><div class="reservation-dial-selection" aria-hidden="true"></div>${['hour','minute'].map((unit,index)=>`<div class="reservation-wheel" role="spinbutton" tabindex="0" aria-label="${index ? '분' : '시'} 선택" aria-valuemin="0" aria-valuemax="${index ? 59 : 23}" data-unit="${unit}" data-max="${index ? 59 : 23}">${Array.from({length:index ? 60 : 24},(_,n)=>`<button type="button" tabindex="-1" data-picker="${unit}" data-${unit}="${pad(n)}" aria-label="${n}${index ? '분' : '시'}">${pad(n)}</button>`).join('')}</div>`).join('')}<span class="reservation-dial-colon" aria-hidden="true">:</span></div>
    <p class="reservation-dial-hint">위아래로 돌려 시간을 선택해 주세요.</p><p class="hint reservation-time-error" role="alert" hidden></p><button type="button" class="button primary" data-picker="apply-time">시간 적용</button>`;
  panel.querySelectorAll('.reservation-wheel').forEach((wheel,index) => {
    selectWheel(wheel, Number(value.slice(index ? 3 : 0, index ? 5 : 2)));
    wheel.addEventListener('scroll', () => updateWheel(wheel), {passive:true});
  });
  root.querySelector(`[data-picker="time"][data-side="${side}"]`).setAttribute('aria-expanded','true');
}
export function bindReservationPicker(document) {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-picker]'), root = button?.closest('.reservation-picker');
    if (!root) return;
    const action = button.dataset.picker, side = button.dataset.side;
    if (action === 'date' || action === 'time') {
      const wasOpen = button.getAttribute('aria-expanded') === 'true';
      close(root,'.reservation-calendar'); close(root,'.reservation-clock');
      if (wasOpen) return;
      if (action === 'date') calendar(root, side, (root.querySelector(`[name="${side}"]`).value || root.querySelector('[name="start"]').value || dayKey(new Date())).slice(0,7));
      else clock(root,side);
    } else if (action === 'month') {
      const panel = root.querySelector('.reservation-calendar'), d = new Date(`${panel.dataset.month}-01T12:00:00`);
      d.setMonth(d.getMonth()+Number(button.dataset.offset)); calendar(root,panel.dataset.side,dayKey(d).slice(0,7));
    } else if (action === 'day') {
      const panel = root.querySelector('.reservation-calendar'), side = panel.dataset.side;
      const field = root.querySelector(`[name="${side}"]`);
      field.value = button.dataset.day + 'T' + (field.value.slice(11) || root.dataset[side + 'Time'] || (side === 'start' ? '09:00' : '18:00'));
      if (root.dataset.dateOnly === 'true') field.value = button.dataset.day;
      const end = root.querySelector('[name="end"]');
      if (side === 'start' && end.value && end.value < field.value) end.value = '';
      notify(root);
      if (side === 'start') { close(root,'.reservation-calendar'); calendar(root,'end',button.dataset.day.slice(0,7)); }
      else { close(root,'.reservation-calendar'); root.querySelector('[data-picker="date"][data-side="end"]').focus(); }
    } else if (action === 'hour' || action === 'minute') {
      selectWheel(button.closest('.reservation-wheel'), Number(button.dataset[action]));
    } else if (action === 'apply-time') {
      const panel = root.querySelector('.reservation-clock');
      panel.querySelectorAll('.reservation-wheel').forEach(wheel => updateWheel(wheel));
      const minute = panel.dataset.minute;
      const side = panel.dataset.side, field = root.querySelector(`[name="${side}"]`), error = panel.querySelector('[role="alert"]');
      if (!/^[0-5]?\d$/.test(minute)) { error.hidden=false; error.textContent='분은 0~59 사이로 입력해 주세요.'; return; }
      root.dataset[side + 'Time'] = `${panel.dataset.hour}:${pad(Number(minute))}`;
      refresh(root);
      if (!field.value) { close(root,'.reservation-clock'); calendar(root,side,dayKey(new Date()).slice(0,7)); return; }
      const value = `${field.value.slice(0,10)}T${panel.dataset.hour}:${pad(Number(minute))}`;
      if (side === 'end' && value <= root.querySelector('[name="start"]').value) { error.hidden=false; error.textContent='반납 시간은 대여 시작 이후로 선택해 주세요.'; return; }
      field.value=value;
      if (side === 'start' && root.querySelector('[name="end"]').value <= value) root.querySelector('[name="end"]').value='';
      notify(root); close(root,'.reservation-clock'); root.querySelector(`[data-picker="time"][data-side="${side}"]`).focus();
    }
  });
  document.addEventListener('keydown', event => {
    const root = event.target.closest('.reservation-picker');
    if (root && event.key === 'Escape') { const trigger = root.querySelector('[aria-expanded="true"]'); close(root,'.reservation-calendar');close(root,'.reservation-clock');trigger?.focus(); }
    const wheel = event.target.closest('.reservation-wheel');
    if (wheel && ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)) {
      event.preventDefault();
      const current = wheelValue(wheel), max = Number(wheel.dataset.max);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? max : current + ({ArrowUp:-1,ArrowDown:1,PageUp:-5,PageDown:5}[event.key]);
      selectWheel(wheel, Math.max(0, Math.min(max, next)));
    }
    if (wheel && event.key === 'Enter') { event.preventDefault(); root.querySelector('[data-picker="apply-time"]').click(); }
  });
}

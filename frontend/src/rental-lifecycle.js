import { reservationPicker } from "./reservation-picker.js";
// Pure display/validation helpers; the server owns all amounts and state changes.
export function chargedDays(start, end) {
  const duration = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(duration) && duration > 0 ? Math.ceil(duration / 86_400_000) : 0;
}

export function reservationInputs(date = {}, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return reservationPicker(date) + `<input type="hidden" name="timeZone" value="${zone.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"><p class="hint">현재 기기의 날짜와 시각을 기준으로 예약해요.</p>`;
}

export async function sendRentalCommand(action, data, actor, accountMode = false) {
  const fingerprint = JSON.stringify([actor, action, data]);
  const storageKey = 'rento-command:' + fingerprint;
  let requestId;
  try { requestId = sessionStorage.getItem(storageKey); } catch {}
  requestId ||= crypto.randomUUID();
  try { sessionStorage.setItem(storageKey, requestId); } catch {}
  const headers = { 'Content-Type': 'application/json', [accountMode ? 'X-Rento-Account' : 'X-Rento-Demo-Actor']: actor };
  const response = await fetch('/api/rental-lifecycle', { method: 'POST', headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ action, data, requestId }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '거래 처리에 실패했어요. 다시 시도해 주세요.');
  try { sessionStorage.removeItem(storageKey); } catch {}
  return result.rental;
}

export function objectionDetails(rental, escape) {
  const card = (title, note) => `<article class="objection-card"><header><strong>${title}</strong><span class="review-badge">검토 대기</span></header><p>${escape(note)}</p></article>`;
  const pending = [rental.amountObjection && card('금액 이의', rental.amountObjection), rental.returnObjection && card('반납 시각 이의', rental.returnObjection)].filter(Boolean).join('');
  const history = (rental.objectionHistory || []).map(entry => `<article class="objection-card resolved"><header><strong>이의 검토 완료</strong><span class="review-badge done">완료</span></header>${entry.amountObjection ? `<p><small>금액 이의</small>${escape(entry.amountObjection)}</p>` : ''}${entry.returnObjection ? `<p><small>반납 시각 이의</small>${escape(entry.returnObjection)}</p>` : ''}<p class="review-result"><small>검토 결과</small>${escape(entry.resolution)}</p></article>`).join('');
  const legacy = !history && rental.objectionResolution ? `<article class="objection-card resolved"><p><small>이전 검토 결과</small>${escape(rental.objectionResolution)}</p></article>` : '';
  return pending || history || legacy ? `<section class="objection-details"><h3>이의 내역</h3>${pending}${history || legacy ? `<details class="review-history"><summary>지난 검토 보기</summary>${history}${legacy}</details>` : ''}</section>` : '';
}

export function lifecyclePanel(rental, role, escape, won) {
  if (rental.lifecycleVersion !== 1) return '';
  const f = rental.finance;
  const at = (t) => t ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: rental.timeZone }).format(new Date(t)) : '';
  const action = (label, name, cls='secondary') => `<button class="button ${cls}" data-action="lifecycle" data-id="${name}">${label}</button>`;
  const borrows = role === rental.renterId, owns = role === rental.lenderId, admin = role === 'admin';
  const buttons = [];
  if (borrows && rental.status === 'payment_pending') buttons.push(action('테스트 결제하기', 'pay', 'primary'));
  if (rental.status === 'active' && borrows) buttons.push(action('대여 기간 연장', 'extend'));
  if (rental.extension?.status === 'pending' && owns) buttons.push(action('연장 승인', 'approve_extension'), action('연장 거절', 'reject_extension'));
  if (rental.extension?.status === 'payment_pending' && borrows) buttons.push(action('연장 요금 결제', 'pay_extension'));
  if (rental.status === 'complete' && f.lateDue > 0 && borrows) buttons.push(action('연체료 결제', 'pay_late'));
  if (['confirmed','handover'].includes(rental.status) && (owns || borrows) && !rental.noShow) buttons.push(action('노쇼 신고', 'report_noshow'));
  if (admin && rental.noShow?.status === 'reported') buttons.push(action('노쇼 확정·전액 환불', 'confirm_noshow'), action('노쇼 신고 기각', 'reject_noshow'));
  if (owns && rental.status === 'checking') buttons.push(action('반납 시각 이의', 'return_objection'));
  if ((owns || borrows) && ['checking','complete'].includes(rental.status) && !f.depositReturned) buttons.push(action('금액 이의 접수', 'amount_objection'));
  if (admin && (rental.returnObjection || rental.amountObjection)) buttons.push(action('이의 검토 완료', 'resolve_objection'));
  if ((owns || admin) && rental.dispute && !f.depositReturned) buttons.push(action('배상 협의 제안', 'propose_compensation'));
  if (borrows && rental.compensationProposal?.status === 'proposed') buttons.push(action('배상 제안 확인·동의', 'consent_compensation'), action('배상 제안 거부', 'reject_compensation'));
  if (borrows && f.compensationDue > 0) buttons.push(action('추가 배상금 결제', 'pay_compensation'));
  const holds = { damage:'손상 신고', amount_objection:'금액 이의', return_objection:'반납 시각 이의', late_unpaid:'연체료 미결제', compensation_unpaid:'추가 배상금 미결제' };
  const kinds = { rental_payment:'대여료 결제', deposit_payment:'보증금 결제', payment_failed:'결제 실패', rental_refund:'대여료 전액 환불', deposit_refund:'보증금 전액 환불', rental_settlement:'대여료 정산', deposit_return:'보증금 반환', extension_payment:'추가 대여료 결제', extension_settlement:'추가 대여료 정산', late_payment:'연체료 결제', compensation_payment:'추가 배상액 결제', compensation_from_deposit:'합의한 보증금 배상' };
  return `<section class="lifecycle-panel"><div class="lifecycle-heading"><h2>결제 내역</h2><span>테스트 · 실제 청구 없음</span></div><dl><div><dt>대여 일정</dt><dd>${escape(at(rental.startAt))}<br>~ ${escape(at(rental.endAt))}</dd></div><div><dt>대여료</dt><dd>${won(rental.total)}</dd></div><div><dt>보증금</dt><dd>${won(rental.deposit)} · ${f.depositReturned ? '반환 완료' : f.refunded ? '전액 환불' : f.paid ? '보관 중' : '미결제'}</dd></div>${f.lateDue ? `<div><dt>연체료 미결제</dt><dd>${won(f.lateDue)}</dd></div>` : ''}${f.compensationDue ? `<div><dt>추가 배상금</dt><dd>${won(f.compensationDue)}</dd></div>` : ''}</dl>
    ${rental.status === 'pending' ? `<p class="hint">응답 기한: ${escape(at(rental.requestExpiresAt))} </p>` : ''}
    ${rental.status === 'payment_pending' ? `<p class="notice">${escape(at(rental.paymentDueAt))}까지 결제해 주세요.</p>` : ''}
    ${rental.firstReturnRequestedAt ? `<p class="hint">최초 반납 요청: ${escape(at(rental.firstReturnRequestedAt))}${rental.actualReturnedAt ? `<br>확정 반납: ${escape(at(rental.actualReturnedAt))}` : '<br>시각 이의가 없으면 24시간 후 자동 완료'}</p>` : ''}
    ${rental.extension ? `<p class="notice">연장 신청 · ${escape(at(rental.extension.endAt))} / 추가 ${won(rental.extension.amount)}<br>상태: ${escape(({pending:'공급자 승인 대기',payment_pending:'추가 결제 대기',paid:'적용 완료',rejected:'거절',expired:'만료'})[rental.extension.status])}</p>` : ''}
    ${f.depositHolds?.length ? `<p class="notice">보증금 반환 보류: ${f.depositHolds.map(k => holds[k] || k).map(escape).join(' · ')}<br><small>대여료 정산은 별도 진행</small></p>` : ''}
    ${objectionDetails(rental, escape)}
    ${rental.noShow ? `<p class="notice">노쇼 검토: ${escape(({reported:"관리자 검토 중",confirmed:"노쇼 확정",rejected:"신고 기각"})[rental.noShow.status])} · ${escape(rental.noShow.place)}</p>` : ''}
    ${rental.compensationProposal ? `<p class="notice">배상 제안 ${won(rental.compensationProposal.amount)}<br>${escape(rental.compensationProposal.evidence)}<br>검토 상태: ${escape(({proposed:"동의 대기",agreed:"동의 완료",unresolved:"미해결 분쟁"})[rental.compensationProposal.status])}</p>` : ''}
    ${rental.ledger.length ? `<details class="payment-history"><summary>결제·환불 기록 <span>${rental.ledger.length}건</span></summary><ul>${rental.ledger.map(e => `<li class="${e.kind === 'payment_failed' ? 'failed' : ''}"><span>${escape(kinds[e.kind] || e.kind)}</span><strong>${e.kind === 'payment_failed' ? '청구 없음' : won(e.amount)}</strong></li>`).join('')}</ul></details>` : ''}
    ${buttons.length ? `<div class="lifecycle-actions">${buttons.join('')}</div>` : ''}</section>`;
}

export function commandForm(action, rental, escape, won) {
  const field = (label, name, type='text', extra='') => `<label>${label}<input name="${name}" type="${type}" ${extra} required></label>`;
  let inputs = '';
  if (action.startsWith('pay')) inputs = `<p class="notice">테스트 결제 · 실제 청구 없음</p><label>테스트 결과<select name="outcome"><option value="success">성공</option><option value="failure">실패 (재시도 확인)</option></select></label>`;
  else if (action === 'extend') inputs = field('새 반납 예정 시각 (현재 기기 시간)', 'endAt', 'datetime-local');
  else if (action === 'report_noshow') inputs = field('합의한 인도 약속 시각 (현재 기기 시간)', 'appointmentAt', 'datetime-local') + field('약속 장소', 'place', 'text', 'maxlength="200"') + field('연락 시도 기록', 'contactAttempts', 'text', 'maxlength="500"') + '<label><input type="checkbox" name="noTimeChangeAgreed" required>시간 변경 합의가 없고 연락을 시도해도 만나지 못했어요.</label>';
  else if (action === 'propose_compensation') inputs = field('합의 제안 배상액 (원)', 'amount', 'number', 'min="0" max="10000000000" step="1"') + '<label>근거<select name="basis"><option value="repair">증빙 수리비</option><option value="used_value">거래 당시 확정 중고 가액</option></select></label>' + field('증빙 수리비 (원, 중고 가액 선택 시 0)', 'repairCost', 'number', 'min="0" max="10000000000" step="1"') + field('증빙 및 검토 근거', 'evidence', 'text', 'maxlength="500"');
  else if (action === 'consent_compensation') inputs = `<p>배상 제안 ${won(rental.compensationProposal.amount)} · ${escape(rental.compensationProposal.evidence)}</p><label><input type="checkbox" name="consent" required>제안 금액, 보증금 사용 및 부족분 추가 테스트 결제에 동의해요.</label>`;
  else if (action === 'resolve_objection') inputs = objectionDetails(rental, escape) + '<label>검토 근거<textarea name="note" maxlength="500" required></textarea></label>' + (rental.returnObjection ? field('확인한 실제 반납 시각 (현재 기기 시간)', 'returnedAt', 'datetime-local') : '');
  else if (['return_objection','amount_objection','confirm_noshow','reject_noshow'].includes(action)) inputs = '<label>접수 내용<textarea name="note" maxlength="500" required></textarea></label>';
  else inputs = '<p>선택한 거래 작업을 진행할까요?</p>';
  if (['consent_compensation','reject_compensation','pay_compensation'].includes(action)) inputs += `<input type="hidden" name="proposalId" value="${escape(rental.compensationProposal.id)}">`;
  return `<form data-form="lifecycle" data-id="${escape(rental.id)}" data-command="${action}" class="form-card plain">${inputs}<p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">확인</button></form>`;
}

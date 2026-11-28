"""Authoritative rental commands. Amounts are test-only KRW integer ledger entries.

Caller supplies a transaction-wide snapshot, a trusted actor and server time.
No client-provided totals, deadlines, status or ledger entries are trusted.
"""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from math import ceil
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import json
import re

from listing_pricing import deposit_for_value, valid_item_value
from listing_visibility import public_listing

HOUR = 3_600_000
DAY = 24 * HOUR
BUSY = {'payment_pending', 'confirmed', 'handover', 'active', 'checking', 'disputed'}
PRE_HANDOVER = {'pending', 'payment_pending', 'confirmed', 'handover'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def timestamp(value):
    require(isinstance(value, str), '날짜와 시각을 선택해 주세요.')
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(dt.tzinfo is not None, '시간대가 포함된 시각이 필요해요.')
        return int(dt.timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        raise ValueError('유효한 날짜·시각과 시간대를 선택해 주세요.') from None


def iso(value):
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec='seconds')


def money(value):
    require(type(value) is int and 0 <= value <= 10**10, '금액을 확인해 주세요.')
    return value


def text(value, label, limit=500):
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit, label + '을 입력해 주세요.')
    return value.strip()


def rental_days(start, end):
    require(end > start, '반납 예정 시각은 시작 시각 이후여야 해요.')
    return ceil((end - start) / DAY)


def calendar_date(value, zone):
    try:
        return datetime.fromtimestamp(value / 1000, ZoneInfo(zone)).date()
    except (ZoneInfoNotFoundError, TypeError):
        raise ValueError('이 거래의 날짜 계산 시간대를 확인해 주세요.') from None


def late_fee(rental):
    days = max(0, (calendar_date(rental['actualReturnedAt'], rental['timeZone']) -
                   calendar_date(rental['endAt'], rental['timeZone'])).days)
    return days * rental['dailyPrice']


def event(rental, key, kind, amount, now):
    if not any(entry['id'] == key for entry in rental['ledger']):
        rental['ledger'].append({'id': key, 'kind': kind, 'amount': money(amount), 'at': now, 'testOnly': True})


def hold_reasons(rental):
    reasons = []
    if rental.get('dispute') and not rental.get('disputeResolved'):
        reasons.append('damage')
    if rental.get('amountObjection'):
        reasons.append('amount_objection')
    if rental.get('returnObjection'):
        reasons.append('return_objection')
    if rental['finance'].get('lateDue', 0) > 0:
        reasons.append('late_unpaid')
    if rental['finance'].get('compensationDue', 0) > 0:
        reasons.append('compensation_unpaid')
    return reasons


def settle(rental, now):
    f = rental['finance']
    event(rental, 'base-settlement', 'rental_settlement', rental['total'], now)
    for entry in list(rental['ledger']):
        if entry['kind'] == 'extension_payment':
            event(rental, 'settle:' + entry['id'], 'extension_settlement', entry['amount'], now)
    f['baseSettled'] = True
    f['depositHolds'] = hold_reasons(rental)
    if not f['depositHolds'] and not f['depositReturned']:
        event(rental, 'compensation-deposit', 'compensation_from_deposit', f.get('compensationFromDeposit', 0), now)
        event(rental, 'deposit-return', 'deposit_return', rental['deposit'] - f.get('compensationFromDeposit', 0), now)
        f['depositReturned'] = True


def complete_return(rental, now, automatic=False):
    require(rental.get('firstReturnRequestedAt') is not None, '반납 요청 기록이 필요해요.')
    rental['actualReturnedAt'] = rental.get('resolvedReturnedAt', rental['firstReturnRequestedAt'])
    rental['completedAt'] = now
    rental['returnConfirmedAt'] = None if automatic else now
    rental['autoCompleted'] = automatic
    rental['status'] = 'complete'
    rental['finance']['lateDue'] = late_fee(rental)
    settle(rental, now)


def advance(records, now):
    """Recover expiry and unattended returns from persisted server timestamps."""
    for r in records:
        if r.get('lifecycleVersion') != 1:
            continue
        if r['status'] == 'pending' and now >= r['requestExpiresAt']:
            r.update(status='expired', expiredAt=now, expirationReason='no_response')
        elif r['status'] == 'payment_pending' and now >= r['paymentDueAt']:
            r.update(status='expired', expiredAt=now, expirationReason='unpaid')
        elif r['status'] == 'checking' and now >= r['firstReturnRequestedAt'] + DAY and not r.get('returnObjection'):
            complete_return(r, now, automatic=True)
        extension = r.get('extension')
        if extension and extension['status'] == 'payment_pending' and now >= extension['paymentDueAt']:
            extension['status'] = 'expired'


def held_extension(rental, now):
    extension = rental.get("extension") or {}
    if extension.get("status") == "payment_pending" and extension.get("paymentDueAt", 0) > now:
        return extension["endAt"]
    return None


def available(rentals, item, start, end, zone, now, ignored=None):
    rental_days(start, end)
    start_day, end_day = calendar_date(start, zone).isoformat(), calendar_date(end, zone).isoformat()
    require(not item.get('availableFrom') or start_day >= item['availableFrom'], '대여 가능 기간 이전이에요.')
    require(not item.get('availableTo') or end_day <= item['availableTo'], '대여 가능 기간을 벗어났어요.')
    if item.get('weekends'):
        begin, finish = calendar_date(start, zone), calendar_date(end, zone)
        require((finish - begin).days <= 1 and all((begin + timedelta(days=i)).weekday() >= 5
                for i in range((finish - begin).days + 1)), '주말 대여 가능한 물품이에요.')
    for other in rentals:
        if other['id'] == ignored or other['itemId'] != item['id'] or other['status'] not in BUSY:
            continue
        if other['status'] == 'payment_pending' and other.get('paymentDueAt', 0) <= now:
            continue
        if other.get('lifecycleVersion') == 1:
            other_start, other_end = other['startAt'], held_extension(other, now) or other['endAt']
            # Unreturned active rentals cannot be advertised as available after their due date.
            occupied = other['status'] in {'handover', 'active', 'checking'} or (other['status'] == 'disputed' and not other.get('after'))
            if (occupied and end > other_start) or start < other_end and other_start < end:
                raise ValueError('다른 예약 또는 결제 대기 일정과 겹쳐요.')
        elif start_day <= other['end'] and other['start'] <= end_day:
            raise ValueError('기존 예약 일정과 겹쳐요.')


def evidence(rental, data, phase):
    record = data.get('inspection')
    require(isinstance(record, dict), '부위별 촬영 기록이 필요해요.')
    plan = record.get('plan', {})
    views = plan.get('views', [])
    photos = record.get(phase, {})
    require(isinstance(views, list) and 1 <= len(views) <= 8 and isinstance(photos, dict), '촬영 목록을 확인해 주세요.')
    require(all(isinstance(v, dict) and isinstance(v.get('id'), str) for v in views), '촬영 부위를 확인해 주세요.')
    require(set(photos) == {v['id'] for v in views}, '모든 부위를 촬영해 주세요.')
    require(all(isinstance(p, dict) and isinstance(p.get('source'), str) and re.fullmatch(r'capture:[a-f0-9-]{36}', p['source'])
                for p in photos.values()), '앱에서 촬영한 상태 사진이 필요해요.')
    checks = plan.get('checks', [])
    require(isinstance(checks, list) and all(isinstance(c, dict) and isinstance(c.get('id'), str) for c in checks), '확인 항목을 점검해 주세요.')
    require(set(record.get(phase + 'Checks', [])) == {c['id'] for c in checks}, '구성품과 상태를 확인해 주세요.')
    if phase == 'after':
        previous = rental['inspection']
        require(all(record.get(k) == previous.get(k) for k in ('plan', 'before', 'beforeChecks', 'beforeNote')),
                '대여 전 사진은 변경할 수 없어요.')
    rental['inspection'] = deepcopy(record)
    if phase == 'after':
        rental.pop('photoAnalysis', None)
    rental[phase] = next(iter(photos.values()))['source']


def execute(records, items, actor, action, data, request_id, now, admin=False, *,
            deposit_policy=None, require_value=False):
    """Mutates a private snapshot inside the caller's serializable transaction."""
    require(isinstance(data, dict), '요청 내용을 확인해 주세요.')
    require(isinstance(request_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{8,100}', request_id), '중복 방지 요청 번호가 필요해요.')
    digest = sha256(json.dumps([actor, action, data], sort_keys=True).encode()).hexdigest()
    for existing in records:
        receipt = existing.get('receipts', {}).get(request_id)
        if receipt:
            require(receipt == digest, '같은 요청 번호로 다른 작업을 할 수 없어요.')
            return existing
    advance(records, now)
    if action == 'request':
        item = next((i for i in items if i['id'] == data.get('itemId')), None)
        require(item and public_listing(item) and actor != item['owner'] and not admin, '이 물품에 신청할 수 없어요.')
        start, end, zone = timestamp(data.get('startAt')), timestamp(data.get('endAt')), data.get('timeZone')
        require(start > now, '시작 시각은 현재 이후로 선택해 주세요.')
        available(records, item, start, end, zone, now)
        require(not any(r['renterId'] == actor and r['itemId'] == item['id'] and r['status'] == 'pending' and
                r.get('startAt', 0) < end and start < r.get('endAt', 0) for r in records), '이미 신청한 시간과 겹쳐요.')
        value = item.get("itemValue")
        if require_value:
            require(valid_item_value(value), "공급자가 중고 가액과 근거를 추가해야 대여를 신청할 수 있어요.")
            require(deposit_policy is not None, "보증금 정책이 정해지면 대여를 신청할 수 있어요.")
        with_policy = valid_item_value(value) and deposit_policy is not None
        rate = money(item['price'])
        deposit = deposit_for_value(value, deposit_policy) if with_policy else money(item.get('deposit', 0))
        rental = {'id': 'r-' + request_id, 'itemId': item['id'], 'renterId': actor, 'lenderId': item['owner'],
                  'lifecycleVersion': 1, 'status': 'pending', 'createdAt': now, 'requestExpiresAt': now + 12 * HOUR,
                  'startAt': start, 'endAt': end, 'timeZone': zone,
                  'start': calendar_date(start, zone).isoformat(), 'end': calendar_date(end, zone).isoformat(),
                  'dailyPrice': rate, 'total': rate * rental_days(start, end), 'deposit': deposit,
                  'usedValue': value["amountWon"] if with_policy else item.get('usedValue'),
                  'ledger': [], 'receipts': {},
                  'finance': {'paid': False, 'baseSettled': False, 'depositReturned': False,
                              'depositHolds': [], 'lateDue': 0, 'compensationDue': 0}}
        if with_policy:
            rental.update(itemValue=deepcopy(value), depositPolicy=deepcopy(deposit_policy))
        require(not any(r['id'] == rental['id'] for r in records), '요청 번호가 이미 사용됐어요.')
        records.append(rental)
    else:
        rental = next((r for r in records if r['id'] == data.get('rentalId')), None)
        require(rental and rental.get('lifecycleVersion') == 1, '새 예약 흐름으로 생성한 거래가 필요해요.')
        require(actor in (rental['renterId'], rental['lenderId']) or admin, '거래 당사자만 처리할 수 있어요.')
        status, owns, borrows = rental['status'], actor == rental['lenderId'], actor == rental['renterId']
        item = next((i for i in items if i['id'] == rental['itemId']), None)
        require(item, '물품 정보를 찾을 수 없어요.')
        if action == 'approve':
            require(owns and status == 'pending' and now < rental['requestExpiresAt'], '승인 가능한 신청이 아니에요.')
            require(now < rental['startAt'], '대여 시작 시각이 지난 신청은 승인할 수 없어요.')
            available(records, item, rental['startAt'], rental['endAt'], rental['timeZone'], now, rental['id'])
            rental.update(status='payment_pending', approvedAt=now, paymentDueAt=now + HOUR)
        elif action == 'reject':
            require(owns and status == 'pending', '거절 가능한 신청이 아니에요.')
            rental['status'] = 'rejected'
        elif action == 'pay':
            require(borrows and status == 'payment_pending' and now < rental['paymentDueAt'], '결제 기한이 지났거나 결제할 수 없는 거래예요.')
            require(now < rental['startAt'], '시작 시각이 지나 결제할 수 없어요. 새로 신청해 주세요.')
            available(records, item, rental['startAt'], rental['endAt'], rental['timeZone'], now, rental['id'])
            test_result(rental, request_id, data, now)
            if data['outcome'] == 'success':
                event(rental, 'base-payment', 'rental_payment', rental['total'], now)
                event(rental, 'deposit-payment', 'deposit_payment', rental['deposit'], now)
                rental['finance']['paid'] = True
                rental.update(status='confirmed', paidAt=now)
        elif action == 'cancel':
            require((owns or borrows) and status in PRE_HANDOVER and not rental.get('receivedAt'), '인도 이후에는 예약 취소할 수 없어요.')
            cancel(rental, now)
        elif action == 'handoff':
            require(owns and status == 'confirmed' and rental['finance']['paid'], '결제 완료 후 공급자가 촬영해 주세요.')
            evidence(rental, data, 'before')
            rental.update(status='handover', handoffRecordedAt=now)
        elif action == 'receive':
            require(borrows and status == 'handover', '수령 확인할 수 없는 거래예요.')
            rental.update(status='active', receivedAt=now)
        elif action in ('return', 'reshoot'):
            require(borrows and status == ('active' if action == 'return' else 'checking'), '반납 사진을 저장할 수 없는 상태예요.')
            evidence(rental, data, 'after')
            rental.setdefault('firstReturnRequestedAt', now)
            rental['status'] = 'checking'
        elif action == 'complete':
            require(owns and status in ('checking', 'complete') and not rental.get('returnObjection'), '반납 시각 이의를 먼저 해결해 주세요.')
            if status != 'complete':
                complete_return(rental, now)
        elif action == 'dispute':
            require(owns and status == 'checking', '반납 확인 중에 신고해 주세요.')
            rental.update(dispute=text(data.get('note'), '신고 내용'), disputeResolved=False)
            # Damage does not prevent confirmation of the first return time/base settlement.
            rental['finance']['depositHolds'] = hold_reasons(rental)
        elif action == 'return_objection':
            require(owns and status == 'checking', '반납 확인 중에 이의를 접수해 주세요.')
            rental['returnObjection'] = text(data.get('note'), '반납 시각 이의')
            rental['finance']['depositHolds'] = hold_reasons(rental)
        elif action == 'amount_objection':
            require((owns or borrows) and status in ('checking', 'complete') and not rental['finance']['depositReturned'], '보증금 반환 전 거래에 이의를 접수해 주세요.')
            rental['amountObjection'] = text(data.get('note'), '금액 이의')
            rental['finance']['depositHolds'] = hold_reasons(rental)
        elif action == 'resolve_objection':
            require(admin and (rental.get('returnObjection') or rental.get('amountObjection')), '검토할 이의가 없어요.')
            rental['objectionResolution'] = text(data.get('note'), '검토 근거')
            if rental.get('returnObjection'):
                rental['resolvedReturnedAt'] = timestamp(data.get('returnedAt'))
                require(rental.get('receivedAt', 0) <= rental['resolvedReturnedAt'] <= now, '확인한 반납 시각을 입력해 주세요.')
            rental.setdefault('objectionHistory', []).append({
                'amountObjection': rental.get('amountObjection', ''),
                'returnObjection': rental.get('returnObjection', ''),
                'resolution': rental['objectionResolution'],
                'reviewedAt': now, 'reviewedBy': actor,
            })
            rental['returnObjection'] = ''
            rental['amountObjection'] = ''
            if status == 'complete':
                settle(rental, now)
        elif action == 'extend':
            require(borrows and status == 'active' and now < rental['endAt'], '반납 기한 전 대여 중인 거래에서 신청해 주세요.')
            require(not rental.get('extension') or rental['extension']['status'] in ('paid', 'rejected', 'expired'), '진행 중인 연장 신청이 있어요.')
            end = timestamp(data.get('endAt'))
            require(end > rental['endAt'], '현재 반납 예정 시각 이후로 선택해 주세요.')
            available(records, item, rental['startAt'], end, rental['timeZone'], now, rental['id'])
            rental['extension'] = {'id': request_id, 'status': 'pending', 'endAt': end,
                    'amount': rental['dailyPrice'] * (rental_days(rental['startAt'], end) - rental_days(rental['startAt'], rental['endAt']))}
        elif action in ('approve_extension', 'reject_extension', 'pay_extension'):
            ext = rental.get('extension', {})
            require(status == 'active' and now < rental['endAt'], '대여 기한이 지나 연장할 수 없어요.')
            if action in ('approve_extension', 'reject_extension'):
                require(owns and ext.get('status') == 'pending', '승인 대기 중인 연장 신청이 아니에요.')
                if action == 'approve_extension':
                    available(records, item, rental['startAt'], ext['endAt'], rental['timeZone'], now, rental['id'])
                    ext.update(status='payment_pending', paymentDueAt=rental['endAt'])
                else:
                    ext['status'] = 'rejected'
            else:
                require(borrows and ext.get('status') == 'payment_pending' and now < ext['paymentDueAt'], '연장 결제 기한을 확인해 주세요.')
                available(records, item, rental['startAt'], ext['endAt'], rental['timeZone'], now, rental['id'])
                test_result(rental, request_id, data, now)
                if data['outcome'] == 'success':
                    event(rental, 'extension:' + ext['id'], 'extension_payment', ext['amount'], now)
                    rental.update(endAt=ext['endAt'], end=calendar_date(ext['endAt'], rental['timeZone']).isoformat())
                    ext['status'] = 'paid'
        elif action == 'pay_late':
            require(borrows and status == 'complete' and rental['finance']['lateDue'] > 0 and not rental.get('amountObjection'), '결제할 연체료를 확인해 주세요.')
            test_result(rental, request_id, data, now)
            if data['outcome'] == 'success':
                event(rental, 'late-payment', 'late_payment', rental['finance']['lateDue'], now)
                rental['finance']['lateDue'] = 0
                settle(rental, now)
        elif action == 'propose_compensation':
            require((owns or admin) and rental.get('dispute') and not rental['finance']['depositReturned'], '보증금 보류 중인 손상 신고가 필요해요.')
            require(rental.get('compensationProposal', {}).get('status') not in ('agreed',), '이미 동의한 배상 제안은 변경할 수 없어요.')
            amount = money(data.get('amount'))
            basis = data.get('basis')
            require(basis in ('repair', 'used_value'), '수리비 또는 거래 당시 중고 가액 근거가 필요해요.')
            cap = money(data.get('repairCost')) if basis == 'repair' else rental.get('usedValue')
            require(type(cap) is int and amount <= cap, '증빙 수리비 또는 확정 중고 가액 상한을 확인해 주세요.')
            rental['compensationProposal'] = {'id': request_id, 'amount': amount, 'basis': basis,
                'evidence': text(data.get('evidence'), '증빙 내용'), 'status': 'proposed', 'proposedBy': actor}
        elif action in ('consent_compensation', 'reject_compensation', 'pay_compensation'):
            proposal = rental.get('compensationProposal', {})
            require(borrows and not rental['finance']['depositReturned'], '대여자의 추가 동의가 필요해요.')
            require(data.get('proposalId') == proposal.get('id'), '배상 제안이 바뀌었어요. 내용을 다시 확인해 주세요.')
            if action == 'reject_compensation':
                require(proposal.get('status') == 'proposed', '검토할 배상 제안이 없어요.')
                proposal['status'] = 'unresolved'
            elif action == 'consent_compensation':
                require(proposal.get('status') == 'proposed', '검토할 배상 제안이 없어요.')
                require(data.get('consent') is True, '보증금 사용과 부족분 결제에 명시적으로 동의해 주세요.')
                proposal['status'] = 'agreed'
                rental['finance']['compensationDue'] = max(0, proposal['amount'] - rental['deposit'])
                rental['finance']['compensationFromDeposit'] = min(proposal['amount'], rental['deposit'])
                rental['disputeResolved'] = True
            else:
                require(proposal.get('status') == 'agreed' and rental['finance']['compensationDue'] > 0, '동의한 추가 배상 결제가 없어요.')
                test_result(rental, request_id, data, now)
                if data['outcome'] == 'success':
                    event(rental, 'compensation:' + proposal['id'], 'compensation_payment', rental['finance']['compensationDue'], now)
                    rental['finance']['compensationDue'] = 0
            if status == 'complete':
                settle(rental, now)
            else:
                rental['finance']['depositHolds'] = hold_reasons(rental)
        elif action == 'report_noshow':
            require((owns or borrows) and status in ('confirmed', 'handover') and not rental.get('noShow'), '노쇼 신고 가능한 상태가 아니에요.')
            appointment = timestamp(data.get('appointmentAt'))
            require(appointment >= rental['createdAt'] and now >= appointment + HOUR // 2, '약속 시각에서 30분 이상 경과해야 해요.')
            rental['noShow'] = {'status': 'reported', 'reporter': actor, 'reportedAt': now, 'appointmentAt': appointment,
                'place': text(data.get('place'), '약속 장소', 200), 'contactAttempts': text(data.get('contactAttempts'), '연락 시도 기록'),
                'noTimeChangeAgreed': data.get('noTimeChangeAgreed') is True}
            require(rental['noShow']['noTimeChangeAgreed'], '시간 변경 합의가 없었는지 확인해 주세요.')
        elif action in ('confirm_noshow', 'reject_noshow'):
            require(admin and status in ('confirmed', 'handover') and rental.get('noShow', {}).get('status') == 'reported', '관리자만 신고를 검토할 수 있어요.')
            rental['noShow'].update(status='confirmed' if action == 'confirm_noshow' else 'rejected', reviewedAt=now,
                                    reviewNote=text(data.get('note'), '검토 근거'))
            if action == 'confirm_noshow':
                cancel(rental, now)
        else:
            raise ValueError('지원하지 않는 거래 작업이에요.')
    rental['receipts'][request_id] = digest
    require(len(rental['receipts']) <= 500, '거래 처리 기록 한도에 도달했어요. 관리자에게 문의해 주세요.')
    return rental


def test_result(rental, key, data, now):
    require(data.get('outcome') in ('success', 'failure'), '테스트 결제 결과를 선택해 주세요.')
    if data['outcome'] == 'failure':
        event(rental, 'failed:' + key, 'payment_failed', 0, now)


def cancel(rental, now):
    if rental['finance']['paid']:
        event(rental, 'base-refund', 'rental_refund', rental['total'], now)
        event(rental, 'deposit-refund', 'deposit_refund', rental['deposit'], now)
        rental['finance']['refunded'] = True
    rental.update(status='canceled', canceledAt=now)


def lifecycle_notices(before, after, now):
    """Notify existing transaction parties only; stable IDs avoid duplicate recovery notices."""
    previous = {r['id']: r for r in before}
    notices = []
    labels = {'pending': '새 대여 신청', 'payment_pending': '공급자 승인 · 테스트 결제 대기',
              'confirmed': '테스트 결제 완료 · 예약 확정', 'expired': '신청 또는 결제 기한 만료',
              'canceled': '예약 취소 · 테스트 환불 내역 확인', 'handover': '대여 전 촬영 완료 · 수령 확인 대기',
              'active': '물품 수령 확인', 'checking': '반납 요청 도착', 'complete': '반납 확인 · 정산 내역 확인',
              'rejected': '대여 신청 거절'}
    for record in after:
        old = previous.get(record['id'], {})
        if record.get('lifecycleVersion') != 1 or old.get('status') == record['status']:
            continue
        for actor in (record['renterId'], record['lenderId']):
            key = sha256((record['id'] + ':' + record['status'] + ':' + actor).encode()).hexdigest()
            notices.append({'id': 'n-' + key, 'rentalId': record['id'], 'role': actor, 'createdAt': now,
                            'message': labels.get(record['status'], '거래 상태 변경'), 'read': False})
    return notices


def validate_feedback_update(current, record, actor, now):
    """Validate one party's new review without changing the other party's review."""
    from community_records import can_submit
    side = 'renter' if actor == current['renterId'] else 'lender' if actor == current['lenderId'] else None
    require(side and can_submit(current, side, now), '후기 작성 권한과 기한을 확인해 주세요.')
    entries = record.get('feedback')
    require(isinstance(entries, dict) and set(entries) <= {'renter', 'lender'}, '후기 내용을 확인해 주세요.')
    entry = entries.get(side)
    require(isinstance(entry, dict) and set(entry) == {'rating', 'text'}, '후기 내용을 확인해 주세요.')
    require(type(entry['rating']) is int and 1 <= entry['rating'] <= 5, '별점을 확인해 주세요.')
    text(entry['text'], '후기', 500)
    for other, value in entries.items():
        if other != side:
            require(value == current.get('feedback', {}).get(other), '상대방 후기는 변경할 수 없어요.')
    record['feedback'] = {**current.get('feedback', {}), side: entry}

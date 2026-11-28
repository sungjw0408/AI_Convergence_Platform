import copy
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from rental_lifecycle import DAY, HOUR, execute, advance, timestamp, rental_days, late_fee
from lifecycle_server import Store, make_handler
from http.server import ThreadingHTTPServer
import json
import urllib.request
import urllib.error


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.now = timestamp('2026-11-26T00:00:00Z')
        self.items = [dict(id='item', owner='lender', price=5000, deposit=10000, usedValue=30000)]
        self.records = []
        self.counter = 0

    def call(self, action, actor='renter', **data):
        self.counter += 1
        if action != 'request':
            data.setdefault('rentalId', self.r['id'])
        result = execute(self.records, self.items, actor, action, data, 'request-%08d' % self.counter, self.now, admin=actor == 'admin')
        self.r = result
        return result

    def request(self, start=None, end=None):
        self.r = self.call('request', itemId='item', startAt=start or '2026-11-27T09:00:00+09:00',
                          endAt=end or '2026-11-28T09:00:00+09:00', timeZone='Asia/Seoul')
        return self.r

    def paid(self):
        self.request()
        self.call('approve', 'lender')
        self.call('pay', outcome='success')
        return self.r

    def inspection(self):
        return dict(plan=dict(views=[dict(id='front')], checks=[]), before={'front': {'source': 'capture:00000000-0000-0000-0000-000000000001'}}, after={}, beforeChecks=[], afterChecks=[], beforeNote='')

    def returned(self, after='2026-11-28T08:00:00+09:00'):
        self.paid()
        self.call('handoff', 'lender', inspection=self.inspection())
        self.call('receive')
        record = copy.deepcopy(self.r['inspection'])
        record['after'] = {'front': {'source': 'capture:00000000-0000-0000-0000-000000000002'}}
        self.now = timestamp(after)
        self.call('return', inspection=record)
        return self.r

    def test_24h_fee_and_explicit_zone(self):
        self.assertEqual(rental_days(0, DAY), 1)
        self.assertEqual(rental_days(0, DAY + 1), 2)
        self.request(end='2026-11-28T11:00:00+09:00')
        self.assertEqual(self.r['total'], 10000)
        self.assertEqual(self.r['deposit'], 10000)
        self.assertEqual(self.r['usedValue'], 30000)

    def test_approval_is_not_confirmation_and_failure_retries(self):
        self.request()
        with self.assertRaises(ValueError): self.call('pay', outcome='success')
        self.call('approve', 'lender')
        self.assertEqual(self.r['status'], 'payment_pending')
        self.call('pay', outcome='failure')
        self.assertFalse(self.r['finance']['paid'])
        self.call('pay', outcome='success')
        self.assertEqual(self.r['status'], 'confirmed')
        self.assertEqual(len([e for e in self.r['ledger'] if e['kind'] == 'rental_payment']), 1)

    def test_deadline_boundaries(self):
        self.request()
        advance(self.records, self.now + 12 * HOUR - 1)
        self.assertEqual(self.r['status'], 'pending')
        advance(self.records, self.now + 12 * HOUR)
        self.assertEqual(self.r['status'], 'expired')
        self.assertEqual(self.r['ledger'], [])
        self.records = []; self.request(); self.call('approve', 'lender')
        self.now += HOUR
        with self.assertRaises(ValueError): self.call('pay', outcome='success')
        self.assertEqual(self.r['status'], 'expired')

    def test_receipt_replay_is_idempotent_and_binds_payload(self):
        self.request(); self.call('approve', 'lender')
        data = {'rentalId': self.r['id'], 'outcome': 'success'}
        execute(self.records, self.items, 'renter', 'pay', data, 'same-request-1', self.now)
        length = len(self.r['ledger'])
        execute(self.records, self.items, 'renter', 'pay', data, 'same-request-1', self.now)
        self.assertEqual(len(self.r['ledger']), length)
        with self.assertRaises(ValueError): execute(self.records,self.items,'renter','cancel',{'rentalId':self.r['id']},'same-request-1',self.now)

    def test_hold_conflicts_release_and_endpoint_touching(self):
        first = self.request(); self.call('approve', 'lender')
        with self.assertRaises(ValueError): self.call('request', 'other', itemId='item', startAt='2026-11-27T10:00:00+09:00', endAt='2026-11-28T10:00:00+09:00', timeZone='Asia/Seoul')
        # A pending request can be made before approval; test its approval conflict separately.
        self.now += HOUR
        advance(self.records, self.now)
        second = self.call('request', 'other', itemId='item', startAt='2026-11-27T09:00:00+09:00', endAt='2026-11-28T09:00:00+09:00', timeZone='Asia/Seoul')
        self.call('approve', 'lender')
        self.assertEqual(second['status'], 'payment_pending')
        self.assertEqual(first['status'], 'expired')

    def test_refund_once_and_no_cancel_after_receive(self):
        self.paid(); self.call('cancel')
        amount = sum(e['amount'] for e in self.r['ledger'] if e['kind'].endswith('refund'))
        self.assertEqual(amount, 15000)
        with self.assertRaises(ValueError): self.call('cancel')
        self.records = []; self.paid(); self.call('handoff','lender',inspection=self.inspection()); self.call('receive')
        with self.assertRaises(ValueError): self.call('cancel')

    def test_late_confirmation_uses_first_request_and_calendar(self):
        self.returned('2026-11-28T23:59:00+09:00')
        first = self.r['firstReturnRequestedAt']; self.now += 2 * HOUR
        self.call('complete', 'lender')
        self.assertEqual(self.r['actualReturnedAt'], first)
        self.assertEqual(self.r['finance']['lateDue'], 0)
        self.assertTrue(self.r['finance']['depositReturned'])

    def test_auto_return_after_restart_keeps_late_deposit_hold(self):
        self.returned('2026-11-29T00:01:00+09:00')
        saved = json.loads(json.dumps(self.records))
        advance(saved, self.now + DAY)
        r = saved[0]
        self.assertEqual(r['status'], 'complete')
        self.assertEqual(r['finance']['lateDue'], 5000)
        self.assertTrue(r['finance']['baseSettled'])
        self.assertFalse(r['finance']['depositReturned'])
        self.records = saved; self.r = r; self.now += DAY
        self.call('pay_late', outcome='success')
        self.assertTrue(self.r['finance']['depositReturned'])
        before = len(self.r['ledger']); advance(saved, self.now + DAY)
        self.assertEqual(len(self.r['ledger']), before)

    def test_damage_does_not_block_base_settlement(self):
        self.returned(); self.call('dispute', 'lender', note='흠집 확인 요청')
        self.call('complete', 'lender')
        self.assertTrue(self.r['finance']['baseSettled'])
        self.assertFalse(self.r['finance']['depositReturned'])
        self.assertIn('damage', self.r['finance']['depositHolds'])

    def test_return_time_objection_blocks_auto_completion(self):
        self.returned(); first = self.r['firstReturnRequestedAt']
        self.call('return_objection','lender',note='실제 물품 전달 시각 확인 필요')
        advance(self.records, self.now + DAY * 2)
        self.assertEqual(self.r['status'], 'checking')
        self.now += DAY * 2
        self.call('resolve_objection','admin',note='당사자 기록 확인',returnedAt='2026-11-28T10:00:00+09:00')
        self.assertEqual(self.r['firstReturnRequestedAt'], first)
        self.assertEqual(self.r['objectionHistory'][0]['returnObjection'], '실제 물품 전달 시각 확인 필요')
        self.assertEqual(self.r['objectionHistory'][0]['resolution'], '당사자 기록 확인')
        self.assertFalse(self.r['returnObjection'])
        self.call('complete', 'lender')
        self.assertEqual(self.r['finance']['lateDue'],0)

    def test_reshoot_does_not_reset_return_timer(self):
        self.returned(); first = self.r['firstReturnRequestedAt']; self.now += HOUR
        self.call('reshoot',inspection=self.r['inspection'])
        self.assertEqual(self.r['firstReturnRequestedAt'], first)

    def test_extension_requires_approval_and_payment_and_checks_next_booking(self):
        self.paid(); self.call('handoff','lender',inspection=self.inspection()); self.call('receive')
        old = self.r['endAt']
        self.call('extend',endAt='2026-11-29T09:00:00+09:00')
        self.assertEqual(self.r['endAt'], old)
        with self.assertRaises(ValueError): self.call('pay_extension',outcome='success')
        self.call('approve_extension','lender')
        self.call('pay_extension',outcome='failure')
        self.assertEqual(self.r['endAt'], old)
        self.call('pay_extension',outcome='success')
        self.assertEqual(self.r['endAt'], old + DAY)
        self.assertEqual(self.r['extension']['amount'],5000)
        other = copy.deepcopy(self.r); other.update(id='next',startAt=old+DAY,endAt=old+DAY*2,status='confirmed'); self.records.append(other)
        with self.assertRaises(ValueError): self.call('extend',endAt='2026-11-30T09:00:00+09:00')

    def test_noshow_needs_evidence_delay_and_admin(self):
        self.paid(); appointment = self.r['startAt']
        data = dict(appointmentAt='2026-11-27T09:00:00+09:00',place='역 출구',contactAttempts='전화 2회, 채팅 1회',noTimeChangeAgreed=True)
        self.now = appointment + HOUR//2-1
        with self.assertRaises(ValueError): self.call('report_noshow',**data)
        self.now += 1; self.call('report_noshow',**data)
        with self.assertRaises(ValueError): self.call('confirm_noshow',note='확인')
        self.call('confirm_noshow','admin',note='당사자 기록 확인')
        self.assertEqual(self.r['status'],'canceled')
        self.assertEqual(self.r['noShow']['status'],'confirmed')
        self.assertTrue(self.r['finance']['refunded'])

    def test_compensation_requires_consent_and_additional_payment(self):
        self.returned(); self.call('dispute','lender',note='파손 확인'); self.call('complete','lender')
        self.call('propose_compensation','lender',amount=15000,basis='repair',repairCost=15000,evidence='수리 견적 영수증 내역')
        self.assertFalse(self.r['finance']['depositReturned'])
        self.call('consent_compensation',consent=True,proposalId=self.r['compensationProposal']['id'])
        self.assertEqual(self.r['finance']['compensationDue'],5000)
        self.assertFalse(self.r['finance']['depositReturned'])
        self.call('pay_compensation',outcome='success',proposalId=self.r['compensationProposal']['id'])
        self.assertTrue(self.r['finance']['depositReturned'])
        self.assertEqual(next(e for e in self.r['ledger'] if e['kind']=='deposit_return')['amount'],0)

    def test_used_value_cap_and_unrelated_actor(self):
        self.returned(); self.call('dispute','lender',note='분실 확인')
        with self.assertRaises(ValueError): self.call('propose_compensation','lender',amount=30001,basis='used_value',evidence='중고 가액')
        with self.assertRaises(ValueError): self.call('complete','stranger')

    def test_completed_lifecycle_accepts_both_reviews_without_finance_changes(self):
        from rental_lifecycle import validate_feedback_update
        self.returned(); self.call('complete', 'lender')
        before = copy.deepcopy(self.r['finance'])
        record = copy.deepcopy(self.r)
        record['feedback'] = {'renter': {'rating': 5, 'text': '감사합니다'}}
        validate_feedback_update(self.r, record, 'renter', self.now)
        current = record
        record = copy.deepcopy(current)
        record['feedback'] = {'lender': {'rating': 4, 'text': '잘 사용했어요'}}
        validate_feedback_update(current, record, 'lender', self.now)
        self.assertEqual(set(record['feedback']), {'renter', 'lender'})
        self.assertEqual(record['finance'], before)
        with self.assertRaises(ValueError):
            validate_feedback_update(record, record, 'stranger', self.now)
        with self.assertRaises(ValueError):
            validate_feedback_update(record, record, 'renter', self.now)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'state.sqlite'
        self.now = timestamp('2026-11-26T00:00:00Z')
        self.store = Store(self.path, lambda: self.now)

    def request(self, actor, request_id):
        return self.store.command(actor, {'action':'request','requestId':request_id,'data':{'itemId':'drill','startAt':'2026-11-27T09:00:00+09:00','endAt':'2026-11-28T09:00:00+09:00','timeZone':'Asia/Seoul'}})

    def test_concurrent_approval_and_restart_expiry(self):
        a=self.request('renter','request-aaa'); b=self.request('other','request-bbb')
        def approve(r):
            try:
                self.store.command('lender', {'action':'approve','requestId':'approve-'+r['id'],'data':{'rentalId':r['id']}})
                return True
            except ValueError: return False
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sum(pool.map(approve,[a,b])),1)
        self.now += HOUR
        restarted=Store(self.path,lambda:self.now)
        states=[r['status'] for r in restarted.read()['records']['rentals']]
        self.assertIn('expired',states)
        self.assertIn('pending',states)

    def test_error_rollback_revision_and_expiry_recovery(self):
        r=self.request('renter','request-aaa'); snapshot=self.store.read()
        forged={**r,'status':'confirmed'}
        with self.assertRaises(ValueError): self.store.save({'revision':snapshot['revision'],'changes':[{'collection':'rentals','record':forged}]},'renter')
        self.assertEqual(self.store.read()['records']['rentals'][0]['status'],'pending')
        self.now += 12*HOUR
        with self.assertRaises(ValueError): self.store.command('lender',{'action':'approve','requestId':'approve-aaa','data':{'rentalId':r['id']}})
        self.assertEqual(Store(self.path,lambda:self.now).read()['records']['rentals'][0]['status'],'expired')

    def test_http_csrf_and_actor_and_command(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.store))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        base='http://127.0.0.1:'+str(server.server_port)
        body=json.dumps({'action':'request','requestId':'http-request1','data':{'itemId':'drill','startAt':'2026-11-27T09:00:00+09:00','endAt':'2026-11-28T09:00:00+09:00','timeZone':'Asia/Seoul'}}).encode()
        for headers in ({'Origin':'https://attacker.example','X-Rento-Demo-Actor':'renter'},{}):
            with self.assertRaises(urllib.error.HTTPError) as e: urllib.request.urlopen(urllib.request.Request(base+'/api/rental-lifecycle',data=body,headers=headers))
            self.assertEqual(e.exception.code,403)
            e.exception.close()
        headers={'Origin':base,'X-Rento-Demo-Actor':'renter','Content-Type':'application/json'}
        with urllib.request.urlopen(urllib.request.Request(base+'/api/rental-lifecycle',data=body,headers=headers)) as response:
            self.assertEqual(json.load(response)['rental']['status'],'pending')


if __name__ == '__main__': unittest.main()

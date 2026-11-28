import json
from base64 import b64encode
from io import BytesIO
import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from PIL import Image
from unittest.mock import Mock, patch

from account_records import ForbiddenRecord, authorize_updates, signup_profile, validate_listing, validate_rental, validate_listing_photos
from listing_assistance import suggest_listing
from listing_market_prices import PricePage, _used_reference
from listing_price_advice import suggest_price, validate_price_request
from listing_pricing import deposit_for_value, load_deposit_policy, valid_pricing_context


class ListingSupportTests(unittest.TestCase):
    def test_album_introduction_is_separate_from_required_camera_evidence(self):
        import copy
        plan = {'id':'general','version':1,'views':[{'id':'front','label':'앞면','instruction':'전체가 보이게 촬영','compare':True}], 'checks':[]}
        photo = {'id':'camera-front','origin':'camera','label':'앞면','viewId':'front','source':'data:image/png;base64,AAAA'}
        album = {'id':'album-cover','origin':'album','label':'소개 사진','source':'data:image/png;base64,BBBB'}
        record = {'inspectionPlan':plan,'photos':[photo],'presentationPhotos':[album], 'coverPhotoId':album['id'],'image':album['source']}
        validate_listing_photos(record)
        bad = copy.deepcopy(record);bad['photos'][0]['origin']='album'
        with self.assertRaises(ForbiddenRecord): validate_listing_photos(bad)
        bad = copy.deepcopy(record);bad['presentationPhotos']=[{'id':'missing','photoId':'missing'}]
        with self.assertRaises(ForbiddenRecord): validate_listing_photos(bad)
        record.update(presentationPhotos=[{'id':photo['id'],'photoId':photo['id']}],coverPhotoId=photo['id'],image=photo['source'])
        validate_listing_photos(record)

    def test_default_demo_policy_rounds_and_caps_the_deposit(self):
        policy = load_deposit_policy(None)
        self.assertEqual(policy["version"], "rento-demo-v2")
        self.assertIsNone(policy["minWon"])
        examples = ((5, 2), (20_000, 6_000), (80_000, 24_000),
                    (200_000, 60_000), (600_000, 180_000), (1_000_000, 200_000))
        for value, deposit in examples:
            with self.subTest(value=value):
                self.assertEqual(deposit_for_value({"amountWon": value}, policy), deposit)

    def test_deposit_waits_and_uses_test_policy_caps(self):
        value = {"amountWon": 80_000, "evidence": "비교한 중고 거래", "verification": "pending"}
        self.assertIsNone(deposit_for_value(value, None))
        policy = load_deposit_policy('{"version":"test-only","rateBps":1000,"minWon":2000,"maxWon":7000}')
        self.assertEqual(deposit_for_value(value, policy), 7000)
        self.assertEqual(deposit_for_value({**value, "amountWon": 5007}, policy), 2000)
        self.assertEqual(deposit_for_value({**value, "amountWon": 50005}, policy), 5001)
        with self.assertRaises(ValueError):
            load_deposit_policy('{"version":"incomplete","rateBps":1000}')

    def test_policy_update_cannot_change_confirmed_amounts(self):
        old = {"version": "rento-demo-v1", "rateBps": 3000, "minWon": None, "maxWon": 50_000}
        new = load_deposit_policy(None)
        existing = {"id": "rental", "itemId": "drill", "renterId": "renter", "lenderId": "seller",
                    "start": "2026-11-28", "end": "2026-11-28", "total": 4000, "deposit": 50_000,
                    "createdAt": 1, "status": "confirmed", "depositPolicy": old,
                    "itemValue": {"amountWon": 1_000_000, "evidence": "비교한 중고 거래", "verification": "pending"}}
        canceled = {**existing, "status": "canceled"}
        validate_rental(None, None, "renter", canceled, existing, new)
        with self.assertRaises(ForbiddenRecord):
            validate_rental(None, None, "renter", {**canceled, "deposit": 200_000}, existing, new)
        with self.assertRaises(ForbiddenRecord):
            validate_rental(None, None, "renter", {**canceled, "depositPolicy": new}, existing, new)

    def test_legacy_listing_requires_valuation_for_new_rentals(self):
        legacy = {"id": "drill", "owner": "seller", "title": "드릴", "deposit": 2000}
        root = Mock()
        root.collection.return_value.document.return_value.get.return_value.to_dict.return_value = legacy
        request = {"itemId": "drill", "renterId": "renter", "lenderId": "seller", "status": "pending"}
        with self.assertRaisesRegex(ValueError, "중고 가액"):
            validate_rental(root, None, "renter", request, None, None)
        with self.assertRaisesRegex(ValueError, "중고 가액"):
            validate_rental(root, None, "seller", {**request, "status": "confirmed"}, request, None)

        value = {"amountWon": 80_000, "evidence": "비교한 중고 거래", "verification": "pending"}
        updated = {**legacy, "deposit": None, "itemValue": value}
        self.assertEqual(validate_listing(updated, "seller", legacy, None), updated)
        with self.assertRaises(ForbiddenRecord):
            validate_listing({**updated, "title": "다른 물품"}, "seller", legacy, None)
        with self.assertRaises(ForbiddenRecord):
            validate_listing(updated, "renter", legacy, None)
        with self.assertRaises(ForbiddenRecord):
            validate_listing(updated, "seller", updated, None)

    def test_owner_can_hide_republish_and_delete_legacy_listing(self):
        legacy = {"id": "drill", "owner": "seller", "title": "드릴", "deposit": 2000}
        private = {**legacy, "visibility": "private"}
        public = {**legacy, "visibility": "public"}
        deleted = {**legacy, "visibility": "deleted"}
        for before, after in ((legacy, private), (private, public), (public, deleted)):
            self.assertEqual(validate_listing(after, "seller", before, None), after)
        for before, after, uid in (
            (legacy, private, "renter"),
            (legacy, {**private, "price": 1000}, "seller"),
            (legacy, {**private, "visibility": "reserved"}, "seller"),
            (deleted, public, "seller"),
        ):
            with self.assertRaises(ForbiddenRecord):
                validate_listing(after, uid, before, None)

    def test_owner_can_edit_existing_listing_details_without_replacing_photo_or_valuation(self):
        listing = {"id": "drill", "owner": "seller", "title": "기존 드릴", "price": 1000,
                   "image": "old-catalogue-url", "isDemo": True, "visibility": "private"}
        updated = {**listing, "title": "충전 드릴", "price": 5000}
        self.assertEqual(validate_listing(updated, "seller", listing, None), updated)
        for attempt in ({**updated, "image": ""}, {**updated, "owner": "buyer"},
                        {**updated, "price": -1}, {**updated, "deposit": 3000}):
            with self.assertRaises(ForbiddenRecord):
                validate_listing(attempt, "seller", listing, None)
        with self.assertRaises(ForbiddenRecord):
            validate_listing(updated, "buyer", listing, None)

    def test_edited_period_keeps_future_and_in_progress_reservations(self):
        today = datetime.now(ZoneInfo("Asia/Seoul")).date()
        booked = (today + timedelta(days=2)).isoformat()
        later = (today + timedelta(days=7)).isoformat()
        tomorrow = (today + timedelta(days=1)).isoformat()
        listing = {"id": "drill", "owner": "seller", "title": "기존 드릴"}
        updated = {**listing, "availableFrom": today.isoformat(), "availableTo": later}
        existing = Mock()
        existing.to_dict.return_value = {"status": "confirmed", "start": booked, "end": booked}
        root, transaction = Mock(), Mock()
        with patch("account_records.query", return_value=[existing]) as lookup:
            self.assertEqual(validate_listing(updated, "seller", listing, None, root=root, transaction=transaction), updated)
            lookup.assert_called_once_with(root, "rentals", "itemId", "==", "drill", transaction)
            with self.assertRaisesRegex(ValueError, "거래 날짜"):
                validate_listing({**updated, "availableTo": tomorrow}, "seller", listing, None, root=root, transaction=transaction)
            with self.assertRaisesRegex(ValueError, "시작일과 종료일"):
                validate_listing({**updated, "availableFrom": later, "availableTo": tomorrow},
                                 "seller", listing, None, root=root, transaction=transaction)
        cleared = {**updated, "availableFrom": "", "availableTo": ""}
        self.assertEqual(validate_listing(cleared, "seller", updated, None), cleared)

    def test_hidden_listings_cannot_receive_new_rentals(self):
        root = Mock()
        lookup = root.collection.return_value.document.return_value.get.return_value
        request = {"itemId": "drill", "renterId": "renter", "lenderId": "seller", "status": "pending"}
        for visibility in ("private", "deleted"):
            lookup.to_dict.return_value = {"id": "drill", "owner": "seller", "visibility": visibility}
            with self.assertRaises(ForbiddenRecord):
                validate_rental(root, None, "renter", request, None, None)

    def test_pricing_context_rejects_inconsistent_assumptions(self):
        suggested = {"condition": "사용감 있음", "usageHistory": "월 2회", "purchaseMonth": "2025-12",
                     "expectedRentalDays": 45, "residualValueWon": 30000, "maintenanceCostWon": 12000}
        self.assertTrue(valid_pricing_context(suggested, 80000, "2026-11"))
        self.assertFalse(valid_pricing_context({**suggested, "residualValueWon": 90000}, 80000, "2026-11"))
        self.assertFalse(valid_pricing_context({**suggested, "purchaseMonth": "2027-01"}, 80000, "2026-11"))

    def test_catalogued_projector_uses_same_model_with_or_without_the_model_field(self):
        query = {"kind": "value", "title": "LG 시네빔 HF85JA", "category": "디지털", "condition": "사용감 있음"}
        with patch("listing_price_advice.generate") as model:
            for overrides in ({}, {"modelName": "hf-85ja"}, {"title": "LG 시네빔", "modelName": "HF85JA"},
                              {"category": "생활용품", "condition": "새것에 가까움"}):
                result = suggest_price(validate_price_request({**query, **overrides}), ())
                self.assertEqual(result["match"], "recorded-used")
                self.assertEqual(result["amountWon"], 540_000)
                self.assertEqual(len(result["references"]), 3)
                self.assertEqual(deposit_for_value(result, load_deposit_policy(None)), 162_000)
            model.assert_not_called()

    def test_catalogued_model_does_not_assign_full_item_price_to_accessories_or_conflicting_models(self):
        query = {"kind": "value", "title": "LG 시네빔 HF85JA", "category": "디지털", "condition": "사용감 있음"}
        with patch("listing_price_advice.configured_model", return_value="stub"), \
                patch("listing_price_advice.generate", return_value='{"referenceIds":[]}'):
            for overrides in ({"title": "LG 시네빔 HF85JA 리모컨"}, {"modelName": "HF85LA"}):
                result = suggest_price(validate_price_request({**query, **overrides}), ())
                self.assertEqual(set(result), {"message"})

    def test_market_result_uses_only_a_selected_used_price_for_the_deposit(self):
        query = validate_price_request({"kind": "value", "title": "자브라 스피커폰 Speak2 40",
                                        "category": "디지털", "condition": "사용감 있음"})
        stored = suggest_price(query, ())
        self.assertEqual(stored["match"], "recorded-used")
        self.assertEqual(stored["amountWon"], 120_000)
        self.assertEqual(len(stored["references"]), 1)
        alternate = suggest_price({**query, "title": "자브라 스피커폰", "modelName": "Speak2 40"}, ())
        self.assertEqual(alternate, stored)
        accessory = suggest_price({**query, "title": "자브라 스피커폰 Speak2 40 케이스"},
                                  [{"id": "a", "title": "다른 렌토 판매", "price": 10000}])
        self.assertEqual(set(accessory), {"message"})
        used = [
            {"title": "Jabra Speak2 40", "amountWon": 120_000, "source": "중고나라",
             "url": "https://web.joongna.com/product/1"},
            {"title": "Jabra Speak2 55", "amountWon": 380_000, "source": "중고나라",
             "url": "https://web.joongna.com/product/2"},
        ]
        with patch("listing_price_advice.configured_model", return_value="stub"), \
                patch("listing_price_advice.generate", return_value='{"referenceIds":["ref-0"]}') as generator:
            result = suggest_price(query, (), used)
            self.assertNotIn("120000", generator.call_args.args[0]["messages"][-1]["content"])
        self.assertEqual(result["match"], "web-used")
        self.assertEqual(result["references"], used[:1])
        self.assertEqual(deposit_for_value(result, load_deposit_policy(None)), 36_000)

    def test_market_page_ignores_sold_prices_and_external_links(self):
        offer = {"price": 120000, "priceCurrency": "KRW", "availability": "https://schema.org/InStock",
                 "itemCondition": "https://schema.org/UsedCondition"}
        page = PricePage()
        page.feed('<a href="https://other.example/product/1">외부</a>'
                  '<a href="/product/2">매물</a><a href="/product/2">중복</a>')
        products = [{"@type": "Product", "name": "Speak2 40", "offers": offer},
                    {"@type": "Product", "name": "거래 완료", "offers": {
                        **offer, "price": 100, "availability": "https://schema.org/SoldOut"}}]
        page.feed('<script type="application/ld+json">' + json.dumps({"@graph": products}) + '</script>')
        self.assertEqual(page.links, ["/product/2"])
        with patch("listing_market_prices._load_page", return_value=page):
            self.assertEqual(_used_reference("https://web.joongna.com/product/2")["amountWon"], 120000)

    def test_model_picks_references_and_server_calculates_the_median(self):
        query = validate_price_request({
            "kind": "rate", "title": "충전식 드릴", "category": "공구", "condition": "사용감 있음",
        })
        cases = [
            {"id": "a", "title": "드릴 A", "price": 5000},
            {"id": "b", "title": "드릴 B", "price": 6001},
        ]
        with patch("listing_price_advice.configured_model", return_value="stub"), \
                patch("listing_price_advice.generate", return_value='{"referenceIds":["ref-0","ref-1"]}') as generator:
            result = suggest_price(query, cases)
            self.assertEqual(result["amountWon"], 5501)
            self.assertEqual([ref["url"] for ref in result["references"]], ["#item/a", "#item/b"])
            payload = json.loads(generator.call_args.args[0]["messages"][-1]["content"])
            self.assertNotIn("amountWon", payload["candidates"][0])
            self.assertEqual(payload["item"]["condition"], "사용감 있음")
            generator.return_value = '{"referenceIds":["ref-0","ref-9"]}'
            with self.assertRaises(RuntimeError):
                suggest_price(query, cases)
            generator.return_value = '{"referenceIds":["ref-0"]}'
            self.assertEqual(set(suggest_price(query, cases)), {"message"})
        self.assertEqual(set(suggest_price(query, cases[:1])), {"message"})

    def test_profile_signup_and_edit_validate_and_preserve_photos(self):
        photo_buffer = BytesIO()
        Image.new("RGB", (96, 96), "#37534a").save(photo_buffer, "JPEG")
        photo = "data:image/jpeg;base64," + b64encode(photo_buffer.getvalue()).decode()
        details = {"displayName": " 왕준서 ", "area": "보정동", "photo": photo}
        self.assertEqual(signup_profile(details), {**details, "displayName": "왕준서"})
        for values in ({**details, "area": ["보정동"]}, {**details, "photo": "https://invalid.example/x.jpg"},
                       {**details, "photo": "data:image/jpeg;base64,ZmFrZQ=="}, {**details, "displayName": False}):
            with self.assertRaises(ValueError):
                signup_profile(values)

        root = Mock()
        original = {"id": "renter", "area": "죽전동", "favorites": ["drill"], "displayName": "기존 이름", "photo": photo}
        root.collection.return_value.document.return_value.get.return_value.to_dict.return_value = original
        edit = {"id": "renter", "area": "보정동", "favorites": ["drill"], "displayName": "새 이름"}
        self.assertEqual(authorize_updates(root, None, "renter", [("profiles", edit)]),
                         [("profiles", {**edit, "photo": photo})])
        self.assertEqual(authorize_updates(root, None, "renter", [("profiles", {**edit, "photo": ""})]),
                         [("profiles", {**edit, "photo": ""})])
        with self.assertRaises(ForbiddenRecord):
            authorize_updates(root, None, "somebody-else", [("profiles", edit)])

    def test_profile_preferences_preserve_an_existing_display_name(self):
        root = Mock()
        existing = {"id": "renter", "area": "죽전동", "favorites": [], "displayName": "왕준서"}
        root.collection.return_value.document.return_value.get.return_value.to_dict.return_value = existing
        profile = {"id": "renter", "area": "보정동", "favorites": ["new-item"]}
        self.assertEqual(authorize_updates(root, None, "renter", [("profiles", profile)]),
                         [("profiles", {**profile, "displayName": "왕준서"})])

    def test_demo_rates_are_a_labeled_fallback_and_do_not_mix_with_posted_prices(self):
        criteria = validate_price_request({
            "kind": "rate", "title": "충전식 드릴", "category": "공구", "condition": "사용감 있음",
        })
        samples = [
            {"id": "demo-a", "title": "[시연] 드릴 A", "price": 5000, "isDemo": True},
            {"id": "demo-b", "title": "[시연] 드릴 B", "price": 7000, "isDemo": True},
        ]
        posted = [{"id": "posted-a", "title": "드릴 C", "price": 20000},
                  {"id": "posted-b", "title": "드릴 D", "price": 22000}]
        with patch("listing_price_advice.configured_model", return_value="stub"), \
                patch("listing_price_advice.generate") as generator:
            generator.return_value = '{"referenceIds":["ref-0","ref-1","ref-2"]}'
            demo = suggest_price(criteria, samples + posted[:1])
            self.assertEqual((demo["match"], demo["amountWon"]), ("demo", 6000))
            self.assertTrue(all(ref["source"] == "렌토 · 시연 대여료" for ref in demo["references"]))
            generator.return_value = '{"referenceIds":["ref-0","ref-1","ref-2","ref-3"]}'
            result = suggest_price(criteria, samples + posted)
            self.assertEqual((result["match"], result["amountWon"]), ("similar", 21000))
            self.assertEqual(set(suggest_price({**criteria, "kind": "value"}, samples)), {"message"})

    @patch.dict("os.environ", {"LISTING_AI_MODEL": "test-model"})
    @patch("listing_assistance.generate")
    def test_model_interface_accepts_copy_and_rejects_invented_price_field(self, generate):
        draft = {"category": "공구", "description": "전동드릴을 빌려드려요. [구성품 확인]"}
        generate.return_value = json.dumps(draft)
        self.assertEqual(suggest_listing({"title": "전동드릴"}), {**draft, "source": "ollama", "model": "test-model"})
        generate.return_value = json.dumps({**draft, "price": 5000})
        with self.assertRaises(RuntimeError):
            suggest_listing({"title": "전동드릴"})

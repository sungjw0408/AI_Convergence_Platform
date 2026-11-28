import os
import unittest
from uuid import uuid4

from flask import Flask
from rental_database import COLLECTIONS, register_database


@unittest.skipUnless(os.environ.get("FIRESTORE_EMULATOR_HOST") == "127.0.0.1:8080", "local Firestore emulator required")
class RentalDatabaseTests(unittest.TestCase):
    def setUp(self):
        from google.cloud import firestore
        self.db = firestore.Client(project="demo-rento")
        space = "test-" + uuid4().hex
        self.root = self.db.collection("rentoSpaces").document(space)
        app = Flask(__name__)
        register_database(app, self.db, space)
        self.api = app.test_client()
        self.url = "/api/rental-database"

    def tearDown(self):
        for name in COLLECTIONS:
            for doc in self.root.collection(name).list_documents():
                doc.delete()
        self.root.delete()
        self.db.close()

    def post(self, revision, changes):
        return self.api.post(self.url, json={"revision": revision, "changes": changes})

    def test_round_trip_and_concurrent_revision(self):
        self.assertEqual(self.api.get(self.url).json["revision"], 0)
        changes = [
            {"collection": "listings", "record": {"id": "drill-1", "title": "공구"}},
            {"collection": "rentals", "record": {"id": "r1", "itemId": "drill-1", "inspection": {"regions": [[1, 2, 3, 4]]}}},
            {"collection": "messages", "record": {"id": "m1", "rentalId": "r1", "text": "도착했어요"}},
            {"collection": "notices", "record": {"id": "n1", "rentalId": "r1", "read": False}},
        ]
        # Historical records can be read/updated, but new bookings use lifecycle commands.
        from rental_database import stored_fields
        self.root.collection("rentals").document("r1").set(stored_fields(changes[1]["record"]))
        self.assertEqual(self.post(0, changes).json, {"revision": 1})
        self.assertEqual(self.post(0, [{"collection": "rentals", "record": {"id": "r2"}}]).status_code, 409)
        snapshot = self.api.get(self.url).json
        self.assertEqual(snapshot["revision"], 1)
        for change in changes:
            self.assertEqual(snapshot["records"][change["collection"]], [change["record"]])

    def test_invalid_batch_and_cross_origin_are_rejected(self):
        changes = [{"collection": "rentals", "record": {"id": "r1"}}, {"collection": "other", "record": {"id": "bad"}}]
        self.assertEqual(self.post(0, changes).status_code, 400)
        self.assertEqual(self.api.get(self.url).json["records"]["rentals"], [])
        self.assertEqual(self.api.post(self.url, json={}, headers={"Origin": "https://example.org"}).status_code, 403)
        self.assertEqual(self.api.get(self.url, base_url="http://example.org").status_code, 403)

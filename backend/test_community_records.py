import unittest

from community_records import WEEK, can_submit, public_reviews, reputation


class CommunityTests(unittest.TestCase):
    def setUp(self):
        self.review = {"rating": 4, "text": "약속을 지켰어요"}
        self.rental = {"status": "complete", "completedAt": 500, "lenderId": "a", "renterId": "b",
                       "feedback": {"lender": self.review}}

    def test_blind_and_deadline(self):
        self.assertFalse(can_submit(self.rental, "lender", 501))
        self.assertTrue(can_submit(self.rental, "renter", 500 + WEEK - 1))
        self.assertEqual(public_reviews(self.rental, 500 + WEEK - 1), {})
        self.assertFalse(can_submit(self.rental, "renter", 500 + WEEK))
        self.assertEqual(public_reviews(self.rental, 500 + WEEK), {"lender": self.review})

    def test_both_reviews_attached_to_recipients(self):
        self.rental["feedback"]["renter"] = {"rating": 5, "text": "감사해요"}
        self.assertEqual(len(public_reviews(self.rental, 505)), 2)
        self.assertEqual(reputation([self.rental])["b"], {"completed": 1, "reviews": [self.review]})

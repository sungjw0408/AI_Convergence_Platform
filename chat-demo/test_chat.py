"""Exercise the HTTP API with independent browser-like cookie jars."""
import json
import tempfile
import threading
import unittest
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import server


class ChatTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        old_db = server.DB
        server.DB = Path(temp.name) / "test.sqlite3"
        self.addCleanup(setattr, server, "DB", old_db)
        server.initialize()
        with server.connection() as db:
            salt = b"test-only-salt"
            db.execute("INSERT INTO accounts VALUES (3,'visitor','제삼자',?,?)",
                       (salt, server.password_hash("chat-demo123", salt)))
        self.start()

    def start(self):
        app = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.url = f"http://127.0.0.1:{app.server_port}"
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(app.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(app.shutdown)

    def call(self, browser, path, data=None, status=200):
        request = Request(self.url + path)
        if data is not None:
            request.add_header("Content-Type", "application/json")
            request.data = json.dumps(data).encode()
        try:
            result = browser.open(request, timeout=5)
        except HTTPError as exc:
            result = exc
        with result:
            self.assertEqual(result.code, status)
            return json.load(result)

    def login(self, username):
        browser = build_opener(HTTPCookieProcessor(CookieJar()))
        self.call(browser, "/api/login", {"username": username, "password": "chat-demo123"})
        return browser

    def test_chat_round_trip_and_persistence(self):
        a, b = self.login("renter"), self.login("owner")
        path = "/api/rentals/1/messages"
        request = {"body": "토요일에 빌릴 수 있나요?", "request_id": "duplicate-test-key", "sender_id": 2}
        sent = self.call(a, path, request, 201)
        self.assertEqual(sent, self.call(a, path, request))
        self.call(a, path, dict(request, body="다른 내용"), 409)
        self.assertEqual(self.call(b, path), [sent])
        self.assertEqual(sent["sender_id"], 1)
        reply = self.call(b, path, {"body": "네, 가능해요!", "request_id": "owner-reply-test-key"}, 201)
        self.assertEqual(reply["sender_id"], 2)
        self.assertEqual(self.call(a, path), [sent, reply])
        self.assertEqual(self.call(a, "/api/rentals/2/messages"), [])
        self.start()  # New HTTP server instance, same persisted database.
        self.assertEqual(self.call(self.login("owner"), path), [sent, reply])

    def test_access_validation_and_logout(self):
        outsider = self.login("visitor")
        renter = self.login("renter")
        anonymous = build_opener()
        path = "/api/rentals/1/messages"
        self.call(anonymous, path, status=401)
        self.assertEqual(self.call(outsider, "/api/rentals"), [])
        self.call(outsider, path, status=404)
        payload = {"body": "   ", "request_id": "empty-message-test"}
        self.call(outsider, path, payload, 404)
        self.call(renter, path, payload, 400)
        with server.connection() as db:
            db.execute("UPDATE rentals SET status='pending' WHERE id=1")
        self.call(renter, path, status=404)
        self.call(renter, "/api/logout", {})
        self.call(renter, path, status=401)


if __name__ == "__main__":
    unittest.main()

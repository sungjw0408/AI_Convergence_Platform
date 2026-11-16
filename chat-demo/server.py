"""Local demo: Python 3.10+ and SQLite, no external packages."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get("RENTAL_CHAT_DB", ROOT / "chat.sqlite3"))
TTL = 8 * 3600


@contextmanager
def connection():
    db = sqlite3.connect(DB, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 210_000)


def initialize():
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
          salt BLOB NOT NULL, password_hash BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS rentals (
          id INTEGER PRIMARY KEY, item TEXT NOT NULL,
          renter INTEGER NOT NULL REFERENCES accounts(id),
          owner INTEGER NOT NULL REFERENCES accounts(id),
          status TEXT NOT NULL, CHECK(renter <> owner));
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY, rental_id INTEGER NOT NULL REFERENCES rentals(id),
          sender_id INTEGER NOT NULL REFERENCES accounts(id), body TEXT NOT NULL,
          request_id TEXT NOT NULL, sent_at INTEGER NOT NULL,
          UNIQUE(rental_id, sender_id, request_id));
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash BLOB PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
          expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_rental_order ON messages(rental_id, id);
        """)
        for uid, username, name in [(1, "renter", "대여자 A"), (2, "owner", "소유자 B")]:
            if not db.execute("SELECT 1 FROM accounts WHERE id=?", (uid,)).fetchone():
                salt = secrets.token_bytes(16)
                db.execute("INSERT INTO accounts VALUES (?,?,?,?,?)",
                           (uid, username, name, salt, password_hash("chat-demo123", salt)))
        db.executemany("INSERT OR IGNORE INTO rentals VALUES (?, ?, 1, 2, 'confirmed')",
                       [(1, "2인용 텐트"), (2, "미러리스 카메라")])


def digest(token):
    return hashlib.sha256(token.encode()).digest()


def message(db, rental, sender, key):
    return db.execute(
        "SELECT id,sender_id,body,sent_at FROM messages "
        "WHERE rental_id=? AND sender_id=? AND request_id=?", (rental, sender, key)
    ).fetchone()


class APIError(Exception):
    def __init__(self, status, detail):
        self.status, self.detail = status, detail


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, content_type, cookie=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def reply(self, status, value, cookie=None):
        self.respond(status, json.dumps(value, ensure_ascii=False).encode(),
                     "application/json; charset=utf-8", cookie)

    def payload(self):
        if self.headers.get_content_type() != "application/json":
            raise APIError(415, "JSON 요청만 사용할 수 있어요.")
        try:
            count = int(self.headers.get("Content-Length", "0"))
            if not 0 < count <= 8192:
                raise APIError(413, "요청 크기가 허용 범위를 넘었어요.")
            value = json.loads(self.rfile.read(count))
            if not isinstance(value, dict):
                raise ValueError
            return value
        except ValueError:
            raise APIError(400, "잘못된 요청이에요.") from None

    def token(self):
        cookies = SimpleCookie(self.headers.get("Cookie", ""))
        return cookies["chat_session"].value if "chat_session" in cookies else ""

    def route(self, method, path, db):
        token = self.token()
        if method == "POST" and path == "/api/login":
            data = self.payload()
            username, pw = data.get("username"), data.get("password")
            if not isinstance(username, str) or not isinstance(pw, str) or len(pw) > 128:
                raise APIError(400, "아이디와 비밀번호를 입력해 주세요.")
            account = db.execute("SELECT * FROM accounts WHERE username=?", (username,)).fetchone()
            if not account or not hmac.compare_digest(account["password_hash"], password_hash(pw, account["salt"])):
                raise APIError(401, "아이디 또는 비밀번호가 맞지 않아요.")
            fresh = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE token_hash=? OR expires_at<=?", (digest(token), int(time.time())))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (digest(fresh), account["id"], int(time.time()) + TTL))
            db.commit()
            return self.reply(200, {"id": account["id"], "name": account["name"]},
                              f"chat_session={fresh}; Path=/; HttpOnly; SameSite=Strict; Max-Age={TTL}")
        if method == "POST" and path == "/api/logout":
            self.payload()
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))
            db.commit()
            return self.reply(200, {}, "chat_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
        user = db.execute(
            "SELECT a.id,a.name FROM sessions s JOIN accounts a ON a.id=s.account_id "
            "WHERE token_hash=? AND expires_at>?", (digest(token), int(time.time()))
        ).fetchone()
        if not user:
            raise APIError(401, "로그인이 필요해요.")
        if method == "GET" and path == "/api/me":
            return self.reply(200, dict(user))
        if method == "GET" and path == "/api/rentals":
            rows = db.execute(
                "SELECT r.id,r.item,a.name AS partner FROM rentals r JOIN accounts a "
                "ON a.id=CASE WHEN r.renter=? THEN r.owner ELSE r.renter END "
                "WHERE (r.renter=? OR r.owner=?) AND r.status='confirmed' ORDER BY r.id",
                (user["id"],)*3
            )
            return self.reply(200, [dict(r) for r in rows])
        match = re.fullmatch(r"/api/rentals/([1-9][0-9]{0,17})/messages", path)
        if not match:
            raise APIError(404, "요청한 주소가 없어요.")
        rental = int(match[1])
        if not db.execute(
            "SELECT 1 FROM rentals WHERE id=? AND (renter=? OR owner=?) AND status='confirmed'",
            (rental, user["id"], user["id"])
        ).fetchone():
            raise APIError(404, "채팅을 열 수 없는 거래예요.")
        if method == "GET":
            rows = db.execute(
                "SELECT id,sender_id,body,sent_at FROM messages WHERE rental_id=? ORDER BY id",
                (rental,)
            )
            return self.reply(200, [dict(r) for r in rows])
        data = self.payload()
        body, key = data.get("body"), data.get("request_id")
        if not isinstance(body, str) or not body.strip() or len(body.strip()) > 1000:
            raise APIError(400, "메시지는 1~1,000자로 입력해 주세요.")
        try:
            body = body.strip()
            body.encode("utf-8")
        except UnicodeError:
            raise APIError(400, "저장할 수 없는 문자가 포함돼 있어요.") from None
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9-]{16,64}", key):
            raise APIError(400, "잘못된 메시지 요청 번호예요.")
        cursor = db.execute(
            "INSERT INTO messages(rental_id,sender_id,body,request_id,sent_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(rental_id,sender_id,request_id) DO NOTHING",
            (rental, user["id"], body, key, int(time.time() * 1000))
        )
        saved = message(db, rental, user["id"], key)
        if saved["body"] != body:
            raise APIError(409, "이미 다른 메시지에 사용한 요청 번호예요.")
        db.commit()
        return self.reply(201 if cursor.rowcount else 200, dict(saved))

    def dispatch(self, method):
        path = urlsplit(self.path).path
        static = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript")}
        try:
            if method == "GET" and path in static:
                name, mime = static[path]
                return self.respond(200, (ROOT / name).read_bytes(), mime + "; charset=utf-8")
            with connection() as db:
                return self.route(method, path, db)
        except APIError as exc:
            self.reply(exc.status, {"error": exc.detail})
        except sqlite3.Error as exc:
            self.log_error("database error: %s", exc)
            self.reply(503, {"error": "저장소에 잠시 연결할 수 없어요. 다시 시도해 주세요."})

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")


if __name__ == "__main__":
    initialize()
    port = int(os.environ.get("RENTAL_CHAT_PORT", "8000"))
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        print(f"채팅 데모: http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever()

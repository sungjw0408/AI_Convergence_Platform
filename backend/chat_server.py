"""Run: python backend/chat_server.py --port 8001 (standard library only)."""
import os
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from item_assistant import room_assist

lock = Lock()


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/ai-room":
            self.send_error(404)
            return
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("JSON 요청만 지원해요.")
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + self.headers.get("Host", ""), "https://" + self.headers.get("Host", "")}:
                self.reply(403, {"error": "같은 앱에서만 요청할 수 있어요."})
                return
            count = int(self.headers.get("Content-Length", "0"))
            if not 0 < count <= 160_000:
                raise ValueError("요청 크기가 허용 범위를 벗어났어요.")
            data = json.loads(self.rfile.read(count))
            if not lock.acquire(blocking=False):
                self.reply(429, {"error": "AI가 처리 중이에요. 잠시 후 다시 요청해 주세요."})
                return
            try:
                result = room_assist(data)
            finally:
                lock.release()
            self.reply(200, result)
        except ValueError as error:
            self.reply(400, {"error": str(error)})
        except RuntimeError as error:
            self.log_error("CHAT_AI: %s", error)
            self.reply(503, {"error": str(error)})

    def reply(self, code, result):
        body = json.dumps(result, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8001")))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "frontend"
    handler = partial(Handler, directory=str(root))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"이웃창고 + 채팅 AI: http://{args.host}:{args.port}", flush=True)
        server.serve_forever()

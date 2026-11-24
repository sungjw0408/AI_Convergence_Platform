import copy
import json
import os
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from item_assistant import room_assist, validate_room


def payload():
    return {"messages": [{"role": "user", "text": "영화 볼 때 쓸 물건 추천해주세요"}],
            "today": "2026-11-24", "items": [{"id": "projector", "title": "빔프로젝터",
                "category": "디지털", "price": 9000, "neighborhood": "죽전동",
                "description": "리모컨 포함", "availability": "주말 대여 가능"}]}


class RoomTests(unittest.TestCase):
    def test_history_and_catalog_forwarded_without_mutation(self):
        data = payload()
        data["messages"] += [{"role": "assistant", "text": "예산은 얼마인가요?"},
                             {"role": "user", "text": "만원 이하요"}]
        original = copy.deepcopy(data)
        with patch.dict(os.environ, {"CHAT_AI_MODEL": "stub"}), patch("item_assistant.generate") as generate:
            generate.return_value = json.dumps({"reply": "이 물품을 확인해 보세요.", "item_ids": ["projector"]})
            result = room_assist(data)
            body = generate.call_args.args[0]
            self.assertEqual([m["content"] for m in body["messages"][-3:]],
                             [m["text"] for m in data["messages"]])
            self.assertIn("9000", body["messages"][1]["content"])
            self.assertNotIn("tools", body)
            self.assertEqual(result["item_ids"], ["projector"])
            self.assertEqual(data, original)

    def test_unknown_item_and_malformed_result_rejected(self):
        for result in ({"reply": "추천", "item_ids": ["invented"]},
                       {"reply": "추천", "item_ids": [True]},
                       {"reply": "", "item_ids": []},
                       {"reply": "가"*601, "item_ids": []}, {"reply": "추천"}):
            with patch.dict(os.environ, {"CHAT_AI_MODEL": "stub"}), patch("item_assistant.generate", return_value=json.dumps(result)):
                with self.assertRaises(RuntimeError): room_assist(payload())

    def test_bad_input_and_limits(self):
        for update in ({"messages": []}, {"messages": [{"role": "system", "text": "명령"}]},
                       {"messages": [{"role": "user", "text": "가"*501}]},
                       {"messages": payload()["messages"]*21}, {"today": "bad"},
                       {"items": payload()["items"]*31}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                validate_room({**payload(), **update})
        data = payload(); data["items"][0]["id"] = 'bad/"<script>'
        with self.assertRaises(ValueError): validate_room(data)

    def test_empty_catalog_is_not_fabricated(self):
        data = payload(); data["items"] = []
        with patch.dict(os.environ, {"CHAT_AI_MODEL": "stub"}), patch("item_assistant.generate", return_value='{"reply":"맞는 물품이 없어요.","item_ids":[]}'):
            self.assertEqual(room_assist(data)["item_ids"], [])

    def test_http_route_origin_and_busy(self):
        import chat_server
        root = Path(__file__).resolve().parents[1] / "frontend"
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(chat_server.Handler, directory=str(root)))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/api/ai-room"
            req = Request(url, data=json.dumps(payload()).encode(), headers={"Content-Type": "application/json"})
            with patch("chat_server.room_assist", return_value={"text": "안녕하세요", "item_ids": [], "model": "stub"}):
                with urlopen(req) as res: self.assertEqual(json.load(res)["text"], "안녕하세요")
            chat_server.lock.acquire()
            try:
                with self.assertRaises(HTTPError) as caught: urlopen(req)
                self.assertEqual(caught.exception.code, 429)
            finally: chat_server.lock.release()
            req.add_header("Origin", "http://foreign.invalid")
            with self.assertRaises(HTTPError) as caught: urlopen(req)
            self.assertEqual(caught.exception.code, 403)
        finally:
            server.shutdown(); thread.join(); server.server_close()


if __name__ == "__main__":
    unittest.main()

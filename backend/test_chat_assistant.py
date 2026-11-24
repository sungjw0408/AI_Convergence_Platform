import copy
import json
import os
import unittest
from unittest.mock import patch, MagicMock
from urllib.error import URLError, HTTPError
from io import BytesIO

from chat_assistant import assist, validate, structured_result


def payload():
    return {"mode": "reply", "role": "renter",
            "rental": {"item": "전동드릴", "start": "2026-11-26", "end": "2026-11-27", "status": "confirmed"},
            "messages": [{"sender": "lender", "text": "정문에서 만나는 건 어떠세요?"}]}


def response(text="정확한 시간을 알려주실 수 있을까요?", **extra):
    result = {"done": True, "message": {"content": text}, **extra}
    mock = MagicMock()
    mock.__enter__.return_value.read.return_value = json.dumps(result).encode()
    return mock


class AssistantTests(unittest.TestCase):
    def test_modes_and_input_unchanged(self):
        data = payload()
        for mode in ("summary", "reply", "agreement"):
            data["mode"] = mode
            original = copy.deepcopy(data)
            with patch.dict(os.environ, {"CHAT_AI_MODEL": "test-model"}), patch("urllib.request.build_opener") as build:
                build.return_value.open.return_value = response(json.dumps({
                    "reply": {"reply": "시간을 확인해 주실 수 있나요?"},
                    "summary": {"points": ["공급자가 정문을 제안했어요."]},
                    "agreement": {"cards": [
                        {"label": label, "detail": "미확인", "status": "미확인", "evidence": []}
                        for label in ["시간", "장소", "반납"]]}
                }[mode], ensure_ascii=False))
                result = assist(data)
                self.assertEqual(result["mode"], mode)
                request = build.return_value.open.call_args.args[0]
                self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/chat")
                body = json.loads(request.data)
                self.assertFalse(body["stream"])
                self.assertEqual(body["model"], "test-model")
                self.assertEqual(len(body["messages"]), 2)
                self.assertNotIn("tools", body)
                self.assertEqual(data, original)

    def test_missing_model_and_offline(self):
        with patch.dict(os.environ, {"CHAT_AI_MODEL": ""}):
            with self.assertRaises(RuntimeError):
                assist(payload())
        with patch.dict(os.environ, {"CHAT_AI_MODEL": "test-model"}), patch("urllib.request.build_opener") as build:
            build.return_value.open.side_effect = URLError("offline")
            with self.assertRaises(RuntimeError):
                assist(payload())

    def test_ollama_failure_diagnostics(self):
        cases = [
            (TimeoutError("timed out"), "180초"),
            (URLError(TimeoutError("timed out")), "180초"),
            (URLError("connection refused"), "연결"),
            (HTTPError("http://127.0.0.1:11434/api/chat", 404, "missing", {},
                       BytesIO(b'{"error":"model missing"}')), "모델을 찾지"),
            (HTTPError("http://127.0.0.1:11434/api/chat", 500, "failure", {},
                       BytesIO(b'{"error":"not enough memory"}')), "HTTP 500"),
        ]
        for failure, expected in cases:
            with self.subTest(expected=expected), patch.dict(os.environ, {"CHAT_AI_MODEL": "test"}), patch("urllib.request.build_opener") as build:
                build.return_value.open.side_effect = failure
                with self.assertLogs("chat_assistant", level="ERROR") as logs:
                    with self.assertRaisesRegex(RuntimeError, expected):
                        assist(payload())
                self.assertNotIn("정문", " ".join(logs.output))

    def test_invalid_and_excessive_input(self):
        for key, value in (("messages", []), ("role", "admin"), ("mode", "send"), ("rental", {})):
            data = payload(); data[key] = value
            with self.assertRaises(ValueError): validate(data)
        data = payload(); data["messages"][0]["text"] = " " * 3
        with self.assertRaises(ValueError): validate(data)
        data["messages"] = [{"sender": "renter", "text": "가"*350}] * 100
        with self.assertRaises(ValueError): validate(data)

    def test_output_validation(self):
        for model_response in (response(""), response("가"*351), response("ok", done=False),
                               response("ok", done_reason="length")):
            with patch.dict(os.environ, {"CHAT_AI_MODEL": "test"}), patch("urllib.request.build_opener") as build:
                build.return_value.open.return_value = model_response
                with self.assertRaises(RuntimeError): assist(payload())


    def test_agreement_grounding_and_labels(self):
        _, context = validate(payload())
        cards = [{"label": label, "detail": "미확인", "status": "미확인", "evidence": []}
                 for label in ["시간", "장소", "반납"]]
        cards[1] = {"label": "장소", "detail": "lender가 정문을 제안함", "status": "동의 표현 있음",
                    "evidence": [{"number": 1, "quote": "정문에서 만나는 건 어떠세요?"}]}
        result = structured_result("agreement", json.dumps({"cards": cards}), context)
        self.assertEqual(result["cards"][1]["status"], "미확인")
        self.assertIn("공급자", result["cards"][1]["detail"])
        self.assertEqual(result["cards"][1]["evidence"][0]["speaker"], "공급자")
        cards[1]["evidence"][0]["quote"] = "학교 후문 오후 3시"
        with self.assertRaises(ValueError):
            structured_result("agreement", json.dumps({"cards": cards}), context)

    def test_status_only_detail_preserves_candidate_quotes(self):
        data = payload()
        data["messages"] = [
            {"sender": "renter", "text": "4월 5일 어떤가요"},
            {"sender": "lender", "text": "4월 5일, 4월 8일 괜찮습니다"}]
        _, context = validate(data)
        cards = [{"label": label, "detail": "미확인", "status": "미확인", "evidence": []}
                 for label in ["시간", "장소", "반납"]]
        cards[0].update(status="조율 중", evidence=[
            {"number": i, "quote": row["text"]} for i, row in enumerate(data["messages"], 1)])
        result = structured_result("agreement", json.dumps({"cards": cards}), context)
        self.assertEqual(result["cards"][0]["status"], "조율 중")
        self.assertIn("4월 5일", result["cards"][0]["detail"])
        self.assertIn("4월 8일", result["cards"][0]["detail"])
        self.assertIn("공급자", result["cards"][0]["detail"])
        self.assertNotIn("확정", result["cards"][0]["detail"])
        self.assertEqual(result["cards"][1]["detail"], "대화에서 확인되지 않았어요.")

    def test_json_summary_and_reply(self):
        _, context = validate(payload())
        self.assertEqual(structured_result("reply", '{"reply": "문의 감사합니다."}', context)["text"], "문의 감사합니다.")
        self.assertEqual(structured_result("summary", '{"points": ["renter가 시간을 질문함"]}', context)["text"],
                         "• 대여자가 시간을 질문함")
        with self.assertRaises(ValueError):
            structured_result("agreement", '{"cards": []}', context)


if __name__ == "__main__":
    unittest.main()

class HTTPTests(unittest.TestCase):
    def test_local_server_and_request_errors(self):
        import threading
        from functools import partial
        from http.server import ThreadingHTTPServer
        from pathlib import Path
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        import chat_server

        root = Path(__file__).resolve().parents[1] / "frontend"
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(chat_server.Handler, directory=str(root)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with urlopen(base + "/") as res:
                self.assertIn(b"app.js", res.read())
            req = Request(base + "/api/chat-assistant", data=json.dumps(payload()).encode(),
                          headers={"Content-Type": "application/json"})
            with self.assertRaises(HTTPError) as caught:
                urlopen(req)
            self.assertEqual(caught.exception.code, 404)
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

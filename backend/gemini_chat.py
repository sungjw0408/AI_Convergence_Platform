import json
import os
import time

from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def configured_model():
    if os.environ.get("GEMINI_API_KEY", "").strip():
        return os.environ.get("GEMINI_MODEL", "").strip() or "gemini-3.5-flash-lite"
    return None


def generate(body):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    model = body["model"]

    if not api_key:
        raise RuntimeError("Gemini API 키가 설정되지 않았어요.")

    contents = []
    system_messages = []

    for message in body["messages"]:
        if message["role"] == "system":
            system_messages.append(message["content"])
        else:
            contents.append({
                "role": (
                    "model"
                    if message["role"] == "assistant"
                    else "user"
                ),
                "parts": [{"text": message["content"]}]
            })

    payload = {
        "systemInstruction": {
            "parts": [{"text": "\n".join(system_messages)}]
        },
        "contents": contents,
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
            "responseJsonSchema": body["format"]
        }
    }

    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{model}:generateContent"
    )

    request = Request(
        url,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key
        },
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST"
    )

    for attempt in range(2):
        try:
            with urlopen(request, timeout=60) as response:
                result = json.load(response)

            candidate = result["candidates"][0]

            if candidate.get("finishReason") != "STOP":
                raise ValueError()

            text = "".join(
                part.get("text", "")
                for part in candidate["content"]["parts"]
                if not part.get("thought", False)
            )

            if not text.strip():
                raise ValueError()

            return text

        except HTTPError as error:
            if error.code == 503 and attempt == 0:
                time.sleep(2)
                continue

            hints = {
                400: "AI 요청 형식을 확인해 주세요.",
                401: "Gemini API 키를 확인해 주세요.",
                403: "Gemini API 접근 권한을 확인해 주세요.",
                404: "사용 가능한 AI 모델을 확인해 주세요.",
                429: "AI 사용량 한도를 초과했어요.",
                503: "AI 서버가 혼잡해요. 잠시 후 다시 시도해 주세요."
            }

            raise RuntimeError(
                hints.get(error.code, "Gemini 서버 오류가 발생했어요.")
            ) from None

        except (URLError, OSError, ValueError, KeyError,
                TypeError, IndexError):
            raise RuntimeError(
                "AI 답변을 받을 수 없어요. 다시 시도해 주세요."
            ) from None
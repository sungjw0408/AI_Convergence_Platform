"""Server-side transport for the Rento AI room."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def generate(body):
    payload = {
        "model": body["model"],
        "messages": body["messages"],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "rento_reply", "strict": True,
            "schema": {"type": "object", "additionalProperties": False,
                       "properties": {"reply": {"type": "string"},
                                      "item_ids": {"type": "array", "items": {"type": "string"}}},
                       "required": ["reply", "item_ids"]}}},
        "max_completion_tokens": 1000,
        "store": False,
    }
    request = Request("https://api.openai.com/v1/chat/completions",
                      headers={"Content-Type": "application/json",
                               "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"].strip()},
                      data=json.dumps(payload).encode())
    try:
        with urlopen(request, timeout=60) as response:
            choice = json.load(response)["choices"][0]
        if choice["finish_reason"] != "stop" or not isinstance(choice["message"]["content"], str):
            raise ValueError()
        return choice["message"]["content"]
    except HTTPError as error:
        hints = {401: "서버 API 키를 확인해 주세요.", 429: "API 잔액과 요청 한도를 확인해 주세요."}
        raise RuntimeError(f"OpenAI 오류 {error.code}. " + hints.get(error.code, "서버 설정을 확인해 주세요.")) from None
    except (URLError, OSError, ValueError, KeyError, TypeError, IndexError):
        raise RuntimeError("OpenAI 응답을 받을 수 없어요. 잠시 후 다시 시도해 주세요.") from None

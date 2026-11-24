"""Shared local Ollama transport for the dedicated AI room."""
import json
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request


def generate(body):
    """Shared local Ollama transport; callers validate their own output schema."""
    request = Request("http://127.0.0.1:11434/api/chat",
                      data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    started = time.monotonic()
    try:
        # Ignore proxy environment; this request is always sent to local Ollama.
        from urllib.request import build_opener, ProxyHandler
        with build_opener(ProxyHandler({})).open(request, timeout=180) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise RuntimeError("AI 응답이 너무 길어요. 다시 시도해 주세요.")
        result = json.loads(raw)
        if result.get("done") is not True or result.get("done_reason") == "length":
            raise RuntimeError("AI 결과가 완성되지 않았어요. 대화를 줄여 다시 요청해 주세요.")
        text = result["message"]["content"]
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError()
        return text
    except HTTPError as error:
        # Log only Ollama's error, never the submitted conversation.
        detail = ""
        try:
            detail = str(json.loads(error.read(4096)).get("error", ""))[:500]
        except (ValueError, AttributeError, OSError):
            pass
        logging.getLogger(__name__).error("CHAT_AI Ollama HTTP %s after %.1fs: %s",
            error.code, time.monotonic() - started, detail)
        if error.code == 404:
            raise RuntimeError("Ollama에서 설정한 모델을 찾지 못했어요. ollama list의 모델 이름과 CHAT_AI_MODEL을 확인해 주세요.") from None
        raise RuntimeError(f"Ollama가 HTTP {error.code} 오류를 반환했어요. 서버 창의 CHAT_AI 오류를 확인해 주세요.") from None
    except (URLError, TimeoutError, OSError) as error:
        reason = getattr(error, "reason", error)
        elapsed = time.monotonic() - started
        logging.getLogger(__name__).error("CHAT_AI connection/generation failure after %.1fs: %s", elapsed, reason)
        if isinstance(reason, TimeoutError):
            raise RuntimeError("AI 응답 대기 시간(180초)을 초과했어요. 서버 창의 CHAT_AI 오류를 확인해 주세요.") from None
        raise RuntimeError("로컬 Ollama 연결이 끊겼거나 연결할 수 없어요. 서버 창의 CHAT_AI 오류를 확인해 주세요.") from None
    except (ValueError, KeyError, TypeError):
        raise RuntimeError("AI 결과를 읽을 수 없어요. 다시 요청해 주세요.") from None

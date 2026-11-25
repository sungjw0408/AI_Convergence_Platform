"""Run with python backend/compare_server.py --port 8093 from the repository."""
import argparse
from pathlib import Path
from threading import Lock

from flask import Flask, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge
from item_assistant import room_assist
from photo_compare import compare, load_model, read_photo

app = Flask(__name__, static_folder=str(Path(__file__).resolve().parents[1] / "frontend"), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
inference_lock = Lock()
room_lock = Lock()


@app.get("/")
def home():
    return app.send_static_file("index.html")


@app.post("/api/ai-room")
def ai_room():
    origin = request.headers.get("Origin")
    if origin and origin != request.host_url.rstrip("/"):
        return jsonify(error="같은 앱에서만 요청할 수 있어요."), 403
    if not request.is_json or request.content_length is None or request.content_length > 160_000:
        return jsonify(error="AI 요청 형식이나 크기를 확인해 주세요."), 400
    if not room_lock.acquire(blocking=False):
        return jsonify(error="AI가 처리 중이에요. 잠시 후 다시 보내 주세요."), 429
    try:
        return jsonify(room_assist(request.get_json(silent=True)))
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except RuntimeError as error:
        app.logger.error("AI_ROOM: %s", error)
        return jsonify(error=str(error)), 503
    finally:
        room_lock.release()


@app.post("/api/photo-comparison")
def photo_comparison():
    if "before" not in request.files or "after" not in request.files:
        return jsonify(error="대여 전과 반납 후 사진이 모두 필요해요."), 400
    with inference_lock:
        try:
            before = read_photo(request.files["before"].stream)
            after = read_photo(request.files["after"].stream)
        except ValueError as error:
            return jsonify(error=str(error)), 422
        return jsonify(compare(before, after))


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify(error="두 사진의 크기를 줄여 주세요."), 413


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8093)
    args = parser.parse_args()
    load_model()  # Download on first launch so the app is ready before it accepts photos.
    app.run(host="127.0.0.1", port=args.port, debug=False)

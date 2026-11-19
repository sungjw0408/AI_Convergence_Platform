"""Run with python backend/compare_server.py --port 8093 from the repository."""
import argparse
from pathlib import Path
from threading import Lock

from flask import Flask, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge
from photo_compare import compare, load_model, read_photo

app = Flask(__name__, static_folder=str(Path(__file__).resolve().parents[1] / "frontend"), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
inference_lock = Lock()


@app.get("/")
def home():
    return app.send_static_file("index.html")


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

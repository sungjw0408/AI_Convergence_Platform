"""Run with python backend/compare_server.py --port 8093 from the repository."""
import argparse
import json
import os
from pathlib import Path
from threading import Lock

from flask import Flask, g, jsonify, request
from markupsafe import escape
from werkzeug.exceptions import RequestEntityTooLarge
from rental_database import register_database
from listing_pricing import load_deposit_policy
from listing_assistance import suggest_listing
from listing_price_advice import suggest_price, validate_price_request
from listing_market_prices import market_prices
from item_assistant import room_assist
from photo_compare import compare, load_model, read_photo
from photo_evaluation import run_evaluation

app = Flask(__name__, static_folder=str(Path(__file__).resolve().parents[1] / "frontend"), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
inference_lock = Lock()
room_lock = Lock()
listing_lock = Lock()
deposit_policy = load_deposit_policy(os.environ.get("RENTO_DEPOSIT_POLICY"))
accounts_enabled = bool(os.environ.get("RENTO_FIREBASE_WEB_API_KEY") or os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"))
if accounts_enabled:
    from accounts import configure_accounts
    configure_accounts(app)
database_enabled = register_database(app, account_mode=accounts_enabled, deposit_policy=deposit_policy)


@app.get("/")
@app.get("/index.html")
def home():
    if not database_enabled and deposit_policy is None:
        return app.send_static_file("index.html")
    metadata = []
    if database_enabled:
        mode = "accounts" if accounts_enabled else "firestore"
        metadata.append(f'<meta name="rento-database" content="{mode}">')
    if deposit_policy is not None:
        metadata.append(f'<meta name="rento-deposit-policy" content="{escape(json.dumps(deposit_policy))}">')
    html = (Path(app.static_folder) / "index.html").read_text(encoding="utf-8")
    return html.replace("<head>", "<head>" + "".join(metadata)), {"Cache-Control": "no-store"}


@app.post("/api/listing-assistance")
def listing_assistance():
    origin = request.headers.get("Origin")
    if origin and origin != request.host_url.rstrip("/"):
        return jsonify(error="같은 앱에서만 요청할 수 있어요."), 403
    if not request.is_json or not 0 < (request.content_length or 0) <= 4096:
        return jsonify(error="물품 정보를 확인해 주세요."), 400
    if not listing_lock.acquire(blocking=False):
        return jsonify(error="등록 제안을 처리하고 있어요. 잠시 후 다시 시도해 주세요."), 429
    try:
        return jsonify(suggest_listing(request.get_json(silent=True)))
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except RuntimeError as error:
        return jsonify(error=str(error)), 503
    finally:
        listing_lock.release()


@app.post("/api/listing-price-advice")
def listing_price_advice():
    origin = request.headers.get("Origin")
    if origin and origin != request.host_url.rstrip("/"):
        return jsonify(error="같은 앱에서만 요청할 수 있어요."), 403
    if not request.is_json or not 0 < (request.content_length or 0) <= 4096:
        return jsonify(error="추천 조건을 확인해 주세요."), 400
    if not listing_lock.acquire(blocking=False):
        return jsonify(error="렌토 추천을 처리하고 있어요. 잠시 후 다시 시도해 주세요."), 429
    try:
        criteria = validate_price_request(request.get_json(silent=True))
        if criteria["kind"] == "value":
            return jsonify(suggest_price(criteria, (), market_prices(criteria)))
        load_listings = app.extensions.get("rento_price_listings")
        uid = (getattr(g, "account", None) or {}).get("uid")
        listings = load_listings(criteria["category"], uid) if load_listings else ()
        return jsonify(suggest_price(criteria, listings))
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except RuntimeError as error:
        return jsonify(error=str(error)), 503
    finally:
        listing_lock.release()


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
    method = request.form.get("method", "lpips")
    mode = request.form.get("mode", "pipeline")
    if method not in {"lpips", "pixel"} or mode not in {"pipeline", "model-only"}:
        return jsonify(error="지원하지 않는 비교 방식이에요."), 400
    with inference_lock:
        try:
            before = read_photo(request.files["before"].stream)
            after = read_photo(request.files["after"].stream)
        except ValueError as error:
            return jsonify(error=str(error)), 422
        return jsonify(compare(before, after, method=method, model_only=mode == "model-only"))


@app.post("/api/photo-evaluation")
def photo_evaluation():
    # Nonblocking: repeated tabs must not queue expensive test runs indefinitely.
    if not inference_lock.acquire(blocking=False):
        return jsonify(error="다른 사진을 분석 중이에요. 완료 후 다시 실행해 주세요."), 409
    try:
        return jsonify(run_evaluation())
    finally:
        inference_lock.release()


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify(error="두 사진의 크기를 줄여 주세요."), 413


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8093)
    args = parser.parse_args()
    load_model()  # Download on first launch so the app is ready before it accepts photos.
    app.run(host="127.0.0.1", port=args.port, debug=False)

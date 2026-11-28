"""Firestore persistence for the local, role-switchable team demo."""
import json
import os
import re
from urllib.parse import urlsplit

from flask import abort, g, jsonify, request

COLLECTIONS = (
    "listings",
    "rentals",
    "messages",
    "notices",
    "memberships",
    "inquiries",
)
DOCUMENT_ID = re.compile(r"[a-zA-Z0-9_-]{1,100}")
# Firestore does not allow arrays inside arrays (e.g. LPIPS bounding boxes).
STRUCTURED_FIELDS = ("inspection", "photoAnalysis")


class RevisionConflict(Exception):
    pass


def stored_fields(record):
    fields = dict(record)
    for key in STRUCTURED_FIELDS:
        if key in fields:
            fields[key] = json.dumps(fields[key], separators=(",", ":"), ensure_ascii=False)
    return fields


def app_fields(fields):
    for key in STRUCTURED_FIELDS:
        if key in fields:
            fields[key] = json.loads(fields[key])
    return fields


def validated_changes(data, collections=COLLECTIONS):
    if not isinstance(data, dict) or type(data.get("revision")) is not int or data["revision"] < 0:
        raise ValueError("저장 기준 버전을 확인해 주세요.")
    changes = data.get("changes")
    if not isinstance(changes, list) or not 1 <= len(changes) <= 450:
        raise ValueError("한 번에 저장할 수 있는 변경 건수를 확인해 주세요.")
    updates = []
    for change in changes:
        if not isinstance(change, dict) or change.get("collection") not in collections:
            raise ValueError("지원하지 않는 데이터 종류예요.")
        record = change.get("record")
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not DOCUMENT_ID.fullmatch(record["id"]):
            raise ValueError("문서 ID를 확인해 주세요.")
        if change["collection"] in ("messages", "notices"):
            if not isinstance(record.get("rentalId"), str) or not DOCUMENT_ID.fullmatch(record["rentalId"]):
                raise ValueError("연결된 거래 ID를 확인해 주세요.")
        fields = stored_fields(record)
        if len(json.dumps(fields, ensure_ascii=False).encode()) > 950_000:
            raise ValueError("문서가 너무 커요. 등록 사진의 크기를 줄여 주세요.")
        updates.append((change["collection"], record))
    return updates


def register_database(app, client=None, space=None, account_mode=False):
    project = os.environ.get("RENTO_FIREBASE_PROJECT")
    if client is None and not project:
        return False

    from google.api_core.exceptions import GoogleAPICallError
    from google.cloud import firestore

    if client is None:
        if project.startswith("demo-") and not os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise RuntimeError("demo 프로젝트에는 FIRESTORE_EMULATOR_HOST를 설정하세요.")
        client = firestore.Client(project=project)
    root = client.collection("rentoSpaces").document(space or ("accounts" if account_mode else "team"))
    if account_mode:
        from account_records import ForbiddenRecord, account_documents, authorize_updates
    else:
        ForbiddenRecord = PermissionError

    @firestore.transactional
    def read(transaction, uid, since):
        meta = root.get(transaction=transaction).to_dict() or {}
        if since == meta.get("revision", 0):
            return {"revision": since}
        records = {}
        if uid:
            records = account_documents(root, uid, transaction)
            records["rentals"] = [app_fields(record) for record in records["rentals"]]
        else:
            for name in COLLECTIONS:
                records[name] = [app_fields(doc.to_dict()) for doc in root.collection(name).stream(transaction=transaction)]
        return {"revision": meta.get("revision", 0), "records": records}

    @firestore.transactional
    def commit(transaction, version, updates, uid):
        meta = root.get(transaction=transaction).to_dict() or {}
        if meta.get("revision", 0) != version:
            raise RevisionConflict()
        # Even the role-switchable Firestore demo must not bypass the payment engine.
        for name, record in updates:
            if name != "rentals":
                continue
            current = root.collection(name).document(record["id"]).get(transaction=transaction).to_dict()
            current = app_fields(current) if current else None
            if not current:
                raise ValueError("새 거래는 거래 명령으로 생성해 주세요.")
            if current.get("lifecycleVersion") != 1 and record.get("status") != current.get("status"):
                raise ValueError("기존 날짜 전용 시연 거래는 조회만 가능해요. 새로 신청해 주세요.")
            if record.get("lifecycleVersion") == 1 or (current and current.get("lifecycleVersion") == 1):
                if not current or record.get("lifecycleVersion") != 1:
                    raise ValueError("새 거래는 거래 명령으로 생성해 주세요.")
                allowed = {"inspection", "photoAnalysis", "review", "feedback"}
                if any(record.get(k) != current.get(k) for k in record.keys() | current.keys() if k not in allowed):
                    raise ValueError("거래 상태와 금액은 거래 명령으로만 변경할 수 있어요.")
                old, new = current.get("inspection", {}), record.get("inspection", {})
                if {k: v for k, v in old.items() if k != "results"} != {k: v for k, v in new.items() if k != "results"}:
                    raise ValueError("촬영 기록은 촬영 완료 명령으로 저장해 주세요.")
        if not uid:
            from rental_lifecycle import validate_feedback_update
            for name, record in updates:
                if name == "rentals":
                    current = app_fields(root.collection(name).document(record["id"]).get(transaction=transaction).to_dict())
                    if record.get("feedback") != current.get("feedback"):
                        actor = request.headers.get("X-Rento-Demo-Actor")
                        validate_feedback_update(current, record, actor, int(time.time() * 1000))
        if uid:
            updates = authorize_updates(root, transaction, uid, updates)
        for name, record in updates:
            transaction.set(root.collection(name).document(record["id"]), stored_fields(record))
        transaction.set(root, {"revision": version + 1})
        return version + 1

    # Lifecycle commands share the same root revision as generic record saves.
    # Reading the root before any write serializes competing approvals/payments.
    from rental_lifecycle import advance, execute, lifecycle_notices
    from copy import deepcopy
    import time

    @firestore.transactional
    def lifecycle(transaction, actor=None, body=None, admin=False):
        meta = root.get(transaction=transaction).to_dict() or {}
        rentals = [app_fields(doc.to_dict()) for doc in root.collection("rentals").stream(transaction=transaction)]
        items = [doc.to_dict() for doc in root.collection("listings").stream(transaction=transaction)]
        if not account_mode:
            from lifecycle_server import DEMO_ITEMS
            items = DEMO_ITEMS + items
        old = deepcopy(rentals)
        now = int(time.time() * 1000)
        advance(rentals, now)
        result = None
        if body:
            result = execute(rentals, items, actor, body.get("action"), body.get("data"), body.get("requestId"), now, admin)
        changed = [record for record in rentals if record not in old]
        if changed:
            for notice in lifecycle_notices(old, rentals, now):
                transaction.set(root.collection("notices").document(notice["id"]), notice)
            for record in changed:
                transaction.set(root.collection("rentals").document(record["id"]), stored_fields(record))
            transaction.set(root, {"revision": meta.get("revision", 0) + 1})
        return result

    def lifecycle_access():
        if request.headers.get("Origin") not in (None, request.host_url.rstrip("/")):
            abort(403)
        if account_mode:
            account = getattr(g, "account", None)
            if not account or request.headers.get("X-Rento-Account") != account["uid"]:
                abort(401)
            uid = account["uid"]
            return uid, uid in os.environ.get("RENTO_ADMIN_UIDS", "").split(",")
        if not getattr(g, "rento_team_authenticated", False) and (
            request.remote_addr not in ("127.0.0.1", "::1") or
            urlsplit(request.host_url).hostname not in ("localhost", "127.0.0.1", "::1")
        ):
            abort(403)
        actor = request.headers.get("X-Rento-Demo-Actor")
        if actor not in ("renter", "lender", "admin"):
            abort(403)
        return actor, actor == "admin"

    @app.post("/api/rental-lifecycle")
    def rental_lifecycle():
        actor, admin = lifecycle_access()
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="거래 요청을 확인해 주세요."), 400
        try:
            # A separate committed sweep keeps expired holds released after a rejected command.
            lifecycle(client.transaction())
            record = lifecycle(client.transaction(), actor, body, admin)
            return jsonify(rental=record)
        except (ValueError, TypeError, KeyError) as error:
            return jsonify(error=str(error)), 400
        except GoogleAPICallError:
            return jsonify(error="거래 저장에 실패했어요. 같은 요청으로 다시 시도해 주세요."), 503

    # Timer recovery is independent of an open browser, and repeats after process restart.
    from threading import Event, Thread
    stop = Event()
    def worker():
        while not stop.wait(15):
            try:
                lifecycle(client.transaction())
            except Exception:
                app.logger.exception("Rental lifecycle recovery will retry")
    Thread(target=worker, daemon=True, name="rental-lifecycle").start()
    app.extensions["rento_lifecycle_stop"] = stop

    @app.route("/api/rental-database", methods=["GET", "POST"])
    def rental_database():
        uid = None
        if account_mode:
            account = getattr(g, "account", None)
            if not account or request.headers.get("X-Rento-Account") != account["uid"]:
                return jsonify(error="로그인한 계정이 변경됐어요. 다시 불러와 주세요."), 401
            uid = account["uid"]
        elif not getattr(g, "rento_team_authenticated", False):
            if (
                request.remote_addr not in ("127.0.0.1", "::1")
                or urlsplit(request.host_url).hostname not in ("localhost", "127.0.0.1", "::1")
            ):
                abort(403)
        origin = request.headers.get("Origin")
        if origin and origin != request.host_url.rstrip("/"):
            abort(403)
        try:
            if request.method == "GET":
                lifecycle(client.transaction())
                response = jsonify(read(client.transaction(read_only=True), uid, request.args.get("since", type=int)))
            else:
                if not request.is_json:
                    abort(415)
                data = request.get_json()
                updates = validated_changes(data, COLLECTIONS + ("profiles",) if uid else COLLECTIONS)
                response = jsonify(revision=commit(client.transaction(), data["revision"], updates, uid))
        except ForbiddenRecord as error:
            return jsonify(error=str(error)), 403
        except (ValueError, TypeError) as error:
            return jsonify(error=str(error)), 400
        except RevisionConflict:
            return jsonify(error="다른 창에서 데이터를 변경했어요. 새로고침 후 다시 시도해 주세요."), 409
        except GoogleAPICallError:
            app.logger.exception("Firestore request failed")
            return jsonify(error="Firestore에 연결하지 못했어요. DB 설정과 실행 상태를 확인해 주세요."), 503
        response.headers["Cache-Control"] = "no-store"
        return response

    return True

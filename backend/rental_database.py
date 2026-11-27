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
        if uid:
            updates = authorize_updates(root, transaction, uid, updates)
        for name, record in updates:
            transaction.set(root.collection(name).document(record["id"]), stored_fields(record))
        transaction.set(root, {"revision": version + 1})
        return version + 1

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

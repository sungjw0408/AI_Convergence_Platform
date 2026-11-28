"""Email/password authentication and server-managed Firebase sessions."""
import os
from datetime import timedelta

import firebase_admin
import requests
from firebase_admin import auth, exceptions
from flask import g, jsonify, request
from google.api_core.exceptions import GoogleAPICallError

from account_records import signup_profile

SESSION_NAME = "rento_account"
SESSION_DURATION = timedelta(days=5)
AUTH_ERRORS = {
    "EMAIL_EXISTS": "이미 가입한 이메일이에요. 로그인해 주세요.",
    "WEAK_PASSWORD": "8자 이상 비밀번호를 입력해 주세요.",
    "INVALID_EMAIL": "이메일 주소를 확인해 주세요.",
    "TOO_MANY_ATTEMPTS_TRY_LATER": "잠시 후 다시 시도해 주세요.",
}


def register_accounts(app, project, api_key, emulator):
    firebase = firebase_admin.initialize_app(options={"projectId": project}, name="rento-accounts")
    endpoint = "https://identitytoolkit.googleapis.com"
    if emulator:
        endpoint = f"http://{emulator}/identitytoolkit.googleapis.com"

    @app.before_request
    def authenticate():
        if not request.path.startswith("/api/"):
            return None
        if request.method != "GET" and request.headers.get("Origin") != request.host_url.rstrip("/"):
            return jsonify(error="같은 앱에서만 요청할 수 있어요."), 403
        if request.path.startswith("/api/account/") and request.method == "POST":
            return None
        cookie = request.cookies.get(SESSION_NAME)
        g.account = None
        if cookie:
            try:
                claims = auth.verify_session_cookie(cookie, check_revoked=True, app=firebase)
                g.account = {"uid": claims["uid"], "email": claims.get("email", ""),
                             "displayName": claims.get("name", "")}
            except (auth.InvalidSessionCookieError, auth.UserDisabledError, auth.UserNotFoundError):
                pass
            except exceptions.FirebaseError:
                return jsonify(error="로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."), 503
        if g.account is None and request.path != "/api/account/session":
            return jsonify(error="다시 로그인해 주세요."), 401
        return None

    @app.after_request
    def private_response(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/account/session")
    def current_session():
        return jsonify(account=g.account)

    @app.post("/api/account/<action>")
    def account_action(action):
        if action == "logout":
            response = jsonify(ok=True)
            response.delete_cookie(SESSION_NAME, httponly=True, secure=request.is_secure, samesite="Lax")
            return response
        if action not in ("signup", "login"):
            return jsonify(error="지원하지 않는 계정 요청이에요."), 404
        fields = request.get_json(silent=True)
        max_size = 52_000 if action == "signup" else 4096
        if not isinstance(fields, dict) or (request.content_length or 0) > max_size:
            return jsonify(error="이메일과 비밀번호를 확인해 주세요."), 400
        email, password = fields.get("email"), fields.get("password")
        if not isinstance(email, str) or not isinstance(password, str) or len(email) > 254 or len(password) > 128:
            return jsonify(error="이메일과 비밀번호를 확인해 주세요."), 400
        if action == "signup" and len(password) < 8:
            return jsonify(error="8자 이상 비밀번호를 입력해 주세요."), 400
        profile = None
        if action == "signup" and "profile" in fields:
            try:
                profile = signup_profile(fields["profile"])
            except ValueError as error:
                return jsonify(error=str(error)), 400
        operation = {"signup": "signUp", "login": "signInWithPassword"}[action]
        try:
            result = requests.post(f"{endpoint}/v1/accounts:{operation}", params={"key": api_key},
                                   json={"email": email.strip(), "password": password, "returnSecureToken": True},
                                   timeout=10)
            data = result.json()
            if not result.ok:
                code = data.get("error", {}).get("message", "").split(" : ", 1)[0]
                if code in {"OPERATION_NOT_ALLOWED", "CONFIGURATION_NOT_FOUND"} or result.status_code >= 500:
                    return jsonify(error="로그인 서비스 설정을 확인해 주세요."), 503
                return jsonify(error=AUTH_ERRORS.get(code, "이메일 또는 비밀번호를 확인해 주세요.")), 400
            cookie = auth.create_session_cookie(data["idToken"], expires_in=SESSION_DURATION, app=firebase)
        except (requests.RequestException, exceptions.FirebaseError, KeyError, ValueError) as error:
            app.logger.warning("Firebase could not create a Rento session: %s", type(error).__name__)
            return jsonify(error="로그인 서비스에 연결하지 못했어요."), 503

        profile_saved = True
        if profile is not None:
            try:
                app.extensions["rento_create_profile"](data["localId"], profile)
            except (GoogleAPICallError, KeyError):
                app.logger.warning("Firebase account created but Rento profile could not be saved.")
                profile_saved = False
        response = jsonify(ok=True, profileSaved=profile_saved)
        response.set_cookie(SESSION_NAME, cookie, max_age=int(SESSION_DURATION.total_seconds()),
                            httponly=True, secure=request.is_secure, samesite="Lax")
        return response


def configure_accounts(app):
    key = os.environ.get("RENTO_FIREBASE_WEB_API_KEY")
    emulator = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    if not key and not emulator:
        return False
    project = os.environ.get("RENTO_FIREBASE_PROJECT")
    if not project:
        raise RuntimeError("Firebase Authentication requires RENTO_FIREBASE_PROJECT.")
    if emulator and (not project.startswith("demo-") or not os.environ.get("FIRESTORE_EMULATOR_HOST")):
        raise RuntimeError("Authentication emulator requires a demo project and the Firestore emulator.")
    if not emulator and os.environ.get("FIRESTORE_EMULATOR_HOST"):
        raise RuntimeError("Cloud Authentication requires Cloud Firestore.")
    register_accounts(app, project, key or "demo-key", emulator)

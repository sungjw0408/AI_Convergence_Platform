"""Cloud Run entry point for the team demo."""
import os
from hmac import compare_digest, digest

from flask import g, make_response, request
from itsdangerous import BadData, URLSafeTimedSerializer
from werkzeug.middleware.proxy_fix import ProxyFix


TEAM_COOKIE = "__Host-rento_team"
TEAM_COOKIE_MAX_AGE = 5 * 24 * 60 * 60


def configure_team_access(app, password):
    if len(password) < 24 or not password.isascii() or not password.isalnum():
        raise RuntimeError("RENTO_TEAM_PASSWORD must contain at least 24 ASCII letters or digits.")

    secret = password.encode()
    invite_key = digest(secret, b"rento-team-invite-v1", "sha256").hex().encode()
    sessions = URLSafeTimedSerializer(secret, salt="rento-team-session-v1")

    # Cloud Run terminates TLS and forwards the original scheme.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)

    @app.route("/team", methods=["GET", "POST"])
    def team_access():
        if request.method in ("GET", "HEAD"):
            response = app.send_static_file("team-access.html")
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
            return response

        if not request.is_secure or request.headers.get("Origin") != request.host_url.rstrip("/"):
            return "", 403
        if not request.is_json or not 0 < (request.content_length or 0) <= 256:
            return "", 400
        data = request.get_json(silent=True)
        code = data.get("access") if isinstance(data, dict) else None
        if not isinstance(code, str) or not code.isascii() or not compare_digest(code.encode(), invite_key):
            return "", 403

        response = make_response("", 204)
        response.headers["Cache-Control"] = "no-store"
        response.set_cookie(TEAM_COOKIE, sessions.dumps("team"), max_age=TEAM_COOKIE_MAX_AGE,
                            secure=True, httponly=True, samesite="Lax", path="/")
        return response

    @app.before_request
    def require_team_password():
        if request.endpoint == "team_access":
            return None

        cookie = request.cookies.get(TEAM_COOKIE)
        if cookie:
            try:
                if sessions.loads(cookie, max_age=TEAM_COOKIE_MAX_AGE) == "team":
                    g.rento_team_authenticated = True
                    return None
            except BadData:
                pass

        credentials = request.authorization
        if (
            credentials is not None
            and credentials.type == "basic"
            and credentials.username == "rento"
            and compare_digest((credentials.password or "").encode(), secret)
        ):
            g.rento_team_authenticated = True
            return None

        return "렌토 팀 시연용 비밀번호를 입력하세요.", 401, {
            "WWW-Authenticate": 'Basic realm="Rento team", charset="UTF-8"',
            "Cache-Control": "no-store",
        }


if not os.environ.get("RENTO_FIREBASE_PROJECT") or os.environ.get("FIRESTORE_EMULATOR_HOST") or os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
    raise RuntimeError("Cloud Run requires a Firestore project with the emulator disabled.")

from compare_server import accounts_enabled, app

team_password = os.environ.get("RENTO_TEAM_PASSWORD", "")
if not accounts_enabled or not team_password:
    raise RuntimeError("The team server requires Firebase Authentication and a team password.")
configure_team_access(app, team_password)

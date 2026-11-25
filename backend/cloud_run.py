"""Cloud Run entry point for the team demo."""
import os
from hmac import compare_digest

from flask import g, request
from werkzeug.middleware.proxy_fix import ProxyFix


def configure_team_access(app, password):
    if len(password) < 24 or not password.isascii() or not password.isalnum():
        raise RuntimeError("RENTO_TEAM_PASSWORD must contain at least 24 ASCII letters or digits.")

    # Cloud Run terminates TLS and forwards the original scheme.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)

    @app.before_request
    def require_team_password():
        credentials = request.authorization
        if (
            credentials is not None
            and credentials.type == "basic"
            and credentials.username == "rento"
            and compare_digest((credentials.password or "").encode(), password.encode())
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

if accounts_enabled:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1)
else:
    configure_team_access(app, os.environ.get("RENTO_TEAM_PASSWORD", ""))

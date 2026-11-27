import os
from pathlib import Path


def load_env():
    if os.environ.get('RENTO_SKIP_ENV') == '1':
        return

    env_file = Path(__file__).resolve().parent.parent / ".env"

    if not env_file.exists():
        return

    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and value and not os.environ.get(key):
            os.environ[key] = value


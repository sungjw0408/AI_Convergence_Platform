FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements-*.txt backend/
RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu \
      torch==2.6.0+cpu torchvision==0.21.0+cpu \
    && python -m pip install -r backend/requirements-deploy.txt \
    && python -m pip check

COPY backend/*.py backend/
COPY frontend/index.html frontend/styles.css frontend/
COPY frontend/src frontend/src
COPY frontend/assets frontend/assets

RUN PYTHONPATH=backend python -c "from photo_compare import load_model; load_model()" \
    && chmod -R a+rX backend frontend

USER 65532:65532
WORKDIR /app/backend
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8080} --no-control-socket --workers 1 --threads 4 --timeout 120 cloud_run:app"]

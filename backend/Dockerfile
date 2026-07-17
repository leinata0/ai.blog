FROM ghcr.io/astral-sh/uv:0.11.6 AS uv

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache

RUN groupadd --system appuser \
    && useradd --system --gid appuser --create-home --home-dir /home/appuser appuser \
    && mkdir -p /app/uploads /data \
    && chown appuser:appuser /app /app/uploads /data

COPY --chown=appuser:appuser app/ ./app/

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

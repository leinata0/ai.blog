FROM ghcr.io/astral-sh/uv:0.11.6 AS uv

FROM python:3.11-slim

# APP_ENV 必须显式声明：env.get_app_env() 在缺省时只靠 Render 注入的 RENDER*
# 变量推断生产环境，同一镜像跑在自建 VPS / compose / 预发布上会静默启用
# dev 默认管理员与默认 JWT 密钥。
ENV PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache

RUN groupadd --system appuser \
    && useradd --system --gid appuser --create-home --home-dir /home/appuser appuser \
    && mkdir -p /app/uploads /data \
    && chown appuser:appuser /app /app/uploads /data

# 构建上下文是仓库根（render.yaml dockerContext: .），容器内布局必须镜像仓库布局：
# backend/app/**.py 用 Path(__file__).resolve().parents[N] 反查仓库根来定位
# scripts/config/*.json（cover_art.py、routers/posts.py）与 uploads/（uploads.py）。
# 把 app/ 扁平化拷到 /app 会让这些路径全部解析到 /，封面风格与主题展示规则会静默降级。
COPY --chown=appuser:appuser backend/app/ ./backend/app/
COPY --chown=appuser:appuser scripts/config/ ./scripts/config/

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]

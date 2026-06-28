# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

中文 AI 资讯与专题博客（"AI 资讯观察 / ai.blog"）。前后端分离 + 自动化内容流水线。Canonical host: `https://www.563118077.xyz` — `PUBLIC_SITE_URL`、SEO canonical、RSS、sitemap、前端路由输出必须与该域名一致。

Three independent packages, each with its own dependency manifest and test runner:

| Dir | Stack | Manifest | Deploys to |
|---|---|---|---|
| `frontend/` | React 18 + Vite 5 + Tailwind + React Router 6 | `package.json` | Vercel (static + prerendered HTML) |
| `backend/` | FastAPI + SQLAlchemy 2 + Pydantic 2 (Python 3.11) | `pyproject.toml` | Render (Docker) |
| `scripts/` | Node.js ESM | `package.json` | runs ad-hoc / CI (content pipeline) |

Production services: Neon Postgres (DB), Cloudflare R2 + CDN (images).

## Commands

Backend (uses `uv`; run from repo root):
```bash
uv sync --project backend --extra dev                                    # install
uv run --project backend -- uvicorn app.main:app --app-dir backend --reload  # dev server :8000
uv run --project backend pytest backend/tests                            # all tests
uv run --project backend pytest backend/tests/test_posts_list.py         # single file
uv run --project backend pytest backend/tests/test_posts_list.py::test_name  # single test
```

Frontend (from `frontend/`):
```bash
npm install
npm run dev          # vite dev server :5173
npm run build        # vite build + prerender-public.mjs (SSG) — build fails if prerender fails
npm test             # vitest run (single run, jsdom)
npx vitest run path/to/file.test.jsx   # single test file
```

Scripts (from `scripts/`):
```bash
npm install
npm test                                                      # node --test
node auto-blog.mjs --mode daily-manual --dry-run --max-posts 1   # safe pipeline dry-run
```

Local smoke baseline before pushing: backend `test_settings_stats.py` + `test_posts_list.py`, then `frontend npm run build`, then the auto-blog dry-run above.

> Use external PowerShell 7 or Git Bash for local verification — the Windows integrated shell is occasionally unstable in this repo.

## Architecture

### Backend runtime bootstrap (read before touching startup/DB)
`app/main.py` lifespan calls `bootstrap.initialize_runtime()`. Two flags govern startup behavior:
- **Schema sync** (`ENABLE_STARTUP_SCHEMA_SYNC`): when on, runs `Base.metadata.create_all` + `ensure_schema_compat`. Auto-**disabled** on Render (detected via `RENDER`/`RENDER_SERVICE_ID` env), auto-enabled locally. On Render you bootstrap schema once via `python -m app.bootstrap` or a one-deploy override — the app will raise a clear error on `OperationalError` if schema is missing and sync is off.
- **Seeding** (`AUTO_SEED_ON_EMPTY`): seeds demo data only when `posts` table is empty. Off (`"0"`) in production.

`schema_compat.py` is a hand-rolled migration shim (no Alembic): it `ALTER TABLE`s in missing columns from explicit column maps. When adding a model column, add it to the matching map there or existing-DB rows break.

### Environment config (`app/env.py`)
Production vs dev is decided by `is_production_env()` (`APP_ENV`/`ENVIRONMENT`, or presence of `RENDER*`). In **dev**, secrets read from `DEV_`-prefixed vars (`DEV_SECRET_KEY`, `DEV_ADMIN_USERNAME`, `DEV_ADMIN_PASSWORD`); in **production** the bare names (`SECRET_KEY`, etc.) are required. Tests set the `DEV_` vars (see `backend/tests/conftest.py`). Use `clean_env`/`clean_env_list` rather than `os.environ` directly.

### API surface (`app/routers/`)
Four routers mounted in `main.py`: `posts` (`/api`, public read), `admin` (`/api/admin`, JWT — 50+ endpoints), `home` (`/api/home`), `subscriptions` (`/api/subscriptions`). Plus direct endpoints in `main.py`: `/health`, `/api/public/home-bootstrap` (one-shot home payload), `/proxy-image` (SSRF-guarded, third-party images only), `/feed.xml`, `/sitemap.xml`, `/uploads/{filename}`. Auth is JWT HS256 via `app/auth.py` (`get_current_admin` dependency). Rate limiting via `slowapi`.

### AI provider system (current active work area — branch `admin-ai-model-picker`)
Two-table model in `app/models.py`: `AiProviderSource` (an API service + credentials) → `AiModelInstance` (a model offered by a source, tagged with capabilities like `text_generation`/`image_generation`). `services/ai_provider_manager.py` resolves which model to use per purpose with default/fallback ordering; `services/ai_channels.py` is the older `AiChannelConfig` layer it builds on. Keys are encrypted at rest via `app/encryption.py` (`encrypt_value`/`decrypt_value`). `services/image_generation_jobs.py` runs async admin cover-generation jobs (`admin_image_generation_jobs` table). Runtime no longer falls back to legacy AiChannel config. Long-lived keys still belong in Render env; the admin UI store is for operational switching.

### Content pipeline (`scripts/auto-blog.mjs`, ~3200 lines)
Modes: `daily-auto` / `daily-manual` / `weekly-review` (longer lookback, arXiv enabled, ~9000+ words, sectioned generation). 8 steps: RSS collect (17 feeds, concurrent) + Jina full-text → token-signature topic clustering → topic selection → LLM outline (JSON) → LLM article (one-shot daily / per-section weekly) → quality gate (source count / word count / banned-phrase checks, up to 3 repair passes) → cover image (xAI Grok) → publish to backend API → trigger Vercel refresh. Shared logic in `scripts/lib/` (`blogwatcher.mjs` RSS engine, `quality-gate.mjs`, `cover-art.mjs`, `arxiv.mjs`). Config in `scripts/config/*.json` (RSS feeds, mode params, gate thresholds, brand visual spec). LLM = SiliconFlow/DeepSeek-V3; covers = xAI Grok. Always test pipeline changes with `--dry-run`.

### Frontend data flow & prerender (SSG contract)
`npm run build` runs `scripts/prerender-public.mjs` after `vite build` to emit static HTML for public pages, injecting data into `window.__BLOG_BOOTSTRAP__`. `contexts/SiteContext` reads that injected payload first (SSR-friendly), falling back to API. `api/client.js` is a custom HTTP client with two-layer cache (memory + sessionStorage), request dedup, stale-while-revalidate, and 401→login redirect. The home-bootstrap path has back-compat fallback from the new combined endpoint to older per-section calls — preserve it during rolling deploys so frontend/backend contract skew doesn't break first paint.

### Images & media
First-party images go direct to R2/CDN via frontend `VITE_IMAGE_DIRECT_BASES`; only third-party remote images route through backend `/proxy-image`. Storage layer (`app/storage.py`) is dual-mode: R2 (boto3, S3-compatible) when `R2_*` configured, else local `/uploads`.

## Conventions
- No Alembic — schema evolution goes through `schema_compat.py` column maps (see above).
- Cross-layer features (new API + new page) require synchronized backend + frontend changes; check `models.py` → `schemas.py` → router/service order on the backend.
- Theme/site state lives in `contexts/` (`ThemeContext`, `SiteContext`), not prop drilling.
- Reference docs in `docs/`: `local-bootstrap.md`, `neon-r2-setup.md`, `repo-maintenance.md`.

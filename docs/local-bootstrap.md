# Local Bootstrap

This repo now uses `uv` as the canonical backend toolchain.
Recommended shells for local verification are external `pwsh 7` or Git Bash.
Do not rely on the unstable integrated shell layer when smoke testing this repo on Windows.

## Backend

```powershell
uv sync --project backend --extra dev
uv run --project backend -- uvicorn app.main:app --app-dir backend --reload
```

Run backend tests:

```powershell
uv run --project backend pytest backend/tests
```

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

## Scripts

```powershell
cd scripts
npm install
node auto-blog.mjs --mode daily-manual --dry-run --max-posts 1
```

## Recommended env files

- Backend: copy `backend/.env.example` to `backend/.env`
- Frontend: copy `frontend/.env.example` to `frontend/.env`
- Scripts: copy `scripts/.env.example` to `scripts/.env`

## Local smoke baseline

```powershell
uv sync --project backend --extra dev
uv run --project backend pytest backend/tests/test_settings_stats.py backend/tests/test_posts_list.py
cd frontend
npm install
npm run build
cd ..
node scripts/auto-blog.mjs --mode daily-manual --dry-run --max-posts 1
```

1. Start the backend with `uv run --project backend -- uvicorn app.main:app --app-dir backend --reload`.
2. Start the frontend dev server in `frontend/`.
3. Visit `http://127.0.0.1:8000/api/health` and confirm `{"status":"ok"}`.
4. Visit `http://127.0.0.1:5173/` and confirm the homepage loads weekly card, daily rail, topic pulse, continue reading, and subscription shortcut.
5. Open one article detail page and confirm Markdown renders, code blocks degrade gracefully, and related rails still load.
6. Run `node scripts/auto-blog.mjs --mode daily-manual --dry-run --max-posts 1` with external `pwsh 7` or Git Bash.

# Local Bootstrap

This repo now uses `uv` as the canonical backend toolchain.

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

1. Start the backend with `uv run --project backend -- uvicorn app.main:app --app-dir backend --reload`.
2. Start the frontend dev server in `frontend/`.
3. Visit `http://127.0.0.1:8000/api/health` and confirm `{"status":"ok"}`.
4. Run `node scripts/auto-blog.mjs --mode daily-manual --dry-run --max-posts 1`.
5. Open the admin dashboard and confirm post list loading plus endpoint health.

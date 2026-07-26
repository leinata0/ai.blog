# Neon + Cloudflare R2 Setup

This project uses:

- `Postgres` via `DATABASE_URL` (Neon in production)
- `Cloudflare R2` for blog image uploads
- local `/uploads` **only in development** — production fails closed when R2 is
  incomplete (see [§4 Behavior](#4-behavior))

## 1. Backend env vars

Set these in your Render backend service. `render.yaml` is the source of truth
for which keys exist; values marked `sync: false` must be filled in on Render.

Required:

- `APP_ENV=production` — declared in `render.yaml` and baked into the image.
  Without it, a non-Render host silently falls back to the dev admin account and
  the default JWT secret.
- `DATABASE_URL`
- `SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `PUBLIC_SITE_URL` — canonical host (`https://www.563118077.xyz`). It also seeds
  CORS: with neither `PUBLIC_SITE_URL` nor `ALLOWED_ORIGINS`, `get_allowed_origins()`
  returns an empty list in production and every browser request is blocked.
- `ALLOWED_ORIGINS` — explicit CORS allowlist. `www.` / bare-domain variants are
  expanded automatically.
- `AUTO_SEED_ON_EMPTY=0`
- `ENABLE_STARTUP_SCHEMA_SYNC=0` — Render disables startup schema sync anyway.
  Bootstrap schema once with `python -m app.bootstrap`, or deploy a single time
  with `ENABLE_STARTUP_SCHEMA_SYNC=1` and flip it back.

For Cloudflare R2 (all required in production):

- `R2_ACCOUNT_ID` (or `R2_ENDPOINT`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT`
- `R2_PUBLIC_BASE_URL`
- `R2_REGION=auto`

Commonly needed optional keys: `TURNSTILE_SECRET_KEY` (human verification is
silently skipped when unset), `RESEND_API_KEY` + `EMAIL_FROM` (email verification
and subscription mail), `VERCEL_DEPLOY_HOOK_URL`, `FIELD_ENCRYPTION_KEY`.

Example `DATABASE_URL` for Neon:

```env
DATABASE_URL=postgresql+psycopg://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

The backend also accepts common pasted variants and normalizes them automatically:

- `postgresql://...`
- `postgres://...`
- values pasted with surrounding quotes
- values pasted as `DATABASE_URL=...`

Example `R2_ENDPOINT`:

```env
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
```

Example `R2_PUBLIC_BASE_URL`:

```env
R2_PUBLIC_BASE_URL=https://images.your-domain.com
```

## 2. Frontend env vars

Set these in your Vercel frontend project:

- `PRERENDER_API_BASE` — **required**. Build-time only; `npm run build` runs the
  prerender step after `vite build` and the build fails if it can't reach the
  backend. Set `SKIP_PRERENDER=1` only for an intentional non-SSG build.
- `PUBLIC_SITE_URL` — canonical host, must match the backend value.
- `VITE_IMAGE_PROXY_BASE`
- `VITE_IMAGE_DIRECT_BASES`

```env
PRERENDER_API_BASE=https://api.your-domain.com
PUBLIC_SITE_URL=https://www.your-domain.com
VITE_IMAGE_PROXY_BASE=/proxy-image
VITE_IMAGE_DIRECT_BASES=https://images.your-domain.com
```

> **Do not set a cross-origin `VITE_API_BASE` on Vercel.** `src/api/base.js`
> resolves the browser API base and drops any value whose origin differs from the
> page origin (except on `localhost`/`127.0.0.1`), so a cross-origin value is
> silently ignored and requests fall back to same-origin `/api/*` via the Vercel
> rewrite. `VITE_API_BASE` is for local development only.

`VITE_IMAGE_DIRECT_BASES` lets trusted public R2/CDN image URLs load directly
instead of being proxied through the backend.

## 3. Migration notes

1. Create the Neon database first.
2. Point Render `DATABASE_URL` to Neon.
3. Disable auto-seeding in production with `AUTO_SEED_ON_EMPTY=0`.
4. Create the R2 bucket and bind a public/custom domain.
5. Add the R2 env vars to Render (all of them — a partial set blocks startup).
6. Set `PUBLIC_SITE_URL` and `ALLOWED_ORIGINS` before the first deploy.
7. Redeploy the backend, then bootstrap schema once (see `ENABLE_STARTUP_SCHEMA_SYNC` above).
8. Add `PRERENDER_API_BASE` / `PUBLIC_SITE_URL` / `VITE_IMAGE_DIRECT_BASES` in
   Vercel and redeploy the frontend.

## 4. Behavior

- If R2 env vars are present, `/api/admin/upload` stores images in R2.
- If `R2_PUBLIC_BASE_URL` is set, uploaded image URLs are returned as public URLs.
- **In production/Render an incomplete R2 configuration fails startup.**
  `bootstrap.validate_storage_configuration()` refuses to boot rather than
  quietly writing to an ephemeral disk. Set `ALLOW_EPHEMERAL_UPLOADS=1` only for
  an explicitly accepted emergency deployment where uploads may vanish on restart.
- Falling back to local `/uploads` is development-only behavior (no `R2_*` set and
  not a production environment).
- `/uploads/<filename>` is served by the backend, so local mode works without
  static mount wiring.

# Neon + Cloudflare R2 Setup

This project now supports:

- `Postgres` via `DATABASE_URL`
- `Cloudflare R2` for blog image uploads
- fallback local uploads when R2 is not configured

## 1. Backend env vars

Set these in your Render backend service:

Required:

- `DATABASE_URL`
- `SECRET_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `AUTO_SEED_ON_EMPTY=0`

For Cloudflare R2:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT`
- `R2_PUBLIC_BASE_URL`
- `R2_REGION=auto`

Example `DATABASE_URL` for Neon:

```env
DATABASE_URL=postgresql+psycopg://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

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

- `VITE_API_BASE`
- `VITE_IMAGE_PROXY_BASE`
- `VITE_IMAGE_DIRECT_BASES`

Example:

```env
VITE_API_BASE=https://api.your-domain.com
VITE_IMAGE_PROXY_BASE=https://api.your-domain.com/proxy-image
VITE_IMAGE_DIRECT_BASES=https://images.your-domain.com
```

`VITE_IMAGE_DIRECT_BASES` lets trusted public R2/CDN image URLs load directly instead of being proxied through the backend.

## 3. Migration notes

1. Create the Neon database first.
2. Point Render `DATABASE_URL` to Neon.
3. Disable auto-seeding in production with `AUTO_SEED_ON_EMPTY=0`.
4. Create the R2 bucket and bind a public/custom domain.
5. Add the R2 env vars to Render.
6. Redeploy the backend.
7. Add `VITE_IMAGE_DIRECT_BASES` in Vercel and redeploy the frontend.

## 4. Behavior

- If R2 env vars are present, `/api/admin/upload` stores images in R2.
- If `R2_PUBLIC_BASE_URL` is set, uploaded image URLs are returned as public URLs.
- If R2 is not configured, uploads still fall back to local `/uploads`.
- `/uploads/<filename>` is now served by the backend, so local mode still works without static mount wiring.

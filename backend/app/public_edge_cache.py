"""Small, reversible Vercel-only cache trial for anonymous collection lists.

The frontend config only opts these rewrites in; it deliberately never forces a
TTL over an origin error/private response. Keep the allowlist exact: detail,
search, account and mutation endpoints are outside this trial.
"""

from fastapi import Request

from app.env import clean_env


PUBLIC_COLLECTION_PATHS = frozenset({"/api/discover", "/api/topics", "/api/series"})
EDGE_CACHE_POLICY = "public, max-age=60, stale-while-revalidate=120"
EDGE_CACHE_TAG = "public-collections-trial"


async def public_collection_edge_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path not in PUBLIC_COLLECTION_PATHS:
        return response

    original_policy = response.headers.get("cache-control", "").lower()
    directives = {item.strip().split("=", 1)[0] for item in original_policy.split(",")}
    enabled = clean_env("PUBLIC_EDGE_CACHE_TRIAL", "1").lower() not in {"0", "false", "no", "off"}
    eligible = (
        enabled
        and request.method == "GET"
        and request.headers.get("authorization") is None
        and request.headers.get("cookie") is None
        and request.headers.get("range") is None
        and response.status_code in {200, 304}
        and "set-cookie" not in response.headers
        and "public" in directives
        and not directives.intersection({"private", "no-store", "no-cache"})
        and (response.status_code == 304 or response.headers.get("content-type", "").startswith("application/json"))
    )

    # Only Vercel may store this response. Browsers revalidate, and downstream
    # CDNs (including Cloudflare) receive an explicit no-store instruction.
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate" if eligible else "private, no-store"
    response.headers["CDN-Cache-Control"] = "no-store"
    response.headers["Vercel-CDN-Cache-Control"] = EDGE_CACHE_POLICY if eligible else "no-store"
    if eligible:
        response.headers["Vercel-Cache-Tag"] = EDGE_CACHE_TAG
    return response

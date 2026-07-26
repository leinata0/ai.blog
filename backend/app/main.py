from contextlib import asynccontextmanager
import json
import logging
from time import perf_counter
from urllib.parse import urljoin
from uuid import uuid4
from xml.etree.ElementTree import Element, SubElement, tostring

import anyio
import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from app.env import clean_env, get_allowed_origins, verify_startup_environment

# Runs before `app.auth` is imported, which is the whole point: that module
# resolves SECRET_KEY / ADMIN_USERNAME / ADMIN_PASSWORD at import time and raises
# on the first one it finds missing, so bringing up a fresh deployment cost one
# redeploy per missing variable. This raises once, listing every missing required
# variable together, and warns about the ones that only degrade a feature.
verify_startup_environment()

from app.auth import get_current_admin
from app.bootstrap import (
    check_runtime_readiness,
    env_flag,
    initialize_runtime,
    startup_diagnostics_summary,
)
from app.db import get_db
from app.feed_meta import RSS_SITE_DESCRIPTION, RSS_SITE_TITLE
from app.frontend_refresh import trigger_frontend_refresh_safe
from app.http_cache import build_public_cache_control, public_json_response, public_text_response
from app.models import Post, Series, SiteSettings, Tag
from app.rate_limit import limiter
from app.request_limits import (
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    UPLOAD_BODY_LIMIT_SLACK_BYTES,
    RequestBodySizeLimitMiddleware,
)
from app.routers.admin import (
    fail_orphaned_generation_jobs,
    router as admin_router,
    start_generation_job_sweeper,
    stop_generation_job_sweeper,
)
from app.routers.home import (
    build_home_modules_payload,
    build_lightweight_home_modules_payload,
    router as home_router,
)
from app.routers.posts import build_posts_list_payload, router as posts_router
from app.routers.subscriptions import router as subscriptions_router
from app.routers.users import MAX_AVATAR_SIZE, router as users_router
from app.schemas import HomeBootstrapOut, SiteSettingsOut, SiteSettingsUpdate, StatsOut
from app.site_config import resolve_public_site_url
from app.storage import MAX_UPLOAD_SIZE, get_uploaded_image_bytes
from app.uploads import UPLOADS_URL_PREFIX
from app.url_safety import (
    ALLOWED_IMAGE_CONTENT_TYPES,
    MAX_IMAGE_DOWNLOAD_BYTES,
    MAX_REDIRECTS,
    REDIRECT_STATUSES,
    build_pinned_http_targets,
    sniff_raster_image_content_type,
)

# Same falsy vocabulary as bootstrap.env_flag ("0"/"false"/"no"/"off"), so
# AUTO_SEED_ON_EMPTY=false is not silently read as "seed production".
AUTO_SEED_ON_EMPTY = env_flag("AUTO_SEED_ON_EMPTY", True)
logger = logging.getLogger("blog.public")
REQUEST_ID_HEADER = "X-Request-ID"
READINESS_TIMEOUT_SECONDS = 2.0


@asynccontextmanager
async def lifespan(app):
    initialize_runtime(seed_on_empty=AUTO_SEED_ON_EMPTY)
    # Sweep on boot, then keep sweeping: worker pools are process-local, so a
    # crashed/restarted instance leaves rows behind. The sweep is age-based —
    # a rolling deploy must not fail jobs the *previous* instance is still
    # running.
    fail_orphaned_generation_jobs()
    start_generation_job_sweeper()
    yield
    stop_generation_job_sweeper()
    aclose = getattr(_http_client, "aclose", None)
    if aclose is not None:
        await aclose()


app = FastAPI(title="AI Dev Blog API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def _resolve_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or request.headers.get(REQUEST_ID_HEADER) or str(uuid4())


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = _resolve_request_id(request)
    logger.warning("HTTP exception request_id=%s path=%s method=%s status=%s detail=%s", request_id, request.url.path, request.method, exc.status_code, exc.detail)
    headers = dict(exc.headers or {})
    headers[REQUEST_ID_HEADER] = request_id
    return Response(
        content=json.dumps({"detail": exc.detail, "code": f"http_{exc.status_code}", "request_id": request_id}).encode(),
        status_code=exc.status_code,
        media_type="application/json",
        headers=headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = _resolve_request_id(request)
    logger.exception("Unhandled exception request_id=%s path=%s method=%s", request_id, request.url.path, request.method)
    return Response(
        content=json.dumps({"detail": "Internal server error", "code": "internal_error", "request_id": request_id}).encode(),
        status_code=500,
        media_type="application/json",
        headers={REQUEST_ID_HEADER: request_id},
    )


# Outermost user middleware (Starlette runs the last-added one first), so an
# oversized body is refused before CORS, routing or Starlette's multipart spooling
# get a chance to touch it. The per-handler `read(MAX + 1)` calls stay where they
# are — they are the ones that know the *image* limit; this only bounds what the
# process is willing to accept off the wire at all.
app.add_middleware(
    RequestBodySizeLimitMiddleware,
    default_limit=DEFAULT_MAX_REQUEST_BODY_BYTES,
    upload_limits={
        "/api/admin/upload": MAX_UPLOAD_SIZE + UPLOAD_BODY_LIMIT_SLACK_BYTES,
        "/api/users/me/avatar": MAX_AVATAR_SIZE + UPLOAD_BODY_LIMIT_SLACK_BYTES,
    },
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
    # The frontend is a different origin (Vercel) from the API (Render), so response
    # headers are invisible to JS unless listed here. GET /api/admin/images answers
    # with the media-library page cursor in X-Next-Cursor; without this the admin UI
    # can never read it and pagination silently stops after the first page.
    expose_headers=["X-Next-Cursor", REQUEST_ID_HEADER],
)

app.include_router(posts_router)
app.include_router(admin_router)
app.include_router(home_router)
app.include_router(subscriptions_router)
app.include_router(users_router)


def build_settings_payload(db: Session) -> dict:
    settings = db.query(SiteSettings).first()
    return {
        "author_name": settings.author_name,
        "bio": settings.bio,
        "avatar_url": settings.avatar_url,
        "hero_image": settings.hero_image,
        "github_link": settings.github_link,
        "announcement": settings.announcement,
        "site_url": settings.site_url,
        "friend_links": settings.friend_links,
    }


def build_stats_payload(db: Session) -> dict:
    # /api/stats is public (rendered in the reader sidebar), so it must count the
    # same universe the public endpoints expose. Counting every row leaked the
    # number of unpublished drafts and, once /api/tags started excluding drafts,
    # made the sidebar disagree with the tag cloud it sits next to.
    post_count = db.query(func.count(Post.id)).filter(Post.is_published == True).scalar()
    tag_count = (
        db.query(func.count(func.distinct(Tag.id)))
        .join(Tag.posts)
        .filter(Post.is_published == True)
        .scalar()
    )
    series_count = db.query(func.count(Series.id)).scalar()
    return {
        "post_count": post_count,
        "tag_count": tag_count,
        "series_count": series_count,
    }


@app.middleware("http")
async def log_public_request_timing(request: Request, call_next):
    request_id = _resolve_request_id(request)
    request.state.request_id = request_id
    started_at = perf_counter()
    response = await call_next(request)
    elapsed_ms = (perf_counter() - started_at) * 1000
    response.headers.setdefault(REQUEST_ID_HEADER, request_id)

    if request.method == "GET" and (
        request.url.path in {"/feed.xml", "/sitemap.xml"}
        or request.url.path.startswith("/api/")
    ):
        response.headers.setdefault("Server-Timing", f"app;dur={elapsed_ms:.1f}")
        logger.info(
            "public_request request_id=%s path=%s status=%s duration_ms=%.1f",
            request_id,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )

    return response


@app.get("/livez")
@app.get("/health")
@app.get("/api/health")
def livez():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    try:
        with anyio.fail_after(READINESS_TIMEOUT_SECONDS):
            await anyio.to_thread.run_sync(check_runtime_readiness, abandon_on_cancel=True)
    except TimeoutError:
        logger.warning("Readiness check timed out after %.1f seconds", READINESS_TIMEOUT_SECONDS)
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    except Exception:
        logger.exception("Readiness check failed")
        return JSONResponse(status_code=503, content={"status": "not_ready"})

    # `checks` is a cached startup snapshot, so it costs nothing per poll and
    # never changes the status code: a non-UTC session timezone, a plaintext API
    # key or a feature switched off by a missing variable are all warnings about
    # a *serving* app. Failing Render's healthCheckPath over them would take the
    # site down to report a warning.
    return {"status": "ready", "checks": startup_diagnostics_summary()}


@app.get(f"{UPLOADS_URL_PREFIX}/{{filename:path}}")
def serve_uploaded_file(filename: str):
    try:
        content, content_type = get_uploaded_image_bytes(filename)
    except ValueError:
        return Response(status_code=400, content="Invalid filename")
    except FileNotFoundError:
        return Response(status_code=404, content="File not found")

    return Response(
        content=content,
        media_type=content_type or "application/octet-stream",
        headers={
            "Cache-Control": build_public_cache_control(max_age=86400, s_maxage=86400, stale_while_revalidate=604800),
            "Vary": "Accept-Encoding",
            # Same hardening as /proxy-image: never let a browser sniff a stored
            # object into an active content type.
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/api/settings", response_model=SiteSettingsOut)
def get_settings(request: Request, db: Session = Depends(get_db)):
    return public_json_response(
        request,
        build_settings_payload(db),
        cache_control=build_public_cache_control(max_age=120, s_maxage=600, stale_while_revalidate=1800),
    )


@app.put("/api/settings", response_model=SiteSettingsOut)
def update_settings(
    body: SiteSettingsUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    settings = db.query(SiteSettings).first()
    for field in (
        "author_name",
        "bio",
        "avatar_url",
        "hero_image",
        "github_link",
        "announcement",
        "site_url",
        "friend_links",
    ):
        value = getattr(body, field)
        if value is not None:
            setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    trigger_frontend_refresh_safe(event="settings.updated")
    return {
        "author_name": settings.author_name,
        "bio": settings.bio,
        "avatar_url": settings.avatar_url,
        "hero_image": settings.hero_image,
        "github_link": settings.github_link,
        "announcement": settings.announcement,
        "site_url": settings.site_url,
        "friend_links": settings.friend_links,
    }


@app.get("/api/stats", response_model=StatsOut)
def get_stats(request: Request, db: Session = Depends(get_db)):
    return public_json_response(
        request,
        build_stats_payload(db),
        cache_control=build_public_cache_control(max_age=120, s_maxage=600, stale_while_revalidate=1800),
    )


@app.get("/api/public/home-bootstrap", response_model=HomeBootstrapOut)
def get_public_home_bootstrap(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    include_modules: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    settings_payload = build_settings_payload(db)
    payload = {
        "settings": settings_payload,
        "home_modules": (
            build_home_modules_payload(db)
            if include_modules
            else build_lightweight_home_modules_payload(settings_payload)
        ),
        "posts": build_posts_list_payload(db, page=page, page_size=page_size),
    }
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900),
    )


_http_client = httpx.AsyncClient(
    follow_redirects=False,
    timeout=15.0,
    # Pinned URLs use the destination IP as the pool origin. Do not reuse a TLS
    # connection for a different hostname that happens to share that CDN IP,
    # because its established SNI/certificate context belongs to the first host.
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=0),
    headers={"User-Agent": "BlogImageProxy/1.0"},
    # Outbound image requests are DNS-pinned below; do not silently route them
    # through process-level proxy variables that would replace the verified
    # destination with an unverifiable intermediary.
    trust_env=False,
)

# Raster only — SVG can carry active content when navigated directly.
ALLOWED_CONTENT_TYPES = set(ALLOWED_IMAGE_CONTENT_TYPES)
MAX_PROXY_IMAGE_BYTES = MAX_IMAGE_DOWNLOAD_BYTES
PROXY_REDIRECT_STATUSES = set(REDIRECT_STATUSES)
MAX_PROXY_REDIRECTS = MAX_REDIRECTS


# Thin wrapper kept for tests that replace DNS resolution with deterministic
# public targets. Each returned fetch URL contains a literal, already-validated
# public IP and preserves the original Host/SNI separately.
def _resolve_proxy_targets(url: str):
    return build_pinned_http_targets(url)


@app.get("/proxy-image")
@limiter.limit("30/minute")
async def proxy_image(request: Request, url: str = Query(..., min_length=8)):
    current_url = url
    for redirect_count in range(MAX_PROXY_REDIRECTS + 1):
        targets = await anyio.to_thread.run_sync(_resolve_proxy_targets, current_url)
        if not targets:
            return Response(status_code=400, content="Invalid URL")
        redirect_url = None
        for target in targets:
            try:
                extensions = (
                    {"sni_hostname": target.sni_hostname} if target.sni_hostname else None
                )
                async with _http_client.stream(
                    "GET",
                    target.fetch_url,
                    headers={"Host": target.host_header},
                    extensions=extensions,
                ) as resp:
                    if resp.status_code in PROXY_REDIRECT_STATUSES:
                        if redirect_count >= MAX_PROXY_REDIRECTS:
                            return Response(status_code=502, content="Upstream image unavailable")
                        location = resp.headers.get("location", "").strip()
                        if not location:
                            return Response(status_code=502, content="Upstream image unavailable")
                        # Resolve relative redirects against the logical URL, not
                        # the pinned-IP transport URL.
                        redirect_url = urljoin(current_url, location)
                        break

                    content_type = (
                        resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    )
                    content_length = resp.headers.get("content-length")
                    if content_length:
                        try:
                            if int(content_length) > MAX_PROXY_IMAGE_BYTES:
                                return Response(status_code=502, content="Upstream image too large")
                        except ValueError:
                            return Response(status_code=502, content="Upstream image unavailable")
                    if resp.status_code != 200 or content_type not in ALLOWED_CONTENT_TYPES | {
                        "",
                        "application/octet-stream",
                    }:
                        return Response(status_code=502, content="Upstream image unavailable")

                    chunks = []
                    total = 0
                    async for chunk in resp.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_PROXY_IMAGE_BYTES:
                            return Response(status_code=502, content="Upstream image too large")
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    detected_type = sniff_raster_image_content_type(body)
                    if detected_type is None:
                        return Response(status_code=502, content="Upstream image unavailable")
                    return Response(
                        content=body,
                        media_type=detected_type,
                        headers={
                            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                            "Access-Control-Allow-Origin": "*",
                            "X-Content-Type-Options": "nosniff",
                        },
                    )
            except httpx.HTTPError:
                # A hostname may have multiple public A/AAAA answers. Try the
                # next pinned address before treating the upstream as down.
                continue
            except Exception:
                logger.exception("proxy image fetch failed", extra={"target_host": target.host_header})
                return Response(status_code=502, content="Failed to fetch image")
        if redirect_url is not None:
            current_url = redirect_url
            continue
        return Response(status_code=502, content="Failed to fetch image")
    return Response(status_code=502, content="Upstream image unavailable")


@app.get("/feed.xml")
def rss_feed(request: Request, db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
        .options(load_only(Post.title, Post.slug, Post.summary, Post.created_at))
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
        .limit(20)
    ).scalars().all()

    rss = Element("rss", version="2.0")
    channel = SubElement(rss, "channel")
    SubElement(channel, "title").text = RSS_SITE_TITLE
    SubElement(channel, "link").text = site_url
    SubElement(channel, "description").text = RSS_SITE_DESCRIPTION
    SubElement(channel, "language").text = "zh-CN"

    for post in posts:
        item = SubElement(channel, "item")
        SubElement(item, "title").text = post.title
        SubElement(item, "link").text = f"{site_url}/posts/{post.slug}"
        SubElement(item, "description").text = post.summary
        SubElement(item, "guid").text = f"{site_url}/posts/{post.slug}"
        if post.created_at:
            SubElement(item, "pubDate").text = post.created_at.strftime("%a, %d %b %Y %H:%M:%S +0000")

    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(rss, encoding="unicode")
    last_modified = posts[0].created_at if posts else None
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )


@app.get("/sitemap.xml")
def sitemap(request: Request, db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
        .options(load_only(Post.slug, Post.updated_at, Post.created_at))
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
    ).scalars().all()

    urlset = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    homepage = SubElement(urlset, "url")
    SubElement(homepage, "loc").text = site_url
    SubElement(homepage, "changefreq").text = "daily"
    SubElement(homepage, "priority").text = "1.0"

    for post in posts:
        url_el = SubElement(urlset, "url")
        SubElement(url_el, "loc").text = f"{site_url}/posts/{post.slug}"
        if post.updated_at:
            SubElement(url_el, "lastmod").text = post.updated_at.strftime("%Y-%m-%d")
        SubElement(url_el, "changefreq").text = "weekly"
        SubElement(url_el, "priority").text = "0.8"
    latest_modified = None
    for post in posts:
        candidate = post.updated_at or post.created_at
        if candidate is None:
            continue
        if latest_modified is None or candidate > latest_modified:
            latest_modified = candidate

    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(urlset, encoding="unicode")
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=latest_modified,
    )

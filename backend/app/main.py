from contextlib import asynccontextmanager
import ipaddress
import logging
import socket
from time import perf_counter
from urllib.parse import urlparse
from xml.etree.ElementTree import Element, SubElement, tostring

import httpx
from fastapi import Depends, FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from app.auth import get_current_admin
from app.bootstrap import initialize_runtime
from app.db import get_db
from app.env import clean_env, get_allowed_origins
from app.feed_meta import RSS_SITE_DESCRIPTION, RSS_SITE_TITLE
from app.frontend_refresh import trigger_frontend_refresh_safe
from app.http_cache import build_public_cache_control, public_json_response, public_text_response
from app.models import Post, Series, SiteSettings, Tag
from app.routers.admin import router as admin_router
from app.routers.home import build_home_modules_payload, router as home_router
from app.routers.posts import build_posts_list_payload, router as posts_router
from app.routers.subscriptions import router as subscriptions_router
from app.schemas import HomeBootstrapOut, SiteSettingsOut, SiteSettingsUpdate, StatsOut
from app.site_config import resolve_public_site_url
from app.storage import get_uploaded_image_bytes
from app.uploads import UPLOADS_URL_PREFIX

AUTO_SEED_ON_EMPTY = clean_env("AUTO_SEED_ON_EMPTY", "1") != "0"
logger = logging.getLogger("blog.public")


@asynccontextmanager
async def lifespan(app):
    initialize_runtime(seed_on_empty=AUTO_SEED_ON_EMPTY)
    yield


app = FastAPI(title="AI Dev Blog API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(posts_router)
app.include_router(admin_router)
app.include_router(home_router)
app.include_router(subscriptions_router)


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
    post_count = db.query(func.count(Post.id)).scalar()
    tag_count = db.query(func.count(Tag.id)).scalar()
    series_count = db.query(func.count(Series.id)).scalar()
    return {
        "post_count": post_count,
        "tag_count": tag_count,
        "series_count": series_count,
    }


@app.middleware("http")
async def log_public_request_timing(request: Request, call_next):
    started_at = perf_counter()
    response = await call_next(request)
    elapsed_ms = (perf_counter() - started_at) * 1000

    if request.method == "GET" and (
        request.url.path in {"/feed.xml", "/sitemap.xml"}
        or request.url.path.startswith("/api/")
    ):
        response.headers.setdefault("Server-Timing", f"app;dur={elapsed_ms:.1f}")
        logger.info(
            "public_request path=%s status=%s duration_ms=%.1f",
            request.url.path,
            response.status_code,
            elapsed_ms,
        )

    return response


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok"}


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
    db: Session = Depends(get_db),
):
    payload = {
        "settings": build_settings_payload(db),
        "home_modules": build_home_modules_payload(db),
        "posts": build_posts_list_payload(db, page=page, page_size=page_size),
    }
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900),
    )


_http_client = httpx.AsyncClient(
    follow_redirects=True,
    timeout=15.0,
    limits=httpx.Limits(max_connections=20),
    headers={"User-Agent": "BlogImageProxy/1.0"},
)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}
MAX_PROXY_IMAGE_BYTES = 5 * 1024 * 1024


def _is_private_hostname(hostname: str) -> bool:
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return True

    for address in addresses:
        ip_value = address[4][0]
        try:
            ip = ipaddress.ip_address(ip_value)
        except ValueError:
            return True
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
            return True
    return False


@app.get("/proxy-image")
async def proxy_image(url: str = Query(..., min_length=8)):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return Response(status_code=400, content="Invalid URL")
    if _is_private_hostname(parsed.hostname):
        return Response(status_code=400, content="Invalid URL")
    try:
        async with _http_client.stream("GET", url) as resp:
            content_type = resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            content_length = resp.headers.get("content-length")
            if content_length and int(content_length) > MAX_PROXY_IMAGE_BYTES:
                return Response(status_code=502, content="Upstream image too large")
            if resp.status_code != 200 or content_type not in ALLOWED_CONTENT_TYPES:
                return Response(status_code=502, content="Upstream image unavailable")

            chunks = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > MAX_PROXY_IMAGE_BYTES:
                    return Response(status_code=502, content="Upstream image too large")
                chunks.append(chunk)
            return Response(
                content=b"".join(chunks),
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except Exception:
        return Response(status_code=502, content="Failed to fetch image")


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

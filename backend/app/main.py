from contextlib import asynccontextmanager
from xml.etree.ElementTree import Element, SubElement, tostring

import httpx
from fastapi import Depends, FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.bootstrap import initialize_runtime
from app.db import get_db
from app.env import clean_env, get_allowed_origins
from app.feed_meta import RSS_SITE_DESCRIPTION, RSS_SITE_TITLE
from app.models import Post, SiteSettings, Tag
from app.routers.admin import router as admin_router
from app.routers.posts import router as posts_router
from app.routers.subscriptions import router as subscriptions_router
from app.schemas import SiteSettingsOut, SiteSettingsUpdate, StatsOut
from app.site_config import resolve_public_site_url
from app.storage import get_uploaded_image_bytes
from app.uploads import UPLOADS_URL_PREFIX

AUTO_SEED_ON_EMPTY = clean_env("AUTO_SEED_ON_EMPTY", "1") != "0"


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
app.include_router(subscriptions_router)


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
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/settings", response_model=SiteSettingsOut)
def get_settings(db: Session = Depends(get_db)):
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
def get_stats(db: Session = Depends(get_db)):
    post_count = db.query(func.count(Post.id)).scalar()
    tag_count = db.query(func.count(Tag.id)).scalar()
    return {
        "post_count": post_count,
        "tag_count": tag_count,
    }


_http_client = httpx.AsyncClient(
    follow_redirects=True,
    timeout=15.0,
    limits=httpx.Limits(max_connections=20),
    headers={"User-Agent": "BlogImageProxy/1.0"},
)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}


@app.get("/proxy-image")
async def proxy_image(url: str = Query(..., min_length=8)):
    if not url.startswith(("http://", "https://")):
        return Response(status_code=400, content="Invalid URL")
    try:
        resp = await _http_client.get(url)
        content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        if resp.status_code != 200 or content_type not in ALLOWED_CONTENT_TYPES:
            return Response(status_code=502, content="Upstream image unavailable")
        return Response(
            content=resp.content,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400",
                "Access-Control-Allow-Origin": "*",
            },
        )
    except Exception:
        return Response(status_code=502, content="Failed to fetch image")


@app.get("/feed.xml")
def rss_feed(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
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
    return Response(content=xml_str, media_type="application/xml")


@app.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post).where(Post.is_published == True).order_by(Post.created_at.desc())
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

    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(urlset, encoding="unicode")
    return Response(content=xml_str, media_type="application/xml")

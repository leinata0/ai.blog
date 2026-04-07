from contextlib import asynccontextmanager
from xml.etree.ElementTree import Element, SubElement, tostring

from fastapi import Depends, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.db import Base, SessionLocal, engine, get_db
from app.models import Post, Tag, Comment, SiteSettings
from app.routers.posts import router as posts_router
from app.routers.admin import router as admin_router
from app.schemas import SiteSettingsOut, SiteSettingsUpdate, StatsOut
from app.seed import seed_data
from app.uploads import UPLOADS_URL_PREFIX, get_uploads_dir


@asynccontextmanager
async def lifespan(app):
    get_uploads_dir().mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        if db.query(Post).count() == 0:
            seed_data(db)
        if db.query(SiteSettings).count() == 0:
            db.add(SiteSettings(id=1))
            db.commit()
    yield


app = FastAPI(title="AI Dev Blog API", lifespan=lifespan)

get_uploads_dir().mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://563118077.xyz",
        "https://www.563118077.xyz",
        "https://api.563118077.xyz",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.mount(UPLOADS_URL_PREFIX, StaticFiles(directory=get_uploads_dir()), name="uploads")

app.include_router(posts_router)
app.include_router(admin_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/settings", response_model=SiteSettingsOut)
def get_settings(db: Session = Depends(get_db)):
    s = db.query(SiteSettings).first()
    return {
        "author_name": s.author_name,
        "bio": s.bio,
        "avatar_url": s.avatar_url,
        "hero_image": s.hero_image,
        "github_link": s.github_link,
        "announcement": s.announcement,
        "site_url": s.site_url,
        "friend_links": s.friend_links,
    }


@app.put("/api/settings", response_model=SiteSettingsOut)
def update_settings(
    body: SiteSettingsUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    s = db.query(SiteSettings).first()
    for field in (
        "author_name", "bio", "avatar_url", "hero_image",
        "github_link", "announcement", "site_url", "friend_links",
    ):
        val = getattr(body, field)
        if val is not None:
            setattr(s, field, val)
    db.commit()
    db.refresh(s)
    return {
        "author_name": s.author_name,
        "bio": s.bio,
        "avatar_url": s.avatar_url,
        "hero_image": s.hero_image,
        "github_link": s.github_link,
        "announcement": s.announcement,
        "site_url": s.site_url,
        "friend_links": s.friend_links,
    }


@app.get("/api/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    post_count = db.query(func.count(Post.id)).scalar()
    tag_count = db.query(func.count(Tag.id)).scalar()
    return {
        "post_count": post_count,
        "tag_count": tag_count,
    }


# ── RSS Feed ──

@app.get("/feed.xml")
def rss_feed(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = (settings.site_url if settings and settings.site_url else "https://563118077.xyz").rstrip("/")
    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
        .limit(20)
    ).scalars().all()

    rss = Element("rss", version="2.0")
    channel = SubElement(rss, "channel")
    SubElement(channel, "title").text = "AI Dev Blog"
    SubElement(channel, "link").text = site_url
    SubElement(channel, "description").text = "极客新生的技术博客"
    SubElement(channel, "language").text = "zh-CN"

    for post in posts:
        item = SubElement(channel, "item")
        SubElement(item, "title").text = post.title
        SubElement(item, "link").text = f"{site_url}/posts/{post.slug}"
        SubElement(item, "description").text = post.summary
        SubElement(item, "guid").text = f"{site_url}/posts/{post.slug}"
        if post.created_at:
            SubElement(item, "pubDate").text = post.created_at.strftime(
                "%a, %d %b %Y %H:%M:%S +0000"
            )

    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(rss, encoding="unicode")
    return Response(content=xml_str, media_type="application/xml")


# ── Sitemap ──

@app.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = (settings.site_url if settings and settings.site_url else "https://563118077.xyz").rstrip("/")
    posts = db.execute(
        select(Post).where(Post.is_published == True).order_by(Post.created_at.desc())
    ).scalars().all()

    urlset = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    # 首页
    url_el = SubElement(urlset, "url")
    SubElement(url_el, "loc").text = site_url
    SubElement(url_el, "changefreq").text = "daily"
    SubElement(url_el, "priority").text = "1.0"

    for post in posts:
        url_el = SubElement(urlset, "url")
        SubElement(url_el, "loc").text = f"{site_url}/posts/{post.slug}"
        if post.updated_at:
            SubElement(url_el, "lastmod").text = post.updated_at.strftime("%Y-%m-%d")
        SubElement(url_el, "changefreq").text = "weekly"
        SubElement(url_el, "priority").text = "0.8"

    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(urlset, encoding="unicode")
    return Response(content=xml_str, media_type="application/xml")

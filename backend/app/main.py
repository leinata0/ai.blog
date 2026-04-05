from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal, engine, get_db
from app.models import Post, Tag, Comment, SiteSettings
from app.routers.posts import router as posts_router
from app.routers.admin import router as admin_router
from app.schemas import SiteSettingsOut, SiteSettingsUpdate, StatsOut
from app.seed import seed_data
from app.uploads import UPLOADS_URL_PREFIX, get_uploads_dir


def _needs_migration(db) -> bool:
    """检测旧表是否缺少新字段，如果缺少则需要重建"""
    try:
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(engine)
        columns = {c["name"] for c in inspector.get_columns("posts")}
        return "created_at" not in columns or "is_published" not in columns
    except Exception:
        return False


@asynccontextmanager
async def lifespan(app):
    get_uploads_dir().mkdir(parents=True, exist_ok=True)

    needs_rebuild = False
    try:
        if engine.dialect.has_table(engine.connect(), "posts"):
            with SessionLocal() as db:
                needs_rebuild = _needs_migration(db)
    except Exception:
        needs_rebuild = True

    if needs_rebuild:
        Base.metadata.drop_all(bind=engine)

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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        "github_link": s.github_link,
        "announcement": s.announcement,
    }


@app.put("/api/settings", response_model=SiteSettingsOut)
def update_settings(body: SiteSettingsUpdate, db: Session = Depends(get_db)):
    s = db.query(SiteSettings).first()
    for field in ("author_name", "bio", "avatar_url", "github_link", "announcement"):
        val = getattr(body, field)
        if val is not None:
            setattr(s, field, val)
    db.commit()
    db.refresh(s)
    return {
        "author_name": s.author_name,
        "bio": s.bio,
        "avatar_url": s.avatar_url,
        "github_link": s.github_link,
        "announcement": s.announcement,
    }


@app.get("/api/stats", response_model=StatsOut)
def get_stats(db: Session = Depends(get_db)):
    post_count = db.query(func.count(Post.id)).scalar()
    tag_count = db.query(func.count(Tag.id)).scalar()
    category_count = tag_count  # tags serve as categories in this schema
    return {
        "post_count": post_count,
        "tag_count": tag_count,
        "category_count": category_count,
    }

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Post, Tag

router = APIRouter(prefix="/api/posts", tags=["posts"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("")
def list_posts(tag: str | None = Query(default=None), db: Session = Depends(get_db)):
    stmt = select(Post).options(selectinload(Post.tags)).order_by(Post.id.desc())
    if tag:
        stmt = stmt.join(Post.tags).where(Tag.slug == tag)

    posts = db.execute(stmt).scalars().all()
    return {
        "items": [
            {
                "title": post.title,
                "slug": post.slug,
                "summary": post.summary,
                "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
            }
            for post in posts
        ]
    }


@router.get("/{slug}")
def get_post_detail(slug: str, db: Session = Depends(get_db)):
    stmt = select(Post).options(selectinload(Post.tags)).where(Post.slug == slug)
    post = db.execute(stmt).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    return {
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "content_md": post.content_md,
        "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
    }

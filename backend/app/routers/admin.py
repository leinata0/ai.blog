import os
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, select

from app.auth import verify_admin, create_access_token, get_current_admin
from app.db import get_db
from app.models import Post, Tag, Comment
from app.schemas import (
    LoginRequest, LoginResponse,
    PostCreateRequest, PostUpdateRequest, PostAdminOut, TagOut, UploadOut,
)
from app.uploads import UPLOADS_URL_PREFIX, get_uploads_dir

router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB


def _post_to_dict(post: Post) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "content_md": post.content_md,
        "cover_image": post.cover_image or "",
        "view_count": post.view_count or 0,
        "is_published": post.is_published if post.is_published is not None else True,
        "is_pinned": post.is_pinned if post.is_pinned is not None else False,
        "like_count": post.like_count or 0,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
    }


def _resolve_tags(db: Session, tag_slugs: list[str]) -> list[Tag]:
    tags = []
    for slug in tag_slugs:
        tag = db.execute(select(Tag).where(Tag.slug == slug)).scalar_one_or_none()
        if tag is None:
            tag = Tag(name=slug, slug=slug)
            db.add(tag)
            db.flush()
        tags.append(tag)
    return tags


def _build_upload_path(filename: str) -> Path:
    extension = Path(filename).suffix.lower()
    safe_extension = extension if extension and len(extension) <= 10 else ""
    return get_uploads_dir() / f"{uuid4().hex}{safe_extension}"


# ── Login (no auth required) ──

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    if not verify_admin(body.username, body.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(data={"sub": body.username})
    return {"access_token": token, "token_type": "bearer"}


# ── 管理员统计 ──

@router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    total_posts = db.execute(select(func.count(Post.id))).scalar() or 0
    draft_count = db.execute(
        select(func.count(Post.id)).where(Post.is_published == False)
    ).scalar() or 0
    total_views = db.execute(select(func.coalesce(func.sum(Post.view_count), 0))).scalar() or 0
    total_comments = db.execute(select(func.count(Comment.id))).scalar() or 0
    total_likes = db.execute(select(func.coalesce(func.sum(Post.like_count), 0))).scalar() or 0
    return {
        "total_posts": total_posts,
        "draft_count": draft_count,
        "total_views": total_views,
        "total_comments": total_comments,
        "total_likes": total_likes,
    }


# ── 管理员文章列表 ──

@router.get("/posts")
def admin_list_posts(
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    stmt = select(Post).options(selectinload(Post.tags)).order_by(Post.created_at.desc())
    count_stmt = select(func.count(Post.id))

    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Post.title.ilike(pattern) | Post.summary.ilike(pattern))
        count_stmt = count_stmt.where(Post.title.ilike(pattern) | Post.summary.ilike(pattern))

    total = db.execute(count_stmt).scalar()
    posts = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).scalars().all()

    return {
        "items": [_post_to_dict(p) for p in posts],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── CRUD (auth required) ──

@router.post("/posts", response_model=PostAdminOut)
def create_post(
    body: PostCreateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = Post(
        title=body.title,
        slug=body.slug,
        summary=body.summary,
        content_md=body.content_md,
        cover_image=body.cover_image,
        is_published=body.is_published,
        is_pinned=body.is_pinned,
    )
    post.tags = _resolve_tags(db, body.tags)
    db.add(post)
    db.commit()
    db.refresh(post)
    return _post_to_dict(post)


@router.put("/posts/{post_id}", response_model=PostAdminOut)
def update_post(
    post_id: int,
    body: PostUpdateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = db.execute(
        select(Post).options(selectinload(Post.tags)).where(Post.id == post_id)
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    if body.title is not None:
        post.title = body.title
    if body.slug is not None:
        post.slug = body.slug
    if body.summary is not None:
        post.summary = body.summary
    if body.content_md is not None:
        post.content_md = body.content_md
    if body.cover_image is not None:
        post.cover_image = body.cover_image
    if body.is_published is not None:
        post.is_published = body.is_published
    if body.is_pinned is not None:
        post.is_pinned = body.is_pinned
    if body.tags is not None:
        post.tags = _resolve_tags(db, body.tags)

    db.commit()
    db.refresh(post)
    return _post_to_dict(post)


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = db.execute(select(Post).where(Post.id == post_id)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    db.delete(post)
    db.commit()
    return {"detail": "deleted"}


# ── 评论管理 ──

@router.get("/comments")
def admin_list_comments(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    total = db.execute(select(func.count(Comment.id))).scalar() or 0
    comments = db.execute(
        select(Comment)
        .order_by(Comment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars().all()
    return {
        "items": [
            {
                "id": c.id,
                "post_id": c.post_id,
                "nickname": c.nickname,
                "content": c.content,
                "ip_address": c.ip_address or "",
                "is_approved": c.is_approved,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.put("/comments/{comment_id}/approve")
def approve_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    comment = db.execute(select(Comment).where(Comment.id == comment_id)).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")
    comment.is_approved = True
    db.commit()
    return {"detail": "approved"}


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    comment = db.execute(select(Comment).where(Comment.id == comment_id)).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")
    db.delete(comment)
    db.commit()
    return {"detail": "deleted"}


# ── 图片管理 ──

@router.post("/upload", response_model=UploadOut)
def upload_image(
    file: UploadFile = File(...),
    _admin: str = Depends(get_current_admin),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")

    # 文件大小限制 5MB
    contents = file.file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="文件大小不能超过 5MB")
    file.file.seek(0)

    uploads_dir = get_uploads_dir()
    uploads_dir.mkdir(parents=True, exist_ok=True)
    target_path = _build_upload_path(file.filename)

    with target_path.open("wb") as buffer:
        buffer.write(contents)

    return {"url": f"{UPLOADS_URL_PREFIX}/{target_path.name}"}


@router.get("/images")
def list_images(_admin: str = Depends(get_current_admin)):
    uploads_dir = get_uploads_dir()
    if not uploads_dir.exists():
        return []
    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"}
    images = []
    for f in sorted(uploads_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file() and f.suffix.lower() in image_extensions:
            images.append({
                "filename": f.name,
                "url": f"{UPLOADS_URL_PREFIX}/{f.name}",
                "size": f.stat().st_size,
            })
    return images


@router.delete("/images/{filename}")
def delete_image(
    filename: str,
    _admin: str = Depends(get_current_admin),
):
    uploads_dir = get_uploads_dir()
    target = uploads_dir / filename
    # 防止路径穿越
    if not target.resolve().parent == uploads_dir.resolve():
        raise HTTPException(status_code=400, detail="非法文件名")
    if not target.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    target.unlink()
    return {"detail": "deleted"}

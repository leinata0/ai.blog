import json
import time

from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, select

from app.db import get_db
from app.models import Post, Tag, Comment, SiteSettings, post_tags
from app.schemas import CommentCreate

router = APIRouter(prefix="/api", tags=["posts"])

# 模块级内存缓存：浏览量防刷 {ip+slug: timestamp}
_view_cache: dict[str, float] = {}
# 点赞 IP 去重 {ip+slug}
_like_cache: set[str] = set()
# 评论频率限制 {ip: [timestamp, ...]}
_comment_rate: dict[str, list[float]] = {}


def _get_client_ip(request: Request) -> str:
    """从请求头获取客户端真实 IP"""
    ip = request.headers.get("CF-Connecting-IP")
    if ip:
        return ip
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


@router.get("/posts")
def list_posts(
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Post)
        .options(selectinload(Post.tags))
        .where(Post.is_published == True)
        .order_by(Post.is_pinned.desc(), Post.created_at.desc())
    )
    count_stmt = select(func.count(Post.id)).where(Post.is_published == True)

    if tag:
        stmt = stmt.join(Post.tags).where(Tag.slug == tag)
        count_stmt = count_stmt.join(Post.tags).where(Tag.slug == tag)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Post.title.ilike(pattern) | Post.summary.ilike(pattern))
        count_stmt = count_stmt.where(Post.title.ilike(pattern) | Post.summary.ilike(pattern))

    total = db.execute(count_stmt).scalar()
    posts = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).scalars().all()

    return {
        "items": [
            {
                "id": post.id,
                "title": post.title,
                "slug": post.slug,
                "summary": post.summary,
                "cover_image": post.cover_image or "",
                "view_count": post.view_count or 0,
                "is_published": post.is_published,
                "is_pinned": post.is_pinned,
                "like_count": post.like_count or 0,
                "created_at": post.created_at.isoformat() if post.created_at else None,
                "updated_at": post.updated_at.isoformat() if post.updated_at else None,
                "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
            }
            for post in posts
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/posts/{slug}")
def get_post_detail(slug: str, request: Request, db: Session = Depends(get_db)):
    stmt = select(Post).options(selectinload(Post.tags)).where(Post.slug == slug)
    post = db.execute(stmt).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    # 浏览量防刷：同一 IP 对同一文章 10 分钟内不重复计数
    client_ip = _get_client_ip(request)
    cache_key = f"{client_ip}:{slug}"
    now = time.time()
    last_view = _view_cache.get(cache_key, 0)
    if now - last_view > 600:
        post.view_count = (post.view_count or 0) + 1
        _view_cache[cache_key] = now
        db.commit()
        db.refresh(post)

    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "content_md": post.content_md,
        "cover_image": post.cover_image or "",
        "view_count": post.view_count,
        "is_pinned": post.is_pinned,
        "like_count": post.like_count or 0,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
    }


# ── 点赞接口 ──

@router.post("/posts/{slug}/like")
def like_post(slug: str, request: Request, db: Session = Depends(get_db)):
    post = db.execute(select(Post).where(Post.slug == slug)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    client_ip = _get_client_ip(request)
    like_key = f"{client_ip}:{slug}"

    if like_key in _like_cache:
        raise HTTPException(status_code=400, detail="你已经点过赞了")

    _like_cache.add(like_key)
    post.like_count = (post.like_count or 0) + 1
    db.commit()
    db.refresh(post)
    return {"like_count": post.like_count}


# ── 相关文章接口 ──

@router.get("/posts/{slug}/related")
def get_related_posts(slug: str, db: Session = Depends(get_db)):
    post = db.execute(
        select(Post).options(selectinload(Post.tags)).where(Post.slug == slug)
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    tag_ids = [t.id for t in post.tags]
    if not tag_ids:
        return []

    related = db.execute(
        select(Post)
        .options(selectinload(Post.tags))
        .join(post_tags)
        .where(post_tags.c.tag_id.in_(tag_ids))
        .where(Post.id != post.id)
        .where(Post.is_published == True)
        .group_by(Post.id)
        .order_by(func.count(post_tags.c.tag_id).desc(), Post.created_at.desc())
        .limit(5)
    ).scalars().all()

    return [
        {
            "id": p.id,
            "title": p.title,
            "slug": p.slug,
            "summary": p.summary,
            "cover_image": p.cover_image or "",
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "tags": [{"name": t.name, "slug": t.slug} for t in p.tags],
        }
        for p in related
    ]


# ── 评论接口 ──

@router.get("/posts/{slug}/comments")
def list_comments(slug: str, db: Session = Depends(get_db)):
    post = db.execute(select(Post).where(Post.slug == slug)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    comments = db.execute(
        select(Comment)
        .where(Comment.post_id == post.id, Comment.is_approved == True)
        .order_by(Comment.created_at.desc())
    ).scalars().all()
    return [
        {
            "id": c.id,
            "nickname": c.nickname,
            "content": c.content,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in comments
    ]


@router.post("/posts/{slug}/comments")
def create_comment(slug: str, body: CommentCreate, request: Request, db: Session = Depends(get_db)):
    post = db.execute(select(Post).where(Post.slug == slug)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    if not body.nickname.strip() or not body.content.strip():
        raise HTTPException(status_code=400, detail="昵称和内容不能为空")

    # 评论频率限制：同 IP 每分钟最多 3 条
    client_ip = _get_client_ip(request)
    now = time.time()
    timestamps = _comment_rate.get(client_ip, [])
    timestamps = [t for t in timestamps if now - t < 60]
    if len(timestamps) >= 3:
        raise HTTPException(status_code=429, detail="评论过于频繁，请稍后再试")
    timestamps.append(now)
    _comment_rate[client_ip] = timestamps

    comment = Comment(
        post_id=post.id,
        nickname=body.nickname.strip(),
        content=body.content.strip(),
        ip_address=client_ip,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "nickname": comment.nickname,
        "content": comment.content,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


# ── 友链接口 ──

@router.get("/friends")
def get_friend_links(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    if not settings or not settings.friend_links:
        return []
    try:
        return json.loads(settings.friend_links)
    except (json.JSONDecodeError, TypeError):
        return []


# ── 归档接口 ──

@router.get("/archive")
def get_archive(db: Session = Depends(get_db)):
    posts = db.execute(
        select(Post).where(Post.is_published == True).order_by(Post.created_at.desc())
    ).scalars().all()
    groups: dict[int, list] = {}
    for p in posts:
        year = p.created_at.year if p.created_at else 2026
        groups.setdefault(year, []).append({
            "title": p.title,
            "slug": p.slug,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "is_pinned": bool(p.is_pinned),
        })
    return [{"year": y, "posts": items} for y, items in sorted(groups.items(), reverse=True)]


# ── 标签云接口 ──

@router.get("/tags")
def get_all_tags(db: Session = Depends(get_db)):
    results = db.execute(
        select(Tag.name, Tag.slug, func.count(post_tags.c.post_id).label("post_count"))
        .outerjoin(post_tags, Tag.id == post_tags.c.tag_id)
        .group_by(Tag.id)
        .order_by(func.count(post_tags.c.post_id).desc())
    ).all()
    return [{"name": r.name, "slug": r.slug, "post_count": r.post_count} for r in results]

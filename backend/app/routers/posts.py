import json
from datetime import datetime, timedelta, timezone
from xml.etree.ElementTree import Element, SubElement, tostring

from fastapi import APIRouter, Depends, Query, HTTPException, Request, Response
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, select

from app.db import get_db
from app.models import (
    Comment,
    Post,
    PostLike,
    PostSource,
    PublishingArtifact,
    Series,
    SiteSettings,
    Tag,
    ViewLog,
    post_tags,
)
from app.schemas import CommentCreate

router = APIRouter(prefix="/api", tags=["posts"])


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


def _post_list_item(post: Post) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "cover_image": post.cover_image or "",
        "content_type": post.content_type or "post",
        "topic_key": post.topic_key or "",
        "published_mode": post.published_mode or "manual",
        "coverage_date": post.coverage_date or "",
        "series_slug": post.series_slug,
        "series_order": post.series_order,
        "source_count": post.source_count,
        "quality_score": post.quality_score,
        "reading_time": post.reading_time,
        "view_count": post.view_count or 0,
        "is_published": post.is_published,
        "is_pinned": post.is_pinned,
        "like_count": post.like_count or 0,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
    }


def _series_to_dict(series: Series, db: Session, include_posts: bool = False) -> dict:
    content_types = []
    try:
        content_types = json.loads(series.content_types or "[]")
    except (json.JSONDecodeError, TypeError):
        content_types = []

    post_count = db.execute(
        select(func.count(Post.id))
        .where(Post.series_slug == series.slug)
        .where(Post.is_published == True)
    ).scalar() or 0

    latest_post_at = db.execute(
        select(func.max(Post.created_at))
        .where(Post.series_slug == series.slug)
        .where(Post.is_published == True)
    ).scalar()

    payload = {
        "id": series.id,
        "slug": series.slug,
        "title": series.title,
        "description": series.description or "",
        "cover_image": series.cover_image or "",
        "content_types": content_types,
        "is_featured": bool(series.is_featured),
        "sort_order": series.sort_order or 0,
        "post_count": post_count,
        "latest_post_at": latest_post_at.isoformat() if latest_post_at else None,
        "created_at": series.created_at.isoformat() if series.created_at else None,
        "updated_at": series.updated_at.isoformat() if series.updated_at else None,
    }

    if include_posts:
        posts = db.execute(
            select(Post)
            .options(selectinload(Post.tags))
            .where(Post.is_published == True)
            .where(Post.series_slug == series.slug)
            .order_by(func.coalesce(Post.series_order, 10**9).asc(), Post.created_at.desc())
            .limit(50)
        ).scalars().all()
        payload["posts"] = [_post_list_item(post) for post in posts]

    return payload


def _source_to_dict(source: PostSource) -> dict:
    return {
        "source_type": source.source_type or "",
        "source_name": source.source_name or "",
        "source_url": source.source_url or "",
        "published_at": source.published_at.isoformat() if source.published_at else None,
        "is_primary": bool(source.is_primary),
    }


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if isinstance(item, (str, int, float))]


def _snapshot_to_dict(snapshot) -> dict | None:
    if snapshot is None:
        return None
    return {
        "overall_score": snapshot.overall_score,
        "structure_score": snapshot.structure_score,
        "source_score": snapshot.source_score,
        "analysis_score": snapshot.analysis_score,
        "packaging_score": snapshot.packaging_score,
        "resonance_score": snapshot.resonance_score,
        "issues": _json_list(snapshot.issues_json),
        "strengths": _json_list(snapshot.strengths_json),
        "notes": snapshot.notes or "",
        "generated_at": snapshot.generated_at.isoformat() if snapshot.generated_at else None,
        "updated_at": snapshot.updated_at.isoformat() if snapshot.updated_at else None,
    }


def _review_to_dict(review) -> dict | None:
    if review is None:
        return None
    return {
        "editor_verdict": review.editor_verdict or "",
        "editor_labels": _json_list(review.editor_labels_json),
        "editor_note": review.editor_note or "",
        "followup_recommended": review.followup_recommended,
        "reviewed_at": review.reviewed_at.isoformat() if review.reviewed_at else None,
        "reviewed_by": review.reviewed_by or "",
        "updated_at": review.updated_at.isoformat() if review.updated_at else None,
    }


def _build_source_summary(sources: list[PostSource], artifact: PublishingArtifact | None) -> str:
    if artifact and (artifact.research_pack_summary or "").strip():
        return artifact.research_pack_summary.strip()
    if not sources:
        return ""
    unique_names = list(
        dict.fromkeys(
            source.source_name.strip()
            for source in sources
            if (source.source_name or "").strip()
        )
    )
    if not unique_names:
        return ""
    preview = "、".join(unique_names[:3])
    suffix = "等来源" if len(unique_names) > 3 else "来源"
    return f"本文综合 {len(unique_names)} 个来源，包括 {preview} {suffix}。"


def _build_feed_xml(posts: list[Post], site_url: str, title: str, description: str) -> str:
    rss = Element("rss", version="2.0")
    channel = SubElement(rss, "channel")
    SubElement(channel, "title").text = title
    SubElement(channel, "link").text = site_url
    SubElement(channel, "description").text = description
    SubElement(channel, "language").text = "zh-CN"

    for post in posts:
        item = SubElement(channel, "item")
        SubElement(item, "title").text = post.title
        SubElement(item, "link").text = f"{site_url}/posts/{post.slug}"
        SubElement(item, "description").text = post.summary
        SubElement(item, "guid").text = f"{site_url}/posts/{post.slug}"
        if post.created_at:
            created_at = post.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            SubElement(item, "pubDate").text = created_at.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(rss, encoding="unicode")


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
        "items": [_post_list_item(post) for post in posts],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/posts/{slug}")
def get_post_detail(slug: str, request: Request, db: Session = Depends(get_db)):
    stmt = (
        select(Post)
        .options(
            selectinload(Post.tags),
            selectinload(Post.quality_snapshot),
            selectinload(Post.quality_review),
        )
        .where(Post.slug == slug)
    )
    post = db.execute(stmt).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    # 浏览量防刷：同一 IP 对同一文章 10 分钟内不重复计数
    client_ip = _get_client_ip(request)
    cutoff = datetime.utcnow() - timedelta(seconds=600)
    recent_view = db.query(ViewLog).filter(
        ViewLog.post_id == post.id,
        ViewLog.ip_address == client_ip,
        ViewLog.created_at > cutoff,
    ).first()
    if not recent_view:
        post.view_count += 1
        db.add(ViewLog(post_id=post.id, ip_address=client_ip))
        db.commit()

    series = None
    if (post.series_slug or "").strip():
        series = db.execute(select(Series).where(Series.slug == post.series_slug)).scalar_one_or_none()

    sources = db.execute(
        select(PostSource)
        .where(PostSource.post_id == post.id)
        .order_by(PostSource.is_primary.desc(), PostSource.created_at.asc())
    ).scalars().all()

    latest_artifact = db.execute(
        select(PublishingArtifact)
        .where(PublishingArtifact.post_id == post.id)
        .order_by(PublishingArtifact.updated_at.desc(), PublishingArtifact.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    same_series_posts = []
    if (post.series_slug or "").strip():
        same_series_posts = db.execute(
            select(Post)
            .options(selectinload(Post.tags))
            .where(Post.is_published == True)
            .where(Post.series_slug == post.series_slug)
            .where(Post.id != post.id)
            .order_by(func.coalesce(Post.series_order, 10**9).asc(), Post.created_at.desc())
            .limit(6)
        ).scalars().all()

    same_topic_posts = []
    if (post.topic_key or "").strip():
        same_topic_posts = db.execute(
            select(Post)
            .options(selectinload(Post.tags))
            .where(Post.is_published == True)
            .where(Post.topic_key == post.topic_key)
            .where(Post.id != post.id)
            .order_by(Post.created_at.desc())
            .limit(6)
        ).scalars().all()

    same_week_posts = []
    if (post.coverage_date or "").strip():
        same_week_posts = db.execute(
            select(Post)
            .options(selectinload(Post.tags))
            .where(Post.is_published == True)
            .where(Post.coverage_date == post.coverage_date)
            .where(Post.id != post.id)
            .order_by(Post.created_at.desc())
            .limit(6)
        ).scalars().all()

    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "summary": post.summary,
        "content_md": post.content_md,
        "cover_image": post.cover_image or "",
        "content_type": post.content_type or "post",
        "topic_key": post.topic_key or "",
        "published_mode": post.published_mode or "manual",
        "coverage_date": post.coverage_date or "",
        "series_slug": post.series_slug,
        "series_order": post.series_order,
        "editor_note": post.editor_note,
        "source_count": post.source_count,
        "quality_score": post.quality_score,
        "reading_time": post.reading_time,
        "view_count": post.view_count,
        "is_pinned": post.is_pinned,
        "like_count": post.like_count or 0,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "tags": [{"name": t.name, "slug": t.slug} for t in post.tags],
        "series": _series_to_dict(series, db, include_posts=False) if series else None,
        "sources": [_source_to_dict(source) for source in sources],
        "source_summary": _build_source_summary(sources, latest_artifact),
        "quality_snapshot": _snapshot_to_dict(post.quality_snapshot),
        "quality_review": _review_to_dict(post.quality_review),
        "same_series_posts": [_post_list_item(item) for item in same_series_posts],
        "same_topic_posts": [_post_list_item(item) for item in same_topic_posts],
        "same_week_posts": [_post_list_item(item) for item in same_week_posts],
    }


# ── 点赞接口 ──

@router.post("/posts/{slug}/like")
def like_post(slug: str, request: Request, db: Session = Depends(get_db)):
    post = db.execute(select(Post).where(Post.slug == slug)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    client_ip = _get_client_ip(request)

    existing = db.query(PostLike).filter(
        PostLike.post_id == post.id,
        PostLike.ip_address == client_ip,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="已经点过赞了")

    post.like_count += 1
    db.add(PostLike(post_id=post.id, ip_address=client_ip))
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

    return [_post_list_item(related_post) for related_post in related]


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
    one_min_ago = datetime.utcnow() - timedelta(seconds=60)
    recent_count = db.query(func.count(Comment.id)).filter(
        Comment.ip_address == client_ip,
        Comment.created_at > one_min_ago,
    ).scalar()
    if recent_count >= 3:
        raise HTTPException(status_code=429, detail="评论过于频繁，请稍后再试")

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
        year = p.created_at.year if p.created_at else datetime.utcnow().year
        groups.setdefault(year, []).append({
            "title": p.title,
            "slug": p.slug,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "content_type": p.content_type or "post",
            "topic_key": p.topic_key or "",
            "published_mode": p.published_mode or "manual",
            "coverage_date": p.coverage_date or "",
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


@router.get("/series")
def list_series(db: Session = Depends(get_db)):
    series_list = db.execute(
        select(Series).order_by(Series.is_featured.desc(), Series.sort_order.asc(), Series.updated_at.desc())
    ).scalars().all()
    return [_series_to_dict(series, db, include_posts=False) for series in series_list]


@router.get("/series/{slug}")
def get_series_detail(slug: str, db: Session = Depends(get_db)):
    series = db.execute(select(Series).where(Series.slug == slug)).scalar_one_or_none()
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")
    return _series_to_dict(series, db, include_posts=True)


@router.get("/discover")
def get_discover(
    q: str | None = Query(default=None),
    content_type: str | None = Query(default=None),
    series: str | None = Query(default=None),
    limit: int = Query(default=24, ge=1, le=60),
    db: Session = Depends(get_db),
):
    featured_series = db.execute(
        select(Series).where(Series.is_featured == True).order_by(Series.sort_order.asc(), Series.updated_at.desc()).limit(6)
    ).scalars().all()

    latest_daily = db.execute(
        select(Post)
        .options(selectinload(Post.tags))
        .where(Post.is_published == True)
        .where(Post.content_type == "daily_brief")
        .order_by(Post.created_at.desc())
        .limit(8)
    ).scalars().all()

    latest_weekly = db.execute(
        select(Post)
        .options(selectinload(Post.tags))
        .where(Post.is_published == True)
        .where(Post.content_type == "weekly_review")
        .order_by(Post.created_at.desc())
        .limit(6)
    ).scalars().all()

    editor_picks = db.execute(
        select(Post)
        .options(selectinload(Post.tags))
        .where(Post.is_published == True)
        .order_by(Post.is_pinned.desc(), Post.like_count.desc(), Post.view_count.desc(), Post.created_at.desc())
        .limit(8)
    ).scalars().all()

    items_stmt = select(Post).options(selectinload(Post.tags)).where(Post.is_published == True)
    total_stmt = select(func.count(Post.id)).where(Post.is_published == True)

    if q:
        pattern = f"%{q}%"
        items_stmt = items_stmt.where(Post.title.ilike(pattern) | Post.summary.ilike(pattern))
        total_stmt = total_stmt.where(Post.title.ilike(pattern) | Post.summary.ilike(pattern))
    if content_type:
        items_stmt = items_stmt.where(Post.content_type == content_type)
        total_stmt = total_stmt.where(Post.content_type == content_type)
    if series:
        items_stmt = items_stmt.where(Post.series_slug == series)
        total_stmt = total_stmt.where(Post.series_slug == series)

    total = db.execute(total_stmt).scalar() or 0
    items = db.execute(
        items_stmt.order_by(Post.is_pinned.desc(), Post.created_at.desc()).limit(limit)
    ).scalars().all()

    return {
        "featured_series": [_series_to_dict(series, db, include_posts=False) for series in featured_series],
        "latest_daily": [_post_list_item(post) for post in latest_daily],
        "latest_weekly": [_post_list_item(post) for post in latest_weekly],
        "editor_picks": [_post_list_item(post) for post in editor_picks],
        "items": [_post_list_item(post) for post in items],
        "total": total,
        "facets": {
            "content_types": {
                "daily_brief": len([post for post in items if (post.content_type or "") == "daily_brief"]),
                "weekly_review": len([post for post in items if (post.content_type or "") == "weekly_review"]),
            },
            "series": series or "",
        },
    }


@router.get("/feeds/all.xml")
def feed_all(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = (settings.site_url if settings and settings.site_url else "https://563118077.xyz").rstrip("/")
    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(posts, site_url, "AI Dev Blog - All Posts", "All published posts.")
    return Response(content=xml_str, media_type="application/xml")


@router.get("/feeds/daily.xml")
def feed_daily(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = (settings.site_url if settings and settings.site_url else "https://563118077.xyz").rstrip("/")
    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .where(Post.content_type == "daily_brief")
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(posts, site_url, "AI Dev Blog - Daily Brief", "Daily brief feed.")
    return Response(content=xml_str, media_type="application/xml")


@router.get("/feeds/weekly.xml")
def feed_weekly(db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = (settings.site_url if settings and settings.site_url else "https://563118077.xyz").rstrip("/")
    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .where(Post.content_type == "weekly_review")
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(posts, site_url, "AI Dev Blog - Weekly Review", "Weekly review feed.")
    return Response(content=xml_str, media_type="application/xml")

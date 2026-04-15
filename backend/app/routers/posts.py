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
    SearchInsight,
    Tag,
    TopicProfile,
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


def _normalize_query(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.strip().split()).lower()


def _record_search_insight(db: Session, query: str, result_count: int) -> None:
    normalized_query = _normalize_query(query)
    if len(normalized_query) < 2:
        return
    now = datetime.now(timezone.utc)
    insight = db.execute(
        select(SearchInsight).where(SearchInsight.query == normalized_query)
    ).scalar_one_or_none()
    if insight is None:
        insight = SearchInsight(
            query=normalized_query,
            search_count=1,
            last_result_count=result_count,
            first_searched_at=now,
            last_searched_at=now,
        )
        db.add(insight)
    else:
        insight.search_count = (insight.search_count or 0) + 1
        insight.last_result_count = result_count
        insight.last_searched_at = now
        insight.updated_at = now
    db.commit()


def _safe_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if isinstance(item, (str, int, float))]


def _topic_profile_to_dict(profile: TopicProfile, db: Session) -> dict:
    post_count = db.execute(
        select(func.count(Post.id))
        .where(Post.is_published == True)
        .where(Post.topic_key == profile.topic_key)
    ).scalar() or 0
    latest_post_at = db.execute(
        select(func.max(Post.created_at))
        .where(Post.is_published == True)
        .where(Post.topic_key == profile.topic_key)
    ).scalar()
    avg_quality = db.execute(
        select(func.avg(Post.quality_score))
        .where(Post.is_published == True)
        .where(Post.topic_key == profile.topic_key)
    ).scalar()
    return {
        "id": profile.id,
        "topic_key": profile.topic_key,
        "title": profile.title or "",
        "display_title": (profile.title or profile.topic_key or "").strip(),
        "description": profile.description or "",
        "cover_image": profile.cover_image or "",
        "aliases": _safe_json_list(profile.aliases_json),
        "focus_points": _safe_json_list(profile.focus_points_json),
        "content_types": _safe_json_list(profile.content_types_json),
        "series_slug": profile.series_slug,
        "is_featured": bool(profile.is_featured),
        "sort_order": profile.sort_order or 0,
        "is_active": bool(profile.is_active),
        "priority": profile.priority or 0,
        "post_count": post_count,
        "latest_post_at": latest_post_at.isoformat() if latest_post_at else None,
        "avg_quality_score": round(float(avg_quality), 2) if avg_quality is not None else None,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def _resolved_post_date(post: Post) -> str:
    if (post.coverage_date or "").strip():
        return post.coverage_date.strip()
    if post.created_at:
        return post.created_at.date().isoformat()
    return ""


def _search_rank(post: Post, query: str) -> tuple[tuple, str]:
    q = _normalize_query(query)
    title = (post.title or "").lower()
    topic = (post.topic_key or "").lower()
    summary = (post.summary or "").lower()
    series = (post.series_slug or "").lower()
    tags = " ".join([(tag.name or "").lower() + " " + (tag.slug or "").lower() for tag in post.tags])

    title_match = q in title
    topic_match = q in topic
    summary_match = q in summary
    tag_or_series_match = (q in tags) or (q in series)
    if not any([title_match, topic_match, summary_match, tag_or_series_match]):
        return ((0, 0, 0, 0, 0, 0, 0), "")

    if title_match:
        reason = "title"
    elif topic_match:
        reason = "topic"
    elif summary_match:
        reason = "summary"
    else:
        reason = "tag_or_series"

    freshness = post.created_at.timestamp() if post.created_at else 0
    quality = post.quality_score if post.quality_score is not None else -1
    rank = (
        1 if title_match else 0,
        1 if topic_match else 0,
        1 if summary_match else 0,
        1 if tag_or_series_match else 0,
        freshness,
        quality,
        post.id or 0,
    )
    return (rank, reason)


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


@router.get("/search")
def search_posts(
    q: str = Query(default="", max_length=200),
    content_type: str | None = Query(default=None),
    series_slug: str | None = Query(default=None),
    topic_key: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    sort: str = Query(default="relevance"),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    query = _normalize_query(q)
    if not query:
        return {"query": "", "items": [], "total": 0, "topics": [], "facets": {}}

    stmt = (
        select(Post)
        .options(selectinload(Post.tags))
        .where(Post.is_published == True)
    )
    if content_type:
        stmt = stmt.where(Post.content_type == content_type)
    if series_slug:
        stmt = stmt.where(Post.series_slug == series_slug)
    if topic_key:
        stmt = stmt.where(Post.topic_key == topic_key)

    posts = db.execute(
        stmt.order_by(Post.created_at.desc()).limit(500)
    ).scalars().all()

    ranked: list[tuple[tuple, str, Post]] = []
    for post in posts:
        coverage = _resolved_post_date(post)
        if date_from and coverage and coverage < date_from:
            continue
        if date_to and coverage and coverage > date_to:
            continue
        rank, reason = _search_rank(post, query)
        if reason:
            ranked.append((rank, reason, post))

    if sort == "latest":
        ranked.sort(
            key=lambda item: (
                item[2].created_at.timestamp() if item[2].created_at else 0,
                item[0],
            ),
            reverse=True,
        )
    elif sort == "quality":
        ranked.sort(
            key=lambda item: (
                item[2].quality_score if item[2].quality_score is not None else -1,
                item[0],
                item[2].created_at.timestamp() if item[2].created_at else 0,
            ),
            reverse=True,
        )
    else:
        ranked.sort(key=lambda item: item[0], reverse=True)

    selected = ranked[:limit]
    items = []
    for rank, reason, post in selected:
        payload = _post_list_item(post)
        payload["match_score"] = round(float(rank[4]), 2)
        payload["match_reason"] = reason
        items.append(payload)

    topic_profiles = db.execute(select(TopicProfile)).scalars().all()
    titles_by_key = {profile.topic_key: profile.title or profile.topic_key for profile in topic_profiles}
    topic_buckets: dict[str, dict] = {}
    for _, _, post in ranked:
        current_topic_key = (post.topic_key or "").strip()
        if not current_topic_key:
            continue
        bucket = topic_buckets.setdefault(
            current_topic_key,
            {
                "topic_key": current_topic_key,
                "title": titles_by_key.get(current_topic_key, current_topic_key),
                "post_count": 0,
                "latest_post_at": None,
            },
        )
        bucket["post_count"] += 1
        if post.created_at and (bucket["latest_post_at"] is None or post.created_at > bucket["latest_post_at"]):
            bucket["latest_post_at"] = post.created_at

    topics = [
        {
            "topic_key": value["topic_key"],
            "title": value["title"],
            "post_count": value["post_count"],
            "latest_post_at": value["latest_post_at"].isoformat() if value["latest_post_at"] else None,
        }
        for value in sorted(
            topic_buckets.values(),
            key=lambda item: (item["post_count"], item["latest_post_at"] or datetime.min.replace(tzinfo=timezone.utc)),
            reverse=True,
        )[:6]
    ]

    _record_search_insight(db, query, len(ranked))
    return {
        "query": query,
        "items": items,
        "total": len(ranked),
        "topics": topics,
        "facets": {
            "content_type": content_type or "",
            "series_slug": series_slug or "",
            "topic_key": topic_key or "",
            "date_from": date_from or "",
            "date_to": date_to or "",
            "sort": sort,
        },
    }


@router.get("/topics")
def list_topics(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    profiles = db.execute(
        select(TopicProfile).order_by(TopicProfile.priority.desc(), TopicProfile.updated_at.desc())
    ).scalars().all()
    profiles_by_key = {profile.topic_key: profile for profile in profiles}

    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .where(Post.topic_key != "")
        .order_by(Post.created_at.desc())
    ).scalars().all()

    grouped: dict[str, dict] = {}
    for post in posts:
        key = (post.topic_key or "").strip()
        if not key:
            continue
        if key not in grouped:
            grouped[key] = {
                "topic_key": key,
                "title": key,
                "description": "",
                "content_types": set(),
                "series_slug": post.series_slug,
                "post_count": 0,
                "source_count": 0,
                "latest_post_at": post.created_at,
                "quality_scores": [],
            }
        bucket = grouped[key]
        bucket["post_count"] += 1
        bucket["source_count"] += int(post.source_count or 0)
        bucket["content_types"].add(post.content_type or "post")
        if post.created_at and (bucket["latest_post_at"] is None or post.created_at > bucket["latest_post_at"]):
            bucket["latest_post_at"] = post.created_at
        if post.quality_score is not None:
            bucket["quality_scores"].append(float(post.quality_score))

    items = []
    query = _normalize_query(q)
    all_keys = set(grouped.keys()) | set(profiles_by_key.keys())
    for key in all_keys:
        grouped_value = grouped.get(key)
        profile = profiles_by_key.get(key)
        title = (profile.title if profile and profile.title else (grouped_value["title"] if grouped_value else key))
        description = (profile.description if profile else "")
        if query and query not in key.lower() and query not in title.lower() and query not in description.lower():
            continue

        quality_scores = grouped_value["quality_scores"] if grouped_value else []
        items.append(
            {
                "topic_key": key,
                "title": title,
                "description": description,
                "content_types": sorted(list(grouped_value["content_types"])) if grouped_value else _safe_json_list(profile.content_types_json if profile else "[]"),
                "series_slug": (profile.series_slug if profile else (grouped_value["series_slug"] if grouped_value else None)),
                "post_count": (grouped_value["post_count"] if grouped_value else 0),
                "source_count": (grouped_value["source_count"] if grouped_value else 0),
                "latest_post_at": grouped_value["latest_post_at"].isoformat() if grouped_value and grouped_value["latest_post_at"] else None,
                "avg_quality_score": round(sum(quality_scores) / len(quality_scores), 2) if quality_scores else None,
                "profile": _topic_profile_to_dict(profile, db) if profile else None,
            }
        )

    items.sort(key=lambda item: (item["post_count"], item["avg_quality_score"] or -1), reverse=True)
    return {"items": items[:limit], "total": len(items)}


@router.get("/topics/{topic_key}")
def get_topic_detail(topic_key: str, db: Session = Depends(get_db)):
    normalized_topic_key = topic_key.strip()
    if not normalized_topic_key:
        raise HTTPException(status_code=400, detail="topic_key is required")

    profile = db.execute(
        select(TopicProfile).where(TopicProfile.topic_key == normalized_topic_key)
    ).scalar_one_or_none()
    posts = db.execute(
        select(Post)
        .options(selectinload(Post.tags))
        .where(Post.is_published == True)
        .where(Post.topic_key == normalized_topic_key)
        .order_by(Post.created_at.desc())
    ).scalars().all()

    if profile is None and not posts:
        raise HTTPException(status_code=404, detail="Topic not found")

    quality_scores = [float(post.quality_score) for post in posts if post.quality_score is not None]
    content_types = sorted(list({(post.content_type or "post") for post in posts}))
    source_count = sum(int(post.source_count or 0) for post in posts)
    latest = posts[0] if posts else None

    return {
        "topic_key": normalized_topic_key,
        "title": profile.title if profile and profile.title else normalized_topic_key,
        "description": profile.description if profile else "",
        "content_types": content_types if content_types else _safe_json_list(profile.content_types_json if profile else "[]"),
        "series_slug": (profile.series_slug if profile else (latest.series_slug if latest else None)),
        "post_count": len(posts),
        "source_count": source_count,
        "avg_quality_score": round(sum(quality_scores) / len(quality_scores), 2) if quality_scores else None,
        "profile": _topic_profile_to_dict(profile, db) if profile else None,
        "posts": [_post_list_item(post) for post in posts[:20]],
        "recent_posts": [_post_list_item(post) for post in posts[:20]],
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


@router.get("/feeds/topics/{topic_key}.xml")
def feed_topic(topic_key: str, db: Session = Depends(get_db)):
    normalized_topic_key = topic_key.strip()
    if not normalized_topic_key:
        raise HTTPException(status_code=400, detail="topic_key is required")
    settings = db.query(SiteSettings).first()
    site_url = (settings.site_url if settings and settings.site_url else "https://563118077.xyz").rstrip("/")
    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .where(Post.topic_key == normalized_topic_key)
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(
        posts,
        site_url,
        f"AI Dev Blog - Topic: {normalized_topic_key}",
        f"Topic feed for {normalized_topic_key}.",
    )
    return Response(content=xml_str, media_type="application/xml")

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only, selectinload

from app.db import get_db
from app.models import Post, Series, SiteSettings, Tag, TopicProfile
from app.notifications import email_delivery_ready, web_push_delivery_ready
from app.schemas import HomeModulesOut
from app.services.cover_art import cover_art_version
from app.site_config import resolve_public_site_url

router = APIRouter(prefix="/api/home", tags=["home"])

_POST_LIST_LOAD_ONLY = (
    Post.id,
    Post.title,
    Post.slug,
    Post.summary,
    Post.cover_image,
    Post.content_type,
    Post.topic_key,
    Post.published_mode,
    Post.coverage_date,
    Post.series_slug,
    Post.series_order,
    Post.source_count,
    Post.quality_score,
    Post.reading_time,
    Post.view_count,
    Post.is_published,
    Post.is_pinned,
    Post.like_count,
    Post.created_at,
    Post.updated_at,
)


def _post_summary_options():
    return (
        load_only(*_POST_LIST_LOAD_ONLY),
        selectinload(Post.tags).load_only(Tag.name, Tag.slug),
    )


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
        "is_published": bool(post.is_published),
        "is_pinned": bool(post.is_pinned),
        "like_count": post.like_count or 0,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "tags": [{"name": tag.name, "slug": tag.slug} for tag in post.tags],
    }


def _series_to_dict(series: Series, post_count: int = 0, latest_post_at=None) -> dict:
    content_types = []
    raw_content_types = getattr(series, "content_types", "[]")
    if isinstance(raw_content_types, str) and raw_content_types.strip():
        try:
            import json

            parsed = json.loads(raw_content_types)
            if isinstance(parsed, list):
                content_types = [str(item).strip() for item in parsed if str(item).strip()]
        except Exception:
            content_types = []

    return {
        "id": series.id,
        "slug": series.slug,
        "title": series.title,
        "description": series.description or "",
        "cover_image": series.cover_image or "",
        "content_types": content_types,
        "is_featured": bool(series.is_featured),
        "sort_order": series.sort_order or 0,
        "post_count": int(post_count or 0),
        "latest_post_at": latest_post_at.isoformat() if latest_post_at else None,
        "created_at": series.created_at.isoformat() if series.created_at else None,
        "updated_at": series.updated_at.isoformat() if series.updated_at else None,
    }


@router.get("/modules", response_model=HomeModulesOut)
def get_home_modules(db: Session = Depends(get_db)):
    settings = db.execute(select(SiteSettings).limit(1)).scalar_one_or_none()
    site_url = resolve_public_site_url(db, settings=settings)
    art_version = cover_art_version()

    latest_weekly = db.execute(
        select(Post)
        .options(*_post_summary_options())
        .where(Post.is_published == True)
        .where(Post.content_type == "weekly_review")
        .order_by(Post.created_at.desc())
        .limit(3)
    ).scalars().all()

    latest_daily = db.execute(
        select(Post)
        .options(*_post_summary_options())
        .where(Post.is_published == True)
        .where(Post.content_type == "daily_brief")
        .order_by(Post.created_at.desc())
        .limit(4)
    ).scalars().all()

    featured_series = db.execute(
        select(Series)
        .where(Series.is_featured == True)
        .order_by(Series.sort_order.asc(), Series.updated_at.desc())
        .limit(4)
    ).scalars().all()

    series_counts = {
        row.series_slug: {
            "post_count": int(row.post_count or 0),
            "latest_post_at": row.latest_post_at,
        }
        for row in db.execute(
            select(
                Post.series_slug.label("series_slug"),
                func.count(Post.id).label("post_count"),
                func.max(Post.created_at).label("latest_post_at"),
            )
            .where(Post.is_published == True)
            .where(Post.series_slug.is_not(None))
            .where(Post.series_slug != "")
            .group_by(Post.series_slug)
        ).all()
    }

    since = datetime.now(timezone.utc) - timedelta(days=14)
    recent_posts = db.execute(
        select(Post)
        .options(load_only(
            Post.id,
            Post.title,
            Post.summary,
            Post.slug,
            Post.topic_key,
            Post.cover_image,
            Post.content_type,
            Post.source_count,
            Post.quality_score,
            Post.created_at,
            Post.series_slug,
        ))
        .where(Post.is_published == True)
        .where(Post.topic_key != "")
        .where(Post.created_at >= since)
        .order_by(Post.created_at.desc())
    ).scalars().all()

    profiles = db.execute(
        select(TopicProfile).order_by(TopicProfile.priority.desc(), TopicProfile.updated_at.desc())
    ).scalars().all()
    profiles_by_key = {profile.topic_key: profile for profile in profiles}

    grouped_topics: dict[str, dict] = defaultdict(
        lambda: {
            "post_count": 0,
            "source_count": 0,
            "latest_post_at": None,
            "latest_post": None,
            "quality_scores": [],
        }
    )
    for post in recent_posts:
        topic_key = (post.topic_key or "").strip()
        if not topic_key:
            continue
        bucket = grouped_topics[topic_key]
        bucket["post_count"] += 1
        bucket["source_count"] += int(post.source_count or 0)
        if post.quality_score is not None:
            bucket["quality_scores"].append(float(post.quality_score))
        if bucket["latest_post_at"] is None or (post.created_at and post.created_at > bucket["latest_post_at"]):
            bucket["latest_post_at"] = post.created_at
            bucket["latest_post"] = post

    topic_items = []
    for topic_key, bucket in sorted(
        grouped_topics.items(),
        key=lambda item: (
            item[1]["post_count"],
            item[1]["latest_post_at"] or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )[:6]:
        profile = profiles_by_key.get(topic_key)
        latest_post = bucket["latest_post"]
        display_title = (
            (profile.title or "").strip()
            or (latest_post.title if latest_post else "")
            or topic_key
        )
        description = (
            (profile.description or "").strip()
            or (latest_post.summary if latest_post else "")
            or "沿着同一条主线继续追踪最近变化。"
        )
        topic_items.append(
            {
                "topic_key": topic_key,
                "title": display_title,
                "description": description,
                "cover_image": (
                    (profile.cover_image or "").strip()
                    or (latest_post.cover_image if latest_post else "")
                    or ""
                ),
                "post_count": bucket["post_count"],
                "source_count": bucket["source_count"],
                "latest_post_at": bucket["latest_post_at"].isoformat() if bucket["latest_post_at"] else None,
                "avg_quality_score": (
                    round(sum(bucket["quality_scores"]) / len(bucket["quality_scores"]), 2)
                    if bucket["quality_scores"]
                    else None
                ),
                "is_featured": bool(profile.is_featured) if profile else False,
            }
        )

    return {
        "hero": {
            "image": (settings.hero_image if settings else "") or (settings.avatar_url if settings else "") or "",
            "image_alt": "站点 Hero 主海报",
            "preset": "site_hero",
            "art_direction_version": art_version,
        },
        "latest_weekly": [_post_list_item(post) for post in latest_weekly],
        "latest_daily": [_post_list_item(post) for post in latest_daily],
        "featured_series": [
            _series_to_dict(
                series,
                post_count=series_counts.get(series.slug, {}).get("post_count", 0),
                latest_post_at=series_counts.get(series.slug, {}).get("latest_post_at"),
            )
            for series in featured_series
        ],
        "topic_pulse": {
            "title": "正在发酵",
            "description": "最近 7 到 14 天里最值得继续追踪的主题，会优先沉淀在这里。",
            "items": topic_items,
        },
        "continue_reading": {
            "title": "继续追更",
            "empty_hint": "你最近读过的文章会在当前浏览器里形成回访入口。",
            "local_only": True,
            "items": [],
        },
        "subscription_cta": {
            "title": "订阅捷径",
            "description": "把 RSS、邮件提醒和浏览器通知收进一个入口，减少反复跳转。",
            "feeds_path": "/feeds",
            "rss_url": f"{site_url}/feed.xml",
            "primary_label": "打开订阅中心",
            "primary_to": "/feeds",
            "secondary_label": "RSS",
            "secondary_to": f"{site_url}/feed.xml",
            "email_enabled": email_delivery_ready(),
            "web_push_enabled": web_push_delivery_ready(),
        },
    }

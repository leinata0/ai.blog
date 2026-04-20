import json
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring

from fastapi import APIRouter, Depends, Query, HTTPException, Request, Response
from sqlalchemy.orm import Session, load_only, selectinload
from sqlalchemy import func, or_, select

from app.db import get_db
from app.feed_meta import (
    RSS_ALL_DESCRIPTION,
    RSS_ALL_TITLE,
    RSS_DAILY_DESCRIPTION,
    RSS_DAILY_TITLE,
    build_series_feed_description,
    build_series_feed_title,
    RSS_WEEKLY_DESCRIPTION,
    RSS_WEEKLY_TITLE,
    build_topic_feed_description,
    build_topic_feed_title,
)
from app.http_cache import build_public_cache_control, public_json_response, public_text_response
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
from app.site_config import resolve_public_site_url

router = APIRouter(prefix="/api", tags=["posts"])

_TOPIC_PRESENTATION_RULES_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "config" / "topic-presentation.rules.json"
)


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


_POST_SUMMARY_FIELDS = (
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
        load_only(*_POST_SUMMARY_FIELDS),
        selectinload(Post.tags).load_only(Tag.name, Tag.slug),
    )


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
            .options(*_post_summary_options())
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


def _series_match_score(series: Series, query_terms: list[str]) -> int:
    haystack = " ".join(
        filter(
            None,
            [
                str(series.slug or "").strip().lower(),
                str(series.title or "").strip().lower(),
                str(series.description or "").strip().lower(),
            ],
        )
    )
    if not haystack or not query_terms:
        return 0

    score = 0
    for term in query_terms[:6]:
        if term in str(series.title or "").strip().lower():
            score += 3
        elif term in haystack:
            score += 1
    return score


def _popular_search_queries(db: Session, current_query: str, limit: int = 6) -> list[dict]:
    rows = db.execute(
        select(SearchInsight)
        .where(SearchInsight.query != current_query)
        .where(SearchInsight.search_count > 0)
        .order_by(SearchInsight.search_count.desc(), SearchInsight.last_searched_at.desc())
        .limit(limit)
    ).scalars().all()
    return [
        {
            "query": row.query,
            "search_count": int(row.search_count or 0),
            "last_result_count": int(row.last_result_count or 0),
            "last_searched_at": row.last_searched_at.isoformat() if row.last_searched_at else None,
        }
        for row in rows
        if len(str(row.query or "").strip()) >= 2
    ]


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


def _has_cjk(value: str | None) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


def _normalize_topic_haystack(*parts: str | None) -> str:
    return " ".join(str(part or "").strip().lower() for part in parts if str(part or "").strip())


@lru_cache(maxsize=1)
def _load_topic_presentation_config() -> dict:
    try:
        raw = _TOPIC_PRESENTATION_RULES_PATH.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        payload = {}

    rules = []
    for rule in payload.get("rules") or []:
        exact = [
            str(item or "").strip().lower()
            for item in (rule.get("topic_key_exact") or [])
            if str(item or "").strip()
        ]
        prefixes = [
            str(item or "").strip().lower()
            for item in (rule.get("topic_key_prefixes") or [])
            if str(item or "").strip()
        ]
        keywords = [
            str(item or "").strip().lower()
            for item in (rule.get("keyword_match") or [])
            if str(item or "").strip()
        ]
        if not any([exact, prefixes, keywords]):
            continue
        presentation = rule.get("presentation") or {}
        rules.append(
            {
                "topic_key_exact": exact,
                "topic_key_prefixes": prefixes,
                "keyword_match": keywords,
                "presentation": {
                    "zh_title": str(presentation.get("zh_title") or "").strip(),
                    "zh_description": str(presentation.get("zh_description") or "").strip(),
                },
                "priority": int(rule.get("priority") or 0),
                "topic_family": str(rule.get("topic_family") or "").strip(),
            }
        )

    rules.sort(key=lambda item: item["priority"], reverse=True)
    default_presentation = payload.get("default_presentation") or {}
    return {
        "enabled": bool(payload.get("enabled", True)),
        "rules": rules,
        "default_presentation": {
            "zh_title_template": str(default_presentation.get("zh_title_template") or "").strip(),
            "zh_description_template": str(default_presentation.get("zh_description_template") or "").strip(),
        },
    }


def _render_template(template: str | None, context: dict[str, str]) -> str:
    rendered = str(template or "")
    for key, value in context.items():
        rendered = rendered.replace(f"{{{key}}}", str(value or "").strip())
    return rendered.strip()


def _match_topic_presentation_rule(topic_key: str, haystack: str) -> dict | None:
    config = _load_topic_presentation_config()
    if not config.get("enabled"):
        return None

    normalized_key = str(topic_key or "").strip().lower()
    for rule in config.get("rules") or []:
        if rule["topic_key_exact"] and normalized_key in rule["topic_key_exact"]:
            return rule
        if rule["topic_key_prefixes"] and any(normalized_key.startswith(prefix) for prefix in rule["topic_key_prefixes"]):
            return rule
        if rule["keyword_match"] and any(keyword in haystack for keyword in rule["keyword_match"]):
            return rule
    return None


def _topic_profile_is_manual(profile: TopicProfile | None) -> bool:
    if profile is None:
        return False
    aliases = _safe_json_list(profile.aliases_json)
    return any(
        [
            bool((profile.description or "").strip()),
            bool((profile.cover_image or "").strip()),
            bool(aliases),
            bool(profile.is_featured),
            bool(profile.priority or 0),
            bool(profile.sort_order or 0),
        ]
    )


def _normalize_topic_key_label(topic_key: str) -> str:
    key = str(topic_key or "").strip()
    if not key:
        return ""
    if any(fragment in key.lower() for fragment in ["http", "www.", "article-url-href", ".com", ".cn", ".xyz"]):
        return ""
    cleaned = re.sub(r"[-_]+", " ", key)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _compact_chinese_text(value: str | None, *, min_len: int = 6, max_len: int = 18) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.split(r"[：:|｜/]", text, maxsplit=1)[0].strip()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[（(].*?[）)]", "", text).strip()
    if len(text) > max_len:
        text = text[:max_len].rstrip("，。；：、,.:;- ")
    if len(text) < min_len:
        return ""
    return text


def _compact_summary_text(value: str | None, *, max_len: int = 44) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len].rstrip("，。；：、,.:;- ") + "。"


def _infer_topic_family(topic_key: str) -> str:
    normalized = str(topic_key or "").lower()
    if not normalized:
        return "general"
    if "agent" in normalized:
        return "agent"
    if "model" in normalized:
        return "model"
    if "open-source" in normalized or "opensource" in normalized:
        return "open_source"
    if "infra" in normalized or "deploy" in normalized or "inference" in normalized:
        return "infrastructure"
    return "general"


def _build_topic_fallback_title(topic_key: str, latest_post: Post | None, content_type: str | None) -> str:
    title = _compact_chinese_text(latest_post.title if latest_post else "")
    if title:
        return title

    readable_key = _normalize_topic_key_label(topic_key)
    family_label = {
        "agent": "智能体",
        "model": "模型",
        "open_source": "开源 AI",
        "infrastructure": "AI 基础设施",
        "general": "AI 主题",
    }.get(_infer_topic_family(topic_key), "AI 主题")

    if readable_key:
        if content_type == "weekly_review":
            return f"AI 周报：{readable_key}"
        if content_type == "daily_brief":
            return f"AI 日报：{readable_key}"
        return f"{family_label}追踪"

    if content_type == "weekly_review":
        return "AI 周报主线"
    if content_type == "daily_brief":
        return "AI 日报主题"
    return family_label


def _build_topic_fallback_description(title: str, latest_post: Post | None) -> str:
    summary = _compact_summary_text(latest_post.summary if latest_post else "")
    if summary and _has_cjk(summary):
        return summary
    compact_title = _compact_chinese_text(title, min_len=2, max_len=16) or title
    return f"围绕{compact_title}持续整理相关消息、产品更新与延伸解读。"


def _resolve_topic_presentation(
    *,
    topic_key: str,
    profile: TopicProfile | None,
    latest_post: Post | None = None,
    content_types: list[str] | None = None,
) -> dict:
    normalized_key = str(topic_key or "").strip()
    primary_type = (content_types or [latest_post.content_type if latest_post else ""])[0] or ""
    haystack = _normalize_topic_haystack(
        normalized_key,
        latest_post.title if latest_post else "",
        latest_post.summary if latest_post else "",
        profile.title if profile else "",
        profile.description if profile else "",
    )
    matched_rule = _match_topic_presentation_rule(normalized_key, haystack)

    context = {
        "topic_key": normalized_key,
        "topic": str(latest_post.title if latest_post else "").strip(),
        "thesis": str(latest_post.summary if latest_post else "").strip(),
        "content_type": primary_type,
    }
    defaults = (_load_topic_presentation_config().get("default_presentation") or {})
    fallback_rule_title = _render_template(defaults.get("zh_title_template"), context)
    fallback_rule_desc = _render_template(defaults.get("zh_description_template"), context)

    manual_title = str(profile.title or "").strip() if profile else ""
    manual_description = str(profile.description or "").strip() if profile else ""

    if profile and manual_title:
        source = "manual" if _topic_profile_is_manual(profile) else "bridged"
        return {
            "display_title": manual_title,
            "description": manual_description
            or str((matched_rule or {}).get("presentation", {}).get("zh_description") or "").strip()
            or fallback_rule_desc
            or _build_topic_fallback_description(manual_title, latest_post),
            "display_title_source": source,
        }

    if matched_rule and matched_rule.get("presentation", {}).get("zh_title"):
        rule_title = matched_rule["presentation"]["zh_title"]
        return {
            "display_title": rule_title,
            "description": str(matched_rule["presentation"].get("zh_description") or "").strip()
            or fallback_rule_desc
            or _build_topic_fallback_description(rule_title, latest_post),
            "display_title_source": "derived",
        }

    if _has_cjk(fallback_rule_title):
        return {
            "display_title": fallback_rule_title,
            "description": fallback_rule_desc or _build_topic_fallback_description(fallback_rule_title, latest_post),
            "display_title_source": "derived",
        }

    fallback_title = _build_topic_fallback_title(normalized_key, latest_post, primary_type)
    return {
        "display_title": fallback_title or normalized_key,
        "description": _build_topic_fallback_description(fallback_title or normalized_key, latest_post),
        "display_title_source": "raw" if fallback_title == normalized_key else "derived",
    }


def _build_topic_presentation_resolver():
    cache: dict[tuple, dict] = {}

    def _resolve_cached(
        *,
        topic_key: str,
        profile: TopicProfile | None,
        latest_post: Post | None = None,
        content_types: list[str] | None = None,
    ) -> dict:
        cache_key = (
            str(topic_key or "").strip().lower(),
            profile.id if profile else None,
            latest_post.id if latest_post else None,
            tuple(sorted({str(item or "") for item in (content_types or [])})),
        )
        if cache_key not in cache:
            cache[cache_key] = _resolve_topic_presentation(
                topic_key=topic_key,
                profile=profile,
                latest_post=latest_post,
                content_types=content_types,
            )
        return cache[cache_key]

    return _resolve_cached


def _parse_discover_sections(sections: str | None) -> set[str] | None:
    if sections is None:
        return None
    allowed = {"featured_series", "latest_daily", "latest_weekly", "editor_picks", "items", "total", "facets"}
    requested = {
        str(item or "").strip()
        for item in sections.split(",")
        if str(item or "").strip()
    }
    selected = {item for item in requested if item in allowed}
    if not selected:
        return set(allowed)
    return selected


def _topic_profile_to_dict(profile: TopicProfile, db: Session) -> dict:
    return _topic_profile_to_dict_with_metrics(profile, db)


def _topic_profile_to_dict_with_metrics(
    profile: TopicProfile,
    db: Session,
    topic_metrics: dict | None = None,
) -> dict:
    metrics = topic_metrics
    if metrics is None:
        metrics = _build_topic_metrics_map(db, [profile.topic_key]).get(profile.topic_key, {})

    post_count = int(metrics.get("post_count") or 0)
    latest_post_at = metrics.get("latest_post_at")
    avg_quality = metrics.get("avg_quality_score")
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


def _latest_timestamp(*values: datetime | None) -> datetime | None:
    latest = None
    for value in values:
        if value is None:
            continue
        current = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if latest is None or current > latest:
            latest = current
    return latest


def _build_topic_metrics_map(
    db: Session,
    topic_keys: list[str] | None = None,
) -> dict[str, dict]:
    stmt = (
        select(
            Post.topic_key.label("topic_key"),
            func.count(Post.id).label("post_count"),
            func.coalesce(func.sum(Post.source_count), 0).label("source_count"),
            func.max(Post.created_at).label("latest_post_at"),
            func.avg(Post.quality_score).label("avg_quality_score"),
        )
        .where(Post.is_published == True)
        .where(Post.topic_key != "")
    )
    if topic_keys:
        stmt = stmt.where(Post.topic_key.in_(topic_keys))

    rows = db.execute(stmt.group_by(Post.topic_key)).all()
    return {
        row.topic_key: {
            "post_count": int(row.post_count or 0),
            "source_count": int(row.source_count or 0),
            "latest_post_at": row.latest_post_at,
            "avg_quality_score": round(float(row.avg_quality_score), 2) if row.avg_quality_score is not None else None,
        }
        for row in rows
        if str(row.topic_key or "").strip()
    }


def _build_topic_content_types_map(
    db: Session,
    topic_keys: list[str] | None = None,
) -> dict[str, list[str]]:
    stmt = (
        select(Post.topic_key, Post.content_type)
        .where(Post.is_published == True)
        .where(Post.topic_key != "")
        .distinct()
    )
    if topic_keys:
        stmt = stmt.where(Post.topic_key.in_(topic_keys))

    content_types_by_key: dict[str, set[str]] = {}
    for topic_key, content_type in db.execute(stmt).all():
        normalized_key = str(topic_key or "").strip()
        if not normalized_key:
            continue
        content_types_by_key.setdefault(normalized_key, set()).add(str(content_type or "post"))

    return {
        key: sorted(values)
        for key, values in content_types_by_key.items()
    }


def _build_latest_topic_posts_map(
    db: Session,
    topic_keys: list[str],
) -> dict[str, Post]:
    normalized_keys = [str(item or "").strip() for item in topic_keys if str(item or "").strip()]
    if not normalized_keys:
        return {}

    ranked_posts = (
        select(
            Post.id.label("post_id"),
            Post.topic_key.label("topic_key"),
            func.row_number().over(
                partition_by=Post.topic_key,
                order_by=(Post.created_at.desc(), Post.id.desc()),
            ).label("row_num"),
        )
        .where(Post.is_published == True)
        .where(Post.topic_key.in_(normalized_keys))
        .subquery()
    )

    latest_rows = db.execute(
        select(ranked_posts.c.topic_key, ranked_posts.c.post_id)
        .where(ranked_posts.c.row_num == 1)
    ).all()
    if not latest_rows:
        return {}

    latest_post_ids = [row.post_id for row in latest_rows]
    topic_key_by_post_id = {row.post_id: row.topic_key for row in latest_rows}
    latest_posts = db.execute(
        select(Post)
        .options(*_post_summary_options())
        .where(Post.id.in_(latest_post_ids))
    ).scalars().all()

    return {
        topic_key_by_post_id[post.id]: post
        for post in latest_posts
        if post.id in topic_key_by_post_id
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


def build_posts_list_payload(
    db: Session,
    *,
    tag: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 10,
):
    stmt = (
        select(Post)
        .options(*_post_summary_options())
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


@router.get("/posts")
def list_posts(
    request: Request,
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    payload = build_posts_list_payload(db, tag=tag, q=q, page=page, page_size=page_size)
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900),
    )


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
            .options(*_post_summary_options())
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
            .options(*_post_summary_options())
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
            .options(*_post_summary_options())
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
        select(Post)
        .options(load_only(Post.id, Post.slug), selectinload(Post.tags).load_only(Tag.id, Tag.name, Tag.slug))
        .where(Post.slug == slug)
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")

    tag_ids = [t.id for t in post.tags]
    if not tag_ids:
        return []

    related = db.execute(
        select(Post)
        .options(*_post_summary_options())
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
def get_archive(request: Request, db: Session = Depends(get_db)):
    posts = db.execute(
        select(Post)
        .options(
            load_only(
                Post.title,
                Post.slug,
                Post.created_at,
                Post.content_type,
                Post.topic_key,
                Post.published_mode,
                Post.coverage_date,
                Post.is_pinned,
            )
        )
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
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
    payload = [{"year": y, "posts": items} for y, items in sorted(groups.items(), reverse=True)]
    last_modified = posts[0].created_at if posts else None
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=120, s_maxage=600, stale_while_revalidate=1800),
        last_modified=last_modified,
    )


# ── 标签云接口 ──

@router.get("/tags")
def get_all_tags(request: Request, db: Session = Depends(get_db)):
    results = db.execute(
        select(Tag.name, Tag.slug, func.count(post_tags.c.post_id).label("post_count"))
        .outerjoin(post_tags, Tag.id == post_tags.c.tag_id)
        .group_by(Tag.id)
        .order_by(func.count(post_tags.c.post_id).desc())
    ).all()
    payload = [{"name": r.name, "slug": r.slug, "post_count": r.post_count} for r in results]
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=300, s_maxage=1800, stale_while_revalidate=3600),
    )


@router.get("/series")
def list_series(
    request: Request,
    featured: bool | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=200),
    db: Session = Depends(get_db),
):
    stmt = select(Series)
    if featured is not None:
        stmt = stmt.where(Series.is_featured == featured)
    stmt = stmt.order_by(Series.is_featured.desc(), Series.sort_order.asc(), Series.updated_at.desc())
    if limit is not None:
        stmt = stmt.limit(limit)
    series_list = db.execute(stmt).scalars().all()
    payload = [_series_to_dict(series, db, include_posts=False) for series in series_list]
    last_modified = max((series.updated_at or series.created_at for series in series_list), default=None)
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=180, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )


@router.get("/series/{slug}")
def get_series_detail(slug: str, request: Request, db: Session = Depends(get_db)):
    series = db.execute(select(Series).where(Series.slug == slug)).scalar_one_or_none()
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")
    payload = _series_to_dict(series, db, include_posts=True)
    last_modified = series.updated_at or series.created_at
    if payload.get("posts"):
        series_post_dates = [
            datetime.fromisoformat(item["updated_at"]) if item.get("updated_at") else datetime.fromisoformat(item["created_at"])
            for item in payload["posts"]
            if item.get("created_at")
        ]
        if series_post_dates:
            last_modified = max([last_modified, *series_post_dates] if last_modified else series_post_dates)
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=120, s_maxage=600, stale_while_revalidate=1800),
        last_modified=last_modified,
    )


@router.get("/discover")
def get_discover(
    request: Request,
    q: str | None = Query(default=None),
    content_type: str | None = Query(default=None),
    series: str | None = Query(default=None),
    limit: int = Query(default=24, ge=1, le=60),
    sections: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    requested = _parse_discover_sections(sections)
    if requested is None:
        requested = {"featured_series", "latest_daily", "latest_weekly", "editor_picks", "items", "total", "facets"}

    payload: dict[str, object] = {}

    if "featured_series" in requested:
        featured_series = db.execute(
            select(Series)
            .where(Series.is_featured == True)
            .order_by(Series.sort_order.asc(), Series.updated_at.desc())
            .limit(6)
        ).scalars().all()
        payload["featured_series"] = [_series_to_dict(series, db, include_posts=False) for series in featured_series]

    if "latest_daily" in requested:
        latest_daily = db.execute(
            select(Post)
            .options(*_post_summary_options())
            .where(Post.is_published == True)
            .where(Post.content_type == "daily_brief")
            .order_by(Post.created_at.desc())
            .limit(8)
        ).scalars().all()
        payload["latest_daily"] = [_post_list_item(post) for post in latest_daily]

    if "latest_weekly" in requested:
        latest_weekly = db.execute(
            select(Post)
            .options(*_post_summary_options())
            .where(Post.is_published == True)
            .where(Post.content_type == "weekly_review")
            .order_by(Post.created_at.desc())
            .limit(6)
        ).scalars().all()
        payload["latest_weekly"] = [_post_list_item(post) for post in latest_weekly]

    if "editor_picks" in requested:
        editor_picks = db.execute(
            select(Post)
            .options(*_post_summary_options())
            .where(Post.is_published == True)
            .order_by(Post.is_pinned.desc(), Post.like_count.desc(), Post.view_count.desc(), Post.created_at.desc())
            .limit(8)
        ).scalars().all()
        payload["editor_picks"] = [_post_list_item(post) for post in editor_picks]

    needs_items_query = bool({"items", "total", "facets"} & requested)
    if needs_items_query:
        items_stmt = select(Post).options(*_post_summary_options()).where(Post.is_published == True)
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

        if "items" in requested:
            payload["items"] = [_post_list_item(post) for post in items]
        if "total" in requested:
            payload["total"] = total
        if "facets" in requested:
            payload["facets"] = {
                "content_types": {
                    "daily_brief": len([post for post in items if (post.content_type or "") == "daily_brief"]),
                    "weekly_review": len([post for post in items if (post.content_type or "") == "weekly_review"]),
                },
                "series": series or "",
            }

    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900),
    )


@router.get("/search")
def search_posts(
    request: Request,
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
        return public_json_response(
            request,
            {"query": "", "items": [], "total": 0, "topics": [], "facets": {}},
            cache_control=build_public_cache_control(max_age=30, s_maxage=180, stale_while_revalidate=600),
        )

    query_terms = [term for term in query.split(" ") if term]
    stmt = (
        select(Post)
        .options(*_post_summary_options())
        .where(Post.is_published == True)
    )
    if content_type:
        stmt = stmt.where(Post.content_type == content_type)
    if series_slug:
        stmt = stmt.where(Post.series_slug == series_slug)
    if topic_key:
        stmt = stmt.where(Post.topic_key == topic_key)

    if query_terms:
        prefilter_clauses = []
        for term in query_terms[:6]:
            pattern = f"%{term}%"
            prefilter_clauses.append(
                or_(
                    Post.title.ilike(pattern),
                    Post.summary.ilike(pattern),
                    Post.topic_key.ilike(pattern),
                    Post.series_slug.ilike(pattern),
                    Post.tags.any(or_(Tag.name.ilike(pattern), Tag.slug.ilike(pattern))),
                )
            )
        stmt = stmt.where(or_(*prefilter_clauses))

    candidate_limit = min(max(limit * 12, 120), 320)
    posts = db.execute(
        stmt.order_by(Post.created_at.desc()).limit(candidate_limit)
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
    profiles_by_key = {profile.topic_key: profile for profile in topic_profiles}
    resolve_topic_presentation = _build_topic_presentation_resolver()
    topic_buckets: dict[str, dict] = {}
    for _, _, post in ranked:
        current_topic_key = (post.topic_key or "").strip()
        if not current_topic_key:
            continue
        bucket = topic_buckets.setdefault(
            current_topic_key,
            {
                "topic_key": current_topic_key,
                "latest_post": post,
                "post_count": 0,
                "latest_post_at": None,
            },
        )
        bucket["post_count"] += 1
        bucket["latest_post"] = bucket["latest_post"] or post
        if post.created_at and (bucket["latest_post_at"] is None or post.created_at > bucket["latest_post_at"]):
            bucket["latest_post_at"] = post.created_at
            bucket["latest_post"] = post

    topics = []
    for value in sorted(
        topic_buckets.values(),
        key=lambda item: (item["post_count"], item["latest_post_at"] or datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )[:6]:
        topic_presentation = resolve_topic_presentation(
            topic_key=value["topic_key"],
            profile=profiles_by_key.get(value["topic_key"]),
            latest_post=value.get("latest_post"),
            content_types=[value.get("latest_post").content_type] if value.get("latest_post") else [],
        )
        topics.append(
            {
                "topic_key": value["topic_key"],
                "title": topic_presentation["display_title"],
                "display_title": topic_presentation["display_title"],
                "post_count": value["post_count"],
                "latest_post_at": value["latest_post_at"].isoformat() if value["latest_post_at"] else None,
            }
        )

    _record_search_insight(db, query, len(ranked))
    available_series = db.execute(
        select(Series).order_by(Series.is_featured.desc(), Series.sort_order.asc(), Series.updated_at.desc())
    ).scalars().all()
    scored_series = [
        (score, series)
        for series in available_series
        for score in [_series_match_score(series, query_terms)]
        if score > 0
    ]
    scored_series.sort(
        key=lambda item: (
            item[0],
            int(bool(item[1].is_featured)),
            item[1].updated_at.timestamp() if item[1].updated_at else 0,
        ),
        reverse=True,
    )
    suggested_series = [_series_to_dict(series, db, include_posts=False) for _, series in scored_series[:4]]
    if not suggested_series:
        fallback_series = [series for series in available_series if bool(series.is_featured)] or available_series
        suggested_series = [_series_to_dict(series, db, include_posts=False) for series in fallback_series[:4]]

    payload = {
        "query": query,
        "items": items,
        "total": len(ranked),
        "topics": topics,
        "series_suggestions": suggested_series,
        "popular_queries": _popular_search_queries(db, query),
        "facets": {
            "content_type": content_type or "",
            "series_slug": series_slug or "",
            "topic_key": topic_key or "",
            "date_from": date_from or "",
            "date_to": date_to or "",
            "sort": sort,
        },
    }
    last_modified = max(
        (
            item[2].updated_at or item[2].created_at
            for item in selected
            if item[2].created_at or item[2].updated_at
        ),
        default=None,
    )
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=30, s_maxage=180, stale_while_revalidate=600),
        last_modified=last_modified,
    )


@router.get("/topics")
def list_topics(
    request: Request,
    q: str | None = Query(default=None),
    featured: bool | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=200),
    page_size: int | None = Query(default=None, ge=1, le=200),
    db: Session = Depends(get_db),
):
    effective_limit = limit or page_size or 50
    profiles = db.execute(
        select(TopicProfile).order_by(TopicProfile.priority.desc(), TopicProfile.updated_at.desc())
    ).scalars().all()
    profiles_by_key = {profile.topic_key: profile for profile in profiles}
    resolve_topic_presentation = _build_topic_presentation_resolver()
    topic_metrics = _build_topic_metrics_map(db)
    all_keys = sorted(set(topic_metrics.keys()) | set(profiles_by_key.keys()))
    latest_posts_by_key = _build_latest_topic_posts_map(db, all_keys)
    content_types_by_key = _build_topic_content_types_map(db, all_keys)

    items_by_key: dict[str, dict] = {}
    query = _normalize_query(q)
    for key in all_keys:
        grouped_value = topic_metrics.get(key, {})
        profile = profiles_by_key.get(key)
        latest_post = latest_posts_by_key.get(key)
        content_types = content_types_by_key.get(key) or _safe_json_list(profile.content_types_json if profile else "[]")
        presentation = resolve_topic_presentation(
            topic_key=key,
            profile=profile,
            latest_post=latest_post,
            content_types=content_types,
        )
        title = presentation["display_title"]
        description = presentation["description"]
        if query and query not in key.lower() and query not in title.lower() and query not in description.lower():
            continue

        items_by_key[key] = {
            "topic_key": key,
            "title": title,
            "display_title": title,
            "description": description,
            "content_types": content_types,
            "series_slug": (profile.series_slug if profile else (latest_post.series_slug if latest_post else None)),
            "taxonomy_type": "topic",
            "post_count": int(grouped_value.get("post_count") or 0),
            "source_count": int(grouped_value.get("source_count") or 0),
            "latest_post_at": grouped_value["latest_post_at"].isoformat() if grouped_value.get("latest_post_at") else None,
            "avg_quality_score": grouped_value.get("avg_quality_score"),
            "display_title_source": presentation["display_title_source"],
            "profile": _topic_profile_to_dict_with_metrics(profile, db, grouped_value) if profile else None,
        }

    ranked_items = sorted(
        items_by_key.values(),
        key=lambda item: (item["post_count"], item["avg_quality_score"] or -1),
        reverse=True,
    )

    if featured is True:
        ordered: list[dict] = []
        seen_keys: set[str] = set()
        manual_profiles = [
            profile
            for profile in profiles
            if bool(profile.is_featured) or _topic_profile_is_manual(profile)
        ]
        manual_profiles.sort(
            key=lambda profile: (
                0 if bool(profile.is_featured) else 1,
                -(profile.priority or 0),
                profile.sort_order or 0,
                -(profile.updated_at.timestamp() if profile.updated_at else 0),
            )
        )
        for profile in manual_profiles:
            topic_item = items_by_key.get(profile.topic_key)
            if not topic_item:
                continue
            if profile.topic_key in seen_keys:
                continue
            ordered.append(topic_item)
            seen_keys.add(profile.topic_key)
        for item in ranked_items:
            topic_key_value = item["topic_key"]
            if topic_key_value in seen_keys:
                continue
            ordered.append(item)
            seen_keys.add(topic_key_value)
        filtered_items = ordered
    elif featured is False:
        filtered_items = [
            item
            for item in ranked_items
            if not bool((profiles_by_key.get(item["topic_key"]).is_featured) if profiles_by_key.get(item["topic_key"]) else False)
        ]
    else:
        filtered_items = ranked_items

    payload = {"items": filtered_items[:effective_limit], "total": len(filtered_items)}
    latest_topic_post_at = max(
        (
            datetime.fromisoformat(item["latest_post_at"])
            for item in filtered_items[:effective_limit]
            if item.get("latest_post_at")
        ),
        default=None,
    )
    last_modified = _latest_timestamp(
        latest_topic_post_at,
        max((profile.updated_at for profile in profiles if profile.updated_at), default=None),
    )
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900),
        last_modified=last_modified,
    )


@router.get("/topics/{topic_key}")
def get_topic_detail(topic_key: str, request: Request, db: Session = Depends(get_db)):
    normalized_topic_key = topic_key.strip()
    if not normalized_topic_key:
        raise HTTPException(status_code=400, detail="topic_key is required")

    profile = db.execute(
        select(TopicProfile).where(TopicProfile.topic_key == normalized_topic_key)
    ).scalar_one_or_none()
    topic_metrics = _build_topic_metrics_map(db, [normalized_topic_key]).get(normalized_topic_key, {})
    recent_posts = db.execute(
        select(Post)
        .options(*_post_summary_options())
        .where(Post.is_published == True)
        .where(Post.topic_key == normalized_topic_key)
        .order_by(Post.created_at.desc())
        .limit(20)
    ).scalars().all()

    if profile is None and not topic_metrics:
        raise HTTPException(status_code=404, detail="Topic not found")

    content_types = _build_topic_content_types_map(db, [normalized_topic_key]).get(normalized_topic_key, [])
    latest = recent_posts[0] if recent_posts else None
    related_series = []
    series_slug = profile.series_slug if profile else (latest.series_slug if latest else None)
    if (series_slug or "").strip():
        related = db.execute(select(Series).where(Series.slug == series_slug)).scalar_one_or_none()
        if related is not None:
            related_series = [_series_to_dict(related, db, include_posts=False)]
    presentation = _resolve_topic_presentation(
        topic_key=normalized_topic_key,
        profile=profile,
        latest_post=latest,
        content_types=content_types,
    )

    payload = {
        "topic_key": normalized_topic_key,
        "title": presentation["display_title"],
        "display_title": presentation["display_title"],
        "description": presentation["description"],
        "content_types": content_types if content_types else _safe_json_list(profile.content_types_json if profile else "[]"),
        "series_slug": (profile.series_slug if profile else (latest.series_slug if latest else None)),
        "taxonomy_type": "topic",
        "post_count": int(topic_metrics.get("post_count") or 0),
        "source_count": int(topic_metrics.get("source_count") or 0),
        "avg_quality_score": topic_metrics.get("avg_quality_score"),
        "latest_post_at": topic_metrics["latest_post_at"].isoformat() if topic_metrics.get("latest_post_at") else None,
        "display_title_source": presentation["display_title_source"],
        "profile": _topic_profile_to_dict_with_metrics(profile, db, topic_metrics) if profile else None,
        "posts": [_post_list_item(post) for post in recent_posts[:20]],
        "recent_posts": [_post_list_item(post) for post in recent_posts[:20]],
        "related_series": related_series,
    }
    last_modified = _latest_timestamp(
        topic_metrics.get("latest_post_at"),
        profile.updated_at if profile else None,
        latest.updated_at if latest else None,
    )
    return public_json_response(
        request,
        payload,
        cache_control=build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900),
        last_modified=last_modified,
    )


@router.get("/feeds/all.xml")
def feed_all(request: Request, db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
        .options(load_only(Post.title, Post.slug, Post.summary, Post.created_at))
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(posts, site_url, RSS_ALL_TITLE, RSS_ALL_DESCRIPTION)
    last_modified = max((post.created_at for post in posts if post.created_at), default=None)
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )


@router.get("/feeds/daily.xml")
def feed_daily(request: Request, db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
        .options(load_only(Post.title, Post.slug, Post.summary, Post.created_at))
        .where(Post.is_published == True)
        .where(Post.content_type == "daily_brief")
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(posts, site_url, RSS_DAILY_TITLE, RSS_DAILY_DESCRIPTION)
    last_modified = max((post.created_at for post in posts if post.created_at), default=None)
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )


@router.get("/feeds/weekly.xml")
def feed_weekly(request: Request, db: Session = Depends(get_db)):
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
        .options(load_only(Post.title, Post.slug, Post.summary, Post.created_at))
        .where(Post.is_published == True)
        .where(Post.content_type == "weekly_review")
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(posts, site_url, RSS_WEEKLY_TITLE, RSS_WEEKLY_DESCRIPTION)
    last_modified = max((post.created_at for post in posts if post.created_at), default=None)
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )


@router.get("/feeds/topics/{topic_key}.xml")
def feed_topic(topic_key: str, request: Request, db: Session = Depends(get_db)):
    normalized_topic_key = topic_key.strip()
    if not normalized_topic_key:
        raise HTTPException(status_code=400, detail="topic_key is required")
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    profile = db.execute(
        select(TopicProfile).where(TopicProfile.topic_key == normalized_topic_key)
    ).scalar_one_or_none()
    posts = db.execute(
        select(Post)
        .options(load_only(Post.title, Post.slug, Post.summary, Post.created_at, Post.content_type))
        .where(Post.is_published == True)
        .where(Post.topic_key == normalized_topic_key)
        .order_by(Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    presentation = _resolve_topic_presentation(
        topic_key=normalized_topic_key,
        profile=profile,
        latest_post=posts[0] if posts else None,
        content_types=sorted(list({(post.content_type or "post") for post in posts})),
    )
    xml_str = _build_feed_xml(
        posts,
        site_url,
        build_topic_feed_title(presentation["display_title"]),
        build_topic_feed_description(presentation["display_title"]),
    )
    last_modified = max((post.created_at for post in posts if post.created_at), default=None)
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )


@router.get("/feeds/series/{slug}.xml")
def feed_series(slug: str, request: Request, db: Session = Depends(get_db)):
    normalized_slug = slug.strip()
    if not normalized_slug:
        raise HTTPException(status_code=400, detail="series slug is required")
    series = db.execute(select(Series).where(Series.slug == normalized_slug)).scalar_one_or_none()
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")
    settings = db.query(SiteSettings).first()
    site_url = resolve_public_site_url(db, settings=settings)
    posts = db.execute(
        select(Post)
        .options(load_only(Post.title, Post.slug, Post.summary, Post.created_at))
        .where(Post.is_published == True)
        .where(Post.series_slug == normalized_slug)
        .order_by(func.coalesce(Post.series_order, 10**9).asc(), Post.created_at.desc())
        .limit(30)
    ).scalars().all()
    xml_str = _build_feed_xml(
        posts,
        site_url,
        build_series_feed_title(series.title or normalized_slug),
        build_series_feed_description(series.title or normalized_slug),
    )
    last_modified = _latest_timestamp(
        max((post.created_at for post in posts if post.created_at), default=None),
        series.updated_at,
        series.created_at,
    )
    return public_text_response(
        request,
        xml_str,
        media_type="application/xml",
        cache_control=build_public_cache_control(max_age=300, s_maxage=900, stale_while_revalidate=3600),
        last_modified=last_modified,
    )

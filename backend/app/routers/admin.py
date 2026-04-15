import json
from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth import create_access_token, get_current_admin, verify_admin
from app.db import get_db
from app.env import clean_env
from app.models import (
    Comment,
    Post,
    PostQualityReview,
    PostQualitySnapshot,
    PostSource,
    PublishingArtifact,
    PublishingRun,
    SearchInsight,
    Series,
    Tag,
    TopicProfile,
)
from app.schemas import (
    CoverGenerateRequest,
    CoverGenerateResponse,
    ContentHealthOut,
    LoginRequest,
    LoginResponse,
    PostQualityDetailOut,
    PostAdminOut,
    PostCreateRequest,
    QualityInboxOut,
    QualitySnapshotOut,
    QualitySnapshotUpsertRequest,
    QualityReviewOut,
    QualityReviewUpsertRequest,
    PublishingMetadataUpsertRequest,
    PublishingMetadataUpsertResponse,
    PostUpdateRequest,
    PublishingRunOut,
    PublishingRunUpsertRequest,
    PublishingStatusResponse,
    TopicFeedbackOut,
    SeriesCreateRequest,
    SeriesOut,
    SeriesUpdateRequest,
    SearchInsightsOut,
    TopicHealthOut,
    TopicMetadataUpsertRequest,
    TopicMetadataUpsertResponse,
    TopicProfileCreateRequest,
    TopicProfileOut,
    TopicProfileUpdateRequest,
    UploadOut,
)
from app.storage import delete_uploaded_image, list_uploaded_images, save_upload

router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB
XAI_IMAGE_MODEL = "grok-imagine-image"


def _build_series_cover_prompt(series: Series, recent_post: Post | None = None) -> str:
    try:
        content_types = json.loads(series.content_types or "[]")
    except (TypeError, json.JSONDecodeError):
        content_types = []

    parts = [
        "Editorial hero image for a Chinese AI blog series.",
        f"Series title: {series.title or series.slug}.",
    ]
    if (series.description or "").strip():
        parts.append(f"Description: {series.description.strip()}.")
    if content_types:
        parts.append(f"Content types: {', '.join(content_types)}.")
    if recent_post and (recent_post.title or "").strip():
        parts.append(f"Representative article: {recent_post.title.strip()}.")
    parts.append("Wide landscape banner, cinematic composition, layered editorial mood, no text overlay, no watermark.")
    return " ".join(parts)


def _build_topic_cover_prompt(profile: TopicProfile, recent_post: Post | None = None) -> str:
    aliases = []
    try:
        aliases = json.loads(profile.aliases_json or "[]")
    except (TypeError, json.JSONDecodeError):
        aliases = []

    parts = [
        "Editorial hero image for a Chinese AI topic page.",
        f"Topic: {profile.title or profile.topic_key}.",
    ]
    if (profile.description or "").strip():
        parts.append(f"Description: {profile.description.strip()}.")
    if aliases:
        parts.append(f"Aliases: {', '.join(str(item).strip() for item in aliases if str(item).strip())}.")
    if recent_post and (recent_post.title or "").strip():
        parts.append(f"Recent article: {recent_post.title.strip()}.")
    if recent_post and (recent_post.summary or "").strip():
        parts.append(f"Recent summary: {recent_post.summary.strip()}.")
    parts.append("Wide landscape banner, cinematic composition, subtle futuristic atmosphere, no text overlay, no watermark.")
    return " ".join(parts)


def _generate_grok_image_url(prompt: str) -> str:
    api_key = clean_env("XAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing XAI_API_KEY")

    response = httpx.post(
        "https://api.x.ai/v1/images/generations",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": XAI_IMAGE_MODEL,
            "prompt": f"Wide landscape banner image, cinematic, high quality: {prompt}",
            "n": 1,
        },
        timeout=60,
    )
    response.raise_for_status()
    image_url = (response.json().get("data") or [{}])[0].get("url")
    if not image_url:
        raise RuntimeError("Grok returned no image URL")
    return image_url


def _download_image_bytes(image_url: str) -> tuple[bytes, str]:
    response = httpx.get(
        image_url,
        headers={"User-Agent": "AIBlogCoverBot/1.0"},
        timeout=30,
        follow_redirects=True,
    )
    response.raise_for_status()
    content_type = (response.headers.get("content-type") or "image/png").split(";")[0].strip() or "image/png"
    return response.content, content_type


def _generate_cover_asset(prompt: str, filename_hint: str) -> str:
    image_url = _generate_grok_image_url(prompt)
    contents, content_type = _download_image_bytes(image_url)
    stored = save_upload(filename_hint, contents, content_type)
    return stored.url


def _post_to_dict(post: Post) -> dict:
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
        "view_count": post.view_count or 0,
        "is_published": post.is_published if post.is_published is not None else True,
        "is_pinned": post.is_pinned if post.is_pinned is not None else False,
        "like_count": post.like_count or 0,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "tags": [{"name": tag.name, "slug": tag.slug} for tag in post.tags],
    }


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _series_to_dict(series: Series, db: Session) -> dict:
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

    return {
        "id": series.id,
        "slug": series.slug,
        "title": series.title,
        "description": series.description or "",
        "cover_image": series.cover_image or "",
        "content_types": content_types,
        "is_featured": bool(series.is_featured),
        "sort_order": series.sort_order or 0,
        "post_count": post_count,
        "latest_post_at": _serialize_datetime(latest_post_at),
        "created_at": _serialize_datetime(series.created_at),
        "updated_at": _serialize_datetime(series.updated_at),
    }


def _build_post_health(post: Post) -> dict:
    issues: list[str] = []
    if not (post.cover_image or "").strip():
        issues.append("missing_cover_image")
    if not (post.series_slug or "").strip():
        issues.append("missing_series")
    if (post.source_count or 0) <= 0:
        issues.append("missing_sources")
    if post.quality_score is None:
        issues.append("missing_quality_score")
    if (post.reading_time or 0) <= 0:
        issues.append("missing_reading_time")
    if not post.is_published:
        issues.append("draft")

    score = max(0, 100 - (len(issues) * 15))
    return {
        "post_id": post.id,
        "slug": post.slug,
        "title": post.title,
        "content_type": post.content_type or "post",
        "coverage_date": post.coverage_date or "",
        "is_published": bool(post.is_published),
        "series_slug": post.series_slug,
        "source_count": post.source_count,
        "quality_score": post.quality_score,
        "reading_time": post.reading_time,
        "has_cover_image": bool((post.cover_image or "").strip()),
        "score": score,
        "issues": issues,
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


def _snapshot_to_dict(snapshot: PostQualitySnapshot | None) -> dict | None:
    if snapshot is None:
        return None
    return {
        "id": snapshot.id,
        "post_id": snapshot.post_id,
        "overall_score": snapshot.overall_score,
        "structure_score": snapshot.structure_score,
        "source_score": snapshot.source_score,
        "analysis_score": snapshot.analysis_score,
        "packaging_score": snapshot.packaging_score,
        "resonance_score": snapshot.resonance_score,
        "issues": _json_list(snapshot.issues_json),
        "strengths": _json_list(snapshot.strengths_json),
        "notes": snapshot.notes or "",
        "generated_at": _serialize_datetime(snapshot.generated_at),
        "updated_at": _serialize_datetime(snapshot.updated_at),
    }


def _review_to_dict(review: PostQualityReview | None) -> dict | None:
    if review is None:
        return None
    return {
        "id": review.id,
        "post_id": review.post_id,
        "editor_verdict": review.editor_verdict or "",
        "editor_labels": _json_list(review.editor_labels_json),
        "editor_note": review.editor_note or "",
        "followup_recommended": review.followup_recommended,
        "reviewed_at": _serialize_datetime(review.reviewed_at),
        "reviewed_by": review.reviewed_by or "",
        "updated_at": _serialize_datetime(review.updated_at),
    }


def _to_avg(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


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
    avg_quality_score = db.execute(
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
        "latest_post_at": _serialize_datetime(latest_post_at),
        "avg_quality_score": round(float(avg_quality_score), 2) if avg_quality_score is not None else None,
        "created_at": _serialize_datetime(profile.created_at),
        "updated_at": _serialize_datetime(profile.updated_at),
    }


def _merge_topic_content_types(existing_json: str | None, content_type: str | None) -> str:
    values = _safe_json_list(existing_json)
    normalized = str(content_type or "").strip()
    if normalized and normalized not in values:
        values.append(normalized)
    return json.dumps(values, ensure_ascii=False)


def _upsert_topic_metadata_payload(
    body: TopicMetadataUpsertRequest,
    *,
    post_id_override: int | None,
    db: Session,
) -> dict:
    target_post_id = post_id_override or body.post_id
    if target_post_id is None and not body.post_slug:
        raise HTTPException(status_code=400, detail="post_id or post_slug is required")

    post_query = select(Post)
    if target_post_id is not None:
        post_query = post_query.where(Post.id == target_post_id)
    else:
        post_query = post_query.where(Post.slug == body.post_slug)

    post = db.execute(post_query).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    snapshot = body.topic_metadata
    resolved_topic_key = (body.resolved_topic_key() or post.topic_key or "").strip()
    if not resolved_topic_key:
        raise HTTPException(status_code=400, detail="topic_key is required")

    if not (post.topic_key or "").strip():
        post.topic_key = resolved_topic_key

    if snapshot and snapshot.source_count is not None:
        post.source_count = snapshot.source_count
    if snapshot and snapshot.reading_time is not None:
        post.reading_time = snapshot.reading_time

    profile = db.execute(
        select(TopicProfile).where(TopicProfile.topic_key == resolved_topic_key)
    ).scalar_one_or_none()

    topic_title = (snapshot.topic_title if snapshot else "") or resolved_topic_key
    topic_description = (snapshot.notes if snapshot else "") or ""
    if profile is None:
        profile = TopicProfile(
            topic_key=resolved_topic_key,
            title=topic_title,
            description=topic_description,
            cover_image="",
            aliases_json=json.dumps([], ensure_ascii=False),
            focus_points_json=json.dumps([], ensure_ascii=False),
            content_types_json=_merge_topic_content_types("[]", post.content_type),
            series_slug=post.series_slug,
            is_featured=False,
            sort_order=0,
            is_active=True,
            priority=1,
        )
        db.add(profile)
        db.flush()
    else:
        if topic_title and not (profile.title or "").strip():
            profile.title = topic_title
        if topic_description and not (profile.description or "").strip():
            profile.description = topic_description
        profile.content_types_json = _merge_topic_content_types(profile.content_types_json, post.content_type)
        if not profile.series_slug and post.series_slug:
            profile.series_slug = post.series_slug

    artifact = db.execute(
        select(PublishingArtifact)
        .where(PublishingArtifact.post_id == post.id)
        .order_by(PublishingArtifact.updated_at.desc(), PublishingArtifact.created_at.desc())
    ).scalar_one_or_none()

    if artifact is None:
        artifact = PublishingArtifact(
            post_id=post.id,
            workflow_key="topic_metadata",
            coverage_date=(snapshot.coverage_date if snapshot else "") or (post.coverage_date or ""),
        )
        db.add(artifact)
        db.flush()

    if snapshot is not None:
        artifact.candidate_topics_json = json.dumps([snapshot.model_dump(mode="json")], ensure_ascii=False)
        if not artifact.coverage_date:
            artifact.coverage_date = snapshot.coverage_date or (post.coverage_date or "")
        artifact.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(post)
    db.refresh(profile)
    db.refresh(artifact)

    return {
        "post_id": post.id,
        "post_slug": post.slug,
        "topic_key": resolved_topic_key,
        "profile_id": profile.id if profile else None,
        "artifact_id": artifact.id if artifact else None,
    }


def _normalize_topic_payload(items, default_mode: str, coverage_date: str) -> list[dict]:
    normalized = []
    for item in items:
        source_names = [name for name in (item.source_names or []) if name]
        normalized.append(
            {
                "topic_key": item.topic_key or item.post_slug or item.title.lower().replace(" ", "-")[:180],
                "title": item.title,
                "summary": item.summary,
                "source_count": item.source_count or len(source_names),
                "source_names": source_names,
                "content_type": item.content_type or "daily_brief",
                "published_mode": item.published_mode or default_mode,
                "coverage_date": item.coverage_date or coverage_date,
                "post_id": item.post_id,
                "post_slug": item.post_slug,
                "published_at": _serialize_datetime(item.published_at),
                "reason": item.reason,
                "status": item.status,
            }
        )
    return normalized


def _deserialize_topic_payload(items: list[dict], default_status: str) -> list[dict]:
    deserialized = []
    for item in items:
        deserialized.append(
            {
                "topic_key": item.get("topic_key", ""),
                "title": item.get("title", ""),
                "summary": item.get("summary", ""),
                "source_count": item.get("source_count", 0),
                "source_names": item.get("source_names", []),
                "content_type": item.get("content_type", "daily_brief"),
                "published_mode": item.get("published_mode", ""),
                "coverage_date": item.get("coverage_date", ""),
                "post_id": item.get("post_id"),
                "post_slug": item.get("post_slug", ""),
                "published_at": item.get("published_at"),
                "reason": item.get("reason", ""),
                "status": item.get("status") or default_status,
            }
        )
    return deserialized


def _run_to_dict(run: PublishingRun) -> dict:
    try:
        payload = json.loads(run.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}

    candidate_topics = _deserialize_topic_payload(payload.get("candidate_topics", []), "candidate")
    published_topics = _deserialize_topic_payload(payload.get("published_topics", []), "published")
    skipped_topics = _deserialize_topic_payload(payload.get("skipped_topics", []), "skipped")
    auto_published_count = sum(1 for topic in published_topics if topic.get("published_mode") == "auto")
    manual_published_count = sum(1 for topic in published_topics if topic.get("published_mode") == "manual")

    return {
        "id": run.id,
        "workflow_key": run.workflow_key,
        "external_run_id": run.external_run_id or "",
        "run_mode": run.run_mode,
        "status": run.status,
        "coverage_date": run.coverage_date or "",
        "message": run.message or "",
        "started_at": _serialize_datetime(run.started_at),
        "finished_at": _serialize_datetime(run.finished_at),
        "updated_at": _serialize_datetime(run.updated_at),
        "summary": {
            "candidate_count": run.candidate_count,
            "published_count": run.published_count,
            "skipped_count": run.skipped_count,
            "auto_published_count": auto_published_count,
            "manual_published_count": manual_published_count,
        },
        "candidate_topics": candidate_topics,
        "published_topics": published_topics,
        "skipped_topics": skipped_topics,
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


def _raise_integrity_http_error(error: IntegrityError) -> None:
    message = str(getattr(error, "orig", error)).lower()
    if "posts.slug" in message or "slug" in message or "unique constraint" in message:
        raise HTTPException(status_code=409, detail="Post slug already exists")
    if "tags.slug" in message:
        raise HTTPException(status_code=409, detail="Tag slug already exists")
    raise HTTPException(status_code=400, detail="Database constraint failed")


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    if not verify_admin(body.username, body.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(data={"sub": body.username})
    return {"access_token": token, "token_type": "bearer"}


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


@router.get("/publishing-status", response_model=PublishingStatusResponse)
def get_publishing_status(
    limit: int = Query(default=8, ge=1, le=20),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    runs = db.execute(
        select(PublishingRun).order_by(PublishingRun.updated_at.desc()).limit(limit)
    ).scalars().all()

    latest_runs: dict[str, dict | None] = {"daily_auto": None, "weekly_review": None}
    recent_runs = []
    for run in runs:
        serialized = _run_to_dict(run)
        recent_runs.append(serialized)
        if run.workflow_key not in latest_runs:
            latest_runs[run.workflow_key] = None
        if latest_runs[run.workflow_key] is None:
            latest_runs[run.workflow_key] = serialized

    recent_posts = db.execute(
        select(Post).options(selectinload(Post.tags)).order_by(Post.created_at.desc()).limit(10)
    ).scalars().all()

    return {
        "latest_runs": latest_runs,
        "recent_runs": recent_runs,
        "recent_posts": [_post_to_dict(post) for post in recent_posts],
    }


@router.post("/publishing-status", response_model=PublishingRunOut)
def upsert_publishing_status(
    body: PublishingRunUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    existing = None
    if body.external_run_id:
        existing = db.execute(
            select(PublishingRun).where(
                PublishingRun.workflow_key == body.workflow_key,
                PublishingRun.external_run_id == body.external_run_id,
            )
        ).scalar_one_or_none()

    candidate_topics = _normalize_topic_payload(body.candidate_topics, body.run_mode, body.coverage_date)
    published_topics = _normalize_topic_payload(body.published_topics, body.run_mode, body.coverage_date)
    skipped_topics = _normalize_topic_payload(body.skipped_topics, body.run_mode, body.coverage_date)

    run = existing or PublishingRun(
        workflow_key=body.workflow_key,
        external_run_id=body.external_run_id,
    )
    run.run_mode = body.run_mode
    run.status = body.status
    run.coverage_date = body.coverage_date
    run.message = body.message
    run.started_at = body.started_at
    run.finished_at = body.finished_at
    run.candidate_count = len(candidate_topics)
    run.published_count = len(published_topics)
    run.skipped_count = len(skipped_topics)
    run.payload_json = json.dumps(
        {
            "candidate_topics": candidate_topics,
            "published_topics": published_topics,
            "skipped_topics": skipped_topics,
        },
        ensure_ascii=False,
    )
    run.updated_at = datetime.now(timezone.utc)

    if existing is None:
        db.add(run)

    db.commit()
    db.refresh(run)
    return _run_to_dict(run)


@router.get("/publishing-runs/{run_id}", response_model=PublishingRunOut)
def get_publishing_run(
    run_id: int,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    run = db.execute(select(PublishingRun).where(PublishingRun.id == run_id)).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Publishing run not found")
    return _run_to_dict(run)


@router.get("/content-health", response_model=ContentHealthOut)
def get_content_health(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    posts = db.execute(
        select(Post).order_by(Post.updated_at.desc()).limit(limit)
    ).scalars().all()
    items = [_build_post_health(post) for post in posts]
    total_posts = db.execute(select(func.count(Post.id))).scalar() or 0
    published_posts = db.execute(select(func.count(Post.id)).where(Post.is_published == True)).scalar() or 0
    posts_with_series = db.execute(
        select(func.count(Post.id))
        .where(Post.series_slug.is_not(None))
        .where(Post.series_slug != "")
    ).scalar() or 0
    posts_with_sources = db.execute(
        select(func.count(Post.id)).where(func.coalesce(Post.source_count, 0) > 0)
    ).scalar() or 0
    posts_with_quality = db.execute(
        select(func.count(Post.id)).where(Post.quality_score.is_not(None))
    ).scalar() or 0

    return {
        "summary": {
            "total_posts": total_posts,
            "posts_with_series": posts_with_series,
            "posts_with_sources": posts_with_sources,
            "posts_with_quality_score": posts_with_quality,
            "published_posts": published_posts,
        },
        "items": items,
    }


@router.get("/quality-inbox", response_model=QualityInboxOut)
def get_quality_inbox(
    limit: int = Query(default=100, ge=1, le=300),
    q: str | None = Query(default=None),
    content_type: str | None = Query(default=None),
    series_slug: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    stmt = (
        select(Post)
        .options(selectinload(Post.quality_snapshot), selectinload(Post.quality_review))
        .order_by(Post.updated_at.desc())
    )
    count_stmt = select(func.count(Post.id))

    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Post.title.ilike(pattern) | Post.slug.ilike(pattern))
        count_stmt = count_stmt.where(Post.title.ilike(pattern) | Post.slug.ilike(pattern))
    if content_type:
        stmt = stmt.where(Post.content_type == content_type)
        count_stmt = count_stmt.where(Post.content_type == content_type)
    if series_slug:
        stmt = stmt.where(Post.series_slug == series_slug)
        count_stmt = count_stmt.where(Post.series_slug == series_slug)

    total_posts = db.execute(count_stmt).scalar() or 0
    posts = db.execute(stmt.limit(limit)).scalars().all()
    items: list[dict] = []
    snapshot_scores: list[float] = []
    with_snapshot_count = 0
    reviewed_count = 0
    followup_recommended_count = 0

    for post in posts:
        snapshot = _snapshot_to_dict(post.quality_snapshot)
        review = _review_to_dict(post.quality_review)
        if snapshot is not None:
            with_snapshot_count += 1
            if snapshot.get("overall_score") is not None:
                snapshot_scores.append(float(snapshot["overall_score"]))
        if review is not None:
            reviewed_count += 1
            if review.get("followup_recommended") is True:
                followup_recommended_count += 1

        items.append(
            {
                "post_id": post.id,
                "slug": post.slug,
                "title": post.title,
                "content_type": post.content_type or "post",
                "coverage_date": post.coverage_date or "",
                "series_slug": post.series_slug,
                "overall_score": snapshot["overall_score"] if snapshot else None,
                "structure_score": snapshot["structure_score"] if snapshot else None,
                "source_score": snapshot["source_score"] if snapshot else None,
                "analysis_score": snapshot["analysis_score"] if snapshot else None,
                "packaging_score": snapshot["packaging_score"] if snapshot else None,
                "resonance_score": snapshot["resonance_score"] if snapshot else None,
                "editor_verdict": review["editor_verdict"] if review else "",
                "followup_recommended": review["followup_recommended"] if review else None,
                "issues": snapshot["issues"] if snapshot else [],
                "strengths": snapshot["strengths"] if snapshot else [],
                "snapshot_updated_at": snapshot["updated_at"] if snapshot else None,
                "reviewed_at": review["reviewed_at"] if review else None,
            }
        )

    return {
        "summary": {
            "total_posts": total_posts,
            "with_snapshot_count": with_snapshot_count,
            "reviewed_count": reviewed_count,
            "followup_recommended_count": followup_recommended_count,
            "avg_overall_score": _to_avg(snapshot_scores),
        },
        "items": items,
    }


@router.get("/posts/{post_id}/quality", response_model=PostQualityDetailOut)
def get_post_quality_detail(
    post_id: int,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = db.execute(
        select(Post)
        .options(selectinload(Post.quality_snapshot), selectinload(Post.quality_review))
        .where(Post.id == post_id)
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    return {
        "post": {
            "id": post.id,
            "slug": post.slug,
            "title": post.title,
            "content_type": post.content_type or "post",
            "coverage_date": post.coverage_date or "",
            "series_slug": post.series_slug,
        },
        "quality_snapshot": _snapshot_to_dict(post.quality_snapshot),
        "quality_review": _review_to_dict(post.quality_review),
    }


@router.put("/posts/{post_id}/quality", response_model=QualitySnapshotOut)
def upsert_post_quality_snapshot(
    post_id: int,
    body: QualitySnapshotUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = db.execute(select(Post).where(Post.id == post_id)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    snapshot = db.execute(
        select(PostQualitySnapshot).where(PostQualitySnapshot.post_id == post_id)
    ).scalar_one_or_none()
    if snapshot is None:
        snapshot = PostQualitySnapshot(post_id=post_id)
        db.add(snapshot)

    payload = body.quality_snapshot
    snapshot.overall_score = payload.overall_score
    snapshot.structure_score = payload.structure_score
    snapshot.source_score = payload.source_score
    snapshot.analysis_score = payload.analysis_score
    snapshot.packaging_score = payload.packaging_score
    snapshot.resonance_score = payload.resonance_score
    snapshot.issues_json = json.dumps(payload.issues, ensure_ascii=False)
    snapshot.strengths_json = json.dumps(payload.strengths, ensure_ascii=False)
    snapshot.notes = payload.notes or ""
    snapshot.generated_at = payload.generated_at or datetime.now(timezone.utc)
    snapshot.updated_at = datetime.now(timezone.utc)

    if payload.source_count is not None:
        post.source_count = payload.source_count
    if payload.quality_score is not None:
        post.quality_score = payload.quality_score
    if payload.reading_time is not None:
        post.reading_time = payload.reading_time

    db.commit()
    db.refresh(snapshot)
    serialized = _snapshot_to_dict(snapshot)
    if serialized is None:
        raise HTTPException(status_code=500, detail="Quality snapshot serialization failed")
    return serialized


@router.put("/posts/{post_id}/quality-review", response_model=QualityReviewOut)
def upsert_post_quality_review(
    post_id: int,
    body: QualityReviewUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = db.execute(select(Post).where(Post.id == post_id)).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    review = db.execute(
        select(PostQualityReview).where(PostQualityReview.post_id == post_id)
    ).scalar_one_or_none()
    if review is None:
        review = PostQualityReview(post_id=post_id)
        db.add(review)

    review.editor_verdict = body.editor_verdict or ""
    review.editor_labels_json = json.dumps(body.editor_labels, ensure_ascii=False)
    review.editor_note = body.editor_note or ""
    review.followup_recommended = body.followup_recommended
    review.reviewed_by = body.reviewed_by or ""
    review.reviewed_at = datetime.now(timezone.utc)
    review.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(review)
    payload = _review_to_dict(review)
    if payload is None:
        raise HTTPException(status_code=500, detail="Quality review serialization failed")
    return payload


@router.get("/topic-feedback", response_model=TopicFeedbackOut)
def get_topic_feedback(
    days: int = Query(default=30, ge=1, le=180),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    posts = db.execute(
        select(Post)
        .options(selectinload(Post.quality_snapshot), selectinload(Post.quality_review))
        .where(Post.created_at >= since)
        .where(Post.is_published == True)
        .order_by(Post.created_at.desc())
    ).scalars().all()

    grouped: dict[tuple[str, str, str], dict] = {}
    for post in posts:
        key = (
            (post.topic_key or "").strip(),
            (post.series_slug or "").strip(),
            post.content_type or "post",
        )
        if key not in grouped:
            grouped[key] = {
                "topic_key": key[0],
                "series_slug": key[1] or None,
                "content_type": key[2],
                "posts": [],
                "overall_scores": [],
                "structure_scores": [],
                "source_scores": [],
                "analysis_scores": [],
                "packaging_scores": [],
                "resonance_scores": [],
                "views": [],
                "likes": [],
                "followup_flags": [],
                "issues_counter": Counter(),
            }
        bucket = grouped[key]
        bucket["posts"].append(post)
        bucket["views"].append(float(post.view_count or 0))
        bucket["likes"].append(float(post.like_count or 0))
        snapshot = post.quality_snapshot
        if snapshot is not None:
            if snapshot.overall_score is not None:
                bucket["overall_scores"].append(float(snapshot.overall_score))
            if snapshot.structure_score is not None:
                bucket["structure_scores"].append(float(snapshot.structure_score))
            if snapshot.source_score is not None:
                bucket["source_scores"].append(float(snapshot.source_score))
            if snapshot.analysis_score is not None:
                bucket["analysis_scores"].append(float(snapshot.analysis_score))
            if snapshot.packaging_score is not None:
                bucket["packaging_scores"].append(float(snapshot.packaging_score))
            if snapshot.resonance_score is not None:
                bucket["resonance_scores"].append(float(snapshot.resonance_score))
            bucket["issues_counter"].update(_json_list(snapshot.issues_json))
        if post.quality_review is not None and post.quality_review.followup_recommended is not None:
            bucket["followup_flags"].append(bool(post.quality_review.followup_recommended))

    items: list[dict] = []
    strong_topic_count = 0
    weak_topic_count = 0
    for bucket in grouped.values():
        sorted_posts = sorted(
            bucket["posts"],
            key=lambda p: p.created_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        latest = sorted_posts[0] if sorted_posts else None
        followup_flags: list[bool] = bucket["followup_flags"]
        followup_rate = None
        if followup_flags:
            followup_rate = round((sum(1 for flag in followup_flags if flag) / len(followup_flags)) * 100, 2)

        avg_overall = _to_avg(bucket["overall_scores"])
        recommendation = "maintain"
        if (avg_overall is not None and avg_overall >= 85) or (followup_rate is not None and followup_rate >= 70):
            recommendation = "expand"
            strong_topic_count += 1
        elif (avg_overall is not None and avg_overall < 65) or (followup_rate is not None and followup_rate < 35):
            recommendation = "improve"
            weak_topic_count += 1

        dominant_issues = [issue for issue, _ in bucket["issues_counter"].most_common(3)]
        items.append(
            {
                "topic_key": bucket["topic_key"],
                "series_slug": bucket["series_slug"],
                "content_type": bucket["content_type"],
                "post_count": len(bucket["posts"]),
                "avg_overall_score": avg_overall,
                "avg_structure_score": _to_avg(bucket["structure_scores"]),
                "avg_source_score": _to_avg(bucket["source_scores"]),
                "avg_analysis_score": _to_avg(bucket["analysis_scores"]),
                "avg_packaging_score": _to_avg(bucket["packaging_scores"]),
                "avg_resonance_score": _to_avg(bucket["resonance_scores"]),
                "avg_views": _to_avg(bucket["views"]) or 0,
                "avg_likes": _to_avg(bucket["likes"]) or 0,
                "followup_rate": followup_rate,
                "dominant_issues": dominant_issues,
                "latest_post_title": latest.title if latest else "",
                "latest_post_slug": latest.slug if latest else "",
                "recommendation": recommendation,
            }
        )

    items.sort(key=lambda item: (item["avg_overall_score"] is not None, item["avg_overall_score"] or 0), reverse=True)
    items = items[:limit]
    strong_topic_count = sum(1 for item in items if item["recommendation"] == "expand")
    weak_topic_count = sum(1 for item in items if item["recommendation"] == "improve")

    return {
        "summary": {
            "topic_count": len(items),
            "strong_topic_count": strong_topic_count,
            "weak_topic_count": weak_topic_count,
        },
        "items": items,
    }


@router.get("/topic-profiles", response_model=list[TopicProfileOut])
def admin_list_topic_profiles(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    profiles = db.execute(
        select(TopicProfile).order_by(TopicProfile.priority.desc(), TopicProfile.updated_at.desc())
    ).scalars().all()
    return [_topic_profile_to_dict(profile, db) for profile in profiles]


@router.post("/topic-profiles", response_model=TopicProfileOut)
def admin_create_topic_profile(
    body: TopicProfileCreateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    existing = db.execute(
        select(TopicProfile).where(TopicProfile.topic_key == body.topic_key)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Topic profile already exists")

    profile = TopicProfile(
        topic_key=body.topic_key,
        title=(body.display_title or body.title or body.topic_key),
        description=body.description or "",
        cover_image=body.cover_image or "",
        aliases_json=json.dumps(body.aliases, ensure_ascii=False),
        focus_points_json=json.dumps(body.focus_points, ensure_ascii=False),
        content_types_json=json.dumps(body.content_types, ensure_ascii=False),
        series_slug=body.series_slug,
        is_featured=body.is_featured,
        sort_order=body.sort_order,
        is_active=body.is_active,
        priority=body.priority,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _topic_profile_to_dict(profile, db)


@router.put("/topic-profiles/{profile_id}", response_model=TopicProfileOut)
def admin_update_topic_profile(
    profile_id: int,
    body: TopicProfileUpdateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    profile = db.execute(select(TopicProfile).where(TopicProfile.id == profile_id)).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="Topic profile not found")

    if body.topic_key is not None:
        conflict = db.execute(
            select(TopicProfile).where(TopicProfile.topic_key == body.topic_key, TopicProfile.id != profile_id)
        ).scalar_one_or_none()
        if conflict is not None:
            raise HTTPException(status_code=409, detail="Topic profile already exists")
        profile.topic_key = body.topic_key
    if body.title is not None:
        profile.title = body.title
    if body.display_title is not None:
        profile.title = body.display_title
    if body.description is not None:
        profile.description = body.description
    if body.cover_image is not None:
        profile.cover_image = body.cover_image
    if body.aliases is not None:
        profile.aliases_json = json.dumps(body.aliases, ensure_ascii=False)
    if body.focus_points is not None:
        profile.focus_points_json = json.dumps(body.focus_points, ensure_ascii=False)
    if body.content_types is not None:
        profile.content_types_json = json.dumps(body.content_types, ensure_ascii=False)
    if body.series_slug is not None:
        profile.series_slug = body.series_slug
    if body.is_featured is not None:
        profile.is_featured = body.is_featured
    if body.sort_order is not None:
        profile.sort_order = body.sort_order
    if body.is_active is not None:
        profile.is_active = body.is_active
    if body.priority is not None:
        profile.priority = body.priority

    db.commit()
    db.refresh(profile)
    return _topic_profile_to_dict(profile, db)


@router.get("/topic-health", response_model=TopicHealthOut)
def get_topic_health(
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    profiles = db.execute(select(TopicProfile)).scalars().all()
    profiles_by_key = {profile.topic_key: profile for profile in profiles}
    posts = db.execute(
        select(Post)
        .where(Post.is_published == True)
        .where(Post.topic_key != "")
        .order_by(Post.created_at.desc())
    ).scalars().all()

    grouped: dict[str, dict] = {}
    for post in posts:
        topic_key = (post.topic_key or "").strip()
        if not topic_key:
            continue
        if topic_key not in grouped:
            grouped[topic_key] = {
                "series_slug": post.series_slug,
                "post_count": 0,
                "quality_scores": [],
                "latest_post_at": post.created_at,
            }
        bucket = grouped[topic_key]
        bucket["post_count"] += 1
        if post.quality_score is not None:
            bucket["quality_scores"].append(float(post.quality_score))
        if post.created_at and (bucket["latest_post_at"] is None or post.created_at > bucket["latest_post_at"]):
            bucket["latest_post_at"] = post.created_at
        if not bucket["series_slug"] and post.series_slug:
            bucket["series_slug"] = post.series_slug

    items = []
    for topic_key, bucket in grouped.items():
        avg_quality = _to_avg(bucket["quality_scores"])
        profile = profiles_by_key.get(topic_key)
        recommendation = "maintain"
        if avg_quality is not None and avg_quality < 65:
            recommendation = "improve"
        elif avg_quality is not None and avg_quality >= 85:
            recommendation = "expand"
        items.append(
            {
                "topic_key": topic_key,
                "series_slug": profile.series_slug if profile and profile.series_slug else bucket["series_slug"],
                "post_count": bucket["post_count"],
                "avg_quality_score": avg_quality,
                "latest_post_at": _serialize_datetime(bucket["latest_post_at"]),
                "profile_exists": profile is not None,
                "recommendation": recommendation,
            }
        )

    items.sort(key=lambda item: (item["post_count"], item["avg_quality_score"] or -1), reverse=True)
    items = items[:limit]
    return {"items": items, "total": len(items)}


@router.post("/series/{series_id}/generate-cover", response_model=CoverGenerateResponse)
def admin_generate_series_cover(
    series_id: int,
    body: CoverGenerateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    series = db.execute(select(Series).where(Series.id == series_id)).scalar_one_or_none()
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")

    try:
        image_url = (body.image_url or "").strip()
        if image_url:
            series.cover_image = image_url
        else:
            if (series.cover_image or "").strip() and not body.overwrite:
                return {
                    "id": series.id,
                    "cover_image": series.cover_image or "",
                    "generated": False,
                    "error": "Cover already exists",
                }
            recent_post = db.execute(
                select(Post)
                .where(Post.series_slug == series.slug)
                .order_by(Post.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            prompt = (body.prompt or "").strip() or _build_series_cover_prompt(series, recent_post)
            if not prompt:
                return {
                    "id": series.id,
                    "cover_image": series.cover_image or "",
                    "generated": False,
                    "error": "No prompt available",
                }
            series.cover_image = _generate_cover_asset(prompt, f"series-{series.slug}.png")

        if not (series.cover_image or "").strip():
            return {
                "id": series.id,
                "cover_image": series.cover_image or "",
                "generated": False,
                "error": "Cover generation failed",
            }
        series.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(series)
        return {
            "id": series.id,
            "cover_image": series.cover_image or "",
            "generated": True,
            "error": "",
        }
    except Exception as exc:
        db.rollback()
        return {
            "id": series.id,
            "cover_image": series.cover_image or "",
            "generated": False,
            "error": str(exc),
        }


@router.post("/topic-profiles/{profile_id}/generate-cover", response_model=CoverGenerateResponse)
def admin_generate_topic_profile_cover(
    profile_id: int,
    body: CoverGenerateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    profile = db.execute(select(TopicProfile).where(TopicProfile.id == profile_id)).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="Topic profile not found")

    try:
        image_url = (body.image_url or "").strip()
        if image_url:
            profile.cover_image = image_url
        else:
            if (profile.cover_image or "").strip() and not body.overwrite:
                return {
                    "id": profile.id,
                    "cover_image": profile.cover_image or "",
                    "generated": False,
                    "error": "Cover already exists",
                }
            recent_post = db.execute(
                select(Post)
                .where(Post.topic_key == profile.topic_key)
                .order_by(Post.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            prompt = (body.prompt or "").strip() or _build_topic_cover_prompt(profile, recent_post)
            if not prompt:
                return {
                    "id": profile.id,
                    "cover_image": profile.cover_image or "",
                    "generated": False,
                    "error": "No prompt available",
                }
            profile.cover_image = _generate_cover_asset(prompt, f"topic-{profile.topic_key}.png")

        if not (profile.cover_image or "").strip():
            return {
                "id": profile.id,
                "cover_image": profile.cover_image or "",
                "generated": False,
                "error": "Cover generation failed",
            }
        profile.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(profile)
        return {
            "id": profile.id,
            "cover_image": profile.cover_image or "",
            "generated": True,
            "error": "",
        }
    except Exception as exc:
        db.rollback()
        return {
            "id": profile.id,
            "cover_image": profile.cover_image or "",
            "generated": False,
            "error": str(exc),
        }


@router.get("/search-insights", response_model=SearchInsightsOut)
def get_search_insights(
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    stmt = select(SearchInsight).order_by(SearchInsight.last_searched_at.desc(), SearchInsight.updated_at.desc())
    if q:
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(SearchInsight.query.ilike(pattern))
    insights = db.execute(stmt.limit(limit)).scalars().all()
    return {
        "items": [
            {
                "id": item.id,
                "query": item.query,
                "search_count": item.search_count or 0,
                "last_result_count": item.last_result_count or 0,
                "first_searched_at": _serialize_datetime(item.first_searched_at),
                "last_searched_at": _serialize_datetime(item.last_searched_at),
                "created_at": _serialize_datetime(item.created_at),
                "updated_at": _serialize_datetime(item.updated_at),
            }
            for item in insights
        ],
        "total": len(insights),
    }


@router.get("/series", response_model=list[SeriesOut])
def admin_list_series(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    series_list = db.execute(
        select(Series).order_by(Series.is_featured.desc(), Series.sort_order.asc(), Series.updated_at.desc())
    ).scalars().all()
    return [_series_to_dict(series, db) for series in series_list]


@router.post("/series", response_model=SeriesOut)
def admin_create_series(
    body: SeriesCreateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    existing = db.execute(select(Series).where(Series.slug == body.slug)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Series slug already exists")

    series = Series(
        slug=body.slug,
        title=body.title,
        description=body.description,
        cover_image=body.cover_image,
        content_types=json.dumps(body.content_types, ensure_ascii=False),
        is_featured=body.is_featured,
        sort_order=body.sort_order,
    )
    db.add(series)
    db.commit()
    db.refresh(series)
    return _series_to_dict(series, db)


@router.put("/series/{series_id}", response_model=SeriesOut)
def admin_update_series(
    series_id: int,
    body: SeriesUpdateRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    series = db.execute(select(Series).where(Series.id == series_id)).scalar_one_or_none()
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")

    if body.slug is not None:
        conflict = db.execute(
            select(Series).where(Series.slug == body.slug, Series.id != series_id)
        ).scalar_one_or_none()
        if conflict is not None:
            raise HTTPException(status_code=409, detail="Series slug already exists")
        series.slug = body.slug
    if body.title is not None:
        series.title = body.title
    if body.description is not None:
        series.description = body.description
    if body.cover_image is not None:
        series.cover_image = body.cover_image
    if body.content_types is not None:
        series.content_types = json.dumps(body.content_types, ensure_ascii=False)
    if body.is_featured is not None:
        series.is_featured = body.is_featured
    if body.sort_order is not None:
        series.sort_order = body.sort_order

    db.commit()
    db.refresh(series)
    return _series_to_dict(series, db)


@router.post("/publishing-metadata", response_model=PublishingMetadataUpsertResponse)
@router.post("/posts/publishing-metadata", response_model=PublishingMetadataUpsertResponse)
def upsert_post_publishing_metadata(
    body: PublishingMetadataUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    if body.post_id is None and not body.post_slug:
        raise HTTPException(status_code=400, detail="post_id or post_slug is required")

    post_query = select(Post)
    if body.post_id is not None:
        post_query = post_query.where(Post.id == body.post_id)
    else:
        post_query = post_query.where(Post.slug == body.post_slug)

    post = db.execute(post_query).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    metadata = body.resolved_metadata()
    sources = body.resolved_sources()
    artifact_input = body.resolved_artifact()

    if metadata.series_slug is not None:
        post.series_slug = metadata.series_slug
    if metadata.series_order is not None:
        post.series_order = metadata.series_order
    if metadata.editor_note is not None:
        post.editor_note = metadata.editor_note
    if metadata.source_count is not None:
        post.source_count = metadata.source_count
    if metadata.quality_score is not None:
        post.quality_score = metadata.quality_score
    if metadata.reading_time is not None:
        post.reading_time = metadata.reading_time

    existing_sources = db.execute(
        select(PostSource).where(PostSource.post_id == post.id)
    ).scalars().all()
    for source in existing_sources:
        db.delete(source)

    inserted_source_count = 0
    for source in sources:
        db.add(
            PostSource(
                post_id=post.id,
                source_type=source.source_type,
                source_name=source.source_name,
                source_url=source.source_url,
                published_at=source.published_at,
                is_primary=source.is_primary,
            )
        )
        inserted_source_count += 1

    if metadata.source_count is None:
        post.source_count = inserted_source_count

    artifact = db.execute(
        select(PublishingArtifact).where(
            PublishingArtifact.post_id == post.id,
            PublishingArtifact.workflow_key == artifact_input.workflow_key,
            PublishingArtifact.coverage_date == artifact_input.coverage_date,
            PublishingArtifact.publishing_run_id == artifact_input.publishing_run_id,
        )
    ).scalar_one_or_none()

    if artifact is None:
        artifact = PublishingArtifact(
            post_id=post.id,
            publishing_run_id=artifact_input.publishing_run_id,
            workflow_key=artifact_input.workflow_key,
            coverage_date=artifact_input.coverage_date,
        )
        db.add(artifact)

    artifact.research_pack_summary = artifact_input.research_pack_summary
    artifact.quality_gate_json = artifact_input.quality_gate_json
    artifact.image_plan_json = artifact_input.image_plan_json
    artifact.candidate_topics_json = artifact_input.candidate_topics_json
    artifact.failure_reason = artifact_input.failure_reason
    artifact.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(post)
    db.refresh(artifact)

    return {
        "post_id": post.id,
        "post_slug": post.slug,
        "source_count": post.source_count or 0,
        "artifact_id": artifact.id,
        "workflow_key": artifact.workflow_key,
        "coverage_date": artifact.coverage_date,
    }


@router.put("/posts/{post_id}/topic-metadata", response_model=TopicMetadataUpsertResponse)
def upsert_post_topic_metadata(
    post_id: int,
    body: TopicMetadataUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    return _upsert_topic_metadata_payload(body, post_id_override=post_id, db=db)


@router.put("/posts/{post_id}/topic-profile", response_model=TopicMetadataUpsertResponse)
def upsert_post_topic_profile_alias(
    post_id: int,
    body: TopicMetadataUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    return _upsert_topic_metadata_payload(body, post_id_override=post_id, db=db)


@router.post("/topic-metadata", response_model=TopicMetadataUpsertResponse)
def upsert_topic_metadata_from_body(
    body: TopicMetadataUpsertRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    return _upsert_topic_metadata_payload(body, post_id_override=None, db=db)


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
        "items": [_post_to_dict(post) for post in posts],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/posts/{post_id}", response_model=PostAdminOut)
def get_admin_post(
    post_id: int,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    post = db.execute(
        select(Post).options(selectinload(Post.tags)).where(Post.id == post_id)
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return _post_to_dict(post)


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
        content_type=body.content_type,
        topic_key=body.topic_key,
        published_mode=body.published_mode,
        coverage_date=body.coverage_date,
        series_slug=body.series_slug,
        series_order=body.series_order,
        editor_note=body.editor_note,
        source_count=body.source_count,
        quality_score=body.quality_score,
        reading_time=body.reading_time,
        is_published=body.is_published,
        is_pinned=body.is_pinned,
    )
    post.tags = _resolve_tags(db, body.tags)
    db.add(post)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        _raise_integrity_http_error(error)
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
    if body.content_type is not None:
        post.content_type = body.content_type
    if body.topic_key is not None:
        post.topic_key = body.topic_key
    if body.published_mode is not None:
        post.published_mode = body.published_mode
    if body.coverage_date is not None:
        post.coverage_date = body.coverage_date
    if body.series_slug is not None:
        post.series_slug = body.series_slug
    if body.series_order is not None:
        post.series_order = body.series_order
    if body.editor_note is not None:
        post.editor_note = body.editor_note
    if body.source_count is not None:
        post.source_count = body.source_count
    if body.quality_score is not None:
        post.quality_score = body.quality_score
    if body.reading_time is not None:
        post.reading_time = body.reading_time
    if body.is_published is not None:
        post.is_published = body.is_published
    if body.is_pinned is not None:
        post.is_pinned = body.is_pinned
    if body.tags is not None:
        post.tags = _resolve_tags(db, body.tags)

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        _raise_integrity_http_error(error)
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
                "id": comment.id,
                "post_id": comment.post_id,
                "nickname": comment.nickname,
                "content": comment.content,
                "ip_address": comment.ip_address or "",
                "is_approved": comment.is_approved,
                "created_at": comment.created_at.isoformat() if comment.created_at else None,
            }
            for comment in comments
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
        raise HTTPException(status_code=404, detail="Comment not found")
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
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()
    return {"detail": "deleted"}


@router.post("/upload", response_model=UploadOut)
def upload_image(
    file: UploadFile = File(...),
    _admin: str = Depends(get_current_admin),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")

    contents = file.file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File size must be 10MB or less")

    stored_image = save_upload(file.filename, contents, file.content_type or "")
    return {"url": stored_image.url}


@router.get("/images")
def list_images(_admin: str = Depends(get_current_admin)):
    return list_uploaded_images()


@router.delete("/images/{filename}")
def delete_image(
    filename: str,
    _admin: str = Depends(get_current_admin),
):
    try:
        delete_uploaded_image(filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid filename")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    return {"detail": "deleted"}

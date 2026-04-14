import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth import create_access_token, get_current_admin, verify_admin
from app.db import get_db
from app.models import Comment, Post, PostSource, PublishingArtifact, PublishingRun, Series, Tag
from app.schemas import (
    ContentHealthOut,
    LoginRequest,
    LoginResponse,
    PostAdminOut,
    PostCreateRequest,
    PublishingMetadataUpsertRequest,
    PublishingMetadataUpsertResponse,
    PostUpdateRequest,
    PublishingRunOut,
    PublishingRunUpsertRequest,
    PublishingStatusResponse,
    SeriesCreateRequest,
    SeriesOut,
    SeriesUpdateRequest,
    UploadOut,
)
from app.storage import delete_uploaded_image, list_uploaded_images, save_upload

router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


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

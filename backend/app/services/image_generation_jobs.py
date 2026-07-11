from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.schema_compat import ensure_admin_image_generation_schema_compat
from app.models import AdminImageGenerationJob, Post, Series, SiteSettings, TopicProfile
from app.services import cover_art as cover_art_service
from app.url_safety import is_public_http_url

logger = logging.getLogger("blog.image_jobs")

JOB_POST_COVER = "post_cover"
JOB_SITE_HERO = "site_hero"
JOB_SERIES_COVER = "series_cover"
JOB_TOPIC_COVER = "topic_cover"

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_CANCELED = "canceled"
TERMINAL_STATUSES = {STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELED}


def _validated_direct_image_url(raw: str) -> str | None:
    """Accept only public http(s) URLs for the admin image_url shortcut.

    Internal / private hosts and non-http schemes are rejected so a compromised
    admin token cannot point covers at metadata endpoints or javascript: URLs.
    Empty input returns None (caller falls through to generation).
    """
    image_url = str(raw or "").strip()
    if not image_url:
        return None
    if not is_public_http_url(image_url, resolve_dns=False):
        raise ValueError("image_url must be a public http(s) address")
    return image_url


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _request_payload(body: Any) -> dict[str, Any]:
    if hasattr(body, "model_dump"):
        return body.model_dump()
    if isinstance(body, dict):
        return dict(body)
    return {}


def _load_request(job: AdminImageGenerationJob) -> dict[str, Any]:
    try:
        parsed = json.loads(job.request_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _finish_success(job: AdminImageGenerationJob, image_url: str, prompt: str | None = None, preset: str | None = None) -> None:
    job.status = STATUS_SUCCEEDED
    job.locked_at = None
    job.result_image_url = image_url or ""
    if prompt is not None:
        job.prompt = prompt or ""
    if preset is not None:
        job.preset = preset or ""
    job.error = ""
    job.error_code = ""
    job.finished_at = _now()
    job.updated_at = _now()


def _finish_failure(job: AdminImageGenerationJob, code: str, message: str, prompt: str | None = None, preset: str | None = None) -> None:
    job.status = STATUS_FAILED
    job.locked_at = None
    job.error_code = code or "unexpected_error"
    job.error = message or "图片生成失败。"
    if prompt is not None:
        job.prompt = prompt or ""
    if preset is not None:
        job.preset = preset or ""
    job.finished_at = _now()
    job.updated_at = _now()


def job_to_dict(job: AdminImageGenerationJob) -> dict[str, Any]:
    image_url = job.result_image_url or ""
    generated = job.status == STATUS_SUCCEEDED and bool(image_url)
    is_hero = job.job_type == JOB_SITE_HERO
    return {
        "id": job.id,
        "job_id": job.id,
        "job_type": job.job_type,
        "target_id": job.target_id,
        "status": job.status,
        "generated": generated,
        "cover_image": "" if is_hero else image_url,
        "hero_image": image_url if is_hero else None,
        "result_image_url": image_url,
        "prompt": job.prompt or None,
        "preset": job.preset or None,
        "art_direction_version": job.art_direction_version or cover_art_service.cover_art_version(),
        "error": job.error or "",
        "error_code": job.error_code or "",
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def list_recent(
    db: Session,
    *,
    limit: int = 30,
    status: str | None = None,
) -> list[AdminImageGenerationJob]:
    """Recent image jobs for admin history dock (cross-device)."""
    ensure_admin_image_generation_schema_compat(db.get_bind())
    limit = max(1, min(int(limit or 30), 100))
    stmt = select(AdminImageGenerationJob).order_by(AdminImageGenerationJob.created_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(AdminImageGenerationJob.status == status)
    return list(db.execute(stmt).scalars().all())


def history_item(job: AdminImageGenerationJob) -> dict[str, Any]:
    data = job_to_dict(job)
    type_labels = {
        JOB_POST_COVER: "文章封面",
        JOB_SITE_HERO: "站点 Hero",
        JOB_SERIES_COVER: "系列封面",
        JOB_TOPIC_COVER: "主题封面",
    }
    label = type_labels.get(job.job_type or "", "图片生成")
    if job.target_id:
        label = f"{label} #{job.target_id}"
    return {
        "kind": "image_generation",
        "job_id": data["job_id"],
        "status": data["status"],
        "label": label,
        "detail": (job.job_type or "") + (f" · {job.error_code}" if job.error_code else ""),
        "error": data.get("error") or "",
        "result_url": data.get("result_image_url") or data.get("cover_image") or data.get("hero_image") or "",
        "result_preview": "",
        "target_type": job.job_type or "",
        "target_id": job.target_id,
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
        "finished_at": data.get("finished_at"),
        "source": "server",
    }


def create_job(db: Session, *, job_type: str, target_id: int | None, body: Any) -> AdminImageGenerationJob:
    ensure_admin_image_generation_schema_compat(db.get_bind())
    payload = _request_payload(body)
    job = AdminImageGenerationJob(
        job_type=job_type,
        target_id=target_id,
        status=STATUS_QUEUED,
        request_json=json.dumps(payload, ensure_ascii=False),
        art_direction_version=cover_art_service.cover_art_version(),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_stale_running_failed(db: Session, *, max_age_minutes: int = 60) -> int:
    ensure_admin_image_generation_schema_compat(db.get_bind())
    cutoff = _now() - timedelta(minutes=max_age_minutes)
    running_jobs = db.execute(
        select(AdminImageGenerationJob)
        .where(AdminImageGenerationJob.status == STATUS_RUNNING)
        .where(AdminImageGenerationJob.locked_at.is_not(None))
        .where(AdminImageGenerationJob.locked_at < cutoff)
    ).scalars().all()
    queued_jobs = db.execute(
        select(AdminImageGenerationJob)
        .where(AdminImageGenerationJob.status == STATUS_QUEUED)
        .where(AdminImageGenerationJob.created_at < cutoff)
    ).scalars().all()
    jobs = [*running_jobs, *queued_jobs]
    for job in jobs:
        _finish_failure(job, "stale_job", "生成任务执行超时或服务重启，请重新发起生成。", job.prompt or None, job.preset or None)
    if jobs:
        db.commit()
    return len(jobs)


def run_job(job_id: int, *, executor) -> None:
    db = SessionLocal()
    try:
        job = db.get(AdminImageGenerationJob, job_id)
        if job is None or job.status in TERMINAL_STATUSES:
            return
        job.status = STATUS_RUNNING
        job.started_at = job.started_at or _now()
        job.locked_at = _now()
        job.attempt_count = (job.attempt_count or 0) + 1
        job.updated_at = _now()
        db.commit()

        try:
            _execute_job(db, job, executor=executor)
        except Exception:
            logger.exception("image_generation_job_unhandled job_id=%s", job_id)
            db.rollback()
            job = db.get(AdminImageGenerationJob, job_id)
            if job is not None:
                _finish_failure(job, "unexpected_error", "图片生成出现未预期错误，请查看后端日志。", job.prompt or None, job.preset or None)
                db.commit()
    finally:
        db.close()


def _execute_job(db: Session, job: AdminImageGenerationJob, *, executor) -> None:
    payload = _load_request(job)
    if job.job_type == JOB_POST_COVER:
        _execute_post_cover(db, job, payload, executor=executor)
    elif job.job_type == JOB_SITE_HERO:
        _execute_site_hero(db, job, payload, executor=executor)
    elif job.job_type == JOB_SERIES_COVER:
        _execute_series_cover(db, job, payload, executor=executor)
    elif job.job_type == JOB_TOPIC_COVER:
        _execute_topic_cover(db, job, payload, executor=executor)
    else:
        _finish_failure(job, "invalid_job_type", "未知图片生成任务类型。")
    db.commit()


def _execute_post_cover(db: Session, job: AdminImageGenerationJob, payload: dict[str, Any], *, executor) -> None:
    post = db.get(Post, job.target_id or 0)
    if post is None:
        _finish_failure(job, "not_found", "Post not found")
        return
    preset = "post_cover"
    prompt = cover_art_service.sanitize_cover_prompt(payload.get("prompt") or "")
    try:
        image_url = _validated_direct_image_url(str(payload.get("image_url") or ""))
    except ValueError:
        _finish_failure(job, "invalid_image_url", "image_url 必须是可公开访问的 http(s) 地址。", prompt or None, preset)
        return
    overwrite = bool(payload.get("overwrite"))
    preview = payload.get("mode") == "preview"
    if image_url:
        if not preview:
            post.cover_image = image_url
            post.updated_at = _now()
        _finish_success(job, image_url, prompt or None, preset)
        return
    if (post.cover_image or "").strip() and not overwrite and not preview:
        _finish_failure(job, "cover_exists", "当前文章已经有封面，如需覆盖请使用重生成。", prompt or None, preset)
        return
    artifact_prompt = executor.extract_post_cover_prompt_from_artifact(post.id, db)
    refined_prompt = ""
    if hasattr(executor, "refine_post_cover_prompt"):
        refined_prompt = executor.refine_post_cover_prompt(db, post, artifact_prompt=artifact_prompt, manual_prompt=prompt)
    prompt = cover_art_service.build_post_cover_prompt(post, artifact_prompt=artifact_prompt, manual_prompt=refined_prompt or prompt)
    if not prompt:
        _finish_failure(job, "prompt_unavailable", "当前文章缺少可用提示词，暂时无法生成封面。", prompt or None, preset)
        return
    try:
        generated_image_url = executor.generate_cover_asset(db, prompt, f"post-{post.slug or post.id}.png", framing_hint=cover_art_service.preset_framing_hint(preset))
    except executor.CoverGenerationError as exc:
        _finish_failure(job, exc.code, exc.message, prompt or None, preset)
        return
    if not preview:
        post.cover_image = generated_image_url
        post.updated_at = _now()
    _finish_success(job, generated_image_url or "", prompt, preset)


def _execute_site_hero(db: Session, job: AdminImageGenerationJob, payload: dict[str, Any], *, executor) -> None:
    settings = db.execute(select(SiteSettings).limit(1)).scalar_one_or_none()
    if settings is None:
        settings = SiteSettings(id=1)
        db.add(settings)
        db.flush()
    preset = "site_hero"
    prompt = cover_art_service.sanitize_cover_prompt(payload.get("prompt") or "")
    try:
        image_url = _validated_direct_image_url(str(payload.get("image_url") or ""))
    except ValueError:
        _finish_failure(job, "invalid_image_url", "image_url 必须是可公开访问的 http(s) 地址。", prompt or None, preset)
        return
    overwrite = True if payload.get("overwrite") is None else bool(payload.get("overwrite"))
    if image_url:
        settings.hero_image = image_url
        _finish_success(job, image_url, prompt or None, preset)
        executor.trigger_frontend_refresh_safe(event="site_hero.updated")
        return
    if (settings.hero_image or "").strip() and not overwrite:
        _finish_failure(job, "cover_exists", "当前 Hero 海报已经存在，如需覆盖请使用重生成。", prompt or None, preset)
        return
    prompt = cover_art_service.build_site_hero_prompt(settings, manual_prompt=prompt)
    if not prompt:
        _finish_failure(job, "prompt_unavailable", "当前站点缺少可用提示词，暂时无法生成 Hero 海报。", prompt or None, preset)
        return
    try:
        settings.hero_image = executor.generate_cover_asset(db, prompt, "site-hero-poster.png", framing_hint=cover_art_service.preset_framing_hint(preset))
    except executor.CoverGenerationError as exc:
        _finish_failure(job, "missing_env" if exc.code == "missing_backend_env" else exc.code, exc.message, prompt or None, preset)
        return
    _finish_success(job, settings.hero_image or "", prompt, preset)
    executor.trigger_frontend_refresh_safe(event="site_hero.updated")


def _execute_series_cover(db: Session, job: AdminImageGenerationJob, payload: dict[str, Any], *, executor) -> None:
    series = db.get(Series, job.target_id or 0)
    if series is None:
        _finish_failure(job, "not_found", "Series not found")
        return
    preset = "series_cover"
    prompt = cover_art_service.sanitize_cover_prompt(payload.get("prompt") or "")
    try:
        image_url = _validated_direct_image_url(str(payload.get("image_url") or ""))
    except ValueError:
        _finish_failure(job, "invalid_image_url", "image_url 必须是可公开访问的 http(s) 地址。", prompt or None, preset)
        return
    overwrite = bool(payload.get("overwrite"))
    if image_url:
        series.cover_image = image_url
        series.updated_at = _now()
        _finish_success(job, image_url, prompt or None, preset)
        return
    if (series.cover_image or "").strip() and not overwrite:
        _finish_failure(job, "cover_exists", "当前系列已经有封面，如需覆盖请使用重生成。", prompt or None, preset)
        return
    recent_post = db.execute(select(Post).where(Post.series_slug == series.slug).order_by(Post.created_at.desc()).limit(1)).scalar_one_or_none()
    prompt = cover_art_service.build_series_cover_prompt(series, recent_post, manual_prompt=prompt)
    if not prompt:
        _finish_failure(job, "prompt_unavailable", "当前系列缺少可用提示词，暂时无法生成封面。", prompt or None, preset)
        return
    try:
        series.cover_image = executor.generate_cover_asset(db, prompt, f"series-{series.slug}.png", framing_hint=cover_art_service.preset_framing_hint(preset))
    except executor.CoverGenerationError as exc:
        _finish_failure(job, exc.code, exc.message, prompt or None, preset)
        return
    series.updated_at = _now()
    _finish_success(job, series.cover_image or "", prompt, preset)


def _execute_topic_cover(db: Session, job: AdminImageGenerationJob, payload: dict[str, Any], *, executor) -> None:
    profile = db.get(TopicProfile, job.target_id or 0)
    if profile is None:
        _finish_failure(job, "not_found", "Topic profile not found")
        return
    preset = "topic_cover"
    prompt = cover_art_service.sanitize_cover_prompt(payload.get("prompt") or "")
    try:
        image_url = _validated_direct_image_url(str(payload.get("image_url") or ""))
    except ValueError:
        _finish_failure(job, "invalid_image_url", "image_url 必须是可公开访问的 http(s) 地址。", prompt or None, preset)
        return
    overwrite = bool(payload.get("overwrite"))
    if image_url:
        profile.cover_image = image_url
        profile.updated_at = _now()
        _finish_success(job, image_url, prompt or None, preset)
        return
    if (profile.cover_image or "").strip() and not overwrite:
        _finish_failure(job, "cover_exists", "当前主题已经有封面，如需覆盖请使用重生成。", prompt or None, preset)
        return
    recent_post = db.execute(select(Post).where(Post.topic_key == profile.topic_key).order_by(Post.created_at.desc()).limit(1)).scalar_one_or_none()
    prompt = cover_art_service.build_topic_cover_prompt(profile, recent_post, manual_prompt=prompt)
    if not prompt:
        _finish_failure(job, "prompt_unavailable", "当前主题缺少可用提示词，暂时无法生成封面。", prompt or None, preset)
        return
    try:
        profile.cover_image = executor.generate_cover_asset(db, prompt, f"topic-{profile.topic_key}.png", framing_hint=cover_art_service.preset_framing_hint(preset))
    except executor.CoverGenerationError as exc:
        _finish_failure(job, exc.code, exc.message, prompt or None, preset)
        return
    profile.updated_at = _now()
    _finish_success(job, profile.cover_image or "", prompt, preset)

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AdminTextGenerationJob
from app.schema_compat import ensure_admin_text_generation_schema_compat
from app.services import ai_channels

logger = logging.getLogger("blog.text_jobs")

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_CANCELED = "canceled"
TERMINAL_STATUSES = {STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELED}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _request_payload(body: Any) -> dict[str, Any]:
    if hasattr(body, "model_dump"):
        return body.model_dump()
    if isinstance(body, dict):
        return dict(body)
    return {}


def _load_request(job: AdminTextGenerationJob) -> dict[str, Any]:
    try:
        parsed = json.loads(job.request_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _finish_success(
    job: AdminTextGenerationJob,
    *,
    content: str,
    provider: str = "",
    model: str = "",
) -> None:
    job.status = STATUS_SUCCEEDED
    job.locked_at = None
    job.result_content = content or ""
    job.provider = provider or ""
    job.model = model or ""
    job.error = ""
    job.error_code = ""
    job.finished_at = _now()
    job.updated_at = _now()


def _finish_failure(job: AdminTextGenerationJob, code: str, message: str) -> None:
    job.status = STATUS_FAILED
    job.locked_at = None
    job.error_code = code or "unexpected_error"
    job.error = message or "文本生成失败。"
    job.finished_at = _now()
    job.updated_at = _now()


def job_to_dict(job: AdminTextGenerationJob) -> dict[str, Any]:
    content = job.result_content or ""
    generated = job.status == STATUS_SUCCEEDED and bool(content)
    return {
        "id": job.id,
        "job_id": job.id,
        "status": job.status,
        "generated": generated,
        "content": content,
        "provider": job.provider or "",
        "model": job.model or "",
        "purpose": job.purpose or ai_channels.TEXT_PURPOSE,
        "error": job.error or "",
        "error_code": job.error_code or "",
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def create_job(db: Session, body: Any) -> AdminTextGenerationJob:
    ensure_admin_text_generation_schema_compat(db.get_bind())
    payload = _request_payload(body)
    job = AdminTextGenerationJob(
        status=STATUS_QUEUED,
        request_json=json.dumps(payload, ensure_ascii=False),
        purpose=ai_channels.TEXT_PURPOSE,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_stale_running_failed(db: Session, *, max_age_minutes: int = 30) -> int:
    ensure_admin_text_generation_schema_compat(db.get_bind())
    cutoff = _now() - timedelta(minutes=max_age_minutes)
    running_jobs = db.execute(
        select(AdminTextGenerationJob)
        .where(AdminTextGenerationJob.status == STATUS_RUNNING)
        .where(AdminTextGenerationJob.locked_at.is_not(None))
        .where(AdminTextGenerationJob.locked_at < cutoff)
    ).scalars().all()
    queued_jobs = db.execute(
        select(AdminTextGenerationJob)
        .where(AdminTextGenerationJob.status == STATUS_QUEUED)
        .where(AdminTextGenerationJob.created_at < cutoff)
    ).scalars().all()
    jobs = [*running_jobs, *queued_jobs]
    for job in jobs:
        _finish_failure(job, "stale_job", "文本生成任务执行超时或服务重启，请重新发起生成。")
    if jobs:
        db.commit()
    return len(jobs)


def run_job(job_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.get(AdminTextGenerationJob, job_id)
        if job is None or job.status in TERMINAL_STATUSES:
            return
        job.status = STATUS_RUNNING
        job.started_at = job.started_at or _now()
        job.locked_at = _now()
        job.attempt_count = (job.attempt_count or 0) + 1
        job.updated_at = _now()
        db.commit()

        try:
            _execute_job(db, job)
        except Exception:
            logger.exception("text_generation_job_unhandled job_id=%s", job_id)
            db.rollback()
            job = db.get(AdminTextGenerationJob, job_id)
            if job is not None:
                _finish_failure(job, "unexpected_error", "文本生成出现未预期错误，请查看后端日志。")
                db.commit()
    finally:
        db.close()


def _execute_job(db: Session, job: AdminTextGenerationJob) -> None:
    payload = _load_request(job)
    raw_messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    messages: list[dict[str, str]] = []
    for item in raw_messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role and content:
            messages.append({"role": role, "content": content})
    if not messages:
        _finish_failure(job, "invalid_request", "文本生成请求缺少有效 messages。")
        db.commit()
        return

    max_tokens = payload.get("max_tokens")
    temperature = payload.get("temperature")
    json_mode = bool(payload.get("json_mode"))
    try:
        content, selected = ai_channels.generate_text(
            db,
            messages,
            max_tokens=int(max_tokens) if max_tokens is not None else None,
            temperature=float(temperature) if temperature is not None else None,
            json_mode=json_mode,
            return_selected=True,
        )
        _finish_success(
            job,
            content=str(content or ""),
            provider=getattr(selected, "provider", "") or "",
            model=getattr(selected, "model", "") or "",
        )
    except ai_channels.AiChannelError as exc:
        _finish_failure(job, exc.code or "generation_failed", exc.message or "文本生成失败。")
    db.commit()

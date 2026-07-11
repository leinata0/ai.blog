"""Visitor user system: registration, login, profile, and cloud sync.

Visitor tokens use ``aud="user"`` and ``sub=str(user.id)`` (see app.user_auth),
keeping them isolated from admin tokens (``aud="admin"``).
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import USER_TOKEN_AUDIENCE, create_access_token
from app.client_ip import client_ip_from_request
from app.db import get_db
from app.email_verification import decode_verify_token, send_verification_email
from app.models import Comment, FollowedTopic, Post, PostLike, ReadingHistory, SiteSettings, User
from app.notifications import is_valid_email
from app.passwords import hash_password, verify_password
from app.rate_limit import limiter
from app.services.user_account import purge_user
from app.site_config import resolve_public_site_url
from app.storage import ImageValidationError, save_upload, validate_image_upload
from app.turnstile import turnstile_ready, verify_turnstile
from app.schemas import (
    FollowTopicInput,
    FollowTopicsMergeInput,
    FollowedTopicOut,
    PasswordChangeRequest,
    ReadingHistoryInput,
    ReadingHistoryMergeInput,
    ReadingHistoryOut,
    UserAuthResponse,
    UserLoginRequest,
    UserOut,
    UserProfileUpdate,
    UserRegisterRequest,
    VerifyEmailRequest,
)
from app.user_auth import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])

MAX_READING_HISTORY = 100  # mirror frontend utils/topicRetention.js cap
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB


def _default_nickname(email: str) -> str:
    return email.split("@", 1)[0][:50]


def _issue_token(user: User) -> str:
    return create_access_token(data={"sub": str(user.id)}, audience=USER_TOKEN_AUDIENCE)


def _site_url(db: Session) -> str:
    settings = db.execute(select(SiteSettings)).scalar_one_or_none()
    return resolve_public_site_url(db, settings=settings)


def _check_turnstile(request: Request, token: str | None) -> None:
    """Verify the Turnstile token when protection is configured; no-op otherwise."""
    if not turnstile_ready():
        return
    if not verify_turnstile(token, client_ip_from_request(request)):
        raise HTTPException(status_code=400, detail="人机验证未通过，请重试")


# ── Authentication ────────────────────────────────

@router.post("/register", response_model=UserAuthResponse)
@limiter.limit("5/minute")
def register(request: Request, body: UserRegisterRequest, db: Session = Depends(get_db)):
    _check_turnstile(request, body.turnstile_token)
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册")

    nickname = (body.nickname or "").strip() or _default_nickname(email)
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        nickname=nickname,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # Best-effort verification email (no-op when email delivery isn't configured).
    try:
        send_verification_email(user, _site_url(db))
    except Exception:
        pass
    return {"access_token": _issue_token(user), "token_type": "bearer", "user": user}


@router.post("/login", response_model=UserAuthResponse)
@limiter.limit("5/minute")
def login(request: Request, body: UserLoginRequest, db: Session = Depends(get_db)):
    _check_turnstile(request, body.turnstile_token)
    email = (body.email or "").strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    if user.status == "banned":
        raise HTTPException(status_code=403, detail="账号已被封禁")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return {"access_token": _issue_token(user), "token_type": "bearer", "user": user}


# ── Profile ───────────────────────────────────────

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserOut)
def update_me(
    body: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.nickname is not None:
        nickname = body.nickname.strip()
        if nickname:
            current_user.nickname = nickname
    # avatar_url is intentionally ignored on this endpoint: only the dedicated
    # /me/avatar upload path may set it (validated magic-bytes + rehosted storage).
    # Accepting arbitrary client URLs would allow javascript:/tracking payloads
    # rendered as <img src> in comments.
    if body.avatar_url is not None and body.avatar_url.strip():
        raise HTTPException(
            status_code=400,
            detail="Please set avatar via the upload endpoint; direct avatar_url writes are not allowed",
        )
    if body.bio is not None:
        current_user.bio = body.bio.strip()
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/password")
def change_password(
    body: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="原密码不正确")
    current_user.password_hash = hash_password(body.new_password)
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "密码已更新"}


# ── Email verification ────────────────────────────

@router.post("/verify-email", response_model=UserOut)
def verify_email(body: VerifyEmailRequest, db: Session = Depends(get_db)):
    user_id = decode_verify_token(body.token)
    if user_id is None:
        raise HTTPException(status_code=400, detail="验证链接无效或已过期")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not user.email_verified:
        user.email_verified = True
        user.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
    return user


@router.post("/resend-verification")
@limiter.limit("3/minute")
def resend_verification(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.email_verified:
        return {"message": "邮箱已验证"}
    sent = send_verification_email(current_user, _site_url(db))
    if not sent:
        raise HTTPException(status_code=503, detail="邮件服务未配置，暂时无法发送验证邮件")
    return {"message": "验证邮件已发送，请查收"}


# ── Followed topics (cloud sync) ──────────────────

@router.get("/me/topics", response_model=list[FollowedTopicOut])
def list_followed_topics(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(FollowedTopic)
        .where(FollowedTopic.user_id == current_user.id)
        .order_by(FollowedTopic.followed_at.desc())
    ).scalars().all()
    return rows


def _upsert_followed_topic(db: Session, user_id: int, item: FollowTopicInput) -> FollowedTopic:
    topic_key = item.topic_key.strip()
    existing = db.execute(
        select(FollowedTopic).where(
            FollowedTopic.user_id == user_id,
            FollowedTopic.topic_key == topic_key,
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = FollowedTopic(
            user_id=user_id,
            topic_key=topic_key,
            display_title=item.display_title.strip(),
        )
        db.add(existing)
    elif item.display_title.strip():
        existing.display_title = item.display_title.strip()
    return existing


@router.post("/me/topics", response_model=list[FollowedTopicOut])
def follow_topic(
    body: FollowTopicInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _upsert_followed_topic(db, current_user.id, body)
    db.commit()
    return list_followed_topics(current_user, db)


@router.delete("/me/topics/{topic_key}", response_model=list[FollowedTopicOut])
def unfollow_topic(
    topic_key: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.execute(
        select(FollowedTopic).where(
            FollowedTopic.user_id == current_user.id,
            FollowedTopic.topic_key == topic_key.strip(),
        )
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()
    return list_followed_topics(current_user, db)


@router.post("/me/topics/merge", response_model=list[FollowedTopicOut])
def merge_topics(
    body: FollowTopicsMergeInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Idempotent: upsert each incoming topic; existing follows are preserved.
    seen: set[str] = set()
    for item in body.topics:
        key = item.topic_key.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        _upsert_followed_topic(db, current_user.id, item)
    db.commit()
    return list_followed_topics(current_user, db)


# ── Reading history (cloud sync) ──────────────────

def _list_history(db: Session, user_id: int) -> list[ReadingHistory]:
    return db.execute(
        select(ReadingHistory)
        .where(ReadingHistory.user_id == user_id)
        .order_by(ReadingHistory.visited_at.desc())
        .limit(MAX_READING_HISTORY)
    ).scalars().all()


def _trim_history(db: Session, user_id: int) -> None:
    # Keep only the newest MAX_READING_HISTORY entries per user.
    stale = db.execute(
        select(ReadingHistory)
        .where(ReadingHistory.user_id == user_id)
        .order_by(ReadingHistory.visited_at.desc())
        .offset(MAX_READING_HISTORY)
    ).scalars().all()
    for row in stale:
        db.delete(row)


def _upsert_history(db: Session, user_id: int, item: ReadingHistoryInput) -> None:
    slug = item.slug.strip()
    visited_at = item.visited_at or datetime.now(timezone.utc)
    existing = db.execute(
        select(ReadingHistory).where(
            ReadingHistory.user_id == user_id,
            ReadingHistory.slug == slug,
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = ReadingHistory(user_id=user_id, slug=slug)
        db.add(existing)
    existing.title = item.title.strip()
    existing.topic_key = item.topic_key.strip()
    existing.topic_display_title = item.topic_display_title.strip()
    existing.content_type = item.content_type.strip()
    existing.coverage_date = item.coverage_date.strip()
    # Keep the most recent visit timestamp when merging.
    if existing.visited_at is None or visited_at > _as_aware(existing.visited_at):
        existing.visited_at = visited_at


def _as_aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@router.get("/me/history", response_model=list[ReadingHistoryOut])
def list_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _list_history(db, current_user.id)


@router.post("/me/history", response_model=list[ReadingHistoryOut])
def record_history(
    body: ReadingHistoryInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _upsert_history(db, current_user.id, body)
    _trim_history(db, current_user.id)
    db.commit()
    return _list_history(db, current_user.id)


@router.post("/me/history/merge", response_model=list[ReadingHistoryOut])
def merge_history(
    body: ReadingHistoryMergeInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    seen: set[str] = set()
    for item in body.items:
        slug = item.slug.strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        _upsert_history(db, current_user.id, item)
    _trim_history(db, current_user.id)
    db.commit()
    return _list_history(db, current_user.id)


# ── Avatar upload ─────────────────────────────────

@router.post("/me/avatar", response_model=UserOut)
@limiter.limit("10/minute")
def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    contents = file.file.read(MAX_AVATAR_SIZE + 1)
    try:
        detected = validate_image_upload(
            file.filename, file.content_type or "", contents, max_size=MAX_AVATAR_SIZE
        )
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stored = save_upload(file.filename, contents, detected)
    current_user.avatar_url = stored.url
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return current_user


# ── My comments / likes ───────────────────────────

@router.get("/me/comments")
def list_my_comments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Comment, Post.slug, Post.title)
        .join(Post, Comment.post_id == Post.id)
        .where(Comment.user_id == current_user.id)
        .order_by(Comment.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": comment.id,
            "content": comment.content,
            "post_slug": slug,
            "post_title": title,
            "created_at": comment.created_at.isoformat() if comment.created_at else None,
        }
        for comment, slug, title in rows
    ]


@router.get("/me/likes")
def list_my_likes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(PostLike, Post.slug, Post.title)
        .join(Post, PostLike.post_id == Post.id)
        .where(PostLike.user_id == current_user.id)
        .order_by(PostLike.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "post_slug": slug,
            "post_title": title,
            "created_at": like.created_at.isoformat() if like.created_at else None,
        }
        for like, slug, title in rows
    ]


# ── Delete account ────────────────────────────────

@router.delete("/me")
def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    purge_user(db, current_user)
    db.commit()
    return {"detail": "deleted"}

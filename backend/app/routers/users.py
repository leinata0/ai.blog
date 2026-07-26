"""Visitor user system: registration, login, profile, and cloud sync.

Visitor tokens use ``aud="user"`` and ``sub=str(user.id)`` (see app.user_auth),
keeping them isolated from admin tokens (``aud="admin"``).
"""
import json
import logging
import secrets
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import USER_TOKEN_AUDIENCE, create_access_token
from app.auth_challenges import (
    LOGIN_PURPOSE,
    PASSWORD_RESET_PURPOSE,
    AuthCodeCooldown,
    AuthCodeError,
    consume_challenge,
    create_challenge,
    normalize_email,
    send_auth_code_email,
)
from app.client_ip import client_ip_from_request
from app.db import get_db
from app.email_verification import decode_verify_token, send_verification_email
from app.models import Comment, FollowedTopic, Post, PostLike, ReadingHistory, SiteSettings, User
from app.notifications import email_delivery_ready, is_valid_email
from app.passwords import PasswordTooLongError, hash_password, validate_password_length, verify_password
from app.rate_limit import limiter
from app.serialization import as_utc, iso_utc
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
    AuthCodeDispatchResponse,
    AuthCodeRequest,
    AuthCodeVerifyRequest,
    PasswordResetConfirmRequest,
    UserLoginRequest,
    UserOut,
    UserProfileUpdate,
    UserRegisterRequest,
    VerifyEmailRequest,
)
from app.user_auth import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])
logger = logging.getLogger("blog.users")

MAX_READING_HISTORY = 100  # mirror frontend utils/topicRetention.js cap
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB
ACCOUNT_LIBRARY_LIMIT = 100


def _default_nickname(email: str) -> str:
    return email.split("@", 1)[0][:50]


def _issue_token(user: User) -> str:
    return create_access_token(
        data={"sub": str(user.id), "ver": user.token_version or 0},
        audience=USER_TOKEN_AUDIENCE,
    )


def _user_out(user: User) -> UserOut:
    """Build the public user payload with UTC-marked timestamps.

    ``users.created_at`` / ``last_login_at`` are naive UTC columns, so validating the ORM
    row straight into UserOut made Pydantic emit them without a timezone marker and the
    账号中心 "最近登录" tile read 8 hours early in UTC+8. model_copy touches only the two
    timestamps, so new UserOut fields keep flowing through from_attributes untouched.
    """
    payload = UserOut.model_validate(user)
    return payload.model_copy(
        update={
            "created_at": as_utc(payload.created_at),
            "last_login_at": as_utc(payload.last_login_at),
        }
    )


def _auth_response(user: User) -> dict:
    return {"access_token": _issue_token(user), "token_type": "bearer", "user": _user_out(user)}


def _validate_password_or_400(password: str) -> None:
    try:
        validate_password_length(password)
    except PasswordTooLongError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _site_url(db: Session) -> str:
    # limit(1): a duplicated site_settings row must not raise MultipleResultsFound here.
    settings = db.execute(select(SiteSettings).limit(1)).scalar_one_or_none()
    return resolve_public_site_url(db, settings=settings)


def _find_user_by_email(db: Session, email: str) -> User | None:
    return db.execute(select(User).where(User.email == email).limit(1)).scalar_one_or_none()


def _commit_with_conflict_retry(db: Session, apply_changes) -> None:
    """Run ``apply_changes`` then commit, retrying once after a unique-constraint race.

    followed_topics carries uq_user_topic and reading_history carries uq_user_slug. Two
    concurrent syncs from the same account (double-click, or a client replaying a merge)
    can both miss the SELECT in the upsert helpers and collide on INSERT. Re-running the
    upsert after a rollback re-reads the row the winner committed, so the loser takes the
    UPDATE branch and returns the same idempotent payload instead of a 500.
    """
    try:
        apply_changes()
        db.commit()
    except IntegrityError:
        db.rollback()
        apply_changes()
        db.commit()


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
    _validate_password_or_400(body.password)
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    existing = _find_user_by_email(db, email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册")

    nickname = (body.nickname or "").strip() or _default_nickname(email)
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        nickname=nickname,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # users.email is UNIQUE: a double-submitted form (or two tabs) can both pass the
        # existence check above and race here. That is a duplicate registration, not a
        # server fault — answer with the same 409 the sequential path returns.
        db.rollback()
        raise HTTPException(status_code=409, detail="该邮箱已注册") from None
    db.refresh(user)
    # Best-effort verification email (no-op when email delivery isn't configured).
    try:
        send_verification_email(user, _site_url(db))
    except Exception:
        pass
    return _auth_response(user)


@router.post("/login", response_model=UserAuthResponse)
@limiter.limit("5/minute")
def login(request: Request, body: UserLoginRequest, db: Session = Depends(get_db)):
    _check_turnstile(request, body.turnstile_token)
    email = (body.email or "").strip().lower()
    user = _find_user_by_email(db, email)
    if user is None or not user.password_set or not verify_password(body.password, user.password_hash):
        if user is not None and not user.password_set:
            raise HTTPException(status_code=400, detail="该账号尚未设置密码，请使用邮箱验证码登录")
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    if user.status == "banned":
        raise HTTPException(status_code=403, detail="账号已被封禁")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return _auth_response(user)


def _validate_auth_email(email: str) -> str:
    normalized = normalize_email(email)
    if not is_valid_email(normalized):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    return normalized


def _dispatch_auth_code(
    request: Request,
    db: Session,
    body: AuthCodeRequest,
    purpose: str,
    *,
    deliver: bool = True,
):
    _check_turnstile(request, body.turnstile_token)
    email = _validate_auth_email(body.email)
    if not email_delivery_ready():
        raise HTTPException(status_code=503, detail="邮件服务暂未配置，请稍后再试")
    try:
        challenge, code = create_challenge(db, email, purpose, client_ip_from_request(request))
        if deliver and not send_auth_code_email(email, code, purpose):
            db.delete(challenge)
            db.commit()
            raise HTTPException(status_code=503, detail="邮件暂时发送失败，请稍后再试")
    except AuthCodeCooldown as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after)}) from exc
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("auth code dispatch failed purpose=%s", purpose)
        raise HTTPException(status_code=503, detail="邮件暂时发送失败，请稍后再试") from exc
    return AuthCodeDispatchResponse(
        challenge_id=challenge.id,
        expires_in=600,
        retry_after=60,
        message="验证码已发送，请查收邮箱",
    )


@router.post("/login-code/request", response_model=AuthCodeDispatchResponse)
@limiter.limit("5/minute")
def request_login_code(request: Request, body: AuthCodeRequest, db: Session = Depends(get_db)):
    return _dispatch_auth_code(request, db, body, LOGIN_PURPOSE)


@router.post("/login-code/verify", response_model=UserAuthResponse)
@limiter.limit("10/minute")
def verify_login_code(request: Request, body: AuthCodeVerifyRequest, db: Session = Depends(get_db)):
    email = _validate_auth_email(body.email)
    try:
        consume_challenge(
            db,
            email=email,
            purpose=LOGIN_PURPOSE,
            challenge_id=body.challenge_id,
            code=body.code,
        )
    except AuthCodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user = _find_user_by_email(db, email)
    if user is None:
        user = User(
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            password_set=False,
            nickname=_default_nickname(email),
            email_verified=True,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            # Two concurrent code verifications for a brand-new address both reach the
            # insert; users.email is UNIQUE so the loser must adopt the row the winner
            # created instead of 500-ing on a successful login.
            db.rollback()
            user = _find_user_by_email(db, email)
            if user is None:
                raise HTTPException(status_code=400, detail="验证码无效或已过期") from None
    if user.status == "banned":
        raise HTTPException(status_code=403, detail="账号已被封禁")
    user.email_verified = True
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/password-reset/request", response_model=AuthCodeDispatchResponse)
@limiter.limit("5/minute")
def request_password_reset(request: Request, body: AuthCodeRequest, db: Session = Depends(get_db)):
    email = _validate_auth_email(body.email)
    user = _find_user_by_email(db, email)
    # Still create a cooldown-protected challenge and return the same response for
    # unknown/banned accounts, but do not turn this endpoint into an email relay.
    response = _dispatch_auth_code(
        request,
        db,
        body,
        PASSWORD_RESET_PURPOSE,
        deliver=bool(user is not None and user.status != "banned"),
    )
    response.message = "如果该邮箱已注册，你会收到一封验证码邮件"
    return response


@router.post("/password-reset/confirm", response_model=UserAuthResponse)
@limiter.limit("10/minute")
def confirm_password_reset(request: Request, body: PasswordResetConfirmRequest, db: Session = Depends(get_db)):
    email = _validate_auth_email(body.email)
    _validate_password_or_400(body.new_password)
    try:
        consume_challenge(
            db,
            email=email,
            purpose=PASSWORD_RESET_PURPOSE,
            challenge_id=body.challenge_id,
            code=body.code,
        )
    except AuthCodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user = _find_user_by_email(db, email)
    if user is None or user.status == "banned":
        raise HTTPException(status_code=400, detail="验证码无效或已过期")
    user.password_hash = hash_password(body.new_password)
    user.password_set = True
    user.email_verified = True
    user.token_version = (user.token_version or 0) + 1
    user.last_login_at = datetime.now(timezone.utc)
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return _auth_response(user)


# ── Profile ───────────────────────────────────────

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return _user_out(current_user)


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
    return _user_out(current_user)


@router.post("/me/password", response_model=UserAuthResponse)
def change_password(
    body: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_password_or_400(body.new_password)
    if current_user.password_set and (not body.old_password or not verify_password(body.old_password, current_user.password_hash)):
        raise HTTPException(status_code=400, detail="原密码不正确")
    current_user.password_hash = hash_password(body.new_password)
    current_user.password_set = True
    current_user.token_version = (current_user.token_version or 0) + 1
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return _auth_response(current_user)


@router.post("/me/revoke-sessions")
def revoke_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.token_version = (current_user.token_version or 0) + 1
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "已退出所有设备"}


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
    return _user_out(user)


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

def _followed_topic_out(row: FollowedTopic) -> dict:
    """Serialize one follow record.

    ``followed_at`` is a naive UTC column; returning the ORM row let FastAPI emit it
    without a timezone marker, which the browser then parsed as local time (关注于 …
    was 8 hours early in UTC+8). Handing Pydantic an aware datetime makes it emit an
    explicit ``Z``.
    """
    return {
        "topic_key": row.topic_key,
        "display_title": row.display_title,
        "followed_at": as_utc(row.followed_at),
    }


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
    return [_followed_topic_out(row) for row in rows]


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
    _commit_with_conflict_retry(db, lambda: _upsert_followed_topic(db, current_user.id, body))
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
    def _apply() -> None:
        seen: set[str] = set()
        for item in body.topics:
            key = item.topic_key.strip()
            if not key or key in seen:
                continue
            seen.add(key)
            _upsert_followed_topic(db, current_user.id, item)

    _commit_with_conflict_retry(db, _apply)
    return list_followed_topics(current_user, db)


# ── Reading history (cloud sync) ──────────────────

def _reading_history_out(row: ReadingHistory) -> dict:
    """Serialize one reading-history record with an explicit UTC marker on ``visited_at``."""
    return {
        "slug": row.slug,
        "title": row.title,
        "topic_key": row.topic_key,
        "topic_display_title": row.topic_display_title,
        "content_type": row.content_type,
        "coverage_date": row.coverage_date,
        "visited_at": as_utc(row.visited_at),
    }


def _list_history(db: Session, user_id: int) -> list[dict]:
    rows = db.execute(
        select(ReadingHistory)
        .where(ReadingHistory.user_id == user_id)
        .order_by(ReadingHistory.visited_at.desc())
        .limit(MAX_READING_HISTORY)
    ).scalars().all()
    return [_reading_history_out(row) for row in rows]


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
    if existing.visited_at is None or visited_at > as_utc(existing.visited_at):
        existing.visited_at = visited_at


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
    def _apply() -> None:
        _upsert_history(db, current_user.id, body)
        _trim_history(db, current_user.id)

    _commit_with_conflict_retry(db, _apply)
    return _list_history(db, current_user.id)


@router.post("/me/history/merge", response_model=list[ReadingHistoryOut])
def merge_history(
    body: ReadingHistoryMergeInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    def _apply() -> None:
        seen: set[str] = set()
        for item in body.items:
            slug = item.slug.strip()
            if not slug or slug in seen:
                continue
            seen.add(slug)
            _upsert_history(db, current_user.id, item)
        _trim_history(db, current_user.id)

    _commit_with_conflict_retry(db, _apply)
    return _list_history(db, current_user.id)


def _account_library_entries(db: Session, user_id: int, kind: str = "all") -> list[dict]:
    entries: list[dict] = []

    if kind in {"all", "history"}:
        history_rows = db.execute(
            select(ReadingHistory, Post)
            .outerjoin(Post, Post.slug == ReadingHistory.slug)
            .where(ReadingHistory.user_id == user_id)
            .order_by(ReadingHistory.visited_at.desc())
            .limit(ACCOUNT_LIBRARY_LIMIT)
        ).all()
        for history, post in history_rows:
            entries.append(
                {
                    "kind": "history",
                    "id": history.slug,
                    "slug": history.slug,
                    "title": (post.title if post else history.title) or history.slug,
                    "summary": post.summary if post else "",
                    "cover_image": post.cover_image if post else "",
                    "content_type": (post.content_type if post else history.content_type) or "post",
                    "topic_key": (post.topic_key if post else history.topic_key) or "",
                    "topic_display_title": history.topic_display_title or "",
                    "coverage_date": (post.coverage_date if post else history.coverage_date) or "",
                    "occurred_at": history.visited_at,
                    "available": bool(post and post.is_published),
                }
            )

    if kind in {"all", "likes"}:
        like_rows = db.execute(
            select(PostLike, Post)
            .join(Post, PostLike.post_id == Post.id)
            .where(PostLike.user_id == user_id)
            .order_by(PostLike.created_at.desc())
            .limit(ACCOUNT_LIBRARY_LIMIT)
        ).all()
        for like, post in like_rows:
            entries.append(
                {
                    "kind": "likes",
                    "id": str(like.id),
                    "slug": post.slug,
                    "title": post.title,
                    "summary": post.summary,
                    "cover_image": post.cover_image,
                    "content_type": post.content_type or "post",
                    "topic_key": post.topic_key or "",
                    "topic_display_title": "",
                    "coverage_date": post.coverage_date or "",
                    "occurred_at": like.created_at,
                    "available": bool(post.is_published),
                }
            )

    if kind in {"all", "comments"}:
        comment_rows = db.execute(
            select(Comment, Post)
            .join(Post, Comment.post_id == Post.id)
            .where(Comment.user_id == user_id)
            .order_by(Comment.created_at.desc())
            .limit(ACCOUNT_LIBRARY_LIMIT)
        ).all()
        for comment, post in comment_rows:
            entries.append(
                {
                    "kind": "comments",
                    "id": str(comment.id),
                    "slug": post.slug,
                    "title": post.title,
                    "summary": post.summary,
                    "cover_image": post.cover_image,
                    "content_type": post.content_type or "post",
                    "topic_key": post.topic_key or "",
                    "topic_display_title": "",
                    "coverage_date": post.coverage_date or "",
                    "occurred_at": comment.created_at,
                    "available": bool(post.is_published),
                    "comment_content": comment.content,
                }
            )

    entries.sort(
        key=lambda entry: as_utc(entry["occurred_at"] or datetime.min),
        reverse=True,
    )
    # Sort on the datetime, ship the string: these entries are returned as a plain dict
    # (no response_model), so an un-serialized naive datetime would reach the browser
    # without a timezone marker and read 8 hours early in UTC+8.
    for entry in entries:
        entry["occurred_at"] = iso_utc(entry["occurred_at"])
    return entries


@router.get("/me/dashboard")
def account_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    count_models = {
        "following": FollowedTopic,
        "history": ReadingHistory,
        "comments": Comment,
        "likes": PostLike,
    }
    counts = {
        key: db.execute(
            select(func.count(model.id)).where(model.user_id == current_user.id)
        ).scalar_one()
        for key, model in count_models.items()
    }

    recent_history = _account_library_entries(db, current_user.id, "history")[:6]
    followed = db.execute(
        select(FollowedTopic)
        .where(FollowedTopic.user_id == current_user.id)
        .order_by(FollowedTopic.followed_at.desc())
    ).scalars().all()
    followed_by_key = {item.topic_key: item for item in followed}

    followed_updates: list[dict] = []
    if followed_by_key:
        ranked_posts = (
            select(
                Post.topic_key.label("topic_key"),
                Post.slug.label("slug"),
                Post.title.label("title"),
                Post.summary.label("summary"),
                Post.cover_image.label("cover_image"),
                Post.content_type.label("content_type"),
                Post.coverage_date.label("coverage_date"),
                Post.created_at.label("created_at"),
                func.row_number()
                .over(partition_by=Post.topic_key, order_by=Post.created_at.desc())
                .label("topic_position"),
            )
            .where(Post.is_published == True)
            .where(Post.topic_key.in_(followed_by_key))
            .subquery()
        )
        latest_rows = db.execute(
            select(ranked_posts).where(ranked_posts.c.topic_position == 1)
        ).mappings().all()
        latest_by_key = {row["topic_key"]: row for row in latest_rows}

        for topic in followed:
            latest = latest_by_key.get(topic.topic_key)
            followed_updates.append(
                {
                    "topic_key": topic.topic_key,
                    "display_title": topic.display_title or topic.topic_key,
                    "followed_at": topic.followed_at,
                    "latest_post": (
                        {
                            "slug": latest["slug"],
                            "title": latest["title"],
                            "summary": latest["summary"],
                            "cover_image": latest["cover_image"],
                            "content_type": latest["content_type"],
                            "coverage_date": latest["coverage_date"],
                            "published_at": latest["created_at"],
                        }
                        if latest
                        else None
                    ),
                }
            )
        followed_updates.sort(
            key=lambda item: as_utc(
                (item["latest_post"] or {}).get("published_at") or item["followed_at"]
            ),
            reverse=True,
        )
        # Same as _account_library_entries: sort on the datetime, ship the string.
        for item in followed_updates:
            item["followed_at"] = iso_utc(item["followed_at"])
            if item["latest_post"]:
                item["latest_post"]["published_at"] = iso_utc(item["latest_post"]["published_at"])

    return {
        "counts": counts,
        "recent_history": recent_history,
        "followed_updates": followed_updates[:8],
        "security": {
            "email_verified": bool(current_user.email_verified),
            "password_set": bool(current_user.password_set),
            "last_login_at": iso_utc(current_user.last_login_at),
        },
    }


@router.get("/me/library")
def account_library(
    kind: Literal["all", "history", "likes", "comments"] = Query(default="all"),
    q: str = Query(default="", max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entries = _account_library_entries(db, current_user.id, kind)
    normalized_query = q.strip().casefold()
    if normalized_query:
        entries = [
            entry
            for entry in entries
            if normalized_query
            in " ".join(
                str(entry.get(field) or "")
                for field in ("title", "summary", "topic_display_title", "comment_content")
            ).casefold()
        ]

    total = len(entries)
    offset = (page - 1) * page_size
    return {
        "kind": kind,
        "items": entries[offset : offset + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.delete("/me/history/{slug}")
def remove_history_entry(
    slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = db.execute(
        delete(ReadingHistory).where(
            ReadingHistory.user_id == current_user.id,
            ReadingHistory.slug == slug.strip(),
        )
    )
    db.commit()
    return {"removed": bool(result.rowcount)}


@router.delete("/me/history")
def clear_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = db.execute(
        delete(ReadingHistory).where(ReadingHistory.user_id == current_user.id)
    )
    db.commit()
    return {"removed_count": result.rowcount or 0}


@router.delete("/me/likes/{slug}")
def remove_like(
    slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    post = db.execute(select(Post).where(Post.slug == slug.strip())).scalar_one_or_none()
    if post is None:
        return {"removed": False, "like_count": 0}

    removed_post_id = db.execute(
        delete(PostLike)
        .where(PostLike.user_id == current_user.id, PostLike.post_id == post.id)
        .returning(PostLike.post_id)
    ).scalar_one_or_none()
    if removed_post_id is not None:
        current_count = func.coalesce(Post.like_count, 0)
        db.execute(
            update(Post)
            .where(Post.id == post.id)
            .values(
                like_count=case(
                    (current_count > 0, current_count - 1),
                    else_=0,
                )
            )
        )
    db.commit()
    refreshed_count = db.execute(
        select(Post.like_count).where(Post.id == post.id)
    ).scalar_one()
    return {"removed": removed_post_id is not None, "like_count": refreshed_count or 0}


@router.delete("/me/comments/{comment_id}")
def remove_own_comment(
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = db.execute(
        delete(Comment).where(Comment.id == comment_id, Comment.user_id == current_user.id)
    )
    if not result.rowcount:
        db.rollback()
        raise HTTPException(status_code=404, detail="评论不存在或无权删除")
    db.commit()
    return {"removed": True}


@router.get("/me/export")
def export_account_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    topics = list_followed_topics(current_user, db)
    library = _account_library_entries(db, current_user.id, "all")
    payload = {
        "exported_at": iso_utc(datetime.now(timezone.utc)),
        "profile": _user_out(current_user),
        "followed_topics": topics,
        "reading_history": [item for item in library if item["kind"] == "history"],
        "likes": [item for item in library if item["kind"] == "likes"],
        "comments": [item for item in library if item["kind"] == "comments"],
    }
    return JSONResponse(
        content=jsonable_encoder(payload),
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="signal-desk-data-{current_user.id}.json"',
        },
    )


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
    return _user_out(current_user)


@router.delete("/me/avatar", response_model=UserOut)
def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.avatar_url = ""
    current_user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return _user_out(current_user)


# ── My comments / likes ───────────────────────────

@router.get("/me/comments")
def list_my_comments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Comment.id, Comment.content, Comment.created_at, Post.slug, Post.title)
        .join(Post, Comment.post_id == Post.id)
        .where(Comment.user_id == current_user.id)
        .order_by(Comment.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": comment_id,
            "content": content,
            "post_slug": slug,
            "post_title": title,
            "created_at": iso_utc(created_at),
        }
        for comment_id, content, created_at, slug, title in rows
    ]


@router.get("/me/likes")
def list_my_likes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(PostLike.created_at, Post.slug, Post.title)
        .join(Post, PostLike.post_id == Post.id)
        .where(PostLike.user_id == current_user.id)
        .order_by(PostLike.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "post_slug": slug,
            "post_title": title,
            "created_at": iso_utc(created_at),
        }
        for created_at, slug, title in rows
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

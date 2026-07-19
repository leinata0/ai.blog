"""Short-lived, single-use email authentication codes."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import auth as auth_mod
from app.models import AuthChallenge
from app.notifications import send_email

LOGIN_PURPOSE = "login"
PASSWORD_RESET_PURPOSE = "password_reset"
CODE_TTL_SECONDS = 600
CODE_RESEND_SECONDS = 60
MAX_CODE_ATTEMPTS = 5


class AuthCodeError(Exception):
    def __init__(self, message: str, *, status: str = "invalid"):
        super().__init__(message)
        self.status = status


class AuthCodeCooldown(AuthCodeError):
    def __init__(self, retry_after: int):
        super().__init__("验证码发送过于频繁，请稍后再试", status="cooldown")
        self.retry_after = retry_after


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _digest(challenge_id: str, code: str) -> str:
    message = f"{challenge_id}:{code}".encode("utf-8")
    return hmac.new(auth_mod.SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()


def create_challenge(db: Session, email: str, purpose: str, request_ip: str) -> tuple[AuthChallenge, str]:
    email = normalize_email(email)
    now = _now()
    latest = db.execute(
        select(AuthChallenge)
        .where(AuthChallenge.email == email, AuthChallenge.purpose == purpose)
        .order_by(AuthChallenge.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest is not None:
        age = max(0, int((now - _as_utc(latest.created_at)).total_seconds()))
        if age < CODE_RESEND_SECONDS and latest.consumed_at is None:
            raise AuthCodeCooldown(CODE_RESEND_SECONDS - age)

    db.execute(
        update(AuthChallenge)
        .where(
            AuthChallenge.email == email,
            AuthChallenge.purpose == purpose,
            AuthChallenge.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    challenge_id = str(uuid4())
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = AuthChallenge(
        id=challenge_id,
        email=email,
        purpose=purpose,
        code_digest=_digest(challenge_id, code),
        expires_at=now + timedelta(seconds=CODE_TTL_SECONDS),
        max_attempts=MAX_CODE_ATTEMPTS,
        request_ip=(request_ip or "")[:80],
        created_at=now,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge, code


def consume_challenge(db: Session, *, email: str, purpose: str, challenge_id: str, code: str) -> AuthChallenge:
    challenge = db.execute(
        select(AuthChallenge).where(
            AuthChallenge.id == challenge_id,
            AuthChallenge.email == normalize_email(email),
            AuthChallenge.purpose == purpose,
        ).with_for_update()
    ).scalar_one_or_none()
    now = _now()
    if challenge is None or challenge.consumed_at is not None:
        raise AuthCodeError("验证码无效或已过期")
    if _as_utc(challenge.expires_at) <= now:
        challenge.consumed_at = now
        db.commit()
        raise AuthCodeError("验证码无效或已过期", status="expired")
    if challenge.attempts >= challenge.max_attempts:
        challenge.consumed_at = now
        db.commit()
        raise AuthCodeError("验证码错误次数过多，请重新获取", status="locked")
    if not hmac.compare_digest(challenge.code_digest, _digest(challenge.id, code)):
        challenge.attempts += 1
        if challenge.attempts >= challenge.max_attempts:
            challenge.consumed_at = now
        db.commit()
        if challenge.attempts >= challenge.max_attempts:
            raise AuthCodeError("验证码错误次数过多，请重新获取", status="locked")
        raise AuthCodeError("验证码错误")
    challenge.consumed_at = now
    db.commit()
    db.refresh(challenge)
    return challenge


def send_auth_code_email(email: str, code: str, purpose: str) -> bool:
    if purpose == LOGIN_PURPOSE:
        subject = "你的登录验证码 - AI 资讯观察"
        heading = "登录验证码"
        description = "使用以下验证码登录 AI 资讯观察。"
    else:
        subject = "重置密码验证码 - AI 资讯观察"
        heading = "重置密码验证码"
        description = "使用以下验证码继续重置你的密码。"
    html = f"""
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7;color:#0f172a;padding:24px;background:#f8fbff">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #dbeafe">
        <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;">{heading}</h1>
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">{description}</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:800;color:#2563eb;background:#eff6ff;border-radius:12px;padding:14px 18px;text-align:center;">{escape(code)}</div>
        <p style="margin-top:20px;font-size:13px;color:#64748b;">验证码 10 分钟内有效，最多尝试 5 次。如果不是你本人操作，请忽略本邮件。</p>
      </div>
    </div>
    """.strip()
    text = f"{subject}\n\n{description}\n\n验证码：{code}\n\n验证码 10 分钟内有效。"
    return send_email(email, subject, html, text)

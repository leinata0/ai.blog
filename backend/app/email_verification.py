"""Email verification for visitor accounts (soft verification).

Verification links carry a short-lived JWT with aud="email_verify" — distinct
from login tokens (aud="user") and admin tokens (aud="admin") — so a
verification link can never be used as a session token and vice versa. No DB
table/column is needed beyond the existing User.email_verified flag.
"""
from __future__ import annotations

from datetime import timedelta

from jose import JWTError, jwt

from app import auth as auth_mod
from app.auth import EMAIL_VERIFY_AUDIENCE, create_access_token
from app.notifications import send_email

VERIFY_TOKEN_TTL = timedelta(hours=24)


def issue_verify_token(user_id: int) -> str:
    return create_access_token(
        data={"sub": str(user_id), "scope": "email_verify"},
        expires_delta=VERIFY_TOKEN_TTL,
        audience=EMAIL_VERIFY_AUDIENCE,
    )


def decode_verify_token(token: str) -> int | None:
    try:
        payload = jwt.decode(
            token,
            auth_mod.SECRET_KEY,
            algorithms=[auth_mod.ALGORITHM],
            issuer=auth_mod.TOKEN_ISSUER,
            audience=EMAIL_VERIFY_AUDIENCE,
        )
    except JWTError:
        return None
    try:
        return int(payload.get("sub"))
    except (TypeError, ValueError):
        return None


def _build_verify_email(nickname: str, verify_url: str) -> tuple[str, str, str]:
    subject = "验证你的邮箱 - AI 资讯观察"
    html = f"""
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7;color:#0f172a;padding:24px;background:#f8fbff">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #dbeafe">
        <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;">验证你的邮箱</h1>
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">你好 {nickname}，点击下方按钮完成邮箱验证后即可评论、点赞。</p>
        <a href="{verify_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">验证邮箱</a>
        <p style="margin-top:20px;font-size:13px;color:#64748b;">如果按钮无法点击，请复制以下链接到浏览器打开：<br>{verify_url}</p>
        <p style="margin-top:12px;font-size:12px;color:#94a3b8;">链接 24 小时内有效。如果不是你本人操作，请忽略本邮件。</p>
      </div>
    </div>
    """.strip()
    text = "\n".join([
        subject,
        "",
        f"你好 {nickname}，请打开以下链接验证邮箱：",
        verify_url,
        "",
        "链接 24 小时内有效。",
    ])
    return subject, html, text


def send_verification_email(user, site_url: str) -> bool:
    """Best-effort: send a verification email. Returns False if delivery is off."""
    token = issue_verify_token(user.id)
    verify_url = f"{site_url}/verify-email?token={token}"
    subject, html, text = _build_verify_email(user.nickname or user.email, verify_url)
    return send_email(user.email, subject, html, text)

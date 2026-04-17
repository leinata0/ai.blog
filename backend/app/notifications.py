import json
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.env import clean_env
from app.models import (
    EmailSubscription,
    Post,
    PostNotificationDispatch,
    SiteSettings,
    WebPushSubscription,
)

ALLOWED_SUBSCRIPTION_CONTENT_TYPES = {"all", "daily_brief", "weekly_review"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match((value or "").strip()))


def normalize_subscription_content_types(values: list[str] | None) -> list[str]:
    normalized = []
    for item in values or []:
        value = str(item or "").strip()
        if not value:
            continue
        if value not in ALLOWED_SUBSCRIPTION_CONTENT_TYPES:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized or ["all"]


def normalize_subscription_topic_keys(values: list[str] | None) -> list[str]:
    normalized = []
    for item in values or []:
        value = str(item or "").strip()
        if not value:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized


def normalize_subscription_series_slugs(values: list[str] | None) -> list[str]:
    normalized = []
    for item in values or []:
        value = str(item or "").strip()
        if not value:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized


def _parse_json_array(value: str | None, *, fallback: list[str] | None = None) -> list[str]:
    try:
        values = json.loads(value or json.dumps(fallback or []))
    except (TypeError, json.JSONDecodeError):
        values = fallback or []
    if not isinstance(values, list):
        values = fallback or []
    return [str(item) for item in values]


def subscription_matches_preferences(
    *,
    content_types_json: str | None,
    topic_keys_json: str | None,
    series_slugs_json: str | None,
    post: Post,
) -> bool:
    normalized = normalize_subscription_content_types(_parse_json_array(content_types_json, fallback=["all"]))
    if "all" in normalized:
        content_type_match = True
    else:
        content_type_match = str(post.content_type or "").strip() in normalized
    if not content_type_match:
        return False

    topic_keys = normalize_subscription_topic_keys(_parse_json_array(topic_keys_json))
    series_slugs = normalize_subscription_series_slugs(_parse_json_array(series_slugs_json))
    if not topic_keys and not series_slugs:
        return True

    return (
        (str(post.topic_key or "").strip() in topic_keys)
        or (str(post.series_slug or "").strip() in series_slugs)
    )


def _trim_text(value: str, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


def _content_type_label(content_type: str | None) -> str:
    if content_type == "daily_brief":
        return "AI 日报"
    if content_type == "weekly_review":
        return "AI 周报"
    return "最新文章"


def _site_url(db: Session) -> str:
    settings = db.execute(select(SiteSettings)).scalar_one_or_none()
    value = settings.site_url if settings and settings.site_url else "https://563118077.xyz"
    return value.rstrip("/")


def email_delivery_ready() -> bool:
    return bool(clean_env("RESEND_API_KEY") and clean_env("EMAIL_FROM"))


def web_push_delivery_ready() -> bool:
    return bool(
        clean_env("WEB_PUSH_VAPID_PUBLIC_KEY")
        and clean_env("WEB_PUSH_VAPID_PRIVATE_KEY")
        and clean_env("WEB_PUSH_SUBJECT")
    )


def wecom_delivery_ready() -> bool:
    return len(_get_wecom_webhook_urls()) > 0


def _missing_env(keys: list[str]) -> list[str]:
    return [key for key in keys if not clean_env(key)]


def _email_health_payload() -> dict:
    missing = _missing_env(["RESEND_API_KEY", "EMAIL_FROM"])
    configured = len(missing) == 0
    if configured:
        message = "邮件订阅已接入，后端可以通过 Resend 发送新文章通知。"
    else:
        message = (
            "邮件订阅未完成配置。请在 Render 后端环境变量中补齐 RESEND_API_KEY 和 EMAIL_FROM，"
            "并确保 EMAIL_FROM 使用 Resend 已验证的发件地址或域名。"
        )
    return {
        "configured": configured,
        "missing_env": missing,
        "message": message,
    }


def _web_push_health_payload() -> dict:
    missing = _missing_env(
        ["WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_SUBJECT"]
    )
    configured = len(missing) == 0
    if configured:
        message = "浏览器提醒已接入，后端可以签发 Web Push 通知。"
    else:
        message = (
            "浏览器提醒未完成配置。请在 Render 后端环境变量中补齐 "
            "WEB_PUSH_VAPID_PUBLIC_KEY、WEB_PUSH_VAPID_PRIVATE_KEY 和 WEB_PUSH_SUBJECT。"
        )
    return {
        "configured": configured,
        "missing_env": missing,
        "has_public_key": bool(clean_env("WEB_PUSH_VAPID_PUBLIC_KEY")),
        "message": message,
    }


def _wecom_health_payload() -> dict:
    configured = wecom_delivery_ready()
    if configured:
        message = "企业微信机器人已接入，可将新文章同步到团队群。"
    else:
        message = "企业微信机器人当前未配置；如需启用，请在 Render 后端环境变量中设置 WECOM_WEBHOOK_URLS。"
    return {
        "configured": configured,
        "missing_env": [] if configured else ["WECOM_WEBHOOK_URLS"],
        "message": message,
    }


def subscription_status_payload() -> dict:
    email = _email_health_payload()
    web_push = _web_push_health_payload()
    wecom = _wecom_health_payload()
    return {
        "email_configured": email["configured"],
        "web_push_configured": web_push["configured"],
        "wecom_configured": wecom["configured"],
        "web_push_public_key": clean_env("WEB_PUSH_VAPID_PUBLIC_KEY"),
    }


def subscription_health_payload() -> dict:
    return {
        "checked_at": datetime.now(timezone.utc),
        "email": _email_health_payload(),
        "web_push": _web_push_health_payload(),
        "wecom": _wecom_health_payload(),
    }


def _get_wecom_webhook_urls() -> list[str]:
    raw = clean_env("WECOM_WEBHOOK_URLS")
    return [item.strip() for item in re.split(r"[\r\n,]+", raw) if item.strip()]


def _build_post_url(site_url: str, post: Post) -> str:
    return f"{site_url}/posts/{post.slug}"


def _build_email_subject(post: Post) -> str:
    return f"{_content_type_label(post.content_type)}更新：{post.title}"


def _build_email_html(post: Post, site_url: str) -> str:
    post_url = _build_post_url(site_url, post)
    feed_url = f"{site_url}/feeds"
    return f"""
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7;color:#0f172a;padding:24px;background:#f8fbff">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #dbeafe">
        <div style="font-size:12px;letter-spacing:0.08em;color:#2563eb;font-weight:700;">{_content_type_label(post.content_type)}</div>
        <h1 style="font-size:28px;line-height:1.3;margin:12px 0 16px;">{post.title}</h1>
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">{_trim_text(post.summary, 220)}</p>
        <a href="{post_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">阅读全文</a>
        <div style="margin-top:20px;font-size:13px;color:#64748b;">
          也可以继续使用 <a href="{site_url}/feed.xml">RSS</a> 或访问 <a href="{feed_url}">订阅中心</a> 管理其他订阅方式。
        </div>
      </div>
    </div>
    """.strip()


def _build_email_text(post: Post, site_url: str) -> str:
    post_url = _build_post_url(site_url, post)
    return "\n".join(
        [
            _build_email_subject(post),
            "",
            _trim_text(post.summary, 220),
            "",
            f"阅读全文：{post_url}",
            f"订阅中心：{site_url}/feeds",
        ]
    )


def _send_email_notification(email: str, post: Post, site_url: str) -> None:
    api_key = clean_env("RESEND_API_KEY")
    sender = clean_env("EMAIL_FROM")
    if not api_key or not sender:
        return
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": sender,
            "to": [email],
            "subject": _build_email_subject(post),
            "html": _build_email_html(post, site_url),
            "text": _build_email_text(post, site_url),
        },
        timeout=30,
    )
    response.raise_for_status()


def _send_wecom_notification(url: str, post: Post, site_url: str) -> None:
    post_url = _build_post_url(site_url, post)
    summary = _trim_text(post.summary, 120)
    content = (
        f"## {_content_type_label(post.content_type)}更新\n"
        f"> **{post.title}**\n"
        f"> {summary}\n\n"
        f"[阅读全文]({post_url})"
    )
    response = httpx.post(
        url,
        json={"msgtype": "markdown", "markdown": {"content": content}},
        timeout=20,
    )
    response.raise_for_status()


def _send_web_push_notification(subscription: WebPushSubscription, post: Post, site_url: str) -> None:
    private_key = clean_env("WEB_PUSH_VAPID_PRIVATE_KEY")
    subject = clean_env("WEB_PUSH_SUBJECT")
    if not private_key or not subject:
        return
    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:  # pragma: no cover - runtime safeguard
        raise RuntimeError("pywebpush is not installed") from exc

    payload = json.dumps(
        {
            "title": _content_type_label(post.content_type),
            "body": _trim_text(post.title, 80),
            "url": _build_post_url(site_url, post),
            "tag": f"post-{post.id}",
        },
        ensure_ascii=False,
    )
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh,
                    "auth": subscription.auth,
                },
            },
            data=payload,
            vapid_private_key=private_key,
            vapid_claims={"sub": subject},
        )
    except WebPushException:
        raise


def dispatch_post_notifications_for_post(post_id: int) -> None:
    db = SessionLocal()
    try:
        _dispatch_post_notifications(db, post_id)
    finally:
        db.close()


def _dispatch_post_notifications(db: Session, post_id: int) -> None:
    post = db.execute(select(Post).where(Post.id == post_id)).scalar_one_or_none()
    if post is None or not post.is_published:
        return

    dispatch = db.execute(
        select(PostNotificationDispatch).where(PostNotificationDispatch.post_id == post_id)
    ).scalar_one_or_none()
    if dispatch is None:
        dispatch = PostNotificationDispatch(post_id=post_id)
        db.add(dispatch)
        db.flush()

    site_url = _site_url(db)
    errors: list[str] = []
    now = datetime.now(timezone.utc)

    if email_delivery_ready() and dispatch.email_sent_at is None:
        recipients = db.execute(
            select(EmailSubscription).where(EmailSubscription.is_active == True)
        ).scalars().all()
        sent_count = 0
        for recipient in recipients:
            if not subscription_matches_preferences(
                content_types_json=recipient.content_types_json,
                topic_keys_json=recipient.topic_keys_json,
                series_slugs_json=recipient.series_slugs_json,
                post=post,
            ):
                continue
            try:
                _send_email_notification(recipient.email, post, site_url)
                recipient.last_notified_at = now
                recipient.updated_at = now
                sent_count += 1
            except Exception as exc:  # pragma: no cover - external delivery
                errors.append(f"email:{recipient.email}:{exc}")
        dispatch.email_recipient_count = sent_count
        dispatch.email_sent_at = now

    if wecom_delivery_ready() and dispatch.wecom_sent_at is None:
        urls = _get_wecom_webhook_urls()
        sent_count = 0
        for url in urls:
            try:
                _send_wecom_notification(url, post, site_url)
                sent_count += 1
            except Exception as exc:  # pragma: no cover - external delivery
                errors.append(f"wecom:{url}:{exc}")
        dispatch.wecom_target_count = sent_count
        dispatch.wecom_sent_at = now

    if web_push_delivery_ready() and dispatch.web_push_sent_at is None:
        subscriptions = db.execute(
            select(WebPushSubscription).where(WebPushSubscription.is_active == True)
        ).scalars().all()
        sent_count = 0
        for subscription in subscriptions:
            if not subscription_matches_preferences(
                content_types_json=subscription.content_types_json,
                topic_keys_json=subscription.topic_keys_json,
                series_slugs_json=subscription.series_slugs_json,
                post=post,
            ):
                continue
            try:
                _send_web_push_notification(subscription, post, site_url)
                subscription.last_notified_at = now
                subscription.updated_at = now
                sent_count += 1
            except Exception as exc:  # pragma: no cover - external delivery
                if "410" in str(exc) or "404" in str(exc):
                    subscription.is_active = False
                errors.append(f"web_push:{subscription.endpoint[:60]}:{exc}")
        dispatch.web_push_recipient_count = sent_count
        dispatch.web_push_sent_at = now

    dispatch.last_error = "\n".join(errors[:12])
    dispatch.updated_at = now
    db.commit()

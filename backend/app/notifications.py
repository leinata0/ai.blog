import hashlib
import json
import re
from datetime import datetime, timezone
from html import escape
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import url_safety
from app.db import SessionLocal  # noqa: F401  (kept for backwards-compat imports)
from app.env import clean_env, clean_env_list
from app.models import (
    EmailSubscription,
    Post,
    PostNotificationDispatch,
    SiteSettings,
    WebPushSubscription,
)
from app.site_config import resolve_public_site_url

ALLOWED_SUBSCRIPTION_CONTENT_TYPES = {"all", "daily_brief", "weekly_review"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Push endpoints are minted by the browser vendor's push service, so the set of
# reachable hosts is small and closed. Anything else is either stale junk or an
# attacker-supplied SSRF target.
#
# This tuple and `is_allowed_web_push_endpoint_host` below are the single
# implementation for both layers: `routers/subscriptions.py` imports the matcher
# for its request-time 400, and `validate_outbound_web_push_endpoint` uses it as
# the delivery-time gate. They used to be two hand-written copies that disagreed
# on two points (apex matching for a dotted rule, and how the env additions were
# normalized), which made WEB_PUSH_ALLOWED_ENDPOINT_HOSTS mean subtly different
# things depending on which side you were reading.
#
# Rule format: a leading dot means "strictly below this name" — ".notify.windows.com"
# matches "wns2-by3p.notify.windows.com" but NOT the bare apex "notify.windows.com".
# That is the stricter of the two former readings, chosen deliberately: no vendor
# serves push endpoints off the apex, and convergence must never make the
# subscribe-time check accept more than it did. Operators who really need an apex
# can name it exactly in WEB_PUSH_ALLOWED_ENDPOINT_HOSTS.
WEB_PUSH_ALLOWED_ENDPOINT_HOSTS = (
    "fcm.googleapis.com",
    ".push.services.mozilla.com",
    ".notify.windows.com",
    "web.push.apple.com",
)
# Statuses the push services use to say "this subscription is gone for good".
WEB_PUSH_GONE_STATUSES = frozenset({404, 410})
# Upstream bodies must never be persisted verbatim: with a hostile endpoint they
# are attacker-chosen content, and with a real one they can carry token material.
_WEB_PUSH_ERROR_TEXT_LIMIT = 200


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
    return resolve_public_site_url(db, settings=settings)


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
    safe_title = escape(post.title or "")
    safe_summary = escape(_trim_text(post.summary, 220))
    safe_post_url = escape(post_url, quote=True)
    safe_site_url = escape(site_url, quote=True)
    safe_feed_url = escape(feed_url, quote=True)
    return f"""
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7;color:#0f172a;padding:24px;background:#f8fbff">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #dbeafe">
        <div style="font-size:12px;letter-spacing:0.08em;color:#2563eb;font-weight:700;">{_content_type_label(post.content_type)}</div>
        <h1 style="font-size:28px;line-height:1.3;margin:12px 0 16px;">{safe_title}</h1>
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">{safe_summary}</p>
        <a href="{safe_post_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">阅读全文</a>
        <div style="margin-top:20px;font-size:13px;color:#64748b;">
          也可以继续使用 <a href="{safe_site_url}/feed.xml">RSS</a> 或访问 <a href="{safe_feed_url}">订阅中心</a> 管理其他订阅方式。
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
    send_email(
        email,
        _build_email_subject(post),
        _build_email_html(post, site_url),
        _build_email_text(post, site_url),
    )


def send_email(to: str, subject: str, html: str, text: str) -> bool:
    """Send a single transactional email via Resend.

    Returns False (without raising) when delivery isn't configured, so callers
    can treat email as best-effort. Network/API failures still raise, matching
    the original notification behavior.
    """
    api_key = clean_env("RESEND_API_KEY")
    sender = clean_env("EMAIL_FROM")
    if not api_key or not sender:
        return False
    response = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": sender,
            "to": [to],
            "subject": subject,
            "html": html,
            "text": text,
        },
        timeout=30,
    )
    response.raise_for_status()
    return True


def send_subscription_confirmation_email(
    email: str,
    token: str,
    site_url: str,
    purpose: str,
) -> bool:
    # Keep action tokens out of HTTP requests, CDN logs, and Referer headers.
    confirmation_url = f"{site_url}/feeds#subscription_token={quote(token, safe='')}"
    safe_url = escape(confirmation_url, quote=True)
    if purpose == "email_unsubscribe":
        subject = "确认退订 - AI 资讯观察"
        heading = "确认关闭邮件订阅"
        description = "点击下方按钮后，这个邮箱才会停止接收更新。"
        button = "确认退订"
    else:
        subject = "确认邮件订阅 - AI 资讯观察"
        heading = "确认你的邮件订阅"
        description = "点击下方按钮确认邮箱所有权并启用你刚刚选择的订阅偏好。"
        button = "确认订阅"

    html = f"""
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7;color:#0f172a;padding:24px;background:#f8fbff">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #dbeafe">
        <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;">{heading}</h1>
        <p style="font-size:15px;color:#334155;margin:0 0 20px;">{description}</p>
        <a href="{safe_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">{button}</a>
        <p style="margin-top:20px;font-size:13px;color:#64748b;">如果按钮无法点击，请复制以下链接到浏览器打开：<br>{safe_url}</p>
        <p style="margin-top:12px;font-size:12px;color:#94a3b8;">链接 1 小时内有效。如果不是你本人操作，请忽略本邮件。</p>
      </div>
    </div>
    """.strip()
    text = "\n".join(
        [subject, "", description, confirmation_url, "", "链接 1 小时内有效。"]
    )
    return send_email(email, subject, html, text)


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


class WebPushEndpointRejected(Exception):
    """A stored push endpoint failed the outbound SSRF / allowlist gate.

    ``permanent`` distinguishes a policy violation (the endpoint can never be a
    real push service, so the row should be deactivated) from an environmental
    failure such as DNS being briefly unavailable (retry, keep the subscriber).
    """

    def __init__(self, reason: str, *, permanent: bool = True) -> None:
        super().__init__(reason)
        self.reason = reason
        self.permanent = permanent


def web_push_allowed_endpoint_host_rules() -> tuple[str, ...]:
    """Built-in push-service hosts plus any operator-configured additions.

    ``WEB_PUSH_ALLOWED_ENDPOINT_HOSTS`` exists so a vendor adding a host does not
    require a code deploy. Extra hosts still go through the private-address
    checks below, so a misconfigured value cannot open an internal target.
    """
    extra = tuple(
        host
        for host in (
            url_safety.normalize_hostname(item)
            for item in clean_env_list("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS")
        )
        if host
    )
    return WEB_PUSH_ALLOWED_ENDPOINT_HOSTS + extra


def is_allowed_web_push_endpoint_host(hostname: str) -> bool:
    """The one host-allowlist decision, shared by the subscribe and send paths.

    ``routers.subscriptions.validate_web_push_endpoint`` calls this too, so a
    host can never be acceptable to store but unacceptable to send to (or the
    reverse). Both sides normalize through ``url_safety.normalize_hostname``, so
    a trailing FQDN dot on either the rule or the candidate is not a bypass.
    """
    host = url_safety.normalize_hostname(hostname)
    if not host:
        return False
    for rule in web_push_allowed_endpoint_host_rules():
        if rule.startswith("."):
            # Subdomains only — see the note on WEB_PUSH_ALLOWED_ENDPOINT_HOSTS.
            if host.endswith(rule):
                return True
        elif host == rule:
            return True
    return False


def validate_outbound_web_push_endpoint(endpoint: str) -> None:
    """Gate an endpoint immediately before it is turned into an HTTP request.

    ``pywebpush`` calls ``requests.post(endpoint, ...)`` with redirects enabled
    and no address filtering, so an endpoint row is an outbound request the
    server will make on the admin's behalf. The subscribe API validates on the
    way in, but that only protects rows written after the check shipped — rows
    already in the table (or written by any future/alternate path) are only
    stopped here. Keep both layers.

    Deliberately named apart from ``routers.subscriptions.validate_web_push_endpoint``:
    that one is the request-time check and answers 400, this one is the delivery
    gate and raises :class:`WebPushEndpointRejected`.
    """
    raw = (endpoint or "").strip()
    if not raw:
        raise WebPushEndpointRejected("empty endpoint")

    parsed = urlparse(raw)
    # Push endpoints are always https; http would also expose the payload.
    if parsed.scheme != "https":
        raise WebPushEndpointRejected(f"endpoint scheme not https: {parsed.scheme or 'none'}")
    if parsed.username is not None or parsed.password is not None:
        raise WebPushEndpointRejected("endpoint carries credentials")

    host = url_safety.normalize_hostname(parsed.hostname or "")
    if not host:
        raise WebPushEndpointRejected("endpoint has no host")
    # Host allowlist first: it is a pure string check, so a hostile endpoint is
    # rejected without the server performing any DNS lookup on its behalf.
    if not is_allowed_web_push_endpoint_host(host):
        raise WebPushEndpointRejected(f"endpoint host not an allowed push service: {host}")

    # Allowlisted host, but still confirm it resolves to a public address —
    # defense against a poisoned/split-horizon resolver. A resolution failure is
    # indistinguishable from "resolves to private", so treat it as retryable
    # rather than permanently dropping every subscriber during a DNS blip.
    if not url_safety.is_public_http_url(raw):
        raise WebPushEndpointRejected(
            f"endpoint host does not resolve to a public address: {host}",
            permanent=False,
        )


def _default_web_push_sender(
    *,
    subscription_info: dict,
    data: str,
    vapid_private_key: str,
    vapid_claims: dict,
) -> None:
    """Real delivery seam. Tests inject a fake here instead of hitting the network."""
    try:
        from pywebpush import webpush
    except Exception as exc:  # pragma: no cover - runtime safeguard
        raise RuntimeError("pywebpush is not installed") from exc

    webpush(
        subscription_info=subscription_info,
        data=data,
        vapid_private_key=vapid_private_key,
        vapid_claims=vapid_claims,
    )


def _send_web_push_notification(
    subscription: WebPushSubscription,
    post: Post,
    site_url: str,
    *,
    sender=None,
) -> None:
    private_key = clean_env("WEB_PUSH_VAPID_PRIVATE_KEY")
    subject = clean_env("WEB_PUSH_SUBJECT")
    if not private_key or not subject:
        return

    # Validate before building the payload so a rejected endpoint costs nothing
    # and, more importantly, never reaches the HTTP client.
    validate_outbound_web_push_endpoint(subscription.endpoint)

    payload = json.dumps(
        {
            "title": _content_type_label(post.content_type),
            "body": _trim_text(post.title, 80),
            "url": _build_post_url(site_url, post),
            "tag": f"post-{post.id}",
        },
        ensure_ascii=False,
    )
    send = sender or _default_web_push_sender
    send(
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


def web_push_error_status(exc: BaseException) -> int | None:
    """Real HTTP status behind a push failure, or None when unavailable.

    ``pywebpush.WebPushException`` carries the ``requests.Response`` (``.response``
    with ``.status_code``); its async path attaches an ``aiohttp`` response whose
    attribute is ``.status``. Duck-typed so neither import is needed here.
    """
    response = getattr(exc, "response", None)
    if response is None:
        return None
    status = getattr(response, "status_code", None)
    if status is None:
        status = getattr(response, "status", None)
    try:
        return int(status)
    except (TypeError, ValueError):
        return None


def web_push_subscription_is_gone(exc: BaseException) -> bool:
    """Whether a failure means the subscription should be deactivated.

    Prefer the real status code. Matching ``"410" in str(exc)`` alone is unsafe:
    the message embeds the upstream response body, so an unrelated id or
    timestamp containing those digits would silently drop a live subscriber.
    """
    status = web_push_error_status(exc)
    if status is not None:
        return status in WEB_PUSH_GONE_STATUSES
    # No status available (transport error, non-pywebpush exception): fall back
    # to the historical string match rather than retrying a dead endpoint forever.
    text = str(exc)
    return "410" in text or "404" in text


def _summarize_web_push_error(exc: BaseException) -> str:
    """Compact, body-free description safe to persist in ``last_error``."""
    status = web_push_error_status(exc)
    if status is not None:
        return f"{type(exc).__name__}: http {status}"
    return f"{type(exc).__name__}: {_trim_text(str(exc), _WEB_PUSH_ERROR_TEXT_LIMIT)}"


def dispatch_post_notifications_for_post(post_id: int) -> None:
    # Reference SessionLocal via the db module (not a bound import) so test
    # fixtures that monkeypatch app.db.SessionLocal reach this background path.
    import app.db as db_mod

    db = db_mod.SessionLocal()
    try:
        _dispatch_post_notifications(db, post_id)
    finally:
        db.close()


def _delivery_target_key(value: str) -> str:
    """Stable non-secret identifier for retry state stored on the dispatch."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _load_delivery_state(raw: str | None) -> dict:
    try:
        parsed = json.loads(raw or "")
    except (TypeError, json.JSONDecodeError):
        return {}
    if not isinstance(parsed, dict) or parsed.get("version") != 1:
        return {}
    return parsed


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
    delivery_state = _load_delivery_state(dispatch.last_error)
    errors: list[str] = []
    now = datetime.now(timezone.utc)

    if email_delivery_ready() and dispatch.email_sent_at is None:
        recipients = db.execute(
            select(EmailSubscription).where(EmailSubscription.is_active == True)
        ).scalars().all()
        previous_pending = delivery_state.get("email_pending_ids")
        if isinstance(previous_pending, list):
            pending_ids = {int(item) for item in previous_pending}
            recipients = [item for item in recipients if item.id in pending_ids]
        sent_count = 0
        failed_ids: list[int] = []
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
                failed_ids.append(recipient.id)
                errors.append(f"email:{recipient.id}:{exc}")
        dispatch.email_recipient_count = (dispatch.email_recipient_count or 0) + sent_count
        if failed_ids:
            delivery_state["email_pending_ids"] = failed_ids
        else:
            delivery_state.pop("email_pending_ids", None)
            dispatch.email_sent_at = now

    if wecom_delivery_ready() and dispatch.wecom_sent_at is None:
        urls = _get_wecom_webhook_urls()
        previous_pending = delivery_state.get("wecom_pending_keys")
        if isinstance(previous_pending, list):
            pending_keys = {str(item) for item in previous_pending}
            urls = [url for url in urls if _delivery_target_key(url) in pending_keys]
        sent_count = 0
        failed_keys: list[str] = []
        for url in urls:
            try:
                _send_wecom_notification(url, post, site_url)
                sent_count += 1
            except Exception as exc:  # pragma: no cover - external delivery
                target_key = _delivery_target_key(url)
                failed_keys.append(target_key)
                errors.append(f"wecom:{target_key}:{exc}")
        dispatch.wecom_target_count = (dispatch.wecom_target_count or 0) + sent_count
        if failed_keys:
            delivery_state["wecom_pending_keys"] = failed_keys
        else:
            delivery_state.pop("wecom_pending_keys", None)
            dispatch.wecom_sent_at = now

    if web_push_delivery_ready() and dispatch.web_push_sent_at is None:
        subscriptions = db.execute(
            select(WebPushSubscription).where(WebPushSubscription.is_active == True)
        ).scalars().all()
        previous_pending = delivery_state.get("web_push_pending_ids")
        if isinstance(previous_pending, list):
            pending_ids = {int(item) for item in previous_pending}
            subscriptions = [item for item in subscriptions if item.id in pending_ids]
        sent_count = 0
        failed_ids: list[int] = []
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
            except WebPushEndpointRejected as exc:
                # Never retried: a rejected endpoint is either a permanent policy
                # violation (deactivate) or a resolver problem (retry next run).
                if exc.permanent:
                    subscription.is_active = False
                    subscription.updated_at = now
                else:
                    failed_ids.append(subscription.id)
                reason = _trim_text(exc.reason, _WEB_PUSH_ERROR_TEXT_LIMIT)
                errors.append(f"web_push:{subscription.id}:rejected:{reason}")
            except Exception as exc:  # external delivery
                if web_push_subscription_is_gone(exc):
                    subscription.is_active = False
                    subscription.updated_at = now
                else:
                    failed_ids.append(subscription.id)
                errors.append(f"web_push:{subscription.id}:{_summarize_web_push_error(exc)}")
        dispatch.web_push_recipient_count = (dispatch.web_push_recipient_count or 0) + sent_count
        if failed_ids:
            delivery_state["web_push_pending_ids"] = failed_ids
        else:
            delivery_state.pop("web_push_pending_ids", None)
            dispatch.web_push_sent_at = now

    pending_keys = {
        "email_pending_ids",
        "wecom_pending_keys",
        "web_push_pending_ids",
    }
    if pending_keys.intersection(delivery_state):
        delivery_state["version"] = 1
        delivery_state["messages"] = errors[:12]
        dispatch.last_error = json.dumps(delivery_state, ensure_ascii=False)
    else:
        dispatch.last_error = ""
    dispatch.updated_at = now
    db.commit()

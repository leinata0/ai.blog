import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.env import env_truthy, is_production_env
from app.models import EmailSubscription, WebPushSubscription
from app.notifications import (
    email_delivery_ready,
    is_allowed_web_push_endpoint_host,
    is_valid_email,
    normalize_subscription_content_types,
    normalize_subscription_series_slugs,
    normalize_subscription_topic_keys,
    send_subscription_confirmation_email,
    subscription_status_payload,
    web_push_delivery_ready,
)
from app.rate_limit import limiter
from app.schemas import (
    EmailSubscriptionRequest,
    EmailSubscriptionResponse,
    EmailSubscriptionConfirmRequest,
    EmailUnsubscribeRequest,
    SubscriptionStatusOut,
    WebPushEndpointRequest,
    WebPushPublicKeyOut,
    WebPushSubscriptionInput,
    WebPushSubscriptionResponse,
)
from app.site_config import resolve_public_site_url
from app.url_safety import is_public_http_url
from app.subscription_tokens import (
    ExpiredSubscriptionToken,
    InvalidSubscriptionToken,
    SUBSCRIBE_PURPOSE,
    UNSUBSCRIBE_PURPOSE,
    decode_subscription_token,
    issue_subscription_token,
)

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])

logger = logging.getLogger("blog.subscriptions")

# Env var that flips the unsubscribe proof-of-possession check from "warn" to
# "enforce". See `unsubscribe_web_push` for the rollout it exists to survive.
WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH_ENV = "WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH"

# Compared against when there is nothing real to compare against (unknown
# endpoint, or a row with an empty stored key). Never a valid base64url value, so
# it can never accidentally match — it exists purely so the constant-time compare
# runs on every request and "no such endpoint" costs the same as "wrong key".
_AUTH_COMPARE_PLACEHOLDER = "\x00absent-web-push-auth-key"


def web_push_unsubscribe_requires_auth() -> bool:
    return env_truthy(WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH_ENV, default=False)


def _normalize_push_auth_secret(value: str | None) -> str:
    """Canonical form of a ``PushSubscription.keys.auth`` value.

    The browser emits unpadded base64url and the subscribe endpoint stores that
    string verbatim, but a client that round-trips the key through a standard
    base64 encoder produces the same 16 bytes with ``+``/``/`` and ``=`` padding.
    Normalizing both sides the same way keeps that from reading as a mismatch.
    Case is significant in base64 and is left alone.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    return text.replace("+", "-").replace("/", "_").rstrip("=")


def _auth_proof_matches(stored: str | None, provided: str) -> bool:
    """Constant-time comparison of a presented auth key against the stored one."""
    expected = _normalize_push_auth_secret(stored) or _AUTH_COMPARE_PLACEHOLDER
    candidate = provided or _AUTH_COMPARE_PLACEHOLDER
    return hmac.compare_digest(expected.encode("utf-8"), candidate.encode("utf-8"))


def _endpoint_fingerprint(endpoint: str) -> str:
    """Log-safe handle for an endpoint.

    The endpoint URL is itself a capability (anyone holding it can push to that
    browser), so it must not be written to logs verbatim. A truncated digest is
    enough to correlate repeated attempts.
    """
    return hashlib.sha256(str(endpoint or "").encode("utf-8")).hexdigest()[:12]


def validate_web_push_endpoint(endpoint: str) -> str:
    """Reject anything that is not a public HTTPS push-service URL.

    A stored push endpoint becomes an outbound POST target for pywebpush every
    time a post is published, so this unauthenticated field is a stored-SSRF
    sink. Same baseline as /proxy-image and cover downloads: never accept a
    non-public host.

    Two layers: the public-URL check always applies (it blocks loopback, private
    ranges and cloud metadata addresses), while the push-service host allowlist
    is enforced in production, where an unknown host is always a mistake or an
    attack. Self-hosted relays can be added via WEB_PUSH_ALLOWED_ENDPOINT_HOSTS.

    The host allowlist itself lives in `app.notifications` and is shared with the
    delivery-time gate, so "storable" and "sendable" cannot drift apart.
    """
    value = str(endpoint or "").strip()
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if parsed.scheme != "https" or not hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Invalid web push endpoint")
    if not is_public_http_url(value, resolve_dns=False):
        raise HTTPException(status_code=400, detail="Invalid web push endpoint")
    if not is_allowed_web_push_endpoint_host(hostname):
        if is_production_env():
            raise HTTPException(status_code=400, detail="Unsupported web push endpoint host")
        logger.warning("web_push_endpoint_host_not_allowlisted host=%s", hostname)
    return value


def _subscription_preferences(subscription: EmailSubscription) -> tuple[list[str], list[str], list[str]]:
    try:
        content_types = json.loads(subscription.content_types_json or "[]")
    except (TypeError, json.JSONDecodeError):
        content_types = []
    try:
        topic_keys = json.loads(subscription.topic_keys_json or "[]")
    except (TypeError, json.JSONDecodeError):
        topic_keys = []
    try:
        series_slugs = json.loads(subscription.series_slugs_json or "[]")
    except (TypeError, json.JSONDecodeError):
        series_slugs = []
    return (
        normalize_subscription_content_types(content_types if isinstance(content_types, list) else []),
        normalize_subscription_topic_keys(topic_keys if isinstance(topic_keys, list) else []),
        normalize_subscription_series_slugs(series_slugs if isinstance(series_slugs, list) else []),
    )


def _require_email_delivery_configured(db: Session) -> str:
    """确认邮件能不能发出去。返回站点地址，配置缺失时 503。

    独立成函数是为了能在查库**之前**先调用一次（见 unsubscribe_email）：配置错误必须
    对所有邮箱表现一致，否则"什么时候报 503"本身就成了状态信号。
    """
    if not email_delivery_ready():
        raise HTTPException(
            status_code=503,
            detail="Email delivery is not configured; confirmation email was not sent",
        )
    site_url = resolve_public_site_url(db)
    if not site_url:
        raise HTTPException(
            status_code=503,
            detail="Public site URL is not configured; confirmation email was not sent",
        )
    return site_url


def _send_confirmation_or_fail(
    *,
    email: str,
    purpose: str,
    content_types: list[str],
    topic_keys: list[str],
    series_slugs: list[str],
    db: Session,
) -> None:
    site_url = _require_email_delivery_configured(db)
    token = issue_subscription_token(
        purpose=purpose,
        email=email,
        content_types=content_types,
        topic_keys=topic_keys,
        series_slugs=series_slugs,
    )
    try:
        sent = send_subscription_confirmation_email(email, token, site_url, purpose)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Confirmation email delivery failed; subscription was not changed",
        ) from exc
    if not sent:
        raise HTTPException(
            status_code=503,
            detail="Confirmation email was not sent; subscription was not changed",
        )


def _as_naive_utc(value: datetime | None) -> datetime | None:
    """把数据库读回来的时间戳归一到 naive UTC，好和 token 的 `iat` 直接比较。"""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _reject_replayed_token(
    existing: EmailSubscription | None,
    *,
    issued_at: datetime | None,
    target_active: bool,
    preferences: tuple[list[str], list[str], list[str]],
) -> None:
    """确认链接只对"签发它时的那个状态"有效。

    token 是无状态 JWT，TTL 1 小时，落地前没有任何一次性校验，所以一条订阅链接在这一
    小时里可以被反复兑现：订阅 → 确认 → 退订 → 再点一次那封旧邮件里的链接，订阅就又
    活了。反过来也一样，旧的退订链接能把刚重新订上的邮箱再关掉。

    判据是"这次确认会不会改变状态"，而不是"这个 token 用过没有"：

    * 会改变状态，而这行在链接签发之后被改过 —— 用户自己做了别的操作，旧链接失效；
    * 状态已经就是 token 想要的样子 —— 重复点击（邮件客户端预取、用户手抖点两下）
      走这条路，保持幂等，什么都不做也不报错。

    这样不需要为一次性 token 建表，也不必让正常的重复点击报错。缺 `iat` 的旧 token
    （签发于这次改动之前）无法判断，按原样放行。
    """
    if existing is None or issued_at is None:
        return
    already_applied = bool(existing.is_active) == target_active and _subscription_preferences(existing) == preferences
    if already_applied:
        return
    updated_at = _as_naive_utc(existing.updated_at)
    # 秒级对齐：JWT 的 `iat` 只有整秒，而 updated_at 带微秒。不截断的话，同一秒内先写库
    # 再签发的 token 会把自己判成过期链接（用户点得快一点就中招）。
    if updated_at is not None and updated_at.replace(microsecond=0) > issued_at:
        raise HTTPException(
            status_code=409,
            detail="Subscription changed after this link was issued; request a new confirmation email",
        )


@router.get("/status", response_model=SubscriptionStatusOut)
def get_subscription_status():
    return subscription_status_payload()


@router.post("/email", response_model=EmailSubscriptionResponse)
@limiter.limit("5/minute")
def subscribe_email(
    request: Request,
    body: EmailSubscriptionRequest,
    db: Session = Depends(get_db),
):
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    content_types = normalize_subscription_content_types(body.content_types)
    topic_keys = normalize_subscription_topic_keys(body.topic_keys)
    series_slugs = normalize_subscription_series_slugs(body.series_slugs)

    _send_confirmation_or_fail(
        email=email,
        purpose=SUBSCRIBE_PURPOSE,
        content_types=content_types,
        topic_keys=topic_keys,
        series_slugs=series_slugs,
        db=db,
    )

    return {
        "email": email,
        "content_types": content_types,
        "topic_keys": topic_keys,
        "series_slugs": series_slugs,
        "is_active": None,
        "delivery_ready": True,
        "confirmation_required": True,
        "message": "确认邮件已发送。请在 1 小时内打开邮件中的链接，确认后订阅偏好才会生效。",
    }


@router.post("/email/unsubscribe", response_model=EmailSubscriptionResponse)
@limiter.limit("10/minute")
def unsubscribe_email(
    request: Request,
    body: EmailUnsubscribeRequest,
    db: Session = Depends(get_db),
):
    """请求一封退订确认邮件。

    对任何格式合法的邮箱都返回同一个响应。以前这里按状态分叉（没订阅过 404、已退订
    409、在订阅中 200 并回显偏好），于是这个未认证端点变成了一个订阅查询接口：随便拿
    一份邮箱列表打过来，就能问出谁订过这个站、订的是哪些栏目。回应统一之后，能确认
    某个邮箱状态的只剩下收件箱本身。users.py 的密码重置走的是同一套。

    邮件投递配置的检查放在查库之前：这样"没配 Resend"对已订阅和未订阅的邮箱返回的是
    同一个 503，不会因为报错时机不同又把状态漏出去。
    """
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    _require_email_delivery_configured(db)

    existing = db.execute(
        select(EmailSubscription).where(EmailSubscription.email == email)
    ).scalar_one_or_none()
    if existing is not None and existing.is_active:
        content_types, topic_keys, series_slugs = _subscription_preferences(existing)
        _send_confirmation_or_fail(
            email=email,
            purpose=UNSUBSCRIBE_PURPOSE,
            content_types=content_types,
            topic_keys=topic_keys,
            series_slugs=series_slugs,
            db=db,
        )

    return {
        "email": email,
        "content_types": [],
        "topic_keys": [],
        "series_slugs": [],
        "is_active": None,
        "delivery_ready": True,
        "confirmation_required": True,
        "message": "如果这个邮箱有生效中的订阅，退订确认邮件已发送。打开邮件中的安全链接后，订阅才会关闭。",
    }


@router.post("/email/confirm", response_model=EmailSubscriptionResponse)
@limiter.limit("20/minute")
def confirm_email_subscription(
    request: Request,
    body: EmailSubscriptionConfirmRequest,
    db: Session = Depends(get_db),
):
    try:
        token_payload = decode_subscription_token(body.token)
    except ExpiredSubscriptionToken as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc
    except InvalidSubscriptionToken as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    email = token_payload.email.strip().lower()
    content_types = normalize_subscription_content_types(token_payload.content_types)
    topic_keys = normalize_subscription_topic_keys(token_payload.topic_keys)
    series_slugs = normalize_subscription_series_slugs(token_payload.series_slugs)
    if (
        not is_valid_email(email)
        or content_types != token_payload.content_types
        or topic_keys != token_payload.topic_keys
        or series_slugs != token_payload.series_slugs
    ):
        raise HTTPException(status_code=400, detail="Invalid subscription token payload")

    existing = db.execute(
        select(EmailSubscription).where(EmailSubscription.email == email)
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    _reject_replayed_token(
        existing,
        issued_at=token_payload.issued_at,
        target_active=token_payload.purpose == SUBSCRIBE_PURPOSE,
        preferences=(content_types, topic_keys, series_slugs),
    )

    if token_payload.purpose == SUBSCRIBE_PURPOSE:
        if existing is None:
            existing = EmailSubscription(
                email=email,
                content_types_json='["all"]',
                topic_keys_json="[]",
                series_slugs_json="[]",
                is_active=False,
                source="feeds_page",
            )
            db.add(existing)
        existing.content_types_json = json.dumps(content_types, ensure_ascii=False)
        existing.topic_keys_json = json.dumps(topic_keys, ensure_ascii=False)
        existing.series_slugs_json = json.dumps(series_slugs, ensure_ascii=False)
        existing.is_active = True
        existing.updated_at = now
        message = "邮箱已确认，邮件订阅和偏好现已生效。"
        is_active = True
    else:
        if existing is None:
            raise HTTPException(status_code=404, detail="Subscription not found")
        if _subscription_preferences(existing) != (content_types, topic_keys, series_slugs):
            raise HTTPException(
                status_code=409,
                detail="Subscription preferences changed; request a new unsubscribe link",
            )
        existing.is_active = False
        existing.updated_at = now
        message = "退订已确认，这个邮箱的订阅现已关闭。"
        is_active = False

    db.commit()
    return {
        "email": email,
        "content_types": content_types,
        "topic_keys": topic_keys,
        "series_slugs": series_slugs,
        "is_active": is_active,
        "delivery_ready": email_delivery_ready(),
        "confirmation_required": False,
        "message": message,
    }


@router.get("/web-push/public-key", response_model=WebPushPublicKeyOut)
def get_web_push_public_key():
    status = subscription_status_payload()
    if not status["web_push_configured"]:
        raise HTTPException(status_code=503, detail="Web push is not configured")
    return {"public_key": status["web_push_public_key"]}


@router.post("/web-push", response_model=WebPushSubscriptionResponse)
@limiter.limit("5/minute")
def subscribe_web_push(
    request: Request,
    body: WebPushSubscriptionInput,
    db: Session = Depends(get_db),
):
    if not web_push_delivery_ready():
        raise HTTPException(status_code=503, detail="Web push is not configured")

    p256dh = (body.keys.p256dh or "").strip()
    auth = (body.keys.auth or "").strip()
    if not (body.endpoint or "").strip() or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Invalid web push subscription payload")
    endpoint = validate_web_push_endpoint(body.endpoint)

    content_types = normalize_subscription_content_types(body.content_types)
    topic_keys = normalize_subscription_topic_keys(body.topic_keys)
    series_slugs = normalize_subscription_series_slugs(body.series_slugs)

    existing = db.execute(
        select(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint)
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is None:
        existing = WebPushSubscription(
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            content_types_json='["all"]',
            topic_keys_json="[]",
            series_slugs_json="[]",
            is_active=True,
            user_agent="browser",
        )
        db.add(existing)

    existing.p256dh = p256dh
    existing.auth = auth
    existing.content_types_json = json.dumps(content_types, ensure_ascii=False)
    existing.topic_keys_json = json.dumps(topic_keys, ensure_ascii=False)
    existing.series_slugs_json = json.dumps(series_slugs, ensure_ascii=False)
    existing.is_active = True
    existing.updated_at = now
    db.commit()

    return {
        "endpoint": endpoint,
        "content_types": content_types,
        "topic_keys": topic_keys,
        "series_slugs": series_slugs,
        "is_active": True,
        "push_ready": True,
        "message": "浏览器提醒已启用，后续会按你的栏目、主题和系列偏好发送通知。",
    }


class WebPushUnsubscribeRequest(WebPushEndpointRequest):
    """`endpoint` plus the browser's proof that it owns that subscription.

    `auth` is `PushSubscription.toJSON().keys.auth` — the 16 random bytes the
    push service hands only to the browser that created the subscription, and
    which this backend already stores at subscribe time. It is optional at the
    schema level on purpose; see `unsubscribe_web_push` for why.

    Declared here rather than in `app/schemas.py` only to keep this change inside
    one file; it belongs next to the other WebPush* models once convenient.
    """

    auth: str | None = Field(default=None, max_length=255)


@router.post("/web-push/unsubscribe", response_model=WebPushSubscriptionResponse)
@limiter.limit("10/minute")
def unsubscribe_web_push(
    request: Request,
    body: WebPushUnsubscribeRequest,
    db: Session = Depends(get_db),
):
    """关闭一个浏览器的推送订阅。

    持有证明是 `keys.auth`：推送服务只把这 16 字节随机值交给创建订阅的那个浏览器，
    而订阅时前端就已经把它发过来存下了，所以后端本来就有比对材料。endpoint 本身虽然
    也是高熵、不可枚举的，但它会出现在网络路径、代理日志、以及任何一次推送投递里，
    单靠它等于"知道 URL 就能替别人关掉提醒"。

    **两阶段上线**：`auth` 在 schema 上是可选的。滚动部署期间旧前端只发 endpoint，
    如果缺 `auth` 直接报错，那段时间里所有退订都会失败。所以：

    * 带了 `auth`：必须常数时间比对通过，否则什么都不做；
    * 没带 `auth`：记一条 warning，行为维持旧的宽松语义（默认），
      或者在 `WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH=1` 时直接拒绝。

    收紧时机：前端带 `auth` 的版本上线并稳定运行 ≥ 一个缓存/部署周期（这里是
    Vercel 预渲染 + sessionStorage 缓存，实际取一周比较稳），确认
    `web_push_unsubscribe_without_proof` 这条 warning 在日志里归零之后，把
    `WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH=1` 加到 Render 环境变量即可；再之后可以把
    默认值翻成 True 并删掉这个开关。

    另外保持"不泄漏存在性"：endpoint 存不存在、`auth` 对不对、走的是宽松还是严格
    分支，响应体和状态码完全一致（未知 endpoint 以前回 404，等于给了一个"这个
    endpoint 在本站注册过吗"的查询接口）。比对无条件执行、且走 `compare_digest`，
    所以耗时也不分叉。命中时只置 is_active=False 从不删行——重新订阅即可恢复。
    """
    endpoint = (body.endpoint or "").strip()
    proof = _normalize_push_auth_secret(body.auth)
    existing = db.execute(
        select(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint)
    ).scalar_one_or_none()
    stored_auth = existing.auth if existing is not None else None

    if proof:
        authorized = _auth_proof_matches(stored_auth, proof)
        if not authorized:
            logger.warning(
                "web_push_unsubscribe_auth_mismatch endpoint=%s",
                _endpoint_fingerprint(endpoint),
            )
    else:
        # 同样跑一次比对：让"没带 auth"和"带了但不对"在耗时上无法区分。
        _auth_proof_matches(stored_auth, _AUTH_COMPARE_PLACEHOLDER)
        enforced = web_push_unsubscribe_requires_auth()
        authorized = not enforced
        logger.warning(
            "web_push_unsubscribe_without_proof endpoint=%s enforced=%s",
            _endpoint_fingerprint(endpoint),
            enforced,
        )

    if authorized and existing is not None and existing.is_active:
        existing.is_active = False
        existing.updated_at = datetime.now(timezone.utc)
        db.commit()
    return {
        "endpoint": endpoint,
        "content_types": [],
        "topic_keys": [],
        "series_slugs": [],
        "is_active": False,
        "push_ready": web_push_delivery_ready(),
        "message": "这个浏览器的提醒已关闭。",
    }

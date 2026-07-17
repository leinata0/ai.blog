import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EmailSubscription, WebPushSubscription
from app.notifications import (
    email_delivery_ready,
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
from app.subscription_tokens import (
    ExpiredSubscriptionToken,
    InvalidSubscriptionToken,
    SUBSCRIBE_PURPOSE,
    UNSUBSCRIBE_PURPOSE,
    decode_subscription_token,
    issue_subscription_token,
)

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])


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


def _send_confirmation_or_fail(
    *,
    email: str,
    purpose: str,
    content_types: list[str],
    topic_keys: list[str],
    series_slugs: list[str],
    db: Session,
) -> None:
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
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    existing = db.execute(
        select(EmailSubscription).where(EmailSubscription.email == email)
    ).scalar_one_or_none()
    if existing is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if not existing.is_active:
        raise HTTPException(status_code=409, detail="Subscription is already inactive")

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
        "content_types": content_types,
        "topic_keys": topic_keys,
        "series_slugs": series_slugs,
        "is_active": True,
        "delivery_ready": True,
        "confirmation_required": True,
        "message": "退订确认邮件已发送。打开邮件中的安全链接后，订阅才会关闭。",
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

    endpoint = (body.endpoint or "").strip()
    p256dh = (body.keys.p256dh or "").strip()
    auth = (body.keys.auth or "").strip()
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Invalid web push subscription payload")

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


@router.post("/web-push/unsubscribe", response_model=WebPushSubscriptionResponse)
@limiter.limit("10/minute")
def unsubscribe_web_push(
    request: Request,
    body: WebPushEndpointRequest,
    db: Session = Depends(get_db),
):
    endpoint = (body.endpoint or "").strip()
    existing = db.execute(
        select(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint)
    ).scalar_one_or_none()
    if existing is None:
        raise HTTPException(status_code=404, detail="Web push subscription not found")

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

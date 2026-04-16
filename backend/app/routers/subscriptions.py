import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EmailSubscription, WebPushSubscription
from app.notifications import (
    email_delivery_ready,
    is_valid_email,
    normalize_subscription_content_types,
    subscription_status_payload,
    web_push_delivery_ready,
)
from app.schemas import (
    EmailSubscriptionRequest,
    EmailSubscriptionResponse,
    EmailUnsubscribeRequest,
    SubscriptionStatusOut,
    WebPushEndpointRequest,
    WebPushPublicKeyOut,
    WebPushSubscriptionInput,
    WebPushSubscriptionResponse,
)

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])


@router.get("/status", response_model=SubscriptionStatusOut)
def get_subscription_status():
    return subscription_status_payload()


@router.post("/email", response_model=EmailSubscriptionResponse)
def subscribe_email(
    body: EmailSubscriptionRequest,
    db: Session = Depends(get_db),
):
    email = (body.email or "").strip().lower()
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    content_types = normalize_subscription_content_types(body.content_types)
    existing = db.execute(
        select(EmailSubscription).where(EmailSubscription.email == email)
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is None:
        existing = EmailSubscription(
            email=email,
            content_types_json='["all"]',
            is_active=True,
            source="feeds_page",
        )
        db.add(existing)
    existing.content_types_json = json.dumps(content_types, ensure_ascii=False)
    existing.is_active = True
    existing.updated_at = now
    db.commit()

    return {
        "email": email,
        "content_types": content_types,
        "is_active": True,
        "delivery_ready": email_delivery_ready(),
        "message": "邮件订阅已保存，后续有新内容会按你的偏好发送提醒。",
    }


@router.post("/email/unsubscribe", response_model=EmailSubscriptionResponse)
def unsubscribe_email(
    body: EmailUnsubscribeRequest,
    db: Session = Depends(get_db),
):
    email = (body.email or "").strip().lower()
    existing = db.execute(
        select(EmailSubscription).where(EmailSubscription.email == email)
    ).scalar_one_or_none()
    if existing is None:
        raise HTTPException(status_code=404, detail="Subscription not found")

    existing.is_active = False
    existing.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "email": email,
        "content_types": normalize_subscription_content_types([]),
        "is_active": False,
        "delivery_ready": email_delivery_ready(),
        "message": "这个邮箱的邮件订阅已关闭。",
    }


@router.get("/web-push/public-key", response_model=WebPushPublicKeyOut)
def get_web_push_public_key():
    status = subscription_status_payload()
    if not status["web_push_configured"]:
        raise HTTPException(status_code=503, detail="Web push is not configured")
    return {"public_key": status["web_push_public_key"]}


@router.post("/web-push", response_model=WebPushSubscriptionResponse)
def subscribe_web_push(
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
            is_active=True,
            user_agent="browser",
        )
        db.add(existing)
    existing.p256dh = p256dh
    existing.auth = auth
    existing.content_types_json = json.dumps(content_types, ensure_ascii=False)
    existing.is_active = True
    existing.updated_at = now
    db.commit()

    return {
        "endpoint": endpoint,
        "content_types": content_types,
        "is_active": True,
        "push_ready": True,
        "message": "浏览器提醒已启用，有新内容时会向这个浏览器发送通知。",
    }


@router.post("/web-push/unsubscribe", response_model=WebPushSubscriptionResponse)
def unsubscribe_web_push(
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
        "is_active": False,
        "push_ready": web_push_delivery_ready(),
        "message": "这个浏览器的提醒已关闭。",
    }

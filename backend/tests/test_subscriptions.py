from datetime import timedelta

from app.models import EmailSubscription, PostNotificationDispatch, WebPushSubscription
from app.notifications import send_subscription_confirmation_email
from app.subscription_tokens import SUBSCRIBE_PURPOSE, issue_subscription_token


def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _capture_confirmations(monkeypatch):
    confirmations = []

    def _send(email, token, site_url, purpose):
        confirmations.append(
            {"email": email, "token": token, "site_url": site_url, "purpose": purpose}
        )
        return True

    monkeypatch.setattr(
        "app.routers.subscriptions.send_subscription_confirmation_email",
        _send,
    )
    return confirmations


def _confirm_latest(client, confirmations):
    return client.post(
        "/api/subscriptions/email/confirm",
        json={"token": confirmations[-1]["token"]},
    )


def _subscribe_and_confirm(client, confirmations, payload):
    request_resp = client.post("/api/subscriptions/email", json=payload)
    assert request_resp.status_code == 200
    assert request_resp.json()["confirmation_required"] is True
    confirm_resp = _confirm_latest(client, confirmations)
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["is_active"] is True
    return confirm_resp


def test_subscription_status_and_public_subscription_endpoints(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "public-test-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-test-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:owner@example.com")
    monkeypatch.setenv("WECOM_WEBHOOK_URLS", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test")
    confirmations = _capture_confirmations(monkeypatch)

    status_resp = client.get("/api/subscriptions/status")
    assert status_resp.status_code == 200
    payload = status_resp.json()
    assert payload["email_configured"] is True
    assert payload["web_push_configured"] is True
    assert payload["wecom_configured"] is True
    assert payload["web_push_public_key"] == "public-test-key"

    email_resp = client.post(
        "/api/subscriptions/email",
        json={
            "email": "reader@example.com",
            "content_types": ["weekly_review"],
            "topic_keys": ["openai-models"],
            "series_slugs": ["ai-weekly-review"],
        },
    )
    assert email_resp.status_code == 200
    assert email_resp.json()["delivery_ready"] is True
    assert email_resp.json()["confirmation_required"] is True
    assert email_resp.json()["is_active"] is None
    assert email_resp.json()["topic_keys"] == ["openai-models"]
    assert email_resp.json()["series_slugs"] == ["ai-weekly-review"]
    assert db_session.query(EmailSubscription).filter_by(email="reader@example.com").one_or_none() is None

    confirm_resp = _confirm_latest(client, confirmations)
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["confirmation_required"] is False
    assert confirmations[0]["site_url"] == "https://example.test"

    email_sub = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()
    assert email_sub.is_active is True
    assert "weekly_review" in email_sub.content_types_json
    assert "openai-models" in email_sub.topic_keys_json
    assert "ai-weekly-review" in email_sub.series_slugs_json

    push_resp = client.post(
        "/api/subscriptions/web-push",
        json={
            "endpoint": "https://push.example.com/sub/123",
            "keys": {"p256dh": "abc", "auth": "def"},
            "content_types": ["daily_brief"],
            "topic_keys": ["agent-tools"],
            "series_slugs": ["ai-daily-brief"],
        },
    )
    assert push_resp.status_code == 200
    assert push_resp.json()["push_ready"] is True
    assert push_resp.json()["topic_keys"] == ["agent-tools"]
    assert push_resp.json()["series_slugs"] == ["ai-daily-brief"]

    push_sub = db_session.query(WebPushSubscription).filter_by(endpoint="https://push.example.com/sub/123").one()
    assert push_sub.is_active is True
    assert "daily_brief" in push_sub.content_types_json
    assert "agent-tools" in push_sub.topic_keys_json
    assert "ai-daily-brief" in push_sub.series_slugs_json


def test_manual_post_dispatches_email_notification(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    sent_emails = []
    confirmations = _capture_confirmations(monkeypatch)

    monkeypatch.setattr(
        "app.notifications._send_email_notification",
        lambda email, post, site_url: sent_emails.append((email, post.slug, site_url)),
    )

    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "reader@example.com", "content_types": ["all"]},
    )

    token = _login(client)
    create_resp = client.post(
        "/api/admin/posts",
        headers=_auth(token),
        json={
            "title": "测试邮件订阅提醒",
            "slug": "subscription-email-alert",
            "summary": "一篇用于验证订阅提醒的文章。",
            "content_md": "## 内容\n\n用于测试。",
            "content_type": "post",
            "published_mode": "manual",
            "is_published": True,
            "tags": [],
        },
    )
    assert create_resp.status_code == 200
    assert sent_emails == [("reader@example.com", "subscription-email-alert", "https://example.test")]

    dispatch = db_session.query(PostNotificationDispatch).filter_by(post_id=create_resp.json()["id"]).one()
    assert dispatch.email_recipient_count == 1
    assert dispatch.email_sent_at is not None


def test_auto_post_dispatches_after_publishing_metadata(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    sent_emails = []
    confirmations = _capture_confirmations(monkeypatch)

    monkeypatch.setattr(
        "app.notifications._send_email_notification",
        lambda email, post, site_url: sent_emails.append((email, post.slug)),
    )

    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "reader@example.com", "content_types": ["daily_brief"]},
    )

    token = _login(client)
    create_resp = client.post(
        "/api/admin/posts",
        headers=_auth(token),
        json={
            "title": "自动日报提醒测试",
            "slug": "auto-daily-subscription-alert",
            "summary": "验证自动发文在元数据桥接后再通知。",
            "content_md": "## 内容\n\n用于自动发文测试。",
            "content_type": "daily_brief",
            "published_mode": "auto",
            "is_published": True,
            "tags": [],
        },
    )
    assert create_resp.status_code == 200
    assert sent_emails == []

    metadata_resp = client.post(
        "/api/admin/publishing-metadata",
        headers=_auth(token),
        json={
            "post_id": create_resp.json()["id"],
            "metadata": {
                "series_slug": "ai-daily-brief",
                "source_count": 3,
                "quality_score": 88,
                "reading_time": 4,
            },
            "sources": [
                {
                    "source_type": "news",
                    "source_name": "Example",
                    "source_url": "https://example.com/article",
                    "is_primary": True,
                }
            ],
            "artifact": {
                "workflow_key": "daily_auto",
                "coverage_date": "2026-04-16",
                "research_pack_summary": "test",
            },
        },
    )
    assert metadata_resp.status_code == 200
    assert sent_emails == [("reader@example.com", "auto-daily-subscription-alert")]

    dispatch = db_session.query(PostNotificationDispatch).filter_by(post_id=create_resp.json()["id"]).one()
    assert dispatch.email_recipient_count == 1


def test_subscription_preferences_match_topic_or_series(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    sent_emails = []
    confirmations = _capture_confirmations(monkeypatch)

    monkeypatch.setattr(
        "app.notifications._send_email_notification",
        lambda email, post, site_url: sent_emails.append((email, post.slug)),
    )

    _subscribe_and_confirm(
        client,
        confirmations,
        {
            "email": "topic@example.com",
            "content_types": ["daily_brief"],
            "topic_keys": ["topic-follow-up"],
        },
    )
    _subscribe_and_confirm(
        client,
        confirmations,
        {
            "email": "series@example.com",
            "content_types": ["daily_brief"],
            "series_slugs": ["ai-daily-brief"],
        },
    )
    _subscribe_and_confirm(
        client,
        confirmations,
        {
            "email": "other@example.com",
            "content_types": ["weekly_review"],
            "topic_keys": ["other-topic"],
        },
    )

    token = _login(client)
    create_resp = client.post(
        "/api/admin/posts",
        headers=_auth(token),
        json={
            "title": "Daily topic follow up",
            "slug": "daily-topic-follow-up",
            "summary": "Subscription preference filter verification.",
            "content_md": "## 内容\n\n用于订阅偏好验证。",
            "content_type": "daily_brief",
            "topic_key": "topic-follow-up",
            "series_slug": "ai-daily-brief",
            "published_mode": "manual",
            "is_published": True,
            "tags": [],
        },
    )
    assert create_resp.status_code == 200
    assert sent_emails == [
        ("topic@example.com", "daily-topic-follow-up"),
        ("series@example.com", "daily-topic-follow-up"),
    ]


def test_email_subscription_fails_closed_without_delivery_configuration(client, db_session, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    response = client.post(
        "/api/subscriptions/email",
        json={"email": "reader@example.com", "content_types": ["all"]},
    )

    assert response.status_code == 503
    assert "confirmation email was not sent" in response.json()["detail"]
    assert db_session.query(EmailSubscription).count() == 0


def test_email_subscription_does_not_overwrite_preferences_before_confirmation(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)
    existing = EmailSubscription(
        email="reader@example.com",
        content_types_json='["weekly_review"]',
        topic_keys_json='["old-topic"]',
        series_slugs_json="[]",
        is_active=True,
        source="test",
    )
    db_session.add(existing)
    db_session.commit()

    response = client.post(
        "/api/subscriptions/email",
        json={
            "email": "reader@example.com",
            "content_types": ["daily_brief"],
            "topic_keys": ["new-topic"],
        },
    )

    assert response.status_code == 200
    db_session.refresh(existing)
    assert existing.content_types_json == '["weekly_review"]'
    assert existing.topic_keys_json == '["old-topic"]'

    confirm_resp = _confirm_latest(client, confirmations)
    assert confirm_resp.status_code == 200
    db_session.refresh(existing)
    assert existing.content_types_json == '["daily_brief"]'
    assert existing.topic_keys_json == '["new-topic"]'


def test_email_unsubscribe_requires_matching_confirmation_token(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)
    _subscribe_and_confirm(
        client,
        confirmations,
        {
            "email": "reader@example.com",
            "content_types": ["daily_brief"],
            "topic_keys": ["agent-tools"],
        },
    )
    subscription = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()

    request_resp = client.post(
        "/api/subscriptions/email/unsubscribe",
        json={"email": "reader@example.com"},
    )
    assert request_resp.status_code == 200
    assert request_resp.json()["confirmation_required"] is True
    db_session.refresh(subscription)
    assert subscription.is_active is True

    confirm_resp = _confirm_latest(client, confirmations)
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["is_active"] is False
    db_session.refresh(subscription)
    assert subscription.is_active is False


def test_stale_unsubscribe_token_cannot_cancel_changed_preferences(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)
    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "reader@example.com", "content_types": ["daily_brief"]},
    )
    request_resp = client.post(
        "/api/subscriptions/email/unsubscribe",
        json={"email": "reader@example.com"},
    )
    assert request_resp.status_code == 200
    unsubscribe_token = confirmations[-1]["token"]

    subscription = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()
    subscription.content_types_json = '["weekly_review"]'
    db_session.commit()

    confirm_resp = client.post(
        "/api/subscriptions/email/confirm",
        json={"token": unsubscribe_token},
    )
    assert confirm_resp.status_code == 409
    db_session.refresh(subscription)
    assert subscription.is_active is True


def test_invalid_and_expired_subscription_tokens_are_rejected(client):
    invalid_resp = client.post(
        "/api/subscriptions/email/confirm",
        json={"token": "not-a-valid-confirmation-token"},
    )
    assert invalid_resp.status_code == 400

    expired_token = issue_subscription_token(
        purpose=SUBSCRIBE_PURPOSE,
        email="reader@example.com",
        content_types=["all"],
        topic_keys=[],
        series_slugs=[],
        expires_delta=timedelta(seconds=-1),
    )
    expired_resp = client.post(
        "/api/subscriptions/email/confirm",
        json={"token": expired_token},
    )
    assert expired_resp.status_code == 410


def test_confirmation_delivery_failure_does_not_create_subscription(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    monkeypatch.setattr(
        "app.routers.subscriptions.send_subscription_confirmation_email",
        lambda *args: False,
    )

    response = client.post(
        "/api/subscriptions/email",
        json={"email": "reader@example.com", "content_types": ["all"]},
    )
    assert response.status_code == 503
    assert db_session.query(EmailSubscription).count() == 0


def test_confirmation_email_keeps_token_out_of_http_query(monkeypatch):
    captured = {}

    def _send_email(to, subject, html, text):
        captured.update({"to": to, "subject": subject, "html": html, "text": text})
        return True

    monkeypatch.setattr("app.notifications.send_email", _send_email)

    assert send_subscription_confirmation_email(
        "reader@example.com",
        "signed.token/value",
        "https://example.test",
        SUBSCRIBE_PURPOSE,
    )
    assert "https://example.test/feeds#subscription_token=signed.token%2Fvalue" in captured["text"]
    assert "/feeds?subscription_token=" not in captured["text"]

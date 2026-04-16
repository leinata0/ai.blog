from app.models import EmailSubscription, PostNotificationDispatch, WebPushSubscription


def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_subscription_status_and_public_subscription_endpoints(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "public-test-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-test-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:owner@example.com")
    monkeypatch.setenv("WECOM_WEBHOOK_URLS", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test")

    status_resp = client.get("/api/subscriptions/status")
    assert status_resp.status_code == 200
    payload = status_resp.json()
    assert payload["email_configured"] is True
    assert payload["web_push_configured"] is True
    assert payload["wecom_configured"] is True
    assert payload["web_push_public_key"] == "public-test-key"

    email_resp = client.post(
        "/api/subscriptions/email",
        json={"email": "reader@example.com", "content_types": ["weekly_review"]},
    )
    assert email_resp.status_code == 200
    assert email_resp.json()["delivery_ready"] is True

    email_sub = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()
    assert email_sub.is_active is True
    assert "weekly_review" in email_sub.content_types_json

    push_resp = client.post(
        "/api/subscriptions/web-push",
        json={
            "endpoint": "https://push.example.com/sub/123",
            "keys": {"p256dh": "abc", "auth": "def"},
            "content_types": ["daily_brief"],
        },
    )
    assert push_resp.status_code == 200
    assert push_resp.json()["push_ready"] is True

    push_sub = db_session.query(WebPushSubscription).filter_by(endpoint="https://push.example.com/sub/123").one()
    assert push_sub.is_active is True
    assert "daily_brief" in push_sub.content_types_json


def test_manual_post_dispatches_email_notification(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    sent_emails = []

    monkeypatch.setattr(
        "app.notifications._send_email_notification",
        lambda email, post, site_url: sent_emails.append((email, post.slug, site_url)),
    )

    subscribe_resp = client.post(
        "/api/subscriptions/email",
        json={"email": "reader@example.com", "content_types": ["all"]},
    )
    assert subscribe_resp.status_code == 200

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
    assert sent_emails == [("reader@example.com", "subscription-email-alert", "https://563118077.xyz")]

    dispatch = db_session.query(PostNotificationDispatch).filter_by(post_id=create_resp.json()["id"]).one()
    assert dispatch.email_recipient_count == 1
    assert dispatch.email_sent_at is not None


def test_auto_post_dispatches_after_publishing_metadata(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    sent_emails = []

    monkeypatch.setattr(
        "app.notifications._send_email_notification",
        lambda email, post, site_url: sent_emails.append((email, post.slug)),
    )

    subscribe_resp = client.post(
        "/api/subscriptions/email",
        json={"email": "reader@example.com", "content_types": ["daily_brief"]},
    )
    assert subscribe_resp.status_code == 200

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

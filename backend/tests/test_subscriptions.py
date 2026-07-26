from datetime import datetime, timedelta, timezone

from app.models import EmailSubscription, Post, PostNotificationDispatch, WebPushSubscription
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


def test_failed_email_dispatch_retries_only_failed_recipients(client, db_session, monkeypatch):
    from app.notifications import _dispatch_post_notifications

    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    recipients = [
        EmailSubscription(email="ok@example.com", is_active=True),
        EmailSubscription(email="retry@example.com", is_active=True),
    ]
    db_session.add_all(recipients)
    db_session.commit()
    post = Post(
        title="Retry delivery",
        slug="retry-delivery",
        summary="Retry only failed recipients.",
        content_md="content",
        is_published=True,
    )
    db_session.add(post)
    db_session.commit()

    calls = []
    retry_should_fail = True

    def _send(email, _post, _site_url):
        nonlocal retry_should_fail
        calls.append(email)
        if email == "retry@example.com" and retry_should_fail:
            retry_should_fail = False
            raise RuntimeError("temporary outage")

    monkeypatch.setattr("app.notifications._send_email_notification", _send)

    _dispatch_post_notifications(db_session, post.id)
    dispatch = db_session.query(PostNotificationDispatch).filter_by(post_id=post.id).one()
    assert dispatch.email_sent_at is None
    assert dispatch.email_recipient_count == 1
    assert "email_pending_ids" in dispatch.last_error
    assert "retry@example.com" not in dispatch.last_error

    _dispatch_post_notifications(db_session, post.id)
    db_session.refresh(dispatch)
    assert calls.count("ok@example.com") == 1
    assert calls.count("retry@example.com") == 2
    assert dispatch.email_recipient_count == 2
    assert dispatch.email_sent_at is not None
    assert dispatch.last_error == ""


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


def test_staged_auto_post_dispatches_only_after_final_publish(client, db_session, monkeypatch):
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
            "title": "分阶段自动发布提醒测试",
            "slug": "staged-auto-subscription-alert",
            "summary": "验证桥接成功之前保持草稿。",
            "content_md": "## 内容\n\n用于分阶段自动发文测试。",
            "content_type": "daily_brief",
            "published_mode": "auto",
            "is_published": False,
            "tags": [],
        },
    )
    assert create_resp.status_code == 200

    metadata_resp = client.post(
        "/api/admin/publishing-metadata",
        headers=_auth(token),
        json={
            "post_id": create_resp.json()["id"],
            "metadata": {"series_slug": "ai-daily-brief", "source_count": 1},
            "sources": [],
            "artifact": {
                "workflow_key": "daily_auto",
                "coverage_date": "2026-04-17",
            },
        },
    )
    assert metadata_resp.status_code == 200
    assert sent_emails == []

    publish_resp = client.put(
        f"/api/admin/posts/{create_resp.json()['id']}",
        headers=_auth(token),
        json={"is_published": True},
    )
    assert publish_resp.status_code == 200
    assert sent_emails == [("reader@example.com", "staged-auto-subscription-alert")]

    dispatch = db_session.query(PostNotificationDispatch).filter_by(
        post_id=create_resp.json()["id"]
    ).one()
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


# --------------------------------------------------------------------------- #
# 未认证端点不能变成状态查询接口
# --------------------------------------------------------------------------- #


def test_unsubscribe_request_cannot_be_used_to_probe_who_is_subscribed(
    client, db_session, monkeypatch
):
    """三种状态（没订过 / 订过已退订 / 订阅中）必须返回同一份响应。

    以前是 404 / 409 / 200+偏好回显，等于给了一个免认证的订阅查询接口：拿一份邮箱列表
    打过来就能问出谁订过这个站。
    """
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)

    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "active@example.com", "content_types": ["daily_brief"], "topic_keys": ["agents"]},
    )
    db_session.add(
        EmailSubscription(
            email="cancelled@example.com",
            content_types_json='["weekly_review"]',
            topic_keys_json="[]",
            series_slugs_json="[]",
            is_active=False,
        )
    )
    db_session.commit()

    responses = {
        email: client.post("/api/subscriptions/email/unsubscribe", json={"email": email})
        for email in ("active@example.com", "cancelled@example.com", "never@example.com")
    }

    bodies = []
    for email, resp in responses.items():
        assert resp.status_code == 200, email
        body = resp.json()
        assert body.pop("email") == email
        bodies.append(body)
    assert bodies[0] == bodies[1] == bodies[2]
    # 偏好不能回显：那本身就是订阅内容的泄漏
    assert bodies[0]["content_types"] == []
    assert bodies[0]["topic_keys"] == []
    assert bodies[0]["is_active"] is None

    # 只有真正在订阅中的那个邮箱才会收到邮件
    assert [item["email"] for item in confirmations if item["purpose"] == "email_unsubscribe"] == [
        "active@example.com"
    ]


def test_unsubscribe_request_reports_missing_email_config_the_same_way_for_everyone(client, monkeypatch):
    """投递没配好时，已订阅和没订阅的邮箱要拿到同一个 503（报错时机也是信号）。"""
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)

    for email in ("active@example.com", "never@example.com"):
        resp = client.post("/api/subscriptions/email/unsubscribe", json={"email": email})
        assert resp.status_code == 503


def test_web_push_unsubscribe_does_not_reveal_whether_an_endpoint_is_registered(client, db_session, monkeypatch):
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "public-test-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-test-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:owner@example.com")

    known = "https://fcm.googleapis.com/fcm/send/known-endpoint"
    db_session.add(WebPushSubscription(endpoint=known, p256dh="k", auth="a", is_active=True))
    db_session.commit()

    known_resp = client.post("/api/subscriptions/web-push/unsubscribe", json={"endpoint": known})
    unknown_resp = client.post(
        "/api/subscriptions/web-push/unsubscribe",
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/never-seen"},
    )

    assert known_resp.status_code == unknown_resp.status_code == 200
    assert known_resp.json()["is_active"] is False
    assert unknown_resp.json()["is_active"] is False

    subscription = db_session.query(WebPushSubscription).filter_by(endpoint=known).one()
    db_session.refresh(subscription)
    assert subscription.is_active is False
    # 只停用，不删行：重新订阅可以恢复
    assert db_session.query(WebPushSubscription).count() == 1


# --------------------------------------------------------------------------- #
# 退订的持有证明（keys.auth）
#
# endpoint 会出现在网络路径和每一次推送投递里，只凭它等于"知道 URL 就能替别人关掉
# 提醒"。`keys.auth` 是推送服务只交给创建订阅那个浏览器的 16 字节随机值，订阅时就已
# 经存进库里，所以后端本来就有比对材料。
# --------------------------------------------------------------------------- #


_PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/proof-of-possession"
_PUSH_AUTH = "kZ3n-Ex4mPl3_auTHkey"


def _web_push_env(monkeypatch):
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "public-test-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-test-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:owner@example.com")
    monkeypatch.delenv("WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH", raising=False)


def _seed_push_subscription(db_session, *, endpoint=_PUSH_ENDPOINT, auth=_PUSH_AUTH):
    db_session.add(
        WebPushSubscription(endpoint=endpoint, p256dh="p256dh-value", auth=auth, is_active=True)
    )
    db_session.commit()


def _is_active(db_session, endpoint=_PUSH_ENDPOINT) -> bool:
    row = db_session.query(WebPushSubscription).filter_by(endpoint=endpoint).one()
    db_session.refresh(row)
    return bool(row.is_active)


def _unsubscribe(client, **payload):
    return client.post("/api/subscriptions/web-push/unsubscribe", json=payload)


def test_web_push_unsubscribe_with_the_matching_auth_key_deactivates(client, db_session, monkeypatch):
    _web_push_env(monkeypatch)
    _seed_push_subscription(db_session)

    resp = _unsubscribe(client, endpoint=_PUSH_ENDPOINT, auth=_PUSH_AUTH)

    assert resp.status_code == 200
    assert _is_active(db_session) is False


def test_web_push_unsubscribe_accepts_a_padded_base64_auth_key(client, db_session, monkeypatch):
    """同一把 16 字节钥匙，标准 base64 重编码后（+ / 和 = 补位）仍要认。"""
    _web_push_env(monkeypatch)
    _seed_push_subscription(db_session, auth="ab-cd_ef")

    resp = _unsubscribe(client, endpoint=_PUSH_ENDPOINT, auth="ab+cd/ef==")

    assert resp.status_code == 200
    assert _is_active(db_session) is False


def test_web_push_unsubscribe_with_a_wrong_auth_key_changes_nothing_and_looks_identical(
    client, db_session, monkeypatch
):
    """错的 auth 不能停用，而且响应必须和成功那次逐字节相同。

    只要"失败"和"成功"在状态码、响应体或任何一个字段上能被区分，未认证的调用方就又拿到
    了一个"这个 endpoint 注册过吗 / 这把钥匙对吗"的查询接口——那正是这个端点上一轮刚
    堵掉的存在性预言机。
    """
    _web_push_env(monkeypatch)
    _seed_push_subscription(db_session)

    wrong_resp = _unsubscribe(client, endpoint=_PUSH_ENDPOINT, auth="not-the-right-key")
    assert wrong_resp.status_code == 200
    # 关键断言：错的钥匙什么都没改
    assert _is_active(db_session) is True

    correct_resp = _unsubscribe(client, endpoint=_PUSH_ENDPOINT, auth=_PUSH_AUTH)
    assert correct_resp.status_code == 200
    assert _is_active(db_session) is False

    # 成功与失败的响应完全一致（两次请求的 endpoint 也是同一个）
    assert wrong_resp.status_code == correct_resp.status_code
    assert wrong_resp.json() == correct_resp.json()


def test_web_push_unsubscribe_response_is_the_same_for_a_never_registered_endpoint(
    client, db_session, monkeypatch
):
    _web_push_env(monkeypatch)
    _seed_push_subscription(db_session)

    known_resp = _unsubscribe(client, endpoint=_PUSH_ENDPOINT, auth=_PUSH_AUTH)
    unknown_endpoint = "https://fcm.googleapis.com/fcm/send/never-registered"
    unknown_resp = _unsubscribe(client, endpoint=unknown_endpoint, auth=_PUSH_AUTH)
    missing_auth_resp = _unsubscribe(client, endpoint=unknown_endpoint)

    assert known_resp.status_code == unknown_resp.status_code == missing_auth_resp.status_code == 200
    bodies = [resp.json() for resp in (known_resp, unknown_resp, missing_auth_resp)]
    # endpoint 是请求回显，其余每个字段都必须一样
    assert bodies[0]["endpoint"] == _PUSH_ENDPOINT
    assert bodies[1]["endpoint"] == bodies[2]["endpoint"] == unknown_endpoint
    stripped = [{key: value for key, value in body.items() if key != "endpoint"} for body in bodies]
    assert stripped[0] == stripped[1] == stripped[2]
    # 未注册的 endpoint 不会因为这次请求被建行
    assert db_session.query(WebPushSubscription).filter_by(endpoint=unknown_endpoint).count() == 0


def test_web_push_unsubscribe_without_auth_stays_permissive_but_warns(
    client, db_session, monkeypatch, caplog
):
    """滚动部署兼容：旧前端只发 endpoint，行为不变，但要留下可观测的 warning。

    这条 warning 就是收紧开关的判据——它在日志里归零之后，才把
    WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH=1 打开。
    """
    import logging

    _web_push_env(monkeypatch)
    _seed_push_subscription(db_session)

    with caplog.at_level(logging.WARNING, logger="blog.subscriptions"):
        resp = _unsubscribe(client, endpoint=_PUSH_ENDPOINT)

    assert resp.status_code == 200
    assert _is_active(db_session) is False
    messages = [record.getMessage() for record in caplog.records]
    warned = [item for item in messages if "web_push_unsubscribe_without_proof" in item]
    assert warned, messages
    # endpoint 本身是能力凭据，日志里只能出现摘要
    assert _PUSH_ENDPOINT not in warned[0]
    assert "enforced=False" in warned[0]


def test_web_push_unsubscribe_can_be_tightened_to_require_auth(client, db_session, monkeypatch):
    """收紧后的形态：没有持有证明就什么都不做，响应仍然一模一样。"""
    _web_push_env(monkeypatch)
    monkeypatch.setenv("WEB_PUSH_UNSUBSCRIBE_REQUIRE_AUTH", "1")
    _seed_push_subscription(db_session)

    rejected = _unsubscribe(client, endpoint=_PUSH_ENDPOINT)
    assert rejected.status_code == 200
    assert _is_active(db_session) is True

    accepted = _unsubscribe(client, endpoint=_PUSH_ENDPOINT, auth=_PUSH_AUTH)
    assert accepted.status_code == 200
    assert _is_active(db_session) is False
    assert rejected.json() == accepted.json()


# --------------------------------------------------------------------------- #
# 确认链接的重放
# --------------------------------------------------------------------------- #


def test_an_old_subscribe_link_cannot_resurrect_a_cancelled_subscription(
    client, db_session, monkeypatch
):
    """TTL 内的旧订阅链接不能把用户手动关掉的订阅重新打开。"""
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)

    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "reader@example.com", "content_types": ["daily_brief"]},
    )
    subscribe_token = confirmations[-1]["token"]

    # 用户随后退订（直接改库，等价于走完退订确认流程）
    subscription = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()
    subscription.is_active = False
    subscription.updated_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db_session.commit()

    replay = client.post("/api/subscriptions/email/confirm", json={"token": subscribe_token})

    assert replay.status_code == 409
    db_session.refresh(subscription)
    assert subscription.is_active is False


def test_an_old_unsubscribe_link_cannot_cancel_a_renewed_subscription(client, db_session, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)

    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "reader@example.com", "content_types": ["daily_brief"]},
    )
    assert (
        client.post(
            "/api/subscriptions/email/unsubscribe", json={"email": "reader@example.com"}
        ).status_code
        == 200
    )
    unsubscribe_token = confirmations[-1]["token"]

    subscription = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()
    subscription.updated_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db_session.commit()

    replay = client.post("/api/subscriptions/email/confirm", json={"token": unsubscribe_token})

    assert replay.status_code == 409
    db_session.refresh(subscription)
    assert subscription.is_active is True


def test_clicking_the_same_confirmation_link_twice_stays_idempotent(client, db_session, monkeypatch):
    """重放拦截的判据是"会不会改变状态"，所以邮件客户端预取 / 用户点两下不该报错。"""
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "noreply@example.com")
    confirmations = _capture_confirmations(monkeypatch)

    _subscribe_and_confirm(
        client,
        confirmations,
        {"email": "reader@example.com", "content_types": ["daily_brief"]},
    )
    token = confirmations[-1]["token"]

    subscription = db_session.query(EmailSubscription).filter_by(email="reader@example.com").one()
    subscription.updated_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db_session.commit()

    again = client.post("/api/subscriptions/email/confirm", json={"token": token})

    assert again.status_code == 200
    assert again.json()["is_active"] is True

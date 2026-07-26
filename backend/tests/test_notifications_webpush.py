"""Web Push delivery-side guards.

Two behaviors are covered:

1. The outbound SSRF gate. ``POST /api/subscriptions/web-push`` is unauthenticated
   and ``pywebpush`` ultimately calls ``requests.post(endpoint, ...)`` with
   redirects on and no address filtering, so a stored endpoint is a request the
   server makes on the admin's behalf at publish time. Input validation only
   protects rows written after it shipped; the send path is what stops rows that
   are already in the table.
2. Deactivation must key off the real HTTP status, not a substring match on the
   error text (which embeds the upstream response body).

No test performs real network or DNS I/O: the sender is injected and DNS is
stubbed where an allowlisted host would otherwise be resolved.
"""

import json
from datetime import datetime, timezone

import pytest

from app import notifications, url_safety
from app.models import Post, WebPushSubscription
from app.notifications import (
    WebPushEndpointRejected,
    is_allowed_web_push_endpoint_host,
    validate_outbound_web_push_endpoint,
    web_push_error_status,
    web_push_subscription_is_gone,
)


class _FakeResponse:
    """Minimal stand-in for the ``requests.Response`` pywebpush attaches."""

    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text
        self.reason = "fake"


class _FakeWebPushException(Exception):
    """Same shape as ``pywebpush.WebPushException``: message + ``.response``."""

    def __init__(self, message, response=None):
        super().__init__(message)
        self.message = message
        self.response = response


@pytest.fixture
def public_dns(monkeypatch):
    """Resolve any host to a fixed public address so tests never touch DNS."""
    monkeypatch.setattr(
        url_safety,
        "resolve_public_host_addresses",
        lambda hostname, port=None: ("142.250.72.0",),
    )


@pytest.fixture
def web_push_env(monkeypatch):
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "test-public-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "test-private-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:ops@example.test")


# --------------------------------------------------------------------------- #
# Endpoint allowlist / SSRF gate
# --------------------------------------------------------------------------- #

FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"
MOZILLA_ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/abc123"
WINDOWS_ENDPOINT = "https://wns2-by3p.notify.windows.com/w/?token=abc123"
APPLE_ENDPOINT = "https://web.push.apple.com/QAbc123"


@pytest.mark.parametrize(
    "endpoint",
    [FCM_ENDPOINT, MOZILLA_ENDPOINT, WINDOWS_ENDPOINT, APPLE_ENDPOINT],
)
def test_known_push_service_endpoints_pass(endpoint, public_dns):
    validate_outbound_web_push_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        # Cloud metadata: the classic SSRF payload the review flagged.
        "https://169.254.169.254/latest/meta-data/",
        "https://10.0.0.5:6379/",
        "https://192.168.1.10/admin",
        "https://127.0.0.1/push",
        "https://[::1]/push",
        "https://localhost/push",
        "https://redis.internal/push",
    ],
)
def test_private_endpoints_are_rejected(endpoint):
    # No DNS stub on purpose: these must be rejected without the server ever
    # resolving an attacker-supplied name.
    with pytest.raises(WebPushEndpointRejected) as excinfo:
        validate_outbound_web_push_endpoint(endpoint)
    assert excinfo.value.permanent is True


def test_public_but_non_allowlisted_host_is_rejected():
    with pytest.raises(WebPushEndpointRejected) as excinfo:
        validate_outbound_web_push_endpoint("https://attacker.example.com/push")
    assert excinfo.value.permanent is True
    assert "not an allowed push service" in excinfo.value.reason


def test_lookalike_hosts_do_not_satisfy_the_suffix_rules():
    for endpoint in (
        "https://fcm.googleapis.com.evil.example/push",
        "https://evil-push.services.mozilla.com.attacker.test/push",
        "https://notfcm.googleapis.com/push",
    ):
        with pytest.raises(WebPushEndpointRejected):
            validate_outbound_web_push_endpoint(endpoint)


def test_non_https_and_credentialed_endpoints_are_rejected():
    for endpoint in (
        "http://fcm.googleapis.com/fcm/send/abc",
        "ftp://fcm.googleapis.com/abc",
        "https://user:pass@fcm.googleapis.com/fcm/send/abc",
        "",
    ):
        with pytest.raises(WebPushEndpointRejected):
            validate_outbound_web_push_endpoint(endpoint)


def test_trailing_dot_host_is_normalized_not_bypassed(public_dns):
    # "fcm.googleapis.com." resolves identically, so it must be treated the same
    # way — and a blocked name with a trailing dot must stay blocked.
    validate_outbound_web_push_endpoint("https://fcm.googleapis.com./fcm/send/abc")
    with pytest.raises(WebPushEndpointRejected):
        validate_outbound_web_push_endpoint("https://metadata.google.internal./compute")


def test_allowlist_can_be_extended_by_operators(monkeypatch, public_dns):
    with pytest.raises(WebPushEndpointRejected):
        validate_outbound_web_push_endpoint("https://push.example.test/send/abc")

    monkeypatch.setenv("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", "push.example.test")
    validate_outbound_web_push_endpoint("https://push.example.test/send/abc")


def test_operator_allowlist_cannot_open_a_private_target(monkeypatch):
    monkeypatch.setenv("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", "169.254.169.254,localhost")
    for endpoint in ("https://169.254.169.254/latest/meta-data/", "https://localhost/push"):
        with pytest.raises(WebPushEndpointRejected):
            validate_outbound_web_push_endpoint(endpoint)


def test_unresolvable_allowlisted_host_is_retryable_not_permanent(monkeypatch):
    # A DNS blip must not permanently drop every real subscriber.
    monkeypatch.setattr(
        url_safety, "resolve_public_host_addresses", lambda hostname, port=None: ()
    )
    with pytest.raises(WebPushEndpointRejected) as excinfo:
        validate_outbound_web_push_endpoint(FCM_ENDPOINT)
    assert excinfo.value.permanent is False


# (hostname, allowed) — the one table both layers are checked against below.
HOST_ALLOWLIST_VECTORS = (
    ("fcm.googleapis.com", True),
    ("FCM.GoogleAPIs.COM", True),
    ("fcm.googleapis.com.", True),  # FQDN trailing dot resolves identically
    ("updates.push.services.mozilla.com", True),
    ("autopush.push.services.mozilla.com", True),
    # A dotted rule means "strictly below this name". The bare apex is not a push
    # service and both layers must now agree on rejecting it — the subscribe-time
    # check always did, and convergence is not allowed to loosen that side.
    ("push.services.mozilla.com", False),
    ("wns2-by3p.notify.windows.com", True),
    ("notify.windows.com", False),
    ("web.push.apple.com", True),
    ("push.apple.com", False),
    ("fcm.googleapis.com.evil.example", False),
    ("notfcm.googleapis.com", False),
    ("evil-push.services.mozilla.com.attacker.test", False),
    ("example.com", False),
    ("", False),
)


def test_is_allowed_web_push_endpoint_host_rules():
    for hostname, allowed in HOST_ALLOWLIST_VECTORS:
        assert is_allowed_web_push_endpoint_host(hostname) is allowed, hostname


def test_subscribe_and_delivery_layers_share_one_host_allowlist(monkeypatch):
    """同一张向量表跑订阅端和投递端，两侧判断必须逐条一致。

    以前这是两份手写实现：订阅端的 `.push.services.mozilla.com` 不匹配裸 apex、投递端
    匹配；订阅端把 env 追加项按 `.strip().lower()` 归一、投递端走
    `url_safety.normalize_hostname()`（多剥尾点）。方向上是订阅端更严，属 fail-closed，
    但同一个 WEB_PUSH_ALLOWED_ENDPOINT_HOSTS 在两层里含义不同，是纯粹的配置困惑源。
    现在只有 `notifications.is_allowed_web_push_endpoint_host` 一份实现。
    """
    # 生产模式下订阅端对未知 host 才会拒绝（开发环境只 warn）
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", raising=False)

    from fastapi import HTTPException

    from app.routers import subscriptions as subscriptions_mod

    for hostname, allowed in HOST_ALLOWLIST_VECTORS:
        if not hostname:
            continue
        endpoint = f"https://{hostname}/push/abc"
        if allowed:
            assert subscriptions_mod.validate_web_push_endpoint(endpoint) == endpoint
        else:
            with pytest.raises(HTTPException) as excinfo:
                subscriptions_mod.validate_web_push_endpoint(endpoint)
            assert excinfo.value.status_code == 400


def test_env_added_hosts_are_normalized_the_same_way_on_both_layers(monkeypatch):
    """尾点/大小写差异不能让一条 env 规则只在其中一层生效。"""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", "Push.SelfHosted.Example.")

    from app.routers import subscriptions as subscriptions_mod

    endpoint = "https://push.selfhosted.example/wpush/abc"
    assert is_allowed_web_push_endpoint_host("push.selfhosted.example") is True
    assert subscriptions_mod.validate_web_push_endpoint(endpoint) == endpoint


def test_send_never_reaches_the_sender_for_a_private_endpoint(web_push_env):
    calls = []
    subscription = WebPushSubscription(
        endpoint="https://169.254.169.254/latest/meta-data/",
        p256dh="p",
        auth="a",
    )
    post = Post(id=1, title="t", slug="s", summary="s", content_md="c")

    with pytest.raises(WebPushEndpointRejected):
        notifications._send_web_push_notification(
            subscription,
            post,
            "https://example.test",
            sender=lambda **kwargs: calls.append(kwargs),
        )

    assert calls == []


def test_send_passes_subscription_info_through_for_a_valid_endpoint(web_push_env, public_dns):
    calls = []
    subscription = WebPushSubscription(endpoint=FCM_ENDPOINT, p256dh="p256", auth="auth")
    post = Post(id=7, title="标题", slug="slug", summary="s", content_md="c")

    notifications._send_web_push_notification(
        subscription,
        post,
        "https://example.test",
        sender=lambda **kwargs: calls.append(kwargs),
    )

    assert len(calls) == 1
    assert calls[0]["subscription_info"]["endpoint"] == FCM_ENDPOINT
    assert calls[0]["subscription_info"]["keys"] == {"p256dh": "p256", "auth": "auth"}
    assert json.loads(calls[0]["data"])["url"] == "https://example.test/posts/slug"


# --------------------------------------------------------------------------- #
# Deactivation must follow the real status code
# --------------------------------------------------------------------------- #


def test_web_push_error_status_reads_the_response():
    exc = _FakeWebPushException("Push failed", response=_FakeResponse(410))
    assert web_push_error_status(exc) == 410
    assert web_push_error_status(Exception("boom")) is None


def test_web_push_error_status_supports_aiohttp_shaped_responses():
    class _AiohttpResponse:
        status = 404

    exc = _FakeWebPushException("Push failed", response=_AiohttpResponse())
    assert web_push_error_status(exc) == 404


@pytest.mark.parametrize("status", [404, 410])
def test_gone_statuses_mark_the_subscription_dead(status):
    exc = _FakeWebPushException("Push failed", response=_FakeResponse(status))
    assert web_push_subscription_is_gone(exc) is True


@pytest.mark.parametrize("status", [400, 401, 429, 500, 502, 503])
def test_other_statuses_keep_the_subscription(status):
    exc = _FakeWebPushException("Push failed", response=_FakeResponse(status))
    assert web_push_subscription_is_gone(exc) is False


def test_digits_in_the_response_body_do_not_deactivate_a_live_subscriber():
    # The regression this fix exists for: pywebpush embeds the upstream body in
    # the message, so a request id or timestamp containing "410"/"404" used to
    # silently unsubscribe a working browser.
    exc = _FakeWebPushException(
        "Push failed: 503 Service Unavailable\nResponse body:{'request_id': 'r-410-404'}",
        response=_FakeResponse(503, text="{'request_id': 'r-410-404'}"),
    )
    assert web_push_subscription_is_gone(exc) is False


def test_falls_back_to_string_match_without_a_response():
    assert web_push_subscription_is_gone(Exception("410 Gone")) is True
    assert web_push_subscription_is_gone(Exception("connection reset")) is False


def test_error_summary_does_not_persist_the_upstream_body():
    exc = _FakeWebPushException(
        "Push failed: 500 err\nResponse body:SECRET-INTERNAL-CONTENT",
        response=_FakeResponse(500, text="SECRET-INTERNAL-CONTENT"),
    )
    summary = notifications._summarize_web_push_error(exc)
    assert "SECRET-INTERNAL-CONTENT" not in summary
    assert "http 500" in summary


# --------------------------------------------------------------------------- #
# End-to-end through the dispatcher
# --------------------------------------------------------------------------- #


def _make_post(db_session):
    post = Post(
        title="AI 日报",
        slug="ai-daily",
        summary="summary",
        content_md="body",
        content_type="daily_brief",
        is_published=True,
    )
    db_session.add(post)
    db_session.commit()
    return post


def _make_subscription(db_session, endpoint):
    subscription = WebPushSubscription(
        endpoint=endpoint,
        p256dh="p256",
        auth="auth",
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(subscription)
    db_session.commit()
    return subscription


def _dispatch(db_session, post, monkeypatch, sender):
    """Run the dispatcher with the real endpoint gate but a fake transport."""
    monkeypatch.setattr(notifications, "_default_web_push_sender", sender)
    notifications._dispatch_post_notifications(db_session, post.id)


def test_dispatch_deactivates_a_stored_private_endpoint_without_sending(
    db_session, monkeypatch, web_push_env
):
    # The exact scenario the review describes: a row that predates (or bypasses)
    # input validation must still never produce an internal request.
    post = _make_post(db_session)
    subscription = _make_subscription(db_session, "https://169.254.169.254/latest/meta-data/")
    calls = []

    _dispatch(db_session, post, monkeypatch, lambda **kwargs: calls.append(kwargs))

    db_session.refresh(subscription)
    assert calls == []
    assert subscription.is_active is False


def test_dispatch_sends_to_an_allowlisted_endpoint(
    db_session, monkeypatch, web_push_env, public_dns
):
    post = _make_post(db_session)
    subscription = _make_subscription(db_session, FCM_ENDPOINT)
    calls = []

    _dispatch(db_session, post, monkeypatch, lambda **kwargs: calls.append(kwargs))

    db_session.refresh(subscription)
    assert len(calls) == 1
    assert subscription.is_active is True
    assert subscription.last_notified_at is not None


@pytest.mark.parametrize("status", [404, 410])
def test_dispatch_deactivates_on_gone_status(
    db_session, monkeypatch, web_push_env, public_dns, status
):
    post = _make_post(db_session)
    subscription = _make_subscription(db_session, FCM_ENDPOINT)

    def _sender(**kwargs):
        raise _FakeWebPushException("Push failed", response=_FakeResponse(status))

    _dispatch(db_session, post, monkeypatch, _sender)

    db_session.refresh(subscription)
    assert subscription.is_active is False


def test_dispatch_keeps_subscription_on_transient_status(
    db_session, monkeypatch, web_push_env, public_dns
):
    post = _make_post(db_session)
    subscription = _make_subscription(db_session, FCM_ENDPOINT)

    def _sender(**kwargs):
        raise _FakeWebPushException(
            "Push failed: 503\nResponse body:{'id': '410-404'}",
            response=_FakeResponse(503, text="{'id': '410-404'}"),
        )

    _dispatch(db_session, post, monkeypatch, _sender)

    db_session.refresh(subscription)
    assert subscription.is_active is True

    dispatch = post.notification_dispatch
    db_session.refresh(dispatch)
    # Still retryable, and the upstream body is not persisted.
    assert dispatch.web_push_sent_at is None
    state = json.loads(dispatch.last_error)
    assert state["web_push_pending_ids"] == [subscription.id]
    assert "410-404" not in dispatch.last_error

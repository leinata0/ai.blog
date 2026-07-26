"""The unauthenticated web-push endpoint is a stored-SSRF sink.

Whatever lands in `web_push_subscriptions.endpoint` is POSTed by pywebpush the
next time a post is published, so an attacker who can store
`http://169.254.169.254/...` gets the backend to call cloud metadata for them.
"""

import pytest


def _subscriptions_module():
    # Imported lazily: `app.routers.subscriptions` pulls in `app.rate_limit`,
    # which decides at import time whether limits are active. Importing it during
    # collection (before PYTEST_CURRENT_TEST exists) would enable rate limiting
    # for the whole session and 429 unrelated suites.
    from app.routers import subscriptions as subscriptions_mod

    return subscriptions_mod


def _payload(endpoint: str) -> dict:
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": "abc", "auth": "def"},
        "content_types": ["daily_brief"],
    }


@pytest.fixture(autouse=True)
def _web_push_configured(monkeypatch):
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "public-test-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-test-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:owner@example.com")
    monkeypatch.delenv("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", raising=False)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://169.254.169.254/latest/meta-data/",
        "http://10.1.2.3:6379/",
        "https://127.0.0.1/push",
        "https://localhost/push",
        "https://[::1]/push",
        "https://redis.internal/push",
        "http://fcm.googleapis.com/fcm/send/abc",  # plaintext transport
        "ftp://fcm.googleapis.com/abc",
        "https://user:pass@fcm.googleapis.com/abc",
        "javascript:alert(1)",
        "",
    ],
)
def test_private_and_non_https_endpoints_are_rejected(endpoint):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        _subscriptions_module().validate_web_push_endpoint(endpoint)

    assert exc_info.value.status_code == 400


def test_metadata_endpoint_is_never_stored(client, db_session):
    """End-to-end: the unauthenticated route must not persist an SSRF target."""
    from app.models import WebPushSubscription

    response = client.post(
        "/api/subscriptions/web-push",
        json=_payload("http://169.254.169.254/latest/meta-data/"),
    )

    assert response.status_code == 400
    assert db_session.query(WebPushSubscription).count() == 0


def test_known_push_service_endpoint_is_accepted(client, db_session):
    from app.models import WebPushSubscription

    response = client.post(
        "/api/subscriptions/web-push",
        json=_payload("https://fcm.googleapis.com/fcm/send/abc123"),
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert db_session.query(WebPushSubscription).count() == 1


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://ABC.notify.windows.com/w/?token=abc",
        "https://web.push.apple.com/abc",
    ],
)
def test_real_push_service_hosts_pass_the_allowlist(endpoint):
    assert _subscriptions_module().validate_web_push_endpoint(endpoint) == endpoint.strip()


def test_unknown_host_is_rejected_in_production(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(HTTPException) as exc_info:
        _subscriptions_module().validate_web_push_endpoint("https://attacker.example.com/push")

    assert exc_info.value.status_code == 400


def test_extra_hosts_can_be_allowlisted_by_env(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("WEB_PUSH_ALLOWED_ENDPOINT_HOSTS", "push.selfhosted.example")

    endpoint = "https://push.selfhosted.example/wpush/abc"
    assert _subscriptions_module().validate_web_push_endpoint(endpoint) == endpoint

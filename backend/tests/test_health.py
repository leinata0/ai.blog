import threading

from jose import jwt

from app.auth import ALGORITHM, SECRET_KEY, TOKEN_AUDIENCE, TOKEN_ISSUER


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_api_health_endpoint_alias(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_livez_is_a_process_only_probe(client, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(
        main_mod,
        "check_runtime_readiness",
        lambda: (_ for _ in ()).throw(RuntimeError("dependency unavailable")),
    )

    resp = client.get("/livez")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_readyz_checks_runtime_dependencies(client):
    resp = client.get("/readyz")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    # The startup self-checks ride along as a cached snapshot; they must never
    # change the status Render reads.
    assert set(body["checks"]) >= {"environment", "database_timezone", "api_key_encryption"}


def test_readyz_rejects_missing_critical_schema(client):
    import app.db as db_mod
    from app.models import User

    User.__table__.drop(bind=db_mod.engine)

    resp = client.get("/readyz")

    assert resp.status_code == 503
    assert resp.json() == {"status": "not_ready"}


def test_readyz_returns_503_when_dependency_check_fails(client, monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(
        main_mod,
        "check_runtime_readiness",
        lambda: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )

    resp = client.get("/readyz")

    assert resp.status_code == 503
    assert resp.json() == {"status": "not_ready"}


def test_readyz_returns_503_on_timeout(client, monkeypatch):
    import app.main as main_mod

    entered = threading.Event()
    release = threading.Event()

    def _blocking_check():
        entered.set()
        # Block for far longer than the readiness budget so the timeout is
        # decided by the budget, not by scheduler jitter on a loaded CI runner.
        # `release` keeps it interruptible: readyz abandons the worker thread on
        # cancel, so an uninterruptible sleep would outlive the test.
        release.wait(30)

    monkeypatch.setattr(main_mod, "READINESS_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(main_mod, "check_runtime_readiness", _blocking_check)

    try:
        resp = client.get("/readyz")
    finally:
        release.set()

    assert resp.status_code == 503
    assert resp.json() == {"status": "not_ready"}
    # Guard against passing for the wrong reason (e.g. the check never ran).
    assert entered.wait(5)


def test_unknown_route_keeps_framework_404_shape(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Not Found"}


def test_http_exception_handler_returns_code_and_request_id(client):
    resp = client.get("/api/posts/not-a-real-slug")
    assert resp.status_code == 404
    assert resp.json()["code"] == "http_404"
    assert resp.json()["detail"]
    assert resp.json()["request_id"]
    assert resp.headers["X-Request-ID"] == resp.json()["request_id"]


def test_invalid_admin_token_returns_json_error(client):
    resp = client.get(
        "/api/admin/posts",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid token"
    assert resp.json()["code"] == "http_401"
    assert resp.json()["request_id"]


def test_admin_token_requires_expected_issuer_and_audience(client):
    token = jwt.encode(
        {
            "sub": "admin",
            "iss": f"{TOKEN_ISSUER}-wrong",
            "aud": f"{TOKEN_AUDIENCE}-wrong",
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    resp = client.get(
        "/api/admin/posts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid token"
    assert resp.json()["code"] == "http_401"
    assert resp.json()["request_id"]


def test_request_id_header_is_echoed_back(client):
    resp = client.get("/api/health", headers={"X-Request-ID": "manual-request-id"})
    assert resp.status_code == 200
    assert resp.headers["X-Request-ID"] == "manual-request-id"

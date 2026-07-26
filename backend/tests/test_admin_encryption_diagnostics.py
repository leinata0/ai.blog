"""The admin surface for the API-key-at-rest check, and the /readyz promise.

Two things are guarded here.

1. `GET /api/admin/diagnostics/encryption` and
   `POST /api/admin/diagnostics/encryption/reencrypt`. The counts are already
   logged once at startup and echoed as a bare number by /readyz; this is the
   surface that names *which* provider sources still hold a plaintext key, which
   is exactly why it is admin-only, and exactly why the response must never
   carry the key it is reporting on.

2. That /readyz stays `200 ready` while all three startup checks are warning —
   built from the **real** check functions rather than a hand-written snapshot.
   `test_startup_diagnostics.py` covers the same promise by injecting a literal
   dict into `bootstrap._startup_diagnostics`; that proves the projection is
   safe for the shape it was handed, but not that the shape the production code
   actually produces still projects safely. A key rename inside
   `describe_session_timezone()` or `api_key_encryption_report()` would slip
   past an injected fixture and only show up on Render. So this file drives the
   genuine article: a real plaintext row in the database, a real non-UTC
   Postgres session, and real degradable variables left unset.

No network and no real Postgres: the timezone probe runs against the same fake
engine `test_startup_diagnostics.py` uses, and provider rows live in the
in-memory test database.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

import app.db as db_mod
from app import bootstrap
from app.encryption import decrypt_value
from app.env import reset_startup_environment_report
from app.models import AiProviderSource
from app.services import ai_provider_manager


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _FakeConnection:
    def __init__(self, session_timezone, stored_now):
        self._session_timezone = session_timezone
        self._stored_now = stored_now

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, statement):
        if str(statement).strip().lower().startswith("show"):
            return _FakeResult(self._session_timezone)
        return _FakeResult(self._stored_now)


class _FakeDialect:
    def __init__(self, name):
        self.name = name


class _FakePostgresEngine:
    """A Postgres session pinned to a non-UTC TimeZone.

    Self-contained rather than imported from `test_startup_diagnostics.py`: this
    file exists to catch drift in what the production code produces, so it must
    not share a fixture with the suite it is cross-checking.
    """

    def __init__(self, *, session_timezone="Asia/Shanghai", offset_hours=8):
        self.dialect = _FakeDialect("postgresql")
        self._session_timezone = session_timezone
        self._offset_hours = offset_hours

    def connect(self):
        # `now()::timestamp` is the naive local-time value a DateTime column
        # receives, so shift Python's UTC clock exactly the way Postgres would.
        stored_now = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
            hours=self._offset_hours
        )
        return _FakeConnection(self._session_timezone, stored_now)


REPORT_ENDPOINT = "/api/admin/diagnostics/encryption"
REENCRYPT_ENDPOINT = "/api/admin/diagnostics/encryption/reencrypt"

# A value that is unmistakable in a serialized payload. Every leak assertion
# below searches for substrings of this, not for the whole string, so a response
# that exposed "a prefix for debugging" would still be caught.
#
# Deliberately shares no substring with the report's own vocabulary — a sentinel
# containing "plaintext" collides with the legitimate `legacy_plaintext` field
# name and makes the scan fail on a payload that leaked nothing.
PLAINTEXT_KEY = "sk-NEVERLEAKME-9f2c1a7b4e33d0"


def _auth_headers(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _add_plaintext_source(db, *, name="prod-openai-source", key=PLAINTEXT_KEY):
    source = AiProviderSource(
        name=name,
        provider="openai",
        base_url="https://gateway.example.com",
        api_key_value=key,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def _assert_no_key_material(payload):
    """No substring of the key may survive into the payload.

    Checking only for the whole key would pass a response that helpfully
    included `api_key_preview: "sk-NEVERL…"`, so this slides an 8-character
    window over the secret and rejects any fragment of it.
    """
    serialized = json.dumps(payload)
    window = 8
    for start in range(len(PLAINTEXT_KEY) - window + 1):
        fragment = PLAINTEXT_KEY[start : start + window]
        assert fragment not in serialized, f"payload leaked key fragment {fragment!r}"


# --------------------------------------------------------------------------- #
# Authorization
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "method, endpoint",
    [("get", REPORT_ENDPOINT), ("post", REENCRYPT_ENDPOINT)],
)
def test_endpoints_require_authentication(client, method, endpoint):
    # Naming which integrations exist and which of them hold a weak credential
    # is reconnaissance; the write endpoint additionally rewrites a credentials
    # column.
    assert getattr(client, method)(endpoint).status_code in (401, 403)


@pytest.mark.parametrize(
    "method, endpoint",
    [("get", REPORT_ENDPOINT), ("post", REENCRYPT_ENDPOINT)],
)
def test_endpoints_reject_a_bogus_token(client, method, endpoint):
    headers = {"Authorization": "Bearer not-a-real-token"}
    assert getattr(client, method)(endpoint, headers=headers).status_code in (401, 403)


# --------------------------------------------------------------------------- #
# The report
# --------------------------------------------------------------------------- #


def test_report_names_the_plaintext_sources_without_carrying_the_key(client, db_session):
    _add_plaintext_source(db_session)

    body = client.get(REPORT_ENDPOINT, headers=_auth_headers(client)).json()
    report = body["api_key_encryption"]

    # The operator has to learn *which* source to act on — that is the whole
    # point of an authenticated surface over the /readyz counter.
    assert report["status"] == "action_required"
    assert report["legacy_plaintext"] == 1
    assert [s["name"] for s in report["legacy_plaintext_sources"]] == ["prod-openai-source"]
    _assert_no_key_material(body)


def test_report_is_clean_when_every_key_is_encrypted(client, db_session):
    _add_plaintext_source(db_session)
    ai_provider_manager.reencrypt_legacy_plaintext_api_keys(db_session)

    report = client.get(REPORT_ENDPOINT, headers=_auth_headers(client)).json()["api_key_encryption"]

    assert report["status"] == "ok"
    assert report["legacy_plaintext"] == 0
    assert report["encrypted"] == 1


def test_report_reads_live_rather_than_replaying_the_boot_snapshot(client, db_session):
    """A key re-saved in the console must clear here without a redeploy.

    The `startup` half is deliberately the cached boot snapshot; the
    `api_key_encryption` half must not be, otherwise the endpoint would keep
    telling the operator to fix something they already fixed.
    """
    source = _add_plaintext_source(db_session)
    headers = _auth_headers(client)
    assert client.get(REPORT_ENDPOINT, headers=headers).json()["api_key_encryption"][
        "legacy_plaintext"
    ] == 1

    ai_provider_manager.reencrypt_legacy_plaintext_api_keys(db_session)
    db_session.refresh(source)

    assert client.get(REPORT_ENDPOINT, headers=headers).json()["api_key_encryption"][
        "legacy_plaintext"
    ] == 0


# --------------------------------------------------------------------------- #
# The re-encrypt action
# --------------------------------------------------------------------------- #


def test_reencrypt_defaults_to_a_dry_run(client, db_session):
    """The destructive-looking direction has to be asked for explicitly.

    A wrong FIELD_ENCRYPTION_KEY turns this call into unreadable credentials, so
    an operator poking the endpoint to see what it does must not write.
    """
    source = _add_plaintext_source(db_session)

    body = client.post(REENCRYPT_ENDPOINT, headers=_auth_headers(client)).json()

    assert body["dry_run"] is True
    assert body["migrated"] == 1
    db_session.refresh(source)
    assert source.api_key_value == PLAINTEXT_KEY, "dry run must not write"
    _assert_no_key_material(body)


def test_reencrypt_applies_and_is_idempotent(client, db_session):
    source = _add_plaintext_source(db_session)
    headers = _auth_headers(client)

    first = client.post(f"{REENCRYPT_ENDPOINT}?dry_run=false", headers=headers).json()

    assert first["dry_run"] is False
    assert first["migrated"] == 1
    db_session.refresh(source)
    assert source.api_key_value != PLAINTEXT_KEY
    # Encrypted, not merely mangled: the credential still has to work afterwards.
    assert decrypt_value(source.api_key_value) == PLAINTEXT_KEY
    _assert_no_key_material(first)

    second = client.post(f"{REENCRYPT_ENDPOINT}?dry_run=false", headers=headers).json()

    assert second["migrated"] == 0, "a second run must be a no-op"
    db_session.refresh(source)
    assert decrypt_value(source.api_key_value) == PLAINTEXT_KEY


# --------------------------------------------------------------------------- #
# /readyz under the real thing
# --------------------------------------------------------------------------- #


@pytest.fixture
def all_three_warnings(client, db_session, monkeypatch):
    """Drive the three checks into their warning states for real, then boot.

    Nothing here is a hand-written snapshot: the timezone verdict comes out of
    `describe_session_timezone()` against a Postgres session pinned to
    Asia/Shanghai, the key verdict out of `api_key_encryption_report_safe()`
    reading an actual plaintext row, and the environment verdict out of
    `startup_environment_report()` with the degradable variables genuinely unset.
    """
    _add_plaintext_source(db_session)

    # The real probe, run against a real-shaped Postgres session on Asia/Shanghai.
    # `probe` is captured before the patch so the patched name cannot recurse.
    probe = db_mod.describe_session_timezone
    shanghai = _FakePostgresEngine()
    monkeypatch.setattr(db_mod, "describe_session_timezone", lambda *a, **k: probe(shanghai))

    # Degradable features: left genuinely unset so the env report has to notice.
    for name in (
        "TURNSTILE_SECRET_KEY",
        "VERCEL_DEPLOY_HOOK_URL",
        "RESEND_API_KEY",
        "EMAIL_FROM",
    ):
        monkeypatch.delenv(name, raising=False)
    reset_startup_environment_report()

    bootstrap.reset_startup_diagnostics()
    snapshot = bootstrap.run_startup_diagnostics()
    yield snapshot
    bootstrap.reset_startup_diagnostics()
    reset_startup_environment_report()


def test_all_three_checks_really_are_warning(all_three_warnings):
    """Guards the fixture itself.

    If any of the three quietly stopped reaching its warning state, the /readyz
    assertions below would still pass — on a healthy app — and prove nothing.
    """
    snapshot = all_three_warnings

    assert snapshot["database_timezone"]["status"] == "misconfigured"
    assert snapshot["database_timezone"]["session_timezone"] == "Asia/Shanghai"
    assert snapshot["api_key_encryption"]["status"] == "action_required"
    assert snapshot["environment"]["degraded_features"], "no feature degraded"
    assert snapshot["needs_attention"] is True
    assert snapshot["status"] == "attention"


def test_readyz_stays_ready_with_all_three_real_warnings(client, all_three_warnings):
    """Render restarts a service whose healthCheckPath fails.

    A shifted session timezone, a plaintext key and a switched-off feature are
    all warnings about an app that is *serving fine*. Returning 503 for any of
    them would turn an advisory into a restart loop.
    """
    resp = client.get("/readyz")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["needs_attention"] is True


@pytest.mark.parametrize(
    "check, field, expected",
    [
        ("database_timezone", "status", "misconfigured"),
        ("api_key_encryption", "status", "action_required"),
        ("environment", "status", "degraded"),
    ],
)
def test_readyz_reports_each_real_warning_individually(client, all_three_warnings, check, field, expected):
    checks = client.get("/readyz").json()["checks"]

    assert checks[check][field] == expected


def test_readyz_withholds_identifying_detail_from_the_real_snapshot(client, all_three_warnings):
    """The public projection has to be safe for what the code actually produces.

    /readyz is unauthenticated. Naming the degraded features tells a
    registration-abuse bot that human verification is off, and naming a provider
    source tells an attacker which integration holds the weak credential.
    """
    serialized = json.dumps(client.get("/readyz").json())

    for secret in ("turnstile", "TURNSTILE_SECRET_KEY", "prod-openai-source", "RESEND_API_KEY"):
        assert secret not in serialized, f"/readyz leaked {secret}"
    _assert_no_key_material(json.loads(serialized))
    # The counts still get through, so an operator outside the box learns that
    # something is waiting for them.
    assert json.loads(serialized)["checks"]["environment"]["degraded_features"] >= 1


def test_readyz_costs_no_extra_query_per_poll(client, all_three_warnings, monkeypatch):
    """Render polls this endpoint continuously for the life of the process.

    The diagnostics are a cached boot snapshot; if any of them were recomputed
    per request, the health check would run a provider-table scan and two
    Postgres round trips on every poll.
    """
    calls = {"timezone": 0, "keys": 0}
    monkeypatch.setattr(
        db_mod,
        "describe_session_timezone",
        lambda *a, **k: calls.__setitem__("timezone", calls["timezone"] + 1),
    )
    monkeypatch.setattr(
        ai_provider_manager,
        "api_key_encryption_report_safe",
        lambda *a, **k: calls.__setitem__("keys", calls["keys"] + 1),
    )

    for _ in range(5):
        assert client.get("/readyz").status_code == 200

    assert calls == {"timezone": 0, "keys": 0}

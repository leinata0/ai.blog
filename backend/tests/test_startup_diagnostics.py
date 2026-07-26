"""Startup self-checks that answer questions only the deployment can answer.

Three of them: whether the production database session runs on UTC (naive
`func.now()` defaults are stored through it), how many AI provider rows still
hold a plaintext API key, and whether every required environment variable is
set. All three must be observable without anyone opening a production shell, and
none of them may take the app — or Render's health check — down.

No network, no real database: the Postgres probe runs against a fake engine and
the provider rows live in the in-memory test database.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet

import app.db as db_mod
from app import bootstrap
from app.encryption import decrypt_value, encrypt_value
from app.env import (
    reset_startup_environment_report,
    startup_environment_report,
    verify_startup_environment,
)
from app.models import AiProviderSource
from app.services import ai_provider_manager


# --------------------------------------------------------------------------- #
# Fake Postgres engine
# --------------------------------------------------------------------------- #


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _FakeConnection:
    def __init__(self, *, session_timezone, stored_now, fail):
        self._session_timezone = session_timezone
        self._stored_now = stored_now
        self._fail = fail
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, statement):
        if self._fail:
            raise RuntimeError("server closed the connection unexpectedly")
        sql = str(statement)
        self.statements.append(sql)
        if sql.strip().lower().startswith("show"):
            return _FakeResult(self._session_timezone)
        return _FakeResult(self._stored_now)


class _FakeDialect:
    def __init__(self, name):
        self.name = name


class _FakeEngine:
    def __init__(self, *, dialect="postgresql", session_timezone="UTC", offset_hours=0, fail=False):
        self.dialect = _FakeDialect(dialect)
        self._session_timezone = session_timezone
        self._offset_hours = offset_hours
        self._fail = fail
        self.connections = []

    def connect(self):
        # `now()::timestamp` is the naive local-time value a DateTime column
        # would receive, so the fake shifts Python's UTC clock by the session
        # offset exactly the way Postgres would.
        stored_now = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
            hours=self._offset_hours
        )
        connection = _FakeConnection(
            session_timezone=self._session_timezone,
            stored_now=stored_now,
            fail=self._fail,
        )
        self.connections.append(connection)
        return connection


# --------------------------------------------------------------------------- #
# 1. Database session timezone
# --------------------------------------------------------------------------- #


def test_session_timezone_check_is_skipped_on_sqlite():
    """Local development is SQLite, which has no server-side session TimeZone.

    The check must say "not applicable" rather than invent an answer, otherwise
    a green local run would be read as evidence about production.
    """
    report = db_mod.describe_session_timezone(db_mod.create_db_engine("sqlite://"))

    assert report["dialect"] == "sqlite"
    assert report["status"] == "skipped"
    assert report["checked"] is False
    assert report["offset_seconds"] is None
    assert "production Postgres" in report["recommendation"]


def test_session_timezone_check_passes_on_utc_postgres():
    report = db_mod.describe_session_timezone(_FakeEngine(session_timezone="UTC", offset_hours=0))

    assert report["status"] == "ok"
    assert report["checked"] is True
    assert report["session_timezone"] == "UTC"
    assert abs(report["offset_seconds"]) <= db_mod.SESSION_TIMEZONE_TOLERANCE_SECONDS
    assert report["utc_aligned"] is True
    assert "No change needed" in report["recommendation"]


def test_session_timezone_check_measures_a_real_offset_on_non_utc_postgres():
    """The timezone *name* alone is not evidence; the measured offset is.

    A row defaulting to func.now() is written through this exact conversion, so
    +8h here is +8h in every created_at the deployment writes.
    """
    engine = _FakeEngine(session_timezone="Asia/Shanghai", offset_hours=8)

    report = db_mod.describe_session_timezone(engine)

    assert report["status"] == "misconfigured"
    assert report["session_timezone"] == "Asia/Shanghai"
    assert report["utc_aligned"] is False
    assert 28795 <= report["offset_seconds"] <= 28805
    # The fix has to be in the report, not in this module's docstring.
    assert "TimeZone%3DUTC" in report["recommendation"]
    assert "DATABASE_URL" in report["recommendation"]
    # SHOW TimeZone really was asked, and so was the cast that proves the shift.
    statements = engine.connections[0].statements
    assert any("show timezone" in sql.lower() for sql in statements)
    assert any("cast(now() as timestamp)" in sql.lower() for sql in statements)


def test_session_timezone_check_separates_clock_skew_from_a_wrong_timezone():
    report = db_mod.describe_session_timezone(_FakeEngine(session_timezone="UTC", offset_hours=1))

    assert report["status"] == "misconfigured"
    assert "clock skew" in report["recommendation"]
    # Telling an operator to set TimeZone=UTC when it already *is* UTC would send
    # them after the wrong problem.
    assert "TimeZone%3DUTC" not in report["recommendation"]


def test_session_timezone_check_never_raises_when_the_probe_fails():
    report = db_mod.describe_session_timezone(_FakeEngine(fail=True))

    assert report["status"] == "unknown"
    assert report["checked"] is False
    assert "RuntimeError" in report["recommendation"]


# --------------------------------------------------------------------------- #
# 2. Legacy plaintext API keys
# --------------------------------------------------------------------------- #

# Deliberately shares no substring with the report's own vocabulary, so the
# "never leaks key material" assertion below cannot pass by accident.
PLAINTEXT_KEY = "sk-live-9f3a71c2e4b8d0a6"


def _seed_provider_sources(db):
    legacy_ciphertext = Fernet(Fernet.generate_key()).encrypt(b"sk-old-token").decode()
    db.add_all(
        [
            AiProviderSource(name="encrypted-source", api_key_value=encrypt_value("sk-encrypted")),
            AiProviderSource(name="plaintext-source", api_key_value=PLAINTEXT_KEY),
            AiProviderSource(name="unprefixed-source", api_key_value=legacy_ciphertext),
            AiProviderSource(name="env-only-source", api_key_value=""),
        ]
    )
    db.commit()


def test_api_key_report_counts_legacy_plaintext_rows(db_session):
    _seed_provider_sources(db_session)

    report = ai_provider_manager.api_key_encryption_report(db_session)

    assert report["total_sources"] == 4
    assert report["sources_with_stored_key"] == 3
    assert report["encrypted"] == 1
    # Encrypted before the fernet:v1: envelope existed — no action needed, and it
    # must not be counted as plaintext.
    assert report["unprefixed_ciphertext"] == 1
    assert report["legacy_plaintext"] == 1
    assert report["status"] == "action_required"
    assert report["action_required"] is True
    assert [item["name"] for item in report["legacy_plaintext_sources"]] == ["plaintext-source"]


def test_api_key_report_never_leaks_key_material(db_session):
    """The whole report is a count plus an identity. Nothing else may escape."""
    _seed_provider_sources(db_session)

    report = ai_provider_manager.api_key_encryption_report(db_session)
    serialized = json.dumps(report)

    assert PLAINTEXT_KEY not in serialized
    # Not even a fragment: a prefix is enough to recognise a key in a log dump.
    for start in range(len(PLAINTEXT_KEY) - 6):
        assert PLAINTEXT_KEY[start : start + 7] not in serialized
    assert "sk-" not in serialized
    # Identity only — no value-shaped field, not even a length.
    for item in report["legacy_plaintext_sources"]:
        assert set(item) == {"id", "name"}


def test_api_key_report_is_clean_when_everything_is_encrypted(db_session):
    db_session.add(AiProviderSource(name="only-source", api_key_value=encrypt_value("sk-encrypted")))
    db_session.commit()

    report = ai_provider_manager.api_key_encryption_report(db_session)

    assert report["status"] == "ok"
    assert report["legacy_plaintext"] == 0
    assert report["legacy_plaintext_sources"] == []
    assert "No change needed" in report["recommendation"]


def test_api_key_report_safe_never_raises(monkeypatch):
    def _explode():
        raise RuntimeError("relation \"ai_provider_sources\" does not exist")

    monkeypatch.setattr(ai_provider_manager.db_mod, "SessionLocal", _explode)

    report = ai_provider_manager.api_key_encryption_report_safe()

    assert report["status"] == "unknown"
    assert report["action_required"] is False
    assert "RuntimeError" in report["recommendation"]


def test_reencrypt_migrates_plaintext_and_is_idempotent(db_session):
    _seed_provider_sources(db_session)

    first = ai_provider_manager.reencrypt_legacy_plaintext_api_keys(db_session)

    assert first["migrated"] == 1
    assert first["failed"] == 0
    assert [item["name"] for item in first["migrated_sources"]] == ["plaintext-source"]
    assert PLAINTEXT_KEY not in json.dumps(first)

    migrated = (
        db_session.query(AiProviderSource).filter(AiProviderSource.name == "plaintext-source").one()
    )
    assert migrated.api_key_value != PLAINTEXT_KEY
    # Migrating must not change what the runtime reads back.
    assert decrypt_value(migrated.api_key_value) == PLAINTEXT_KEY

    # Running it again is a no-op — it is safe to trigger repeatedly.
    second = ai_provider_manager.reencrypt_legacy_plaintext_api_keys(db_session)
    assert second["migrated"] == 0
    assert second["unchanged"] == 4
    assert ai_provider_manager.api_key_encryption_report(db_session)["legacy_plaintext"] == 0


def test_reencrypt_dry_run_reports_without_writing(db_session):
    _seed_provider_sources(db_session)

    preview = ai_provider_manager.reencrypt_legacy_plaintext_api_keys(db_session, dry_run=True)

    assert preview["dry_run"] is True
    assert preview["migrated"] == 1
    unchanged_row = (
        db_session.query(AiProviderSource).filter(AiProviderSource.name == "plaintext-source").one()
    )
    assert unchanged_row.api_key_value == PLAINTEXT_KEY


def test_startup_never_reencrypts_on_its_own(db_session, monkeypatch):
    """Rewriting a credentials column on every boot is not a health check's job."""
    _seed_provider_sources(db_session)
    monkeypatch.setattr(
        ai_provider_manager,
        "reencrypt_legacy_plaintext_api_keys",
        lambda *args, **kwargs: pytest.fail("startup must not rewrite stored credentials"),
    )

    bootstrap.run_startup_diagnostics()

    assert (
        db_session.query(AiProviderSource)
        .filter(AiProviderSource.name == "plaintext-source")
        .one()
        .api_key_value
        == PLAINTEXT_KEY
    )


# --------------------------------------------------------------------------- #
# 3. Required environment variables
# --------------------------------------------------------------------------- #


@pytest.fixture
def production_env(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    for name in (
        "SECRET_KEY",
        "ADMIN_USERNAME",
        "ADMIN_PASSWORD",
        "DATABASE_URL",
        "TURNSTILE_SECRET_KEY",
        "VERCEL_DEPLOY_HOOK_URL",
        "RESEND_API_KEY",
        "EMAIL_FROM",
        "WEB_PUSH_VAPID_PUBLIC_KEY",
        "WEB_PUSH_VAPID_PRIVATE_KEY",
        "WEB_PUSH_SUBJECT",
        "ALLOW_EPHEMERAL_UPLOADS",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "R2_PUBLIC_BASE_URL",
        "R2_ENDPOINT",
        "R2_ACCOUNT_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    reset_startup_environment_report()
    yield monkeypatch
    reset_startup_environment_report()


def _satisfy_fatal_env(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "production-secret")
    monkeypatch.setenv("ADMIN_USERNAME", "operator")
    monkeypatch.setenv("ADMIN_PASSWORD", "operator-password")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@host/db")
    # Explicitly accepted ephemeral uploads, so the R2 group is not required.
    monkeypatch.setenv("ALLOW_EPHEMERAL_UPLOADS", "1")


def test_missing_required_env_is_reported_all_at_once(production_env):
    with pytest.raises(RuntimeError) as excinfo:
        verify_startup_environment()

    message = str(excinfo.value)
    # One redeploy has to be enough: every tier is in the same message.
    for name in ("SECRET_KEY", "ADMIN_USERNAME", "ADMIN_PASSWORD", "DATABASE_URL", "R2_BUCKET_NAME"):
        assert name in message
    # And each one says what actually breaks without it.
    assert "sqlite:///./blog.db" in message
    assert "development credentials" in message


def test_ephemeral_uploads_opt_out_removes_only_the_storage_group(production_env):
    production_env.setenv("ALLOW_EPHEMERAL_UPLOADS", "1")

    missing = startup_environment_report()["missing_required_env"]

    assert "R2_BUCKET_NAME" not in missing
    assert {"SECRET_KEY", "ADMIN_USERNAME", "ADMIN_PASSWORD", "DATABASE_URL"} <= set(missing)


def test_development_never_requires_production_secrets(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    reset_startup_environment_report()

    report = verify_startup_environment()

    assert report["missing_required_env"] == []
    assert report["status"] in {"ok", "degraded"}


def test_degraded_features_warn_but_never_block_startup(production_env, caplog):
    _satisfy_fatal_env(production_env)

    with caplog.at_level(logging.WARNING, logger="blog.env"):
        report = verify_startup_environment()

    assert report["status"] == "degraded"
    assert report["action_required"] is False
    features = set(report["degraded_features"])
    assert {"turnstile", "frontend_refresh", "email_notifications", "web_push"} <= features
    # The warning must name the consequence, not just the variable.
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "without human verification" in logged
    assert "never rebuilds" in logged


def test_defaulted_ai_variables_are_not_reported_as_degraded(production_env):
    """SILICONFLOW_BASE_URL/MODEL have working built-in defaults, and XAI_API_KEY
    is only consulted for sources configured to read it, so calling either one
    "degraded" would be noise an operator learns to ignore."""
    _satisfy_fatal_env(production_env)
    for name in ("SILICONFLOW_BASE_URL", "SILICONFLOW_MODEL", "XAI_API_KEY"):
        production_env.delenv(name, raising=False)

    serialized = json.dumps(startup_environment_report())

    assert "SILICONFLOW_BASE_URL" not in serialized
    assert "SILICONFLOW_MODEL" not in serialized
    assert "XAI_API_KEY" not in serialized


def test_empty_cors_origins_is_degraded_only_when_it_actually_resolves_empty(production_env):
    _satisfy_fatal_env(production_env)
    production_env.delenv("ALLOWED_ORIGINS", raising=False)
    production_env.delenv("PUBLIC_SITE_URL", raising=False)
    production_env.delenv("SITE_URL", raising=False)
    production_env.setattr("app.env._load_site_url_from_database", lambda: "")

    assert "cors_origins" in startup_environment_report()["degraded_features"]

    # PUBLIC_SITE_URL alone is enough to derive origins, so nothing is degraded.
    production_env.setenv("PUBLIC_SITE_URL", "https://www.563118077.xyz")
    assert "cors_origins" not in startup_environment_report()["degraded_features"]


def test_initialize_runtime_checks_the_environment_before_touching_anything(
    production_env, monkeypatch
):
    monkeypatch.setattr(
        bootstrap,
        "validate_storage_configuration",
        lambda: pytest.fail("environment must be validated first"),
    )
    monkeypatch.setattr(
        bootstrap.db_mod.Base.metadata,
        "create_all",
        lambda bind=None: pytest.fail("database work must not start"),
    )

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        bootstrap.initialize_runtime(sync_schema=True, seed_on_empty=False)


# --------------------------------------------------------------------------- #
# 4. /readyz stays healthy under every one of these warnings
# --------------------------------------------------------------------------- #


ATTENTION_SNAPSHOT = {
    "status": "attention",
    "needs_attention": True,
    "environment": {
        "status": "degraded",
        "missing_required_env": [],
        "degraded_features": ["turnstile", "frontend_refresh"],
        "degraded_details": [
            {"feature": "turnstile", "missing_env": ["TURNSTILE_SECRET_KEY"], "effect": "off"}
        ],
        "recommendation": "set TURNSTILE_SECRET_KEY",
    },
    "database_timezone": {
        "status": "misconfigured",
        "session_timezone": "Asia/Shanghai",
        "offset_seconds": 28800.0,
        "recommendation": "append options=-c TimeZone=UTC",
    },
    "api_key_encryption": {
        "status": "action_required",
        "legacy_plaintext": 2,
        "legacy_plaintext_sources": [{"id": 7, "name": "prod-openai-source"}],
        "sources_with_stored_key": 3,
        "encrypted": 1,
        "recommendation": "re-save the source",
    },
}


def test_readyz_stays_ready_while_every_check_is_warning(client, monkeypatch):
    """A non-UTC timezone, a plaintext key and a disabled feature are warnings
    about a *serving* app. Failing Render's healthCheckPath over them would take
    the site down to report a warning."""
    monkeypatch.setattr(bootstrap, "_startup_diagnostics", dict(ATTENTION_SNAPSHOT))

    resp = client.get("/readyz")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    checks = body["checks"]
    assert checks["needs_attention"] is True
    assert checks["database_timezone"]["session_timezone"] == "Asia/Shanghai"
    assert checks["database_timezone"]["offset_seconds"] == 28800.0
    assert checks["api_key_encryption"]["legacy_plaintext"] == 2


def test_readyz_summary_withholds_identifying_detail(client, monkeypatch):
    """/readyz is unauthenticated. "Human verification is off" is exactly what a
    registration-abuse bot wants told to it, so the public projection counts the
    degraded features instead of naming them, and never names a provider row."""
    monkeypatch.setattr(bootstrap, "_startup_diagnostics", dict(ATTENTION_SNAPSHOT))

    serialized = json.dumps(client.get("/readyz").json())

    assert "turnstile" not in serialized
    assert "TURNSTILE_SECRET_KEY" not in serialized
    assert "prod-openai-source" not in serialized
    # The count still gets through, so an operator learns something is waiting.
    assert '"degraded_features": 2' in serialized


def test_readyz_reports_not_run_before_startup_diagnostics_complete(client, monkeypatch):
    monkeypatch.setattr(bootstrap, "_startup_diagnostics", {})

    body = client.get("/readyz").json()

    assert body["status"] == "ready"
    assert body["checks"] == {"status": "not_run"}


def test_run_startup_diagnostics_never_raises(monkeypatch, caplog):
    monkeypatch.setattr(
        db_mod,
        "describe_session_timezone",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("probe exploded")),
    )
    bootstrap.reset_startup_diagnostics()

    with caplog.at_level(logging.ERROR, logger="blog.bootstrap"):
        snapshot = bootstrap.run_startup_diagnostics()

    assert snapshot["status"] == "not_run"
    assert "Startup diagnostics failed" in caplog.text


def test_startup_diagnostics_caches_instead_of_probing_per_request(monkeypatch):
    calls = {"timezone": 0}
    probe = db_mod.describe_session_timezone

    def _counted(*args, **kwargs):
        calls["timezone"] += 1
        return probe(_FakeEngine(session_timezone="UTC"))

    monkeypatch.setattr(db_mod, "describe_session_timezone", _counted)
    bootstrap.reset_startup_diagnostics()
    bootstrap.run_startup_diagnostics()

    for _ in range(5):
        assert bootstrap.startup_diagnostics_summary()["database_timezone"]["status"] == "ok"

    # /readyz is polled continuously by Render; the probe must run once per
    # process, not once per poll.
    assert calls["timezone"] == 1

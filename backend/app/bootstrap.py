from __future__ import annotations

import logging
import sys

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

import app.db as db_mod
from app.env import clean_env, startup_environment_report, verify_startup_environment
from app.models import Post, SiteSettings, User
from app.schema_compat import ensure_runtime_required_schema, ensure_schema_compat
from app.seed import seed_data
from app.storage import (
    check_storage_readiness,
    ensure_local_upload_dir,
    is_r2_enabled,
    validate_storage_configuration,
)

logger = logging.getLogger("blog.bootstrap")

FALSE_VALUES = {"0", "false", "no", "off"}


def env_flag(name: str, default: bool) -> bool:
    raw = clean_env(name, "")
    if raw == "":
        return default
    return raw.strip().lower() not in FALSE_VALUES


def should_enable_startup_schema_sync() -> bool:
    explicit = clean_env("ENABLE_STARTUP_SCHEMA_SYNC", "")
    if explicit != "":
        return explicit.strip().lower() not in FALSE_VALUES
    is_render_runtime = bool(clean_env("RENDER", "") or clean_env("RENDER_SERVICE_ID", ""))
    return not is_render_runtime


def initialize_runtime(*, sync_schema: bool | None = None, seed_on_empty: bool | None = None) -> None:
    effective_sync = should_enable_startup_schema_sync() if sync_schema is None else sync_schema
    effective_seed = env_flag("AUTO_SEED_ON_EMPTY", True) if seed_on_empty is None else seed_on_empty

    # Before anything touches storage or the database: one error listing every
    # missing required variable, so a fresh deployment is fixed in one pass.
    # `app.main` calls this too (earlier, before app.auth resolves credentials);
    # it is idempotent, and this call is what covers `python -m app.bootstrap`.
    verify_startup_environment()

    validate_storage_configuration()
    if not is_r2_enabled():
        ensure_local_upload_dir()

    if effective_sync:
        db_mod.Base.metadata.create_all(bind=db_mod.engine)
        ensure_schema_compat(db_mod.engine)
    else:
        ensure_runtime_required_schema(db_mod.engine)

    try:
        with db_mod.SessionLocal() as db:
            if effective_seed and db.query(Post).count() == 0:
                seed_data(db)
            if db.query(SiteSettings).count() == 0:
                db.add(SiteSettings(id=1))
                db.commit()
    except OperationalError as exc:
        if not effective_sync:
            raise RuntimeError(
                "Database schema has not been initialized for this runtime. "
                "Run `python -m app.bootstrap` once or temporarily set ENABLE_STARTUP_SCHEMA_SYNC=1 "
                "for a single deploy."
            ) from exc
        raise

    # Last, because both DB-backed checks need the schema to exist.
    run_startup_diagnostics()


# --------------------------------------------------------------------------- #
# Startup diagnostics
#
# Two questions cannot be answered from the source tree — what the production
# database session's TimeZone is, and how many AI provider rows still hold a
# plaintext API key — and both need credentials nobody is going to paste into a
# shell. So the deployment answers them itself: the checks run once at startup,
# log what they found, and are cached for /readyz and the admin console to echo.
#
# Cached rather than recomputed per request on purpose: /readyz is Render's
# healthCheckPath and gets polled continuously, and none of this changes while
# the process lives.
# --------------------------------------------------------------------------- #

_startup_diagnostics: dict = {}


def startup_diagnostics() -> dict:
    """Full snapshot of the startup self-checks (admin-only surface).

    Carries the identifying detail — which features are degraded, which provider
    sources still hold plaintext keys — so it must stay behind admin auth. Use
    `startup_diagnostics_summary()` for anything public. Returns a ``not_run``
    placeholder rather than doing work if startup has not completed, so no
    request path can trigger the probes.
    """
    if not _startup_diagnostics:
        return {
            "status": "not_run",
            "recommendation": (
                "Startup diagnostics have not run in this process yet. They execute at the end of "
                "bootstrap.initialize_runtime(); if this persists, startup did not complete."
            ),
        }
    return dict(_startup_diagnostics)


def startup_diagnostics_summary() -> dict:
    """Public-safe projection of `startup_diagnostics()` for /readyz.

    /readyz is unauthenticated, so this drops every identifying detail the full
    snapshot carries: provider ids and names, and the *names* of the degraded
    features. "Human verification is currently off" is precisely what a
    registration-abuse bot would like to be told; a count still answers the only
    question an operator has from outside — is something waiting for me? — while
    the names stay behind admin auth and in the logs.
    """
    snapshot = startup_diagnostics()
    if snapshot.get("status") == "not_run":
        return {"status": "not_run"}

    environment = snapshot.get("environment") or {}
    database_timezone = snapshot.get("database_timezone") or {}
    api_key_encryption = snapshot.get("api_key_encryption") or {}
    return {
        "status": snapshot.get("status", "unknown"),
        "needs_attention": bool(snapshot.get("needs_attention")),
        "environment": {
            "status": environment.get("status", "unknown"),
            "missing_required_env": len(environment.get("missing_required_env") or []),
            "degraded_features": len(environment.get("degraded_features") or []),
        },
        "database_timezone": {
            "status": database_timezone.get("status", "unknown"),
            "session_timezone": database_timezone.get("session_timezone", ""),
            "offset_seconds": database_timezone.get("offset_seconds"),
        },
        "api_key_encryption": {
            "status": api_key_encryption.get("status", "unknown"),
            "legacy_plaintext": api_key_encryption.get("legacy_plaintext", 0),
        },
    }


def run_startup_diagnostics() -> dict:
    """Run the self-checks once, log what they found and cache the snapshot.

    Never raises. It runs at the tail of startup, after the app is otherwise
    ready; a diagnostic that could abort the boot it is describing would be worse
    than the questions it answers.
    """
    global _startup_diagnostics

    try:
        # Imported here so the service layer stays out of the startup import
        # graph and a failure in it can never keep the app from booting.
        from app.services.ai_provider_manager import api_key_encryption_report_safe

        environment = startup_environment_report()
        database_timezone = db_mod.describe_session_timezone()
        api_key_encryption = api_key_encryption_report_safe()
    except Exception:
        logger.exception("Startup diagnostics failed; continuing without them")
        return startup_diagnostics()

    if database_timezone["status"] == "misconfigured":
        logger.warning("Database session TimeZone check: %s", database_timezone["recommendation"])
    else:
        logger.info(
            "Database session TimeZone check: status=%s timezone=%s offset_seconds=%s",
            database_timezone["status"],
            database_timezone["session_timezone"] or "-",
            database_timezone["offset_seconds"],
        )

    if api_key_encryption["status"] == "action_required":
        logger.warning(
            "AI provider API keys at rest: %s Affected source ids: %s",
            api_key_encryption["recommendation"],
            ",".join(str(item["id"]) for item in api_key_encryption["legacy_plaintext_sources"]),
        )
    else:
        logger.info(
            "AI provider API keys at rest: status=%s stored=%s encrypted=%s",
            api_key_encryption["status"],
            api_key_encryption["sources_with_stored_key"],
            api_key_encryption["encrypted"],
        )

    needs_attention = (
        environment["status"] != "ok"
        or database_timezone["status"] == "misconfigured"
        or api_key_encryption["status"] == "action_required"
    )
    _startup_diagnostics = {
        "status": "attention" if needs_attention else "ok",
        "needs_attention": needs_attention,
        "environment": environment,
        "database_timezone": database_timezone,
        "api_key_encryption": api_key_encryption,
    }
    return dict(_startup_diagnostics)


def reset_startup_diagnostics() -> None:
    """Clear the cached snapshot (used by tests; safe to call at runtime)."""
    global _startup_diagnostics
    _startup_diagnostics = {}


def check_runtime_readiness() -> None:
    with db_mod.engine.connect() as connection:
        if connection.execute(text("SELECT 1")).scalar_one() != 1:
            raise RuntimeError("Database connectivity check returned an unexpected result")

        # LIMIT 0 validates the mapped columns without reading application rows.
        for model in (Post, SiteSettings, User):
            connection.execute(select(model).limit(0))

    check_storage_readiness()


def main(argv: list[str] | None = None) -> None:
    """One-off schema bootstrap (`python -m app.bootstrap`).

    Seeding is opt-in via `--seed`, never inherited from AUTO_SEED_ON_EMPTY: this
    entry point is documented as "run it once from any shell you have", and a shell
    pointed at the production DATABASE_URL would otherwise write demo posts and tags
    into the production database whenever the posts table happened to be empty.
    """
    args = sys.argv[1:] if argv is None else argv
    seed_on_empty = "--seed" in args
    initialize_runtime(sync_schema=True, seed_on_empty=seed_on_empty)
    print("Runtime bootstrap complete." + (" Demo content seeded." if seed_on_empty else ""))


if __name__ == "__main__":
    main()

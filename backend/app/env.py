from __future__ import annotations

import logging
import os
from collections.abc import Iterable
from urllib.parse import urlparse

logger = logging.getLogger("blog.env")


def clean_env(name: str, default: str = "") -> str:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    value = raw_value.strip().replace("\r", "").replace("\n", "").replace("\t", "")

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1].strip()

    prefix = f"{name}="
    if value.startswith(prefix):
        value = value[len(prefix):].strip()

    return value or default


def normalize_database_url(value: str) -> str:
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    return value


def get_database_url(default: str = "sqlite:///./blog.db") -> str:
    return normalize_database_url(clean_env("DATABASE_URL", default))


def env_truthy(name: str, default: bool = False) -> bool:
    value = clean_env(name)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on", "production"}


def get_app_env() -> str:
    explicit = clean_env("APP_ENV") or clean_env("ENVIRONMENT")
    if explicit:
        return explicit.lower()
    if clean_env("RENDER") or clean_env("RENDER_SERVICE_ID"):
        return "production"
    return "development"


def is_production_env() -> bool:
    return get_app_env() in {"prod", "production"}


def clean_env_list(name: str, default: list[str] | None = None) -> list[str]:
    value = clean_env(name)
    if not value:
        return list(default or [])

    items: list[str] = []
    for raw in value.replace("\n", ",").split(","):
        item = raw.strip()
        if item and item not in items:
            items.append(item)
    return items


def get_default_public_site_url() -> str:
    value = clean_env("PUBLIC_SITE_URL") or clean_env("SITE_URL")
    if value:
        return value.rstrip("/")
    if is_production_env():
        return ""
    return "http://127.0.0.1:5173"


def _expand_origin_variants(url: str) -> list[str]:
    value = str(url or "").strip().rstrip("/")
    if not value:
        return []

    try:
        parsed = urlparse(value)
    except Exception:
        return []

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return []

    origin = f"{parsed.scheme}://{parsed.netloc}"
    origins = [origin]

    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    if host and host not in {"localhost", "127.0.0.1", "::1"}:
        if host.startswith("www."):
            origins.append(f"{parsed.scheme}://{host[4:]}{port}")
        else:
            origins.append(f"{parsed.scheme}://www.{host}{port}")

    deduped: list[str] = []
    for item in origins:
        if item and item not in deduped:
            deduped.append(item)
    return deduped


def _load_site_url_from_database() -> str:
    try:
        from sqlalchemy import text

        from app.db import SessionLocal

        with SessionLocal() as db:
            row = db.execute(
                text(
                    "SELECT site_url FROM site_settings "
                    "WHERE site_url IS NOT NULL AND TRIM(site_url) != '' "
                    "LIMIT 1"
                )
            ).first()
            if row and row[0]:
                return str(row[0]).strip().rstrip("/")
    except Exception:
        return ""
    return ""


def get_allowed_origins() -> list[str]:
    configured = clean_env_list("ALLOWED_ORIGINS")
    if configured:
        expanded: list[str] = []
        for item in configured:
            variants = _expand_origin_variants(item)
            if variants:
                expanded.extend(variants)
            elif item not in expanded:
                expanded.append(item)
        return list(dict.fromkeys(expanded))

    default_site_url = get_default_public_site_url()
    derived_origins = _expand_origin_variants(default_site_url)
    if not derived_origins and not is_production_env():
        defaults = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
        return defaults

    if not derived_origins and is_production_env():
        derived_origins = _expand_origin_variants(_load_site_url_from_database())

    if is_production_env():
        return derived_origins

    defaults = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    for item in derived_origins:
        if item not in defaults:
            defaults.append(item)
    return defaults


# --------------------------------------------------------------------------- #
# Startup environment validation
#
# Every required variable used to fail on its own, at its own point of first
# use: `app.auth` raises on SECRET_KEY, then (after a redeploy) on
# ADMIN_USERNAME, then on ADMIN_PASSWORD, and `app.storage` raises separately
# for the R2 group. Bringing up a fresh deployment therefore cost one redeploy
# per missing variable. The checks below collect *every* missing name first and
# raise once, so a single pass through the Render dashboard is enough.
#
# Two tiers, decided by what the code actually does when the value is absent —
# not by how important the name sounds:
#
# - fatal    – no working fallback exists, so the process would either refuse to
#              serve or serve against the wrong resource entirely. Raises.
# - degraded – a fallback exists and it silently turns a feature off. Warns, and
#              is listed in `degraded_features` so /readyz and the admin
#              diagnostics can report it without anyone reading logs.
#
# Deliberately *not* listed, having been checked against their real read sites:
# - SILICONFLOW_BASE_URL / SILICONFLOW_MODEL: `ai_channels.provider_defaults()`
#   already carries working defaults, so "unset" means "use the built-in
#   endpoint/model", which is not a degradation.
# - XAI_API_KEY: only read when an AI provider source is configured to take its
#   key from that variable *and* has no key stored in the database. That is
#   data-dependent, so it belongs to the AI provider diagnostics, not here.
# --------------------------------------------------------------------------- #

# (name, what goes wrong when it is missing in production)
REQUIRED_PRODUCTION_ENV_VARS: tuple[tuple[str, str], ...] = (
    (
        "SECRET_KEY",
        "app.auth refuses to boot without it, and it is also what the AI provider "
        "key encryption falls back to when FIELD_ENCRYPTION_KEY is unset.",
    ),
    (
        "ADMIN_USERNAME",
        "the admin console would otherwise fall back to the development credentials.",
    ),
    (
        "ADMIN_PASSWORD",
        "the admin console would otherwise fall back to the development credentials.",
    ),
    (
        "DATABASE_URL",
        "get_database_url() falls back to sqlite:///./blog.db, so production would "
        "boot against an empty file on the container's ephemeral disk and lose "
        "every write on the next deploy.",
    ),
)

# (feature key, required variables, what silently happens without them)
DEGRADABLE_ENV_FEATURES: tuple[tuple[str, tuple[str, ...], str], ...] = (
    (
        "turnstile",
        ("TURNSTILE_SECRET_KEY",),
        "turnstile_ready() is False, so visitor register/login accept any request "
        "without human verification.",
    ),
    (
        "frontend_refresh",
        ("VERCEL_DEPLOY_HOOK_URL",),
        "trigger_frontend_refresh_safe() returns False, so publishing never rebuilds "
        "the prerendered frontend and new posts stay invisible until the next deploy.",
    ),
    (
        "email_notifications",
        ("RESEND_API_KEY", "EMAIL_FROM"),
        "email_delivery_ready() is False, so subscribers are never emailed about new posts.",
    ),
    (
        "web_push",
        ("WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_SUBJECT"),
        "web_push_delivery_ready() is False, so browser push notifications are never sent.",
    ),
    (
        "field_encryption_key",
        ("FIELD_ENCRYPTION_KEY",),
        "stored AI provider keys are encrypted with a key derived from SECRET_KEY, so "
        "rotating SECRET_KEY would silently make every stored credential undecryptable.",
    ),
)

_startup_environment_logged = False


def reset_startup_environment_report() -> None:
    """Allow the one-shot startup warnings to be emitted again (used by tests)."""
    global _startup_environment_logged
    _startup_environment_logged = False


def missing_env_vars(names: Iterable[str]) -> list[str]:
    """The subset of ``names`` that resolve to an empty value."""
    return [name for name in names if not clean_env(name)]


def _missing_durable_storage_env_vars() -> list[str]:
    """R2 group, delegated to app.storage so the rule lives in exactly one place.

    Imported lazily: app.storage imports this module, and the cycle only matters
    at import time.
    """
    try:
        from app.storage import (
            ephemeral_uploads_allowed,
            get_missing_r2_configuration,
            is_durable_storage_required,
        )
    except Exception:  # pragma: no cover - storage import failures surface elsewhere
        return []

    if not is_durable_storage_required() or ephemeral_uploads_allowed():
        return []
    return list(get_missing_r2_configuration())


def missing_required_env_vars() -> list[str]:
    """Every fatal variable that is missing, in one list. Empty outside production."""
    if not is_production_env():
        return []
    missing = missing_env_vars(name for name, _ in REQUIRED_PRODUCTION_ENV_VARS)
    for name in _missing_durable_storage_env_vars():
        if name not in missing:
            missing.append(name)
    return missing


def degraded_feature_report() -> list[dict]:
    """Features that are silently switched off by a missing variable."""
    report: list[dict] = []
    for feature, names, effect in DEGRADABLE_ENV_FEATURES:
        missing = missing_env_vars(names)
        if missing:
            report.append({"feature": feature, "missing_env": missing, "effect": effect})

    # CORS is the one case where the variable being unset is not the failure:
    # production derives origins from PUBLIC_SITE_URL and then from
    # site_settings.site_url. Only an empty *result* actually blocks the browser.
    if is_production_env() and not get_allowed_origins():
        report.append(
            {
                "feature": "cors_origins",
                "missing_env": ["ALLOWED_ORIGINS"],
                "effect": (
                    "get_allowed_origins() resolves to an empty list (no ALLOWED_ORIGINS, no "
                    "PUBLIC_SITE_URL and no stored site_url), so every cross-origin browser "
                    "request from the frontend is rejected."
                ),
            }
        )
    return report


def _required_env_failure_message(missing: list[str]) -> str:
    reasons = dict(REQUIRED_PRODUCTION_ENV_VARS)
    lines = [
        "Missing required environment variables in production: "
        # ASCII only: this message is printed to stderr by the interpreter when
        # startup aborts, and a Windows console on a non-UTF-8 code page would
        # turn a non-ASCII character into a UnicodeEncodeError on top of it.
        f"{', '.join(missing)}. Set all of them and redeploy once; they are "
        "validated together so a single pass is enough:",
    ]
    for name in missing:
        reason = reasons.get(
            name,
            "durable R2 storage is required in production; configure the R2 group "
            "or set ALLOW_EPHEMERAL_UPLOADS=1 to explicitly accept ephemeral local uploads.",
        )
        lines.append(f"  - {name}: {reason}")
    return "\n".join(lines)


def _environment_recommendation(missing: list[str], degraded: list[dict]) -> str:
    """The next action, phrased so an operator never has to read this module."""
    if missing:
        return (
            f"Set {', '.join(missing)} in the Render dashboard (they are declared as "
            "sync: false in render.yaml) and redeploy. The startup check lists every "
            "missing variable at once, so one redeploy clears all of them."
        )
    if degraded:
        features = ", ".join(item["feature"] for item in degraded)
        names = ", ".join(sorted({name for item in degraded for name in item["missing_env"]}))
        return (
            f"The app is serving, but these features are switched off because their "
            f"configuration is absent: {features}. Set {names} if you want them; leaving "
            "them unset is a valid choice, this is a statement of what is currently off."
        )
    return "No change needed: every required variable is set and no feature is degraded."


def startup_environment_report() -> dict:
    """Snapshot of environment configuration for an ops/diagnostic surface.

    Never raises — `verify_startup_environment()` is the enforcing entry point.
    ``status`` is the one field to read, ``recommendation`` says what to do:

    - ``ok``            – everything required is set, nothing is degraded
    - ``degraded``      – serving, but some features are silently switched off
    - ``misconfigured`` – a fatal variable is missing (production only)
    """
    missing = missing_required_env_vars()
    degraded = degraded_feature_report()
    if missing:
        status = "misconfigured"
    elif degraded:
        status = "degraded"
    else:
        status = "ok"
    return {
        "environment": get_app_env(),
        "production": is_production_env(),
        "missing_required_env": missing,
        "degraded_features": [item["feature"] for item in degraded],
        "degraded_details": degraded,
        "status": status,
        "action_required": bool(missing),
        "recommendation": _environment_recommendation(missing, degraded),
    }


def verify_startup_environment() -> dict:
    """Fail fast on everything fatal at once; warn once about the degraded set.

    Called from `app.main` *before* `app.auth` is imported (that module resolves
    the credentials at import time and raises on the first missing one) and again
    from `bootstrap.initialize_runtime()` so the `python -m app.bootstrap`
    entry point gets the same guarantee. Raising is idempotent; the warnings are
    emitted only once per process.
    """
    global _startup_environment_logged

    report = startup_environment_report()
    if report["missing_required_env"]:
        raise RuntimeError(_required_env_failure_message(report["missing_required_env"]))

    if _startup_environment_logged:
        return report
    _startup_environment_logged = True

    for item in report["degraded_details"]:
        logger.warning(
            "Feature disabled by missing configuration: feature=%s missing_env=%s effect=%s",
            item["feature"],
            ",".join(item["missing_env"]),
            item["effect"],
        )
    if not report["degraded_details"]:
        logger.info(
            "Environment check passed: every required variable is set and no feature is degraded."
        )
    return report

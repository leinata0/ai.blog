import logging
from datetime import datetime, timezone
from time import perf_counter

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.env import clean_env, get_database_url

DATABASE_URL = get_database_url()


def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def _pool_int(name: str, default: int) -> int:
    """Never let a malformed env var raise at import time — that kills the process."""
    raw = clean_env(name, "")
    if not raw:
        return default
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        logging.getLogger("blog.db").warning(
            "Ignoring invalid %s=%r, falling back to %s", name, raw, default
        )
        return default


def create_db_engine(database_url: str):
    if database_url.startswith("sqlite"):
        return _create_sqlite_engine(database_url)

    db_engine = create_engine(
        database_url,
        pool_pre_ping=True,
        # Neon closes idle server connections on its own; recycling first keeps the
        # pool from handing out a socket the server has already dropped.
        pool_recycle=_pool_int("DB_POOL_RECYCLE_SECONDS", 300),
        pool_size=_pool_int("DB_POOL_SIZE", 5),
        max_overflow=_pool_int("DB_MAX_OVERFLOW", 5),
        pool_timeout=_pool_int("DB_POOL_TIMEOUT_SECONDS", 30),
    )
    return db_engine


def _create_sqlite_engine(database_url: str):
    db_engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    event.listen(db_engine, "connect", _enable_sqlite_foreign_keys)
    return db_engine


engine = create_db_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
db_logger = logging.getLogger("blog.db")


def _timing_threshold_ms() -> float:
    raw = clean_env("DB_TIMING_LOG_MIN_MS", "") or "30"
    try:
        return float(raw)
    except (TypeError, ValueError):
        db_logger.warning("Ignoring invalid DB_TIMING_LOG_MIN_MS=%r, falling back to 30", raw)
        return 30.0


DB_TIMING_LOG_MIN_MS = _timing_threshold_ms()


def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    conn.info.setdefault("query_start_time", []).append(perf_counter())


def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    start_times = conn.info.get("query_start_time") or []
    if not start_times:
        return

    elapsed_ms = (perf_counter() - start_times.pop()) * 1000
    if elapsed_ms < DB_TIMING_LOG_MIN_MS:
        return

    compact_statement = " ".join(str(statement or "").split())
    if len(compact_statement) > 240:
        compact_statement = f"{compact_statement[:237]}..."

    db_logger.info("query_timing duration_ms=%.1f sql=%s", elapsed_ms, compact_statement)


def discard_timing_on_error(exception_context):
    """after_cursor_execute never fires for a failing statement, so the timestamp
    pushed by before_cursor_execute would leak. On a pooled connection that lives
    for the whole process the list would grow without bound."""
    connection = getattr(exception_context, "connection", None)
    if connection is None:
        return
    try:
        start_times = connection.info.get("query_start_time")
    except Exception:  # invalidated connection — nothing left to clean up
        return
    if start_times:
        start_times.pop()


def register_query_timing_listeners(target_engine) -> None:
    event.listen(target_engine, "before_cursor_execute", before_cursor_execute)
    event.listen(target_engine, "after_cursor_execute", after_cursor_execute)
    # Pairs with before_cursor_execute so the push/pop stays balanced on failure.
    event.listen(target_engine, "handle_error", discard_timing_on_error)


register_query_timing_listeners(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Session TimeZone self-check
#
# Most models default their timestamps with `Column(DateTime, default=func.now())`.
# Postgres' `now()` is a *timestamptz*; storing it into a naive `timestamp`
# column casts it through the session's TimeZone, so a session that is not UTC
# shifts every one of those rows by the offset — silently, and only in
# production, because local development runs on SQLite where the setting does
# not exist. `posts.py` already sidesteps this for ViewLog by writing an explicit
# Python UTC timestamp, but every remaining `func.now()` default still goes
# through the session timezone.
#
# Reporting the timezone *name* is not proof. `now()::timestamp` is exactly the
# conversion a naive column performs, so comparing it against Python's UTC clock
# measures the stored value itself — that is what `offset_seconds` reports.
# --------------------------------------------------------------------------- #

# Clock skew between the app container and the database server, plus one
# round-trip, lives well inside this. A real timezone misconfiguration is at
# least 30 minutes.
SESSION_TIMEZONE_TOLERANCE_SECONDS = 5.0

_UTC_TIMEZONE_NAMES = {"utc", "etc/utc", "universal", "zulu", "z", "gmt", "etc/gmt", "+00", "+00:00"}


def _looks_like_utc(name: str) -> bool:
    return str(name or "").strip().lower() in _UTC_TIMEZONE_NAMES


def _as_naive_utc(value):
    """Normalize a driver-returned datetime for comparison, or None."""
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def describe_session_timezone(target_engine=None) -> dict:
    """Report whether `func.now()` defaults land on UTC, with a measured offset.

    Never raises: this runs at startup and is echoed by /readyz, and a broken
    diagnostic must not take either of them down. ``status`` is the field to
    read, ``recommendation`` says what to do about it:

    - ``skipped``      – not Postgres (SQLite has no server-side session TimeZone)
    - ``unknown``      – the probe could not run; the question stays unanswered
    - ``misconfigured`` – stored timestamps are shifted by ``offset_seconds``
    - ``ok``           – naive timestamp columns receive UTC
    """
    active_engine = engine if target_engine is None else target_engine
    dialect = str(getattr(getattr(active_engine, "dialect", None), "name", "") or "unknown")
    report = {
        "dialect": dialect,
        "checked": False,
        "session_timezone": "",
        "offset_seconds": None,
        "utc_aligned": None,
        "tolerance_seconds": SESSION_TIMEZONE_TOLERANCE_SECONDS,
        "status": "skipped",
        "recommendation": (
            f"Skipped: the {dialect} dialect has no server-side session TimeZone, so nothing "
            "can shift a naive timestamp column. This check only answers the question on the "
            "production Postgres."
        ),
    }
    if not dialect.startswith("postgres"):
        return report

    try:
        with active_engine.connect() as connection:
            session_timezone = connection.execute(text("SHOW TimeZone")).scalar_one()
            # The cast is the point: it is the same conversion a naive DateTime
            # column performs, so this measures what gets stored, not what the
            # driver hands back over the wire.
            stored_now = connection.execute(text("SELECT CAST(now() AS timestamp)")).scalar_one()
    except Exception as exc:
        report["status"] = "unknown"
        report["recommendation"] = (
            f"Could not read the session TimeZone ({exc.__class__.__name__}), so whether "
            "func.now() defaults are stored as UTC is still unanswered. Re-check once the "
            "database is reachable."
        )
        return report

    measured_at = datetime.now(timezone.utc).replace(tzinfo=None)
    stored_naive = _as_naive_utc(stored_now)
    offset_seconds = (
        round((stored_naive - measured_at).total_seconds(), 1) if stored_naive is not None else None
    )
    aligned = offset_seconds is not None and abs(offset_seconds) <= SESSION_TIMEZONE_TOLERANCE_SECONDS

    report["checked"] = True
    report["session_timezone"] = str(session_timezone or "")
    report["offset_seconds"] = offset_seconds
    report["utc_aligned"] = aligned
    report["status"] = "ok" if aligned else "misconfigured"
    report["recommendation"] = _session_timezone_recommendation(
        session_timezone=report["session_timezone"],
        offset_seconds=offset_seconds,
        aligned=aligned,
    )
    return report


def _session_timezone_recommendation(
    *, session_timezone: str, offset_seconds: float | None, aligned: bool
) -> str:
    if aligned:
        return (
            f"No change needed: the session TimeZone is {session_timezone!r} and now() lands on "
            f"Python's UTC clock (offset {offset_seconds:+.1f}s), so columns defaulting to "
            "func.now() are stored as UTC."
        )
    if offset_seconds is None:
        return (
            f"The session TimeZone is {session_timezone!r} but the offset could not be measured, "
            "so treat the timestamps written by func.now() defaults as unverified."
        )
    if _looks_like_utc(session_timezone):
        return (
            f"The session TimeZone is {session_timezone!r}, which is correct, but now() is "
            f"{offset_seconds:+.1f}s away from this container's UTC clock. That is clock skew "
            "between the app and the database host, not a timezone problem: timestamps are "
            "consistent, just offset from wall time by that much."
        )
    return (
        f"The database session TimeZone is {session_timezone!r} and now() is {offset_seconds:+.1f}s "
        "away from UTC, so every column defaulting to func.now() (created_at on posts, comments, "
        "AI provider rows, ...) is being stored shifted by that amount. Append "
        "'?options=-c%20TimeZone%3DUTC' to DATABASE_URL, or set "
        "connect_args={'options': '-c TimeZone=UTC'} on the engine in app/db.py, and redeploy. "
        "Rows already written keep the old offset; this check does not rewrite them."
    )

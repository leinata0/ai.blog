"""Shared timestamp serialization for API responses.

Every DateTime column in ``app.models`` is naive and holds UTC. Emitting a bare
"2026-07-20T23:30:00" makes ECMA-262 parse it as *local* time, so a UTC+8 reader
saw fresh posts as "8 小时前", 归档/日报 day grouping landed on the wrong date, and
账号中心/关注/阅读历史 showed every timestamp 8 hours early.

Every timestamp that leaves the API goes through here, so there is exactly one
answer to "what does a stored timestamp look like on the wire". Routers used to
each carry their own copy (``posts._iso_utc`` had the offset, ``admin._serialize_datetime``
did not, ``users`` had no hook at all) — that skew is what this module removes.
"""
from datetime import datetime, timezone

__all__ = ["as_utc", "iso_utc"]


def as_utc(value: datetime | None) -> datetime | None:
    """Return ``value`` as a timezone-aware UTC datetime (``None`` passes through).

    Use this when the value is handed to a Pydantic ``response_model`` — Pydantic
    serializes an aware datetime with an explicit ``Z`` and a naive one without any
    marker — or when timestamps are compared/sorted against each other.
    """
    if value is None:
        return None
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(timezone.utc)


def iso_utc(value: datetime | None) -> str | None:
    """Serialize a stored timestamp as ISO-8601 with an explicit ``+00:00`` offset.

    Use this when building a plain ``dict`` response that is not filtered through a
    Pydantic model.
    """
    aware = as_utc(value)
    return aware.isoformat() if aware is not None else None

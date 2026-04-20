from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime

from fastapi import Request, Response


def build_public_cache_control(
    *,
    max_age: int = 60,
    s_maxage: int = 300,
    stale_while_revalidate: int = 600,
) -> str:
    return (
        f"public, max-age={int(max_age)}, "
        f"s-maxage={int(s_maxage)}, "
        f"stale-while-revalidate={int(stale_while_revalidate)}"
    )


def _normalize_http_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    current = value
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return format_datetime(current.astimezone(timezone.utc), usegmt=True)


def _compute_etag(content: bytes) -> str:
    digest = hashlib.sha1(content).hexdigest()
    return f'W/"{digest}"'


def _matches_if_none_match(header_value: str, etag: str) -> bool:
    if not header_value or not etag:
        return False
    if header_value.strip() == "*":
        return True
    return any(part.strip() == etag for part in header_value.split(","))


def _matches_if_modified_since(header_value: str, last_modified: datetime | None) -> bool:
    if not header_value or last_modified is None:
        return False
    try:
        parsed = parsedate_to_datetime(header_value)
    except (TypeError, ValueError, IndexError):
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    current = last_modified if last_modified.tzinfo else last_modified.replace(tzinfo=timezone.utc)
    return parsed >= current.astimezone(timezone.utc).replace(microsecond=0)


def public_json_response(
    request: Request,
    payload,
    *,
    cache_control: str | None = None,
    last_modified: datetime | None = None,
) -> Response:
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    etag = _compute_etag(content)
    headers = {
        "Cache-Control": cache_control or build_public_cache_control(),
        "ETag": etag,
        "Vary": "Accept-Encoding",
    }
    last_modified_value = _normalize_http_datetime(last_modified)
    if last_modified_value:
        headers["Last-Modified"] = last_modified_value

    if _matches_if_none_match(request.headers.get("if-none-match", ""), etag) or _matches_if_modified_since(
        request.headers.get("if-modified-since", ""),
        last_modified,
    ):
        return Response(status_code=304, headers=headers)

    return Response(content=content, media_type="application/json", headers=headers)


def public_text_response(
    request: Request,
    content: str,
    *,
    media_type: str,
    cache_control: str | None = None,
    last_modified: datetime | None = None,
) -> Response:
    content_bytes = content.encode("utf-8")
    etag = _compute_etag(content_bytes)
    headers = {
        "Cache-Control": cache_control or build_public_cache_control(),
        "ETag": etag,
        "Vary": "Accept-Encoding",
    }
    last_modified_value = _normalize_http_datetime(last_modified)
    if last_modified_value:
        headers["Last-Modified"] = last_modified_value

    if _matches_if_none_match(request.headers.get("if-none-match", ""), etag) or _matches_if_modified_since(
        request.headers.get("if-modified-since", ""),
        last_modified,
    ):
        return Response(status_code=304, headers=headers)

    return Response(content=content_bytes, media_type=media_type, headers=headers)

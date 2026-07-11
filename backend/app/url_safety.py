"""Shared URL / host safety checks for outbound fetches (proxy, cover download).

Keeps SSRF guards in one place so admin cover download and public /proxy-image
share the same private-IP / DNS-rebinding posture.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

# Raster-only: SVG can carry active content and must not be proxied/rehosted.
ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}
MAX_IMAGE_DOWNLOAD_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 3
REDIRECT_STATUSES = {301, 302, 303, 307, 308}

_BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
}


def is_blocked_ip(ip_value: str) -> bool:
    """Whether a resolved/connected IP must not be reached by outbound fetches."""
    try:
        ip = ipaddress.ip_address(ip_value)
    except ValueError:
        return True
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
    )


def is_private_hostname(hostname: str) -> bool:
    """Resolve hostname and reject if any address is non-public."""
    host = (hostname or "").strip().lower().rstrip(".")
    if not host:
        return True
    if host in _BLOCKED_HOSTNAMES or host.endswith(".local") or host.endswith(".internal"):
        return True
    # Literal IP hostnames (e.g. http://127.0.0.1/...) skip DNS.
    try:
        if is_blocked_ip(host):
            return True
        # Valid public literal IP — allow.
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass

    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return True

    for address in addresses:
        if is_blocked_ip(address[4][0]):
            return True
    return False


def is_public_http_url(url: str, *, resolve_dns: bool = True) -> bool:
    """True when URL is http(s) and the host is not an obvious private target.

    When ``resolve_dns`` is True (default, for live fetches), hostnames are DNS-
    resolved and private peers are rejected. When False, only scheme + literal
    private IPs / blocked hostnames are checked — suitable for validating
    stored image URLs that will not be fetched by the server.
    """
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        return False
    if host in _BLOCKED_HOSTNAMES or host.endswith(".local") or host.endswith(".internal"):
        return False
    # Literal IP: allow only public addresses.
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        return not is_blocked_ip(host)
    if not resolve_dns:
        return True
    return not is_private_hostname(host)


def connected_peer_ip(resp) -> str | None:
    """Best-effort peer IP from a live httpx response (DNS-rebinding guard)."""
    try:
        stream = resp.extensions.get("network_stream")
        if stream is None:
            return None
        addr = stream.get_extra_info("server_addr")
        if not addr:
            return None
        return addr[0]
    except Exception:
        return None


def download_public_image_bytes(
    image_url: str,
    *,
    user_agent: str = "AIBlogSafeImageFetch/1.0",
    timeout: float = 30.0,
    max_bytes: int = MAX_IMAGE_DOWNLOAD_BYTES,
) -> tuple[bytes, str]:
    """Download an image from a public http(s) URL with SSRF guards.

    - Rejects private/reserved hosts (pre-resolve + post-connect peer check)
    - Follows redirects only after re-validating each Location
    - Caps body size and restricts content-type to raster images
    """
    current_url = (image_url or "").strip()
    if not current_url:
        raise ValueError("empty image url")

    last_error: Exception | None = None
    with httpx.Client(
        follow_redirects=False,
        timeout=timeout,
        headers={"User-Agent": user_agent},
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            if not is_public_http_url(current_url, resolve_dns=True):
                raise ValueError("image url is not a public http(s) address")
            try:
                with client.stream("GET", current_url) as resp:
                    if resp.status_code in REDIRECT_STATUSES:
                        location = (resp.headers.get("location") or "").strip()
                        if not location:
                            raise ValueError("redirect without location")
                        # Absolute or relative redirect target
                        current_url = str(resp.url.join(location))
                        continue

                    peer_ip = connected_peer_ip(resp)
                    if peer_ip is not None and is_blocked_ip(peer_ip):
                        raise ValueError("connected peer is not a public address")

                    content_type = (
                        (resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
                    )
                    content_length = resp.headers.get("content-length")
                    if content_length:
                        try:
                            if int(content_length) > max_bytes:
                                raise ValueError("image too large")
                        except ValueError as exc:
                            if "image too large" in str(exc):
                                raise
                            raise ValueError("invalid content-length") from exc

                    if resp.status_code != 200:
                        raise ValueError(f"upstream http {resp.status_code}")
                    if content_type and content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
                        # Some CDNs omit content-type; allow empty and sniff later.
                        if content_type not in {"", "application/octet-stream"}:
                            raise ValueError(f"unsupported content-type: {content_type}")

                    chunks: list[bytes] = []
                    total = 0
                    for chunk in resp.iter_bytes():
                        total += len(chunk)
                        if total > max_bytes:
                            raise ValueError("image too large")
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    resolved_type = content_type if content_type in ALLOWED_IMAGE_CONTENT_TYPES else ""
                    return body, resolved_type or "image/png"
            except httpx.HTTPError as exc:
                last_error = exc
                break

    if last_error is not None:
        raise last_error
    raise ValueError("failed to download image")

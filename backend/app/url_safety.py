"""Shared URL / host safety checks for outbound fetches (proxy, cover download).

Keeps SSRF guards in one place so admin cover download and public /proxy-image
share the same private-IP / DNS-rebinding posture.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

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

# Kept in sync with BLOCKED_HOSTNAMES in scripts/lib/url-guard.mjs. Bare
# ``metadata`` is the short name cloud metadata services answer to on internal
# search domains; ``*.localhost`` is reserved for loopback by RFC 6761.
_BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
}
_BLOCKED_HOSTNAME_SUFFIXES = (".localhost", ".local", ".internal")


def normalize_hostname(hostname: str) -> str:
    """Lowercase a host and drop the FQDN trailing dot(s).

    ``localhost.`` and ``metadata.google.internal.`` resolve exactly like their
    dotless forms, so blocklists must compare against the normalized value.
    """
    return (hostname or "").strip().lower().rstrip(".")


def is_blocked_hostname(hostname: str) -> bool:
    """Whether a host name is on the never-fetch list. Normalizes first."""
    host = normalize_hostname(hostname)
    if not host:
        return True
    return host in _BLOCKED_HOSTNAMES or host.endswith(_BLOCKED_HOSTNAME_SUFFIXES)


@dataclass(frozen=True)
class PinnedHttpTarget:
    """A request target whose network destination has already been validated.

    ``fetch_url`` uses a literal public IP, while ``host_header`` and
    ``sni_hostname`` preserve virtual-host routing and TLS certificate checks.
    This removes the second DNS lookup that otherwise creates a rebinding gap.
    """

    fetch_url: str
    host_header: str
    sni_hostname: str | None


def is_blocked_ip(ip_value: str) -> bool:
    """Whether a resolved/connected IP must not be reached by outbound fetches."""
    try:
        ip = ipaddress.ip_address(ip_value)
    except ValueError:
        return True
    # ``is_global`` is the catch-all: it also rejects IANA special-purpose ranges
    # the narrower flags miss, notably RFC 6598 shared address space
    # (100.64.0.0/10), which Python 3.13 stopped reporting as ``is_private``, plus
    # 6to4/Teredo tunnel prefixes that embed a reachable inner address.
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
        or not ip.is_global
    )


def is_private_hostname(hostname: str) -> bool:
    """Resolve hostname and reject if any address is non-public."""
    return not resolve_public_host_addresses(hostname)


def resolve_public_host_addresses(hostname: str, port: int | None = None) -> tuple[str, ...]:
    """Resolve a host to a stable, public-only set of destination addresses.

    If *any* answer is private/reserved, fail closed. Mixed public/private DNS
    answers are unsafe because a later resolver choice could otherwise reach a
    private service.
    """
    host = normalize_hostname(hostname)
    if not host or is_blocked_hostname(host):
        return ()
    # Literal IP hostnames (e.g. http://127.0.0.1/...) skip DNS.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        return () if is_blocked_ip(str(literal)) else (str(literal),)

    # gaierror subclasses OSError. UnicodeError comes out of getaddrinfo's IDNA
    # encoding for hosts with an empty ("a..b") or over-long label.
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError, ValueError):
        return ()

    resolved: set[str] = set()
    for address in addresses:
        candidate = address[4][0].split("%", 1)[0]
        if is_blocked_ip(candidate):
            return ()
        resolved.add(str(ipaddress.ip_address(candidate)))
    # Prefer IPv4 where both families are available. Many deployment egress
    # networks still do not provide IPv6, while the security posture is equal.
    return tuple(sorted(resolved, key=lambda value: (ipaddress.ip_address(value).version, value)))


def build_pinned_http_targets(url: str) -> tuple[PinnedHttpTarget, ...]:
    """Validate an HTTP(S) URL and pin requests to its public DNS answers.

    Never raises: any parse failure (``urlparse`` rejecting a malformed IPv6
    literal, ``httpx.URL`` rejecting bad percent-encoding, ...) is reported as
    "no reachable target" so callers answer 400 instead of leaking a 500.
    """
    try:
        return _build_pinned_http_targets(url)
    except Exception:
        return ()


def _build_pinned_http_targets(url: str) -> tuple[PinnedHttpTarget, ...]:
    raw_url = (url or "").strip()
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ()
    # Credentials in proxy URLs are unnecessary and can create confusing Host
    # or redirect semantics. Reject them instead of forwarding secrets.
    if parsed.username is not None or parsed.password is not None:
        return ()
    try:
        port = parsed.port
    except ValueError:
        return ()

    host = normalize_hostname(parsed.hostname)
    addresses = resolve_public_host_addresses(host, port)
    if not addresses:
        return ()

    # httpx.InvalidURL derives straight from Exception, not ValueError.
    try:
        normalized_url = httpx.URL(raw_url)
    except (TypeError, ValueError, httpx.InvalidURL):
        return ()
    ascii_host = normalized_url.raw_host.decode("ascii")

    try:
        host_ip: ipaddress.IPv4Address | ipaddress.IPv6Address | None = ipaddress.ip_address(host)
    except ValueError:
        host_ip = None
    host_for_header = f"[{ascii_host}]" if host_ip is not None and host_ip.version == 6 else ascii_host
    if port is not None and port != (443 if parsed.scheme == "https" else 80):
        host_for_header = f"{host_for_header}:{port}"

    # RFC 6066: server_name carries a DNS host name, never a literal address.
    sni_hostname = ascii_host if parsed.scheme == "https" and host_ip is None else None
    return tuple(
        PinnedHttpTarget(
            fetch_url=str(normalized_url.copy_with(host=address)),
            host_header=host_for_header,
            sni_hostname=sni_hostname,
        )
        for address in addresses
    )


def sniff_raster_image_content_type(body: bytes) -> str | None:
    """Identify the allowed raster formats by signature, never by extension."""
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(body) >= 12 and body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    return None


def is_public_http_url(url: str, *, resolve_dns: bool = True) -> bool:
    """True when URL is http(s) and the host is not an obvious private target.

    When ``resolve_dns`` is True (default, for live fetches), hostnames are DNS-
    resolved and private peers are rejected. When False, only scheme + literal
    private IPs / blocked hostnames are checked — suitable for validating
    stored image URLs that will not be fetched by the server.
    """
    # urlparse raises on malformed IPv6 literals ("http://ex[ample.com:1/").
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    host = normalize_hostname(parsed.hostname or "")
    if not host or is_blocked_hostname(host):
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


def download_public_image_bytes(
    image_url: str,
    *,
    user_agent: str = "AIBlogSafeImageFetch/1.0",
    timeout: float = 30.0,
    max_bytes: int = MAX_IMAGE_DOWNLOAD_BYTES,
) -> tuple[bytes, str]:
    """Download an image from a public http(s) URL with SSRF guards.

    - Rejects private/reserved hosts and pins the connection to a DNS answer
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
        # The pool origin is the pinned IP. Avoid reusing a connection if a
        # cross-host redirect resolves to the same CDN address with different SNI.
        limits=httpx.Limits(max_keepalive_connections=0),
        trust_env=False,
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            targets = build_pinned_http_targets(current_url)
            if not targets:
                raise ValueError("image url is not a public http(s) address")
            redirect_url: str | None = None
            for target in targets:
                try:
                    extensions = (
                        {"sni_hostname": target.sni_hostname} if target.sni_hostname else None
                    )
                    with client.stream(
                        "GET",
                        target.fetch_url,
                        headers={"Host": target.host_header},
                        extensions=extensions,
                    ) as resp:
                        if resp.status_code in REDIRECT_STATUSES:
                            location = (resp.headers.get("location") or "").strip()
                            if not location:
                                raise ValueError("redirect without location")
                            redirect_url = urljoin(current_url, location)
                            break

                        content_type = (
                            (resp.headers.get("content-type") or "")
                            .split(";", 1)[0]
                            .strip()
                            .lower()
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
                        if content_type not in ALLOWED_IMAGE_CONTENT_TYPES | {
                            "",
                            "application/octet-stream",
                        }:
                            raise ValueError(f"unsupported content-type: {content_type}")

                        chunks: list[bytes] = []
                        total = 0
                        for chunk in resp.iter_bytes():
                            total += len(chunk)
                            if total > max_bytes:
                                raise ValueError("image too large")
                            chunks.append(chunk)
                        body = b"".join(chunks)
                        resolved_type = sniff_raster_image_content_type(body)
                        if resolved_type is None:
                            raise ValueError("response body is not a supported raster image")
                        return body, resolved_type
                except httpx.HTTPError as exc:
                    last_error = exc
                    continue
            if redirect_url is not None:
                current_url = redirect_url
                continue
            break

    if last_error is not None:
        raise last_error
    raise ValueError("failed to download image")

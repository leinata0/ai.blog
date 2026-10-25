"""Build reversible, content-addressed WebP derivatives of public blog images.

Optional maintenance tool (Python + Pillow); it never mutates originals or the DB.
Generated assets travel with a Vercel deployment, so rolling back that deployment
also rolls back the manifest. Future posts absent from the manifest keep originals.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import time
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = "https://www.563118077.xyz"
ALLOWED_HOSTS = {"www.563118077.xyz", "563118077.xyz", "img.563118077.xyz", "ai-blog-hbur.onrender.com"}
MAX_BYTES = 12 * 1024 * 1024
WIDTHS = (480, 960, 1600, 2400)
ENCODER_VERSION = b"webp-q82-m6-alpha100-v1"


class TrustedRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        canonical_url(new_url)  # Validate before urllib follows the redirect.
        return super().redirect_request(request, response, code, message, headers, new_url)


def canonical_url(value: str) -> str:
    url = urljoin(CANONICAL, value.strip())
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.username or parsed.password:
        raise ValueError("Image URL must use an approved public HTTPS host")
    return url


def download(url: str, *, timeout: float = 25, limit: int = MAX_BYTES) -> bytes:
    url = canonical_url(url)
    request = Request(url, headers={"User-Agent": "ai-blog-public-image-optimizer/1.0"})
    with build_opener(TrustedRedirects()).open(request, timeout=timeout) as response:
        canonical_url(response.url)  # Reject an unexpected redirected host too.
        size = response.headers.get("Content-Length")
        if size and int(size) > limit:
            raise ValueError("Response exceeds the size limit")
        chunks, total = [], 0
        deadline = time.monotonic() + timeout
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError("Image response exceeded its transfer deadline")
            chunk = response.read(min(65536, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > limit:
                raise ValueError("Response exceeds the size limit")
        return b"".join(chunks)


def encode_variants(contents: bytes, output: Path) -> dict:
    """No cropping/upscaling; preserve aspect ratio, orientation and alpha."""
    with Image.open(BytesIO(contents)) as source:
        if getattr(source, "is_animated", False):
            raise ValueError("Animated images retain their original URL")
        if source.width * source.height > 40_000_000:
            raise ValueError("Image dimensions exceed the decoding limit")
        image = ImageOps.exif_transpose(source)
        image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
    width, height = image.size
    identity = sha256(contents + ENCODER_VERSION).hexdigest()[:24]
    sizes = sorted({value for value in WIDTHS if value < width} | {min(width, WIDTHS[-1])})
    variants = []
    for target_width in sizes:
        target_height = max(1, round(height * target_width / width))
        resized = image.resize((target_width, target_height), Image.Resampling.LANCZOS) if target_width != width else image
        encoded = BytesIO()
        resized.save(encoded, "WEBP", quality=82, method=6, alpha_quality=100, exact=True)
        payload = encoded.getvalue()
        filename = f"{identity}-{target_width}.webp"
        output.mkdir(parents=True, exist_ok=True)
        destination = output / filename
        if destination.exists() and destination.read_bytes() != payload:
            raise ValueError("Immutable derivative collision; bump encoder version")
        destination.write_bytes(payload)
        variants.append({"url": f"/performance-images/{filename}", "width": target_width, "height": target_height, "bytes": len(payload), "format": "webp"})
    return {"width": width, "height": height, "variants": variants}


def collect_cover_urls(payload) -> set[str]:
    urls = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key == "cover_image" and isinstance(value, str) and value.strip():
                try:
                    urls.add(canonical_url(value))
                except ValueError:
                    pass  # Never fetch an arbitrary publisher URL from content.
            elif isinstance(value, (dict, list)):
                urls.update(collect_cover_urls(value))
    elif isinstance(payload, list):
        for item in payload:
            urls.update(collect_cover_urls(item))
    return urls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="https://ai-blog-hbur.onrender.com")
    parser.add_argument("--output", type=Path, default=ROOT / "frontend/public/performance-images")
    parser.add_argument("--manifest", type=Path, default=ROOT / "frontend/src/data/image-variants.json")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    urls = set()
    endpoints = (
        "/api/discover?content_type=daily_brief&sections=items,total&limit=24",
        "/api/discover?content_type=weekly_review&sections=items,total&limit=24",
        "/api/topics?limit=24",
        "/api/series?limit=24",
    )
    for endpoint in endpoints:
        try:
            payload = json.loads(download(args.api_base.rstrip("/") + endpoint))
            urls.update(collect_cover_urls(payload))
        except Exception as error:
            print(f"Source skipped: {endpoint}: {type(error).__name__}", flush=True)
    local_sources = {
        canonical_url("/images/renaissance-edition/figures.png"): ROOT / "frontend/public/images/renaissance-edition/figures.png",
        canonical_url("/images/renaissance-edition/world.jpg"): ROOT / "frontend/public/images/renaissance-edition/world.jpg",
    }
    urls.update(local_sources)
    originals = 0
    manifest = {"version": 1, "images": {}}

    def process(url):
        contents = local_sources[url].read_bytes() if url in local_sources else download(url)
        return url, len(contents), encode_variants(contents, args.output)

    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 3))) as executor:
        futures = {executor.submit(process, url): url for url in sorted(urls)}
        for future in as_completed(futures):
            try:
                url, original_bytes, record = future.result()
                manifest["images"][url] = record
                originals += original_bytes
                print(f"Optimized {len(manifest['images'])}/{len(urls)}: {original_bytes} -> {record['variants'][-1]['bytes']} bytes", flush=True)
            except Exception as error:
                print(f"Image skipped: {futures[future]}: {type(error).__name__}", flush=True)
    manifest["images"] = dict(sorted(manifest["images"].items()))
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    largest = sum(record["variants"][-1]["bytes"] for record in manifest["images"].values())
    print(json.dumps({"mapped_images": len(manifest["images"]), "original_bytes": originals, "largest_variant_bytes": largest, "manifest": str(args.manifest)}), flush=True)


if __name__ == "__main__":
    main()

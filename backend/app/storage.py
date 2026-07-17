import os
from dataclasses import dataclass
from mimetypes import guess_extension
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
except ImportError:  # pragma: no cover - dependency is installed in production
    boto3 = None
    Config = None

    class ClientError(Exception):
        pass

from app.env import clean_env, is_production_env
from app.uploads import UPLOADS_URL_PREFIX, get_uploads_dir

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"}
R2_REQUIRED_ENV_VARS = (
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL",
)

# Shared image-upload validation (used by admin uploads and visitor avatars).
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_UPLOAD_TYPES = {
    "image/jpeg": (".jpg", ".jpeg"),
    "image/png": (".png",),
    "image/gif": (".gif",),
    "image/webp": (".webp",),
}


class ImageValidationError(ValueError):
    """Raised when an uploaded file fails image validation."""


def detect_image_content_type(contents: bytes) -> str | None:
    if contents.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if contents.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if contents.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(contents) >= 12 and contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_image_upload(
    filename: str,
    declared_content_type: str,
    contents: bytes,
    *,
    max_size: int = MAX_UPLOAD_SIZE,
) -> str:
    """Validate filename/declared type/magic-bytes/size; return the detected type.

    Raises ImageValidationError with a human-readable message on any failure.
    """
    if not filename:
        raise ImageValidationError("Missing filename")
    declared = (declared_content_type or "").split(";", 1)[0].strip().lower()
    if declared not in ALLOWED_UPLOAD_TYPES:
        raise ImageValidationError("Only image uploads are allowed")
    if len(contents) > max_size:
        mb = max_size // (1024 * 1024)
        raise ImageValidationError(f"File size must be {mb}MB or less")
    detected = detect_image_content_type(contents)
    if detected not in ALLOWED_UPLOAD_TYPES:
        raise ImageValidationError("Unsupported image file")
    if not filename.lower().endswith(ALLOWED_UPLOAD_TYPES[detected]):
        raise ImageValidationError("Image extension does not match file content")
    return detected


@dataclass
class StoredImage:
    filename: str
    url: str
    size: int
    content_type: str


def _clean_env(name: str) -> str:
    return clean_env(name)


def _normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def _safe_filename(filename: str) -> str:
    candidate = Path(filename).name
    if not candidate or candidate in {".", ".."} or candidate != filename:
        raise ValueError("invalid filename")
    return candidate


def _extension_from_content_type(content_type: str) -> str:
    if not content_type:
        return ""

    normalized = content_type.split(";")[0].strip().lower()
    overrides = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/bmp": ".bmp",
    }
    if normalized in overrides:
        return overrides[normalized]

    guessed = guess_extension(normalized) or ""
    if guessed == ".jpe":
        return ".jpg"
    return guessed


def _build_generated_name(filename: str, content_type: str = "") -> str:
    extension = Path(filename).suffix.lower()
    if not extension or len(extension) > 10:
        extension = _extension_from_content_type(content_type)
    safe_extension = extension if extension and len(extension) <= 10 else ""
    return f"{uuid4().hex}{safe_extension}"


def _looks_like_image_key(key: str) -> bool:
    suffix = Path(key).suffix.lower()
    if suffix:
        return suffix in IMAGE_EXTENSIONS
    return True


def get_r2_bucket_name() -> str:
    return _clean_env("R2_BUCKET_NAME")


def get_r2_endpoint() -> str:
    explicit = _normalize_base_url(_clean_env("R2_ENDPOINT"))
    if explicit:
        return explicit

    account_id = _clean_env("R2_ACCOUNT_ID")
    if account_id:
        return f"https://{account_id}.r2.cloudflarestorage.com"
    return ""


def get_r2_public_base_url() -> str:
    return _normalize_base_url(_clean_env("R2_PUBLIC_BASE_URL"))


def get_missing_r2_configuration() -> tuple[str, ...]:
    missing = [name for name in R2_REQUIRED_ENV_VARS if not _clean_env(name)]
    if not get_r2_endpoint():
        missing.append("R2_ENDPOINT or R2_ACCOUNT_ID")
    return tuple(missing)


def is_r2_enabled() -> bool:
    return not get_missing_r2_configuration()


def is_durable_storage_required() -> bool:
    is_render_runtime = bool(_clean_env("RENDER") or _clean_env("RENDER_SERVICE_ID"))
    return is_production_env() or is_render_runtime


def ephemeral_uploads_allowed() -> bool:
    return _clean_env("ALLOW_EPHEMERAL_UPLOADS") == "1"


def validate_storage_configuration() -> None:
    if is_r2_enabled() or not is_durable_storage_required() or ephemeral_uploads_allowed():
        return

    missing = ", ".join(get_missing_r2_configuration())
    raise RuntimeError(
        "Durable R2 storage is required in production and on Render, but the "
        f"configuration is incomplete (missing: {missing}). Configure R2 or set "
        "ALLOW_EPHEMERAL_UPLOADS=1 to explicitly accept ephemeral local uploads."
    )


def build_storage_url(filename: str) -> str:
    safe_name = _safe_filename(filename)
    public_base = get_r2_public_base_url()
    if is_r2_enabled() and public_base:
        return f"{public_base}/{quote(safe_name)}"
    return f"{UPLOADS_URL_PREFIX}/{quote(safe_name)}"


def build_r2_client(*, request_timeout_seconds: float | None = None):
    endpoint = get_r2_endpoint()
    if not endpoint:
        raise RuntimeError("Missing R2 endpoint")
    if boto3 is None or Config is None:
        raise RuntimeError("boto3 is required for R2 storage")

    config_options = {"signature_version": "s3v4"}
    if request_timeout_seconds is not None:
        config_options.update(
            {
                "connect_timeout": request_timeout_seconds,
                "read_timeout": request_timeout_seconds,
                "retries": {"total_max_attempts": 1, "mode": "standard"},
            }
        )

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=_clean_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_clean_env("R2_SECRET_ACCESS_KEY"),
        region_name=_clean_env("R2_REGION") or "auto",
        config=Config(**config_options),
    )


def _local_upload_path(filename: str) -> Path:
    safe_name = _safe_filename(filename)
    return get_uploads_dir() / safe_name


def ensure_local_upload_dir() -> None:
    get_uploads_dir().mkdir(parents=True, exist_ok=True)


def check_storage_readiness(*, request_timeout_seconds: float = 1.0) -> None:
    validate_storage_configuration()

    if is_r2_enabled():
        client = build_r2_client(request_timeout_seconds=request_timeout_seconds)
        client.head_bucket(Bucket=get_r2_bucket_name())
        return

    uploads_dir = get_uploads_dir()
    if not uploads_dir.is_dir() or not os.access(uploads_dir, os.W_OK):
        raise RuntimeError(f"Local uploads directory is not writable: {uploads_dir}")


def save_upload(filename: str, contents: bytes, content_type: str = "") -> StoredImage:
    target_name = _build_generated_name(filename, content_type)
    effective_type = content_type or "application/octet-stream"

    if is_r2_enabled():
        client = build_r2_client()
        client.put_object(
            Bucket=get_r2_bucket_name(),
            Key=target_name,
            Body=contents,
            ContentType=effective_type,
            CacheControl="public, max-age=31536000, immutable",
        )
        return StoredImage(
            filename=target_name,
            url=build_storage_url(target_name),
            size=len(contents),
            content_type=effective_type,
        )

    ensure_local_upload_dir()
    target_path = _local_upload_path(target_name)
    with target_path.open("wb") as buffer:
        buffer.write(contents)
    return StoredImage(
        filename=target_name,
        url=build_storage_url(target_name),
        size=len(contents),
        content_type=effective_type,
    )


def list_uploaded_images() -> list[dict]:
    if is_r2_enabled():
        client = build_r2_client()
        items = []
        continuation_token = None

        while True:
            params = {"Bucket": get_r2_bucket_name(), "MaxKeys": 1000}
            if continuation_token:
                params["ContinuationToken"] = continuation_token
            response = client.list_objects_v2(**params)
            for obj in response.get("Contents", []):
                key = obj.get("Key", "")
                if not _looks_like_image_key(key):
                    continue
                items.append({
                    "filename": key,
                    "url": build_storage_url(key),
                    "size": obj.get("Size", 0),
                })
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")

        return items

    uploads_dir = get_uploads_dir()
    if not uploads_dir.exists():
        return []

    images = []
    for file_path in sorted(uploads_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if file_path.is_file() and _looks_like_image_key(file_path.name):
            images.append({
                "filename": file_path.name,
                "url": build_storage_url(file_path.name),
                "size": file_path.stat().st_size,
            })
    return images


def delete_uploaded_image(filename: str) -> None:
    safe_name = _safe_filename(filename)

    if is_r2_enabled():
        client = build_r2_client()
        try:
            client.head_object(Bucket=get_r2_bucket_name(), Key=safe_name)
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status == 404:
                raise FileNotFoundError(safe_name) from exc
            raise
        client.delete_object(Bucket=get_r2_bucket_name(), Key=safe_name)
        return

    target = _local_upload_path(safe_name)
    if not target.exists():
        raise FileNotFoundError(safe_name)
    target.unlink()


def get_uploaded_image_bytes(filename: str) -> tuple[bytes, str]:
    safe_name = _safe_filename(filename)

    if is_r2_enabled():
        client = build_r2_client()
        response = client.get_object(Bucket=get_r2_bucket_name(), Key=safe_name)
        content_type = response.get("ContentType") or "application/octet-stream"
        return response["Body"].read(), content_type

    target = _local_upload_path(safe_name)
    if not target.exists():
        raise FileNotFoundError(safe_name)
    return target.read_bytes(), ""

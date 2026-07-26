import pytest

from app import storage as storage_mod


R2_ENV_NAMES = (
    "R2_ACCOUNT_ID",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL",
    "ALLOW_EPHEMERAL_UPLOADS",
)


@pytest.fixture(autouse=True)
def _clear_storage_env(monkeypatch):
    for name in R2_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def _configure_r2(monkeypatch):
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-id")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "access-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret-key")
    monkeypatch.setenv("R2_BUCKET_NAME", "uploads")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://images.example.test")


def test_build_generated_name_uses_content_type_extension_when_missing():
    generated = storage_mod._build_generated_name("image", "image/png")
    assert generated.endswith(".png")


def test_list_uploaded_images_skips_extensionless_keys(upload_dir):
    """A shared bucket holds non-image objects; the media library only lists images."""
    (upload_dir / "image-without-extension").write_bytes(b"image-bytes")
    (upload_dir / "real.png").write_bytes(b"\x89PNG\r\n\x1a\nimage-bytes")

    images = storage_mod.list_uploaded_images()
    filenames = {image["filename"] for image in images}

    assert "real.png" in filenames
    assert "image-without-extension" not in filenames


def test_list_uploaded_images_page_is_bounded_and_pages_locally(upload_dir):
    for index in range(5):
        (upload_dir / f"img-{index}.png").write_bytes(b"x" * (index + 1))

    first, next_cursor = storage_mod.list_uploaded_images_page(limit=2)

    assert len(first) == 2
    assert next_cursor == "2"

    second, second_cursor = storage_mod.list_uploaded_images_page(limit=2, cursor=next_cursor)
    assert len(second) == 2
    assert second_cursor == "4"
    assert {item["filename"] for item in first}.isdisjoint({item["filename"] for item in second})

    last, last_cursor = storage_mod.list_uploaded_images_page(limit=2, cursor=second_cursor)
    assert len(last) == 1
    assert last_cursor == ""


def test_local_read_returns_a_usable_content_type(upload_dir):
    (upload_dir / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\nimage-bytes")

    contents, content_type = storage_mod.get_uploaded_image_bytes("photo.png")

    assert contents.startswith(b"\x89PNG")
    # An empty type used to fall back to application/octet-stream and browsers
    # refused to render the image.
    assert content_type == "image/png"


def test_missing_local_file_raises_file_not_found(upload_dir):
    with pytest.raises(FileNotFoundError):
        storage_mod.get_uploaded_image_bytes("missing.png")


def test_missing_r2_object_raises_file_not_found_not_client_error(monkeypatch):
    """`/uploads/{name}` is public: a bogus key must be a 404, not a 500 + stack trace."""
    _configure_r2(monkeypatch)

    class _FakeClient:
        def get_object(self, **kwargs):
            raise storage_mod.ClientError(
                {"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
                "GetObject",
            )

    monkeypatch.setattr(storage_mod, "build_r2_client", lambda **_kwargs: _FakeClient())

    with pytest.raises(FileNotFoundError):
        storage_mod.get_uploaded_image_bytes("missing.png")


def test_r2_calls_use_explicit_timeouts(monkeypatch):
    """Public and admin request threads must never inherit botocore's 60s defaults."""
    _configure_r2(monkeypatch)
    seen = []

    class _FakeClient:
        def get_object(self, **kwargs):
            return {"Body": _FakeBody(), "ContentType": "image/png"}

        def put_object(self, **kwargs):
            return None

        def list_objects_v2(self, **kwargs):
            return {"Contents": [], "IsTruncated": False}

    class _FakeBody:
        def read(self):
            return b"bytes"

    def _fake_builder(**kwargs):
        seen.append(kwargs)
        return _FakeClient()

    monkeypatch.setattr(storage_mod, "build_r2_client", _fake_builder)

    storage_mod.get_uploaded_image_bytes("photo.png")
    storage_mod.save_upload("photo.png", b"bytes", "image/png")
    storage_mod.list_uploaded_images()

    assert seen
    assert all(call.get("request_timeout_seconds") for call in seen)


def test_production_rejects_incomplete_r2_configuration(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("R2_BUCKET_NAME", "uploads")

    with pytest.raises(RuntimeError, match="ALLOW_EPHEMERAL_UPLOADS=1") as exc_info:
        storage_mod.validate_storage_configuration()

    assert "R2_PUBLIC_BASE_URL" in str(exc_info.value)
    assert "R2_ENDPOINT or R2_ACCOUNT_ID" in str(exc_info.value)


def test_render_rejects_local_storage_even_when_app_env_says_development(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("RENDER", "true")

    with pytest.raises(RuntimeError, match="Durable R2 storage is required"):
        storage_mod.validate_storage_configuration()


def test_production_allows_explicit_ephemeral_upload_opt_in(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_EPHEMERAL_UPLOADS", "1")

    storage_mod.validate_storage_configuration()


def test_complete_r2_configuration_is_ready_via_read_only_bucket_check(monkeypatch):
    _configure_r2(monkeypatch)
    calls = []

    class _FakeClient:
        def head_bucket(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr(
        storage_mod,
        "build_r2_client",
        lambda *, request_timeout_seconds=None: _FakeClient(),
    )

    storage_mod.check_storage_readiness(request_timeout_seconds=0.5)

    assert calls == [{"Bucket": "uploads"}]

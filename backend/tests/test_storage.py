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


def test_list_uploaded_images_keeps_extensionless_files(upload_dir):
    file_path = upload_dir / "image-without-extension"
    file_path.write_bytes(b"image-bytes")

    images = storage_mod.list_uploaded_images()

    assert any(image["filename"] == "image-without-extension" for image in images)


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

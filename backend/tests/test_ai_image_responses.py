import base64

import pytest

from app.services import ai_channels


PNG_BYTES = b"\x89PNG\r\n\x1a\nminimal-image"


def test_extract_generated_image_keeps_url_response():
    payload = {"data": [{"url": "https://images.example.test/generated.png"}]}

    assert ai_channels._extract_generated_image(payload) == "https://images.example.test/generated.png"


def test_extract_generated_image_accepts_nested_compatibility_response():
    payload = {"output": {"result": {"image_url": "https://images.example.test/nested.png"}}}

    assert ai_channels._extract_generated_image(payload) == "https://images.example.test/nested.png"


def test_response_body_image_wins_over_upstream_503():
    class FakeResponse:
        status_code = 503
        text = '{"data":[{"url":"https://images.example.test/paid-result.png"}]}'

        def json(self):
            return {"data": [{"url": "https://images.example.test/paid-result.png"}]}

    original_post = ai_channels.httpx.post
    try:
        ai_channels.httpx.post = lambda *args, **kwargs: FakeResponse()
        channel = ai_channels.ResolvedAiChannel(
            purpose=ai_channels.IMAGE_PURPOSE,
            provider="openai_compatible",
            base_url="https://images.example.test/v1",
            model="image-model",
            api_key="sk-test",
            api_key_env_var="",
            api_key_source="inline",
            enabled=True,
            db_configured=True,
        )
        assert ai_channels._generate_image_from_channel(channel, "test prompt") == "https://images.example.test/paid-result.png"
    finally:
        ai_channels.httpx.post = original_post


def test_response_body_detail_is_preserved_for_503():
    class FakeResponse:
        status_code = 503
        text = '{"error":{"message":"provider overloaded"}}'

        def json(self):
            return {"error": {"message": "provider overloaded"}}

    original_post = ai_channels.httpx.post
    try:
        ai_channels.httpx.post = lambda *args, **kwargs: FakeResponse()
        channel = ai_channels.ResolvedAiChannel(
            purpose=ai_channels.IMAGE_PURPOSE,
            provider="openai_compatible",
            base_url="https://images.example.test/v1",
            model="image-model",
            api_key="sk-test",
            api_key_env_var="",
            api_key_source="inline",
            enabled=True,
            db_configured=True,
        )
        with pytest.raises(ai_channels.AiChannelError, match="provider overloaded"):
            ai_channels._generate_image_from_channel(channel, "test prompt")
    finally:
        ai_channels.httpx.post = original_post


def test_extract_generated_image_accepts_openai_base64_response():
    from app.routers import admin as admin_router

    encoded = base64.b64encode(PNG_BYTES).decode("ascii")

    result = ai_channels._extract_generated_image({"data": [{"b64_json": encoded}]})

    assert result == f"data:image/png;base64,{encoded}"
    contents, content_type = admin_router._download_image_bytes(result)
    assert contents == PNG_BYTES
    assert content_type == "image/png"


def test_download_generated_image_rejects_invalid_base64():
    from app.routers import admin as admin_router

    with pytest.raises(admin_router.CoverGenerationError, match="base64"):
        admin_router._download_image_bytes("data:image/png;base64,not-valid***")

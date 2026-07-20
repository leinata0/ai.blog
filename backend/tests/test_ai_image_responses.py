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
        with pytest.raises(ai_channels.AiChannelError, match="provider overloaded") as exc_info:
            ai_channels._generate_image_from_channel(channel, "test prompt")
        assert exc_info.value.allow_failover is False
    finally:
        ai_channels.httpx.post = original_post


def test_image_generation_retries_connect_failure_without_changing_idempotency_key(monkeypatch):
    calls = []

    class FakeResponse:
        status_code = 200
        text = '{"data":[{"url":"https://images.example.test/recovered.png"}]}'

        def json(self):
            return {"data": [{"url": "https://images.example.test/recovered.png"}]}

    def fake_post(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise ai_channels.httpx.ConnectError("temporary connect failure")
        return FakeResponse()

    monkeypatch.setattr(ai_channels.httpx, "post", fake_post)
    monkeypatch.setattr(ai_channels.time, "sleep", lambda _seconds: None)
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

    result = ai_channels._generate_image_from_channel(channel, "test prompt")

    assert result == "https://images.example.test/recovered.png"
    assert len(calls) == 2
    assert calls[0]["headers"]["Idempotency-Key"] == calls[1]["headers"]["Idempotency-Key"]
    assert calls[1]["timeout"].read == ai_channels.DEFAULT_IMAGE_GENERATION_TIMEOUT_SECONDS


def test_image_generation_read_timeout_is_not_resubmitted(monkeypatch):
    calls = []

    def fake_post(*args, **kwargs):
        calls.append((args, kwargs))
        raise ai_channels.httpx.ReadTimeout("slow image generation")

    monkeypatch.setattr(ai_channels.httpx, "post", fake_post)
    channel = ai_channels.ResolvedAiChannel(
        purpose=ai_channels.IMAGE_PURPOSE,
        provider="openai_compatible",
        base_url="https://images.example.test",
        model="image-model",
        api_key="sk-test",
        api_key_env_var="",
        api_key_source="inline",
        enabled=True,
        db_configured=True,
    )

    with pytest.raises(ai_channels.AiChannelError) as exc_info:
        ai_channels._generate_image_from_channel(channel, "test prompt")

    assert exc_info.value.code == "generation_timeout"
    assert exc_info.value.allow_failover is False
    assert "避免重复扣费" in exc_info.value.message
    assert len(calls) == 1


def test_provider_plan_stops_after_ambiguous_billable_failure(monkeypatch):
    from app.services import ai_provider_manager

    providers = [
        ai_provider_manager.ResolvedModelProvider(
            instance_id=index,
            source_id=index,
            purpose=ai_channels.IMAGE_PURPOSE,
            name=f"image-{index}",
            source_name=f"source-{index}",
            provider="openai_compatible",
            protocol="openai",
            base_url=f"https://images-{index}.example.test/v1",
            model="image-model",
            api_key="sk-test",
            api_key_env_var="",
            api_key_source="db",
            priority=index,
            is_default=index == 1,
            enabled=True,
        )
        for index in (1, 2)
    ]
    monkeypatch.setattr(ai_provider_manager, "resolve_runtime_plan", lambda _db, _purpose: providers)
    calls = []

    def runner(channel):
        calls.append(channel.base_url)
        raise ai_channels.AiChannelError(
            "generation_connection_lost",
            "request may already be billed",
            allow_failover=False,
        )

    with pytest.raises(ai_channels.AiChannelError) as exc_info:
        ai_provider_manager.run_generation(None, ai_channels.IMAGE_PURPOSE, runner)

    assert exc_info.value.code == "generation_connection_lost"
    assert len(calls) == 1
    assert len(exc_info.value.attempts) == 1


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

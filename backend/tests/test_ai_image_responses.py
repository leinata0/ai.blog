import base64

import pytest

from app.routers import admin as admin_router
from app.services import ai_channels


PNG_BYTES = b"\x89PNG\r\n\x1a\nminimal-image"


def test_extract_generated_image_keeps_url_response():
    payload = {"data": [{"url": "https://images.example.test/generated.png"}]}

    assert ai_channels._extract_generated_image(payload) == "https://images.example.test/generated.png"


def test_extract_generated_image_accepts_openai_base64_response():
    encoded = base64.b64encode(PNG_BYTES).decode("ascii")

    result = ai_channels._extract_generated_image({"data": [{"b64_json": encoded}]})

    assert result == f"data:image/png;base64,{encoded}"
    contents, content_type = admin_router._download_image_bytes(result)
    assert contents == PNG_BYTES
    assert content_type == "image/png"


def test_download_generated_image_rejects_invalid_base64():
    with pytest.raises(admin_router.CoverGenerationError, match="base64"):
        admin_router._download_image_bytes("data:image/png;base64,not-valid***")

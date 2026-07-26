"""The art-direction config must be found in the container, and loudly missed.

The backend image only ships `backend/`, so the repo-relative path resolved to
`/scripts/config/...` in production and the OSError was swallowed — the cover
system silently ran on built-in defaults (no brand palette, no presets, no
negative rules) with nothing in the logs.
"""

import json
import logging

from app.services import cover_art as cover_art_service


def _reload_config():
    cover_art_service.load_cover_art_config.cache_clear()
    return cover_art_service.load_cover_art_config()


def test_repository_config_is_resolved_by_default(monkeypatch):
    monkeypatch.delenv("AUTO_BLOG_CONFIG_DIR", raising=False)
    cover_art_service.load_cover_art_config.cache_clear()

    resolved = cover_art_service.resolve_cover_art_config_path()

    assert resolved is not None
    assert resolved.name == "cover-art-direction.json"
    config = _reload_config()
    assert config["brand_palette"]
    assert config["presets"]


def test_explicit_config_dir_wins(tmp_path, monkeypatch):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "cover-art-direction.json").write_text(
        json.dumps({"version": "test-override", "brand_palette": ["#123456"]}),
        encoding="utf-8",
    )
    monkeypatch.setenv("AUTO_BLOG_CONFIG_DIR", str(config_dir))

    try:
        config = _reload_config()
        assert config["version"] == "test-override"
        assert config["brand_palette"] == ["#123456"]
    finally:
        monkeypatch.delenv("AUTO_BLOG_CONFIG_DIR", raising=False)
        cover_art_service.load_cover_art_config.cache_clear()


def test_missing_config_is_logged_before_falling_back(monkeypatch, caplog):
    monkeypatch.setenv("AUTO_BLOG_CONFIG_DIR", "/definitely/not/a/real/dir")
    monkeypatch.setattr(cover_art_service, "resolve_cover_art_config_path", lambda: None)

    try:
        with caplog.at_level(logging.ERROR, logger="blog.cover_art"):
            config = _reload_config()
        assert config["brand_palette"] == []
        assert config["presets"] == {}
        assert any("cover_art_config_missing" in record.message for record in caplog.records)
    finally:
        monkeypatch.delenv("AUTO_BLOG_CONFIG_DIR", raising=False)
        cover_art_service.load_cover_art_config.cache_clear()


def test_unreadable_config_is_logged_before_falling_back(tmp_path, monkeypatch, caplog):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "cover-art-direction.json").write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("AUTO_BLOG_CONFIG_DIR", str(config_dir))

    try:
        with caplog.at_level(logging.ERROR, logger="blog.cover_art"):
            config = _reload_config()
        assert config["presets"] == {}
        assert any("cover_art_config_unreadable" in record.message for record in caplog.records)
    finally:
        monkeypatch.delenv("AUTO_BLOG_CONFIG_DIR", raising=False)
        cover_art_service.load_cover_art_config.cache_clear()

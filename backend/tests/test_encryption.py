"""Tests for field-level encryption, especially the production fail-closed path."""

import pytest

import app.encryption as enc


def _clear_fernet_cache():
    enc._get_fernet.cache_clear()


def test_dev_without_key_falls_back_to_plaintext(monkeypatch):
    """In development a missing key degrades to plaintext so the app still runs."""
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(enc, "is_production_env", lambda: False)
    _clear_fernet_cache()

    assert enc.encrypt_value("secret-key") == "secret-key"


def test_production_without_key_refuses_plaintext(monkeypatch):
    """In production a missing key must fail loudly, not silently store plaintext."""
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(enc, "is_production_env", lambda: True)
    _clear_fernet_cache()

    with pytest.raises(RuntimeError):
        enc.encrypt_value("secret-key")


def test_empty_value_is_returned_unchanged_even_in_production(monkeypatch):
    """Empty strings carry no secret, so they never trigger the fail-closed path."""
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.setattr(enc, "is_production_env", lambda: True)
    _clear_fernet_cache()

    assert enc.encrypt_value("") == ""


def test_round_trip_with_configured_key(monkeypatch):
    """A configured key encrypts and decrypts back to the original."""
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", key)
    monkeypatch.setattr(enc, "is_production_env", lambda: True)
    _clear_fernet_cache()

    ciphertext = enc.encrypt_value("secret-key")
    assert ciphertext != "secret-key"
    assert enc.decrypt_value(ciphertext) == "secret-key"


def test_decrypt_legacy_plaintext_is_passthrough(monkeypatch):
    """Legacy plaintext values (not Fernet tokens) decrypt to themselves."""
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", key)
    _clear_fernet_cache()

    assert enc.decrypt_value("plain-legacy-value") == "plain-legacy-value"

"""Tests for fail-closed field-level encryption."""

import pytest

import app.encryption as enc


def _clear_fernet_cache():
    enc._get_fernet.cache_clear()


def test_without_any_key_refuses_plaintext(monkeypatch):
    """No environment may silently persist API keys in plaintext."""
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    _clear_fernet_cache()

    with pytest.raises(RuntimeError):
        enc.encrypt_value("secret-key")


def test_empty_value_is_returned_unchanged_even_in_production(monkeypatch):
    """Empty strings carry no secret, so they never trigger the fail-closed path."""
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    _clear_fernet_cache()

    assert enc.encrypt_value("") == ""


def test_round_trip_with_configured_key(monkeypatch):
    """A configured key encrypts and decrypts back to the original."""
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", key)
    _clear_fernet_cache()

    ciphertext = enc.encrypt_value("secret-key")
    assert ciphertext != "secret-key"
    assert enc.decrypt_value(ciphertext) == "secret-key"


def test_round_trip_with_key_derived_from_secret_key(monkeypatch):
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("SECRET_KEY", "stable-application-secret")
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


def test_ciphertext_carries_a_version_prefix(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _clear_fernet_cache()

    ciphertext = enc.encrypt_value("sk-live-secret")

    assert ciphertext.startswith(enc.ENCRYPTION_PREFIX)
    assert enc.is_encrypted_value(ciphertext)
    assert not enc.is_encrypted_value("sk-live-secret")


def test_rotated_key_makes_ciphertext_unusable_instead_of_leaking_it(monkeypatch):
    """Fail closed: returning the undecryptable token would send
    `Authorization: Bearer gAAAAAB...` upstream while the console still claimed
    the credential was present."""
    from cryptography.fernet import Fernet

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _clear_fernet_cache()
    ciphertext = enc.encrypt_value("sk-live-secret")

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _clear_fernet_cache()

    assert enc.decrypt_value(ciphertext) == ""


def test_legacy_unprefixed_ciphertext_also_fails_closed_after_rotation(monkeypatch):
    """Rows written before the version prefix are still recognisably Fernet tokens."""
    from cryptography.fernet import Fernet

    old_key = Fernet.generate_key()
    legacy_ciphertext = Fernet(old_key).encrypt(b"sk-live-secret").decode()
    assert legacy_ciphertext.startswith("gAAAAA")

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _clear_fernet_cache()

    assert enc.decrypt_value(legacy_ciphertext) == ""


def test_legacy_unprefixed_ciphertext_still_decrypts_with_the_same_key(monkeypatch):
    from cryptography.fernet import Fernet

    key = Fernet.generate_key()
    legacy_ciphertext = Fernet(key).encrypt(b"sk-live-secret").decode()

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", key.decode())
    _clear_fernet_cache()

    assert enc.decrypt_value(legacy_ciphertext) == "sk-live-secret"


def test_missing_key_does_not_expose_ciphertext(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _clear_fernet_cache()
    ciphertext = enc.encrypt_value("sk-live-secret")

    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    _clear_fernet_cache()

    assert enc.decrypt_value(ciphertext) == ""

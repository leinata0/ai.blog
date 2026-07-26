"""Runtime plan resolution must degrade per-record, never all-or-nothing.

`AI_PROVIDER_ALLOWED_BASE_URL_HOSTS` is an unsynced Render variable: one typo
used to turn every previously valid record illegal, and because the read path
reused the strict write-path validator, a single bad row raised out of
`resolve_runtime_plan` — killing text and image generation *and* the admin views
that would have shown which row was broken.
"""

import json

import pytest

from test_url_safety_vectors import install_stub_resolver

from app.encryption import encrypt_value
from app.models import AiModelInstance, AiProviderSource
from app.services import ai_channels, ai_provider_manager


@pytest.fixture(autouse=True)
def _provider_host_resolution(monkeypatch):
    """本文件测的是"一条坏记录不能拖垮整个计划"，所有测试主机都按公网可解析处理。

    私网拦截本身在 test_provider_allowlist.py 里单独断言。缓存必须清，它是模块级全局。
    """
    install_stub_resolver(monkeypatch, lambda host, port: ["93.184.216.34"])
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    yield
    ai_provider_manager.invalidate_allowed_base_url_host_cache()


def _source(db, *, name, base_url, enabled=True):
    source = AiProviderSource(
        name=name,
        provider="openai_compatible",
        protocol="openai",
        base_url=base_url,
        api_key_env_var="",
        api_key_value=encrypt_value("sk-test-key"),
        enabled=enabled,
        extra_json="{}",
    )
    db.add(source)
    db.flush()
    return source


def _instance(db, source, *, purpose, model="model-a", priority=1, capabilities=None, is_default=False):
    instance = AiModelInstance(
        source_id=source.id,
        name=model,
        model=model,
        purpose=purpose,
        capabilities_json=json.dumps(capabilities if capabilities is not None else [purpose]),
        priority=priority,
        enabled=True,
        is_default=is_default,
        extra_json="{}",
    )
    db.add(instance)
    db.flush()
    return instance


def test_one_disallowed_base_url_does_not_take_down_the_whole_plan(db_session):
    healthy = _source(db_session, name="healthy", base_url="https://gateway.example.com/v1")
    broken = _source(db_session, name="broken", base_url="https://not-allowlisted.example.org/v1")
    _instance(db_session, healthy, purpose=ai_channels.TEXT_PURPOSE, model="good-model", priority=1)
    _instance(db_session, broken, purpose=ai_channels.TEXT_PURPOSE, model="bad-model", priority=2)
    db_session.commit()

    plan = ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.TEXT_PURPOSE)

    assert [item.model for item in plan] == ["good-model"]


def test_runtime_plan_public_stays_readable_with_a_broken_record(db_session):
    broken = _source(db_session, name="broken", base_url="https://not-allowlisted.example.org/v1")
    _instance(db_session, broken, purpose=ai_channels.IMAGE_PURPOSE, model="bad-image-model")
    db_session.commit()

    payload = ai_provider_manager.runtime_plan_public(db_session)

    assert payload[ai_channels.IMAGE_PURPOSE] == []
    assert payload[ai_channels.TEXT_PURPOSE] == []


def test_instance_without_the_purpose_capability_is_not_selected(db_session):
    source = _source(db_session, name="healthy", base_url="https://gateway.example.com/v1")
    # Purpose was later switched to image generation but the capability tags were
    # never updated — the instance cannot actually draw.
    _instance(
        db_session,
        source,
        purpose=ai_channels.IMAGE_PURPOSE,
        model="text-only-model",
        capabilities=[ai_channels.TEXT_PURPOSE],
    )
    db_session.commit()

    assert ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.IMAGE_PURPOSE) == []


def test_instance_with_the_matching_capability_is_selected(db_session):
    source = _source(db_session, name="healthy", base_url="https://gateway.example.com/v1")
    _instance(
        db_session,
        source,
        purpose=ai_channels.IMAGE_PURPOSE,
        model="image-model",
        capabilities=[ai_channels.IMAGE_PURPOSE, ai_channels.TEXT_PURPOSE],
    )
    db_session.commit()

    plan = ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.IMAGE_PURPOSE)

    assert [item.model for item in plan] == ["image-model"]


def test_legacy_instance_without_capability_tags_stays_eligible(db_session):
    source = _source(db_session, name="healthy", base_url="https://gateway.example.com/v1")
    instance = _instance(db_session, source, purpose=ai_channels.TEXT_PURPOSE, model="legacy-model")
    instance.capabilities_json = ""
    db_session.commit()

    plan = ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.TEXT_PURPOSE)

    assert [item.model for item in plan] == ["legacy-model"]


def test_undecryptable_api_key_marks_the_instance_unusable(db_session, monkeypatch):
    """After a key rotation the stored token must not be forwarded as a bearer
    credential; the instance has to drop out of the plan instead."""
    from cryptography.fernet import Fernet

    from app import encryption

    source = _source(db_session, name="healthy", base_url="https://gateway.example.com/v1")
    _instance(db_session, source, purpose=ai_channels.TEXT_PURPOSE, model="rotated-key-model")
    db_session.commit()

    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    encryption._get_fernet.cache_clear()

    assert ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.TEXT_PURPOSE) == []


def test_test_instance_reports_the_configuration_error_instead_of_raising(db_session):
    broken = _source(db_session, name="broken", base_url="https://not-allowlisted.example.org/v1")
    instance = _instance(db_session, broken, purpose=ai_channels.TEXT_PURPOSE, model="bad-model")
    db_session.commit()

    result = ai_provider_manager.test_instance(db_session, instance.id)

    assert result["ok"] is False
    assert result["error_code"] == "base_url_not_allowed"


def test_create_and_update_still_reject_a_disallowed_base_url(db_session):
    with pytest.raises(ai_channels.AiChannelError) as exc_info:
        ai_provider_manager.create_source(
            db_session,
            {
                "name": "rogue",
                "provider": "openai_compatible",
                "base_url": "https://not-allowlisted.example.org/v1",
            },
        )

    assert exc_info.value.code == "base_url_not_allowed"

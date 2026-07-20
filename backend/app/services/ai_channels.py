from __future__ import annotations

import base64
import binascii
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from app.encryption import decrypt_value, encrypt_value
from app.env import clean_env
from app.models import AiChannelConfig

logger = logging.getLogger(__name__)

DEFAULT_TEXT_GENERATION_TIMEOUT_SECONDS = 180

IMAGE_PURPOSE = "image_generation"
TEXT_PURPOSE = "text_generation"
VALID_PURPOSES = {IMAGE_PURPOSE, TEXT_PURPOSE}

PROTOCOL_OPENAI = "openai"
PROTOCOL_ANTHROPIC = "anthropic"

VALID_PROVIDERS = {
    "xai", "siliconflow", "openai_compatible",
    "deepseek", "moonshot", "zhipu", "baichuan", "minimax", "doubao",
    "openai", "anthropic", "gemini", "mistral", "groq", "together",
}

PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "xai": {
        "base_url": "https://api.x.ai/v1",
        "model_image": "grok-imagine-image",
        "model_text": "grok-4",
        "api_key_env_var": "XAI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model_image": "dall-e-3",
        "model_text": "gpt-4o",
        "api_key_env_var": "OPENAI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "model_image": "",
        "model_text": "deepseek-chat",
        "api_key_env_var": "DEEPSEEK_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "siliconflow": {
        "base_url": "https://api.siliconflow.cn/v1",
        "model_image": "black-forest-labs/FLUX.1-schnell",
        "model_text": "deepseek-ai/DeepSeek-V3",
        "api_key_env_var": "SILICONFLOW_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "moonshot": {
        "base_url": "https://api.moonshot.cn/v1",
        "model_image": "",
        "model_text": "moonshot-v1-128k",
        "api_key_env_var": "MOONSHOT_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "zhipu": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model_image": "cogview-4",
        "model_text": "glm-4-flash",
        "api_key_env_var": "ZHIPU_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "baichuan": {
        "base_url": "https://api.baichuan-ai.com/v1",
        "model_image": "",
        "model_text": "Baichuan4",
        "api_key_env_var": "BAICHUAN_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "minimax": {
        "base_url": "https://api.minimax.chat/v1",
        "model_image": "",
        "model_text": "MiniMax-Text-01",
        "api_key_env_var": "MINIMAX_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "doubao": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model_image": "",
        "model_text": "doubao-pro-32k",
        "api_key_env_var": "DOUBAO_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "anthropic": {
        "base_url": "https://api.anthropic.com",
        "model_image": "",
        "model_text": "claude-sonnet-4-20250514",
        "api_key_env_var": "ANTHROPIC_API_KEY",
        "protocol": PROTOCOL_ANTHROPIC,
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "model_image": "imagen-3.0-generate-002",
        "model_text": "gemini-2.0-flash",
        "api_key_env_var": "GEMINI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "mistral": {
        "base_url": "https://api.mistral.ai/v1",
        "model_image": "",
        "model_text": "mistral-large-latest",
        "api_key_env_var": "MISTRAL_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model_image": "",
        "model_text": "llama-3.3-70b-versatile",
        "api_key_env_var": "GROQ_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "model_image": "stabilityai/stable-diffusion-xl-base-1.0",
        "model_text": "meta-llama/Llama-3-70b-chat-hf",
        "api_key_env_var": "TOGETHER_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    "openai_compatible": {
        "base_url": "",
        "model_image": "",
        "model_text": "",
        "api_key_env_var": "AI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
}

DEFAULTS = {
    IMAGE_PURPOSE: {
        "provider": "openai_compatible",
        "base_url": "",
        "model": "",
        "api_key_env_var": "AI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    TEXT_PURPOSE: {
        "provider": "openai_compatible",
        "base_url": "",
        "model": "",
        "api_key_env_var": "AI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
}


class AiChannelError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ResolvedAiChannel:
    purpose: str
    provider: str
    base_url: str
    model: str
    api_key: str
    api_key_env_var: str
    api_key_source: str
    enabled: bool
    db_configured: bool
    protocol: str = PROTOCOL_OPENAI

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key)

    @property
    def is_configured(self) -> bool:
        return self.enabled and self.has_api_key and bool(self.base_url) and bool(self.model)


@dataclass(frozen=True)
class ResolvedAiChannelTarget:
    id: str
    priority: int
    purpose: str
    provider: str
    base_url: str
    model: str
    api_key: str
    api_key_env_var: str
    api_key_source: str
    enabled: bool
    db_configured: bool
    protocol: str = PROTOCOL_OPENAI

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key)

    @property
    def is_configured(self) -> bool:
        return self.enabled and self.has_api_key and bool(self.base_url) and bool(self.model)


@dataclass(frozen=True)
class ResolvedAiChannelPlan:
    purpose: str
    enabled: bool
    db_configured: bool
    targets: list[ResolvedAiChannelTarget]


FAILOVER_TARGETS_KEY = "failover_targets"


def normalize_purpose(purpose: str) -> str:
    normalized = str(purpose or "").strip().lower()
    if normalized not in VALID_PURPOSES:
        raise AiChannelError("invalid_channel_config", "不支持的 AI 渠道用途。")
    return normalized


def normalize_provider(provider: str | None, purpose: str) -> str:
    fallback = DEFAULTS[purpose]["provider"]
    normalized = str(provider or fallback).strip().lower()
    if normalized not in VALID_PROVIDERS:
        raise AiChannelError("invalid_channel_config", "不支持的 AI 服务提供方。")
    return normalized


def provider_defaults(provider: str, purpose: str) -> dict[str, str]:
    preset = PROVIDER_PRESETS.get(provider)
    if preset is None:
        return DEFAULTS[purpose]
    model_key = "model_image" if purpose == IMAGE_PURPOSE else "model_text"
    base_url = preset["base_url"]
    model = preset[model_key]
    if provider == "siliconflow":
        base_url = clean_env("SILICONFLOW_BASE_URL", base_url) or base_url
        model = clean_env("SILICONFLOW_MODEL", model) or model
    return {
        "base_url": base_url,
        "model": model,
        "api_key_env_var": preset["api_key_env_var"],
        "protocol": preset["protocol"],
    }


def mask_api_key(value: str) -> str:
    key = str(value or "").strip()
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


def _safe_extra_dict(value: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value or "{}").strip() or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _target_message(target: ResolvedAiChannelTarget) -> str:
    if not target.enabled:
        return "该候选已停用。"
    if target.is_configured:
        return "AI 候选已配置，可用于生成。"
    if not target.has_api_key:
        return "AI 候选缺少 API Key。"
    return "AI 候选配置不完整。"


def _target_to_channel(target: ResolvedAiChannelTarget) -> ResolvedAiChannel:
    return ResolvedAiChannel(
        purpose=target.purpose,
        provider=target.provider,
        base_url=target.base_url,
        model=target.model,
        api_key=target.api_key,
        api_key_env_var=target.api_key_env_var,
        api_key_source=target.api_key_source,
        enabled=target.enabled,
        db_configured=target.db_configured,
        protocol=target.protocol,
    )


def _channel_to_target(channel: ResolvedAiChannel, *, target_id: str = "primary", priority: int = 1) -> ResolvedAiChannelTarget:
    return ResolvedAiChannelTarget(
        id=target_id,
        priority=priority,
        purpose=channel.purpose,
        provider=channel.provider,
        base_url=channel.base_url,
        model=channel.model,
        api_key=channel.api_key,
        api_key_env_var=channel.api_key_env_var,
        api_key_source=channel.api_key_source,
        enabled=channel.enabled,
        db_configured=channel.db_configured,
        protocol=channel.protocol,
    )


def _target_public_dict(target: ResolvedAiChannelTarget) -> dict[str, Any]:
    return {
        "id": target.id,
        "priority": target.priority,
        "provider": target.provider,
        "protocol": target.protocol,
        "base_url": target.base_url,
        "model": target.model,
        "api_key_env_var": target.api_key_env_var,
        "has_api_key": target.has_api_key,
        "api_key_source": target.api_key_source,
        "masked_api_key": mask_api_key(target.api_key),
        "enabled": target.enabled,
        "is_configured": target.is_configured,
        "message": _target_message(target),
    }


def _target_from_stored(raw: dict[str, Any], purpose: str, *, db_configured: bool) -> ResolvedAiChannelTarget | None:
    if not isinstance(raw, dict):
        return None
    try:
        provider = normalize_provider(raw.get("provider"), purpose)
    except AiChannelError:
        return None
    defaults = provider_defaults(provider, purpose)
    env_var = str(raw.get("api_key_env_var") or defaults["api_key_env_var"]).strip()
    stored_key = decrypt_value(str(raw.get("api_key_value") or "").strip())
    env_key = clean_env(env_var) if env_var else ""
    api_key = stored_key or env_key
    api_key_source = "db" if stored_key else "env" if env_key else "missing"
    try:
        priority = int(raw.get("priority") or 1)
    except (TypeError, ValueError):
        priority = 1
    return ResolvedAiChannelTarget(
        id=str(raw.get("id") or f"target-{priority}"),
        priority=max(priority, 1),
        purpose=purpose,
        provider=provider,
        base_url=str(raw.get("base_url") or defaults["base_url"]).strip().rstrip("/"),
        model=str(raw.get("model") or defaults["model"]).strip(),
        api_key=api_key,
        api_key_env_var=env_var,
        api_key_source=api_key_source,
        enabled=bool(raw.get("enabled", True)),
        db_configured=db_configured,
        protocol=defaults.get("protocol", PROTOCOL_OPENAI),
    )


def _target_from_inline(raw: dict[str, Any], purpose: str, *, require_model: bool = True) -> ResolvedAiChannelTarget:
    provider = normalize_provider(raw.get("provider"), purpose)
    defaults = provider_defaults(provider, purpose)
    env_var = str(raw.get("api_key_env_var") or defaults["api_key_env_var"]).strip()
    api_key = str(raw.get("api_key_value") or "").strip()
    env_key = clean_env(env_var) if env_var else ""
    if not api_key and env_key:
        api_key = env_key
    try:
        priority = int(raw.get("priority") or 1)
    except (TypeError, ValueError):
        priority = 1
    return ResolvedAiChannelTarget(
        id=str(raw.get("id") or f"inline-{priority}"),
        priority=max(priority, 1),
        purpose=purpose,
        provider=provider,
        base_url=str(raw.get("base_url") or defaults["base_url"]).strip().rstrip("/"),
        model=str(raw.get("model") or (defaults["model"] if require_model else "")).strip(),
        api_key=api_key,
        api_key_env_var=env_var,
        api_key_source="inline" if str(raw.get("api_key_value") or "").strip() else ("env" if env_key else "missing"),
        enabled=bool(raw.get("enabled", True)),
        db_configured=False,
        protocol=defaults.get("protocol", PROTOCOL_OPENAI),
    )


def _stored_targets(config: AiChannelConfig, purpose: str) -> list[ResolvedAiChannelTarget]:
    extra = _safe_extra_dict(config.extra_json)
    raw_targets = extra.get(FAILOVER_TARGETS_KEY)
    if not isinstance(raw_targets, list):
        return []
    targets = [t for item in raw_targets if (t := _target_from_stored(item, purpose, db_configured=True))]
    return sorted(targets, key=lambda item: item.priority)


def _legacy_channel_from_config(config: AiChannelConfig, purpose: str) -> ResolvedAiChannel:
    try:
        provider = normalize_provider(config.provider, purpose)
    except AiChannelError:
        logger.warning("Invalid AI channel provider in DB; falling back to defaults for purpose=%s", purpose)
        return _fallback_channel(purpose)
    defaults = provider_defaults(provider, purpose)
    base_url = (config.base_url or defaults["base_url"]).strip().rstrip("/")
    model = (config.model or defaults["model"]).strip()
    env_var = (config.api_key_env_var or defaults["api_key_env_var"]).strip()
    db_key = decrypt_value((config.api_key_value or "").strip())
    env_key = clean_env(env_var) if env_var else ""
    api_key = db_key or env_key
    api_key_source = "db" if db_key else "env" if env_key else "missing"
    return ResolvedAiChannel(
        purpose=purpose,
        provider=provider,
        base_url=base_url,
        model=model,
        api_key=api_key,
        api_key_env_var=env_var,
        api_key_source=api_key_source,
        enabled=bool(config.enabled),
        db_configured=True,
        protocol=defaults.get("protocol", PROTOCOL_OPENAI),
    )


def _fallback_channel(purpose: str) -> ResolvedAiChannel:
    defaults = DEFAULTS[purpose]
    provider = defaults["provider"]
    pd = provider_defaults(provider, purpose)
    base_url = pd["base_url"] or defaults["base_url"]
    model = pd["model"] or defaults["model"]
    env_var = pd["api_key_env_var"] or defaults["api_key_env_var"]
    api_key = clean_env(env_var)
    return ResolvedAiChannel(
        purpose=purpose,
        provider=provider,
        base_url=base_url.rstrip("/"),
        model=model,
        api_key=api_key,
        api_key_env_var=env_var,
        api_key_source="env" if api_key else "missing",
        enabled=True,
        db_configured=False,
        protocol=pd.get("protocol", PROTOCOL_OPENAI),
    )


def resolve_channel(db: Session, purpose: str) -> ResolvedAiChannel:
    plan = resolve_channel_plan(db, purpose)
    if plan.targets:
        return _target_to_channel(plan.targets[0])
    return _fallback_channel(normalize_purpose(purpose))


def resolve_channel_plan(db: Session, purpose: str) -> ResolvedAiChannelPlan:
    normalized_purpose = normalize_purpose(purpose)
    config = db.query(AiChannelConfig).filter(AiChannelConfig.purpose == normalized_purpose).first()
    if config is None:
        channel = _fallback_channel(normalized_purpose)
        return ResolvedAiChannelPlan(
            purpose=normalized_purpose,
            enabled=channel.enabled,
            db_configured=False,
            targets=[_channel_to_target(channel, target_id="default", priority=1)],
        )

    targets = _stored_targets(config, normalized_purpose)
    if not targets:
        legacy = _legacy_channel_from_config(config, normalized_purpose)
        targets = [_channel_to_target(legacy, target_id="primary", priority=1)]
    else:
        targets = [
            ResolvedAiChannelTarget(
                id=target.id,
                priority=index + 1,
                purpose=target.purpose,
                provider=target.provider,
                base_url=target.base_url,
                model=target.model,
                api_key=target.api_key,
                api_key_env_var=target.api_key_env_var,
                api_key_source=target.api_key_source,
                enabled=bool(config.enabled) and target.enabled,
                db_configured=target.db_configured,
                protocol=target.protocol,
            )
            for index, target in enumerate(targets)
        ]
    return ResolvedAiChannelPlan(
        purpose=normalized_purpose,
        enabled=bool(config.enabled),
        db_configured=True,
        targets=targets,
    )


def channel_to_public_dict(channel: ResolvedAiChannel) -> dict[str, Any]:
    if not channel.enabled:
        message = "该 AI 渠道已停用。"
    elif channel.is_configured:
        message = "AI 渠道已配置，可用于生成。"
    elif not channel.has_api_key:
        message = "AI 渠道缺少 API Key。"
    else:
        message = "AI 渠道配置不完整。"

    target = _channel_to_target(channel, target_id="primary", priority=1)
    return {
        "purpose": channel.purpose,
        "provider": channel.provider,
        "protocol": channel.protocol,
        "base_url": channel.base_url,
        "model": channel.model,
        "api_key_env_var": channel.api_key_env_var,
        "has_api_key": channel.has_api_key,
        "api_key_source": channel.api_key_source,
        "masked_api_key": mask_api_key(channel.api_key),
        "enabled": channel.enabled,
        "is_configured": channel.is_configured,
        "db_configured": channel.db_configured,
        "message": message,
        "targets": [_target_public_dict(target)],
        "active_target_count": 1 if target.is_configured else 0,
    }


def channel_plan_to_public_dict(plan: ResolvedAiChannelPlan) -> dict[str, Any]:
    primary = plan.targets[0] if plan.targets else _channel_to_target(_fallback_channel(plan.purpose), target_id="default", priority=1)
    payload = channel_to_public_dict(_target_to_channel(primary))
    payload["db_configured"] = plan.db_configured
    payload["enabled"] = plan.enabled
    payload["targets"] = [_target_public_dict(target) for target in plan.targets]
    payload["active_target_count"] = sum(1 for target in plan.targets if target.is_configured)
    if payload["active_target_count"] > 1:
        payload["message"] = f"已配置 {payload['active_target_count']} 个可用候选，将按优先级自动切换。"
    return payload


def _normalize_extra_json(value: str | None) -> str:
    text = str(value or "{}").strip() or "{}"
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AiChannelError("invalid_channel_config", "Extra JSON 不是合法 JSON。") from exc
    if not isinstance(parsed, dict):
        raise AiChannelError("invalid_channel_config", "Extra JSON 必须是对象。")
    return json.dumps(parsed, ensure_ascii=False)


def _payload_value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _payload_has(obj: Any, key: str) -> bool:
    if isinstance(obj, dict):
        return key in obj
    return hasattr(obj, key)


def _payload_dict(obj: Any) -> dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return dict(getattr(obj, "__dict__", {}))


def _stored_target_lookup(config: AiChannelConfig) -> dict[str, dict[str, Any]]:
    extra = _safe_extra_dict(config.extra_json)
    items = extra.get(FAILOVER_TARGETS_KEY)
    if not isinstance(items, list):
        return {}
    return {str(item.get("id")): item for item in items if isinstance(item, dict) and item.get("id")}


def _normalize_target_payloads(config: AiChannelConfig, payload, purpose: str) -> list[dict[str, Any]] | None:
    raw_targets = _payload_value(payload, "targets", None)
    if raw_targets is None:
        return None
    if not isinstance(raw_targets, list):
        raise AiChannelError("invalid_channel_config", "AI 候选配置必须是列表。")

    existing = _stored_target_lookup(config)
    normalized_targets: list[dict[str, Any]] = []
    for index, item in enumerate(raw_targets):
        raw = _payload_dict(item)
        provider = normalize_provider(raw.get("provider"), purpose)
        defaults = provider_defaults(provider, purpose)
        target_id = str(raw.get("id") or uuid4().hex[:12]).strip()
        previous = existing.get(target_id, {})
        api_key_value = str(raw.get("api_key_value") or "").strip()
        if raw.get("clear_api_key"):
            stored_key = ""
        elif api_key_value:
            stored_key = encrypt_value(api_key_value)
        else:
            stored_key = str(previous.get("api_key_value") or "")
            if not stored_key and index == 0:
                stored_key = str(config.api_key_value or "")
        normalized_targets.append({
            "id": target_id,
            "priority": index + 1,
            "provider": provider,
            "base_url": str(raw.get("base_url") or defaults["base_url"]).strip().rstrip("/"),
            "model": str(raw.get("model") or defaults["model"]).strip(),
            "api_key_env_var": str(raw.get("api_key_env_var") or defaults["api_key_env_var"]).strip(),
            "api_key_value": stored_key,
            "enabled": bool(raw.get("enabled", True)),
        })
    if not normalized_targets:
        raise AiChannelError("invalid_channel_config", "至少需要保留一个 AI 候选。")
    return normalized_targets


def _apply_channel_payload(config: AiChannelConfig, payload, purpose: str) -> None:
    targets = _normalize_target_payloads(config, payload, purpose)
    if targets is not None:
        primary = targets[0]
        config.provider = primary["provider"]
        config.base_url = primary["base_url"]
        config.model = primary["model"]
        config.api_key_env_var = primary["api_key_env_var"]
        config.api_key_value = primary["api_key_value"]
        extra = _safe_extra_dict(config.extra_json)
        extra[FAILOVER_TARGETS_KEY] = targets
        config.extra_json = json.dumps(extra, ensure_ascii=False)
    else:
        provider = normalize_provider(getattr(payload, "provider", None) or config.provider, purpose)
        defaults = provider_defaults(provider, purpose)
        config.provider = provider
        config.base_url = str((getattr(payload, "base_url", None) if getattr(payload, "base_url", None) is not None else config.base_url) or defaults["base_url"]).strip().rstrip("/")
        config.model = str((getattr(payload, "model", None) if getattr(payload, "model", None) is not None else config.model) or defaults["model"]).strip()
        config.api_key_env_var = str(
            (
                getattr(payload, "api_key_env_var", None)
                if getattr(payload, "api_key_env_var", None) is not None
                else config.api_key_env_var
            ) or defaults["api_key_env_var"]
        ).strip()
        api_key_value = getattr(payload, "api_key_value", None)
        if getattr(payload, "clear_api_key", False):
            config.api_key_value = ""
        elif api_key_value is not None and str(api_key_value).strip():
            config.api_key_value = encrypt_value(str(api_key_value).strip())
        if getattr(payload, "extra_json", None) is not None:
            config.extra_json = _normalize_extra_json(payload.extra_json)
    if getattr(payload, "enabled", None) is not None:
        config.enabled = bool(payload.enabled)
    config.updated_at = datetime.now(timezone.utc)

def create_channel(db: Session, purpose: str, payload) -> ResolvedAiChannel:
    normalized_purpose = normalize_purpose(purpose)
    existing = db.query(AiChannelConfig).filter(AiChannelConfig.purpose == normalized_purpose).first()
    if existing is not None:
        raise AiChannelError("channel_exists", "该 AI 渠道配置已存在。")

    defaults = DEFAULTS[normalized_purpose]
    config = AiChannelConfig(
        purpose=normalized_purpose,
        provider=defaults["provider"],
        base_url=defaults["base_url"],
        model=defaults["model"],
        api_key_env_var=defaults["api_key_env_var"],
    )
    _apply_channel_payload(config, payload, normalized_purpose)
    db.add(config)
    db.commit()
    db.refresh(config)
    return resolve_channel(db, normalized_purpose)


def update_channel(db: Session, purpose: str, payload) -> ResolvedAiChannel:
    normalized_purpose = normalize_purpose(purpose)
    config = db.query(AiChannelConfig).filter(AiChannelConfig.purpose == normalized_purpose).first()
    if config is None:
        defaults = DEFAULTS[normalized_purpose]
        config = AiChannelConfig(
            purpose=normalized_purpose,
            provider=defaults["provider"],
            base_url=defaults["base_url"],
            model=defaults["model"],
            api_key_env_var=defaults["api_key_env_var"],
        )
        db.add(config)

    _apply_channel_payload(config, payload, normalized_purpose)
    db.commit()
    db.refresh(config)
    return resolve_channel(db, normalized_purpose)


def delete_channel(db: Session, purpose: str) -> None:
    normalized_purpose = normalize_purpose(purpose)
    config = db.query(AiChannelConfig).filter(AiChannelConfig.purpose == normalized_purpose).first()
    if config is not None:
        db.delete(config)
        db.commit()


def ensure_channel_ready(channel: ResolvedAiChannel) -> None:
    if not channel.enabled:
        raise AiChannelError("channel_disabled", "该 AI 渠道已停用。")
    if not channel.api_key:
        raise AiChannelError("missing_api_key", "AI 渠道缺少 API Key，请在后台配置 API Key 或环境变量名。")
    if not channel.base_url or not channel.model:
        raise AiChannelError("invalid_channel_config", "AI 渠道缺少 Base URL 或模型名称。")


def _openai_endpoints(base_url: str, suffix: str) -> list[str]:
    normalized = base_url.rstrip("/")
    normalized_suffix = suffix if suffix.startswith("/") else f"/{suffix}"
    endpoints = [f"{normalized}{normalized_suffix}"]
    parsed = urlparse(normalized)
    path = (parsed.path or "").rstrip("/")
    if not path.endswith("/v1"):
        endpoints.append(f"{normalized}/v1{normalized_suffix}")
    return endpoints


def _generate_image_from_channel(channel: ResolvedAiChannel, prompt: str, framing_hint: str = "") -> str:
    ensure_channel_ready(channel)
    full_prompt = f"{framing_hint}: {prompt}" if framing_hint else prompt
    last_error: AiChannelError | None = None
    for endpoint in _openai_endpoints(channel.base_url, "/images/generations"):
        try:
            response = httpx.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {channel.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": channel.model,
                    "prompt": full_prompt,
                    "n": 1,
                },
                timeout=60,
            )
            try:
                data = response.json()
            except ValueError:
                data = None
            image_url = _extract_generated_image(data)
            # Some paid gateways return a usable result body with a transient
            # 5xx status. The image is more authoritative than the status code.
            if image_url:
                return image_url
            if response.status_code >= 400:
                detail = _response_error_detail(response, data)
                last_error = AiChannelError(
                    "generation_failed",
                    f"生图请求失败，HTTP {response.status_code}{f'：{detail}' if detail else '。'}",
                )
                # Do not send a second billable request after an upstream 5xx.
                if response.status_code >= 500:
                    break
                continue
            last_error = AiChannelError("generation_failed", "生图服务已响应，但未返回可用图片 URL 或 base64 图片。")
            continue
        except httpx.HTTPError:
            last_error = AiChannelError("generation_failed", "生图请求失败，请稍后重试。")
    if last_error is not None:
        raise last_error
    raise AiChannelError("generation_failed", "生图请求失败，请检查 Base URL。")


def _response_error_detail(response, data: Any = None) -> str:
    if isinstance(data, dict):
        for key in ("error", "message", "detail"):
            value = data.get(key)
            if isinstance(value, dict):
                value = value.get("message") or value.get("detail") or value.get("code")
            if value:
                text = str(value).strip()
                return text[:300]
    try:
        text = str(response.text or "").strip()
    except Exception:
        text = ""
    return " ".join(text.split())[:300]


def _extract_generated_image(data: Any) -> str:
    """Normalize common OpenAI-compatible image response shapes.

    DALL-E-style services return ``data[0].url`` while several compatible
    gateways return ``data[0].b64_json`` after a successful, billable request.
    The latter is converted to a data URL and is consumed immediately by the
    cover downloader; it is never stored as the article's public URL.
    """
    if isinstance(data, str):
        value = data.strip()
        if value.startswith(("http://", "https://", "data:image/")):
            return value
        return ""
    if isinstance(data, list):
        for item in data:
            result = _extract_generated_image(item)
            if result:
                return result
        return ""
    if not isinstance(data, dict):
        return ""
    for key in ("url", "image_url", "imageUrl"):
        value = str(data.get(key) or "").strip()
        if value.startswith(("http://", "https://", "data:image/")):
            return value
    encoded = ""
    for key in ("b64_json", "b64", "base64", "image_base64", "imageBase64"):
        candidate = str(data.get(key) or "").strip()
        if candidate:
            encoded = candidate
            break
    if encoded:
        if encoded.startswith("data:image/"):
            return encoded
        mime = str(data.get("mime_type") or data.get("mimeType") or data.get("content_type") or "image/png").strip().lower()
        if mime not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
            mime = "image/png"
        try:
            base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            return ""
        return f"data:{mime};base64,{encoded}"
    for key in ("data", "images", "output", "result", "results", "image"):
        result = _extract_generated_image(data.get(key))
        if result:
            return result
    return ""


def _generate_text_openai(
    channel: ResolvedAiChannel,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
) -> str:
    last_error: AiChannelError | None = None
    for endpoint in _openai_endpoints(channel.base_url, "/chat/completions"):
        try:
            response = httpx.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {channel.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    key: value
                    for key, value in {
                        "model": channel.model,
                        "messages": messages,
                        "temperature": 0.2 if temperature is None else temperature,
                        "max_tokens": max_tokens,
                        "response_format": {"type": "json_object"} if json_mode else None,
                    }.items()
                    if value is not None
                },
                timeout=DEFAULT_TEXT_GENERATION_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            data = response.json()
            content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
            if not content:
                last_error = AiChannelError("generation_failed", "生文字服务未返回可用内容。")
                continue
            return str(content)
        except httpx.HTTPStatusError as exc:
            last_error = AiChannelError("generation_failed", f"生文字请求失败，HTTP {exc.response.status_code}。")
        except httpx.TimeoutException:
            last_error = AiChannelError("generation_timeout", f"生文字请求超过 {DEFAULT_TEXT_GENERATION_TIMEOUT_SECONDS} 秒未完成。")
        except httpx.HTTPError:
            last_error = AiChannelError("generation_failed", "生文字请求失败，请稍后重试。")
        except ValueError:
            last_error = AiChannelError("generation_failed", "生文字服务响应不是合法 JSON。")
    if last_error is not None:
        raise last_error
    raise AiChannelError("generation_failed", "生文字请求失败，请检查 Base URL。")


def _generate_text_anthropic(
    channel: ResolvedAiChannel,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
) -> str:
    system_text = ""
    chat_messages = []
    for msg in messages:
        if msg.get("role") == "system":
            system_text = (system_text + "\n" + msg["content"]).strip() if system_text else msg["content"]
        else:
            chat_messages.append(msg)
    if not chat_messages:
        chat_messages = [{"role": "user", "content": "Hello"}]

    body: dict[str, Any] = {
        "model": channel.model,
        "max_tokens": max_tokens or 1024,
        "messages": chat_messages,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if json_mode:
        system_text = (system_text + "\nReturn only valid JSON." if system_text else "Return only valid JSON.").strip()
    if system_text:
        body["system"] = system_text

    base_url = channel.base_url.rstrip("/")
    endpoint = f"{base_url}/v1/messages" if "/v1" not in base_url else f"{base_url}/messages"

    try:
        response = httpx.post(
            endpoint,
            headers={
                "x-api-key": channel.api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=DEFAULT_TEXT_GENERATION_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        raise AiChannelError("generation_failed", f"生文字请求失败，HTTP {exc.response.status_code}。") from exc
    except httpx.TimeoutException as exc:
        raise AiChannelError("generation_timeout", f"生文字请求超过 {DEFAULT_TEXT_GENERATION_TIMEOUT_SECONDS} 秒未完成。") from exc
    except httpx.HTTPError as exc:
        raise AiChannelError("generation_failed", "生文字请求失败，请稍后重试。") from exc

    content_blocks = data.get("content") or []
    text_parts = [block.get("text", "") for block in content_blocks if block.get("type") == "text" and block.get("text")]
    content = "\n".join(text_parts).strip()
    if not content:
        raise AiChannelError("generation_failed", "生文字服务未返回可用内容。")
    return content


def _generate_text_from_channel(
    channel: ResolvedAiChannel,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
) -> str:
    ensure_channel_ready(channel)
    if channel.protocol == PROTOCOL_ANTHROPIC:
        return _generate_text_anthropic(channel, messages, max_tokens=max_tokens, temperature=temperature, json_mode=json_mode)
    return _generate_text_openai(channel, messages, max_tokens=max_tokens, temperature=temperature, json_mode=json_mode)


def _attempt_result(target: ResolvedAiChannelTarget, *, ok: bool, latency_ms: int, message: str, error_code: str = "") -> dict[str, Any]:
    return {
        "target_id": target.id,
        "priority": target.priority,
        "ok": ok,
        "provider": target.provider,
        "model": target.model,
        "api_key_source": target.api_key_source,
        "latency_ms": latency_ms,
        "message": message,
        "error_code": error_code,
    }


def _run_target(target: ResolvedAiChannelTarget, runner) -> tuple[Any, dict[str, Any]]:
    started = time.perf_counter()
    try:
        result = runner(_target_to_channel(target))
        latency_ms = int((time.perf_counter() - started) * 1000)
        return result, _attempt_result(target, ok=True, latency_ms=latency_ms, message="候选测试成功。")
    except AiChannelError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        raise AiChannelError(exc.code, exc.message) from exc


def _run_plan(plan: ResolvedAiChannelPlan, runner) -> tuple[Any, list[dict[str, Any]], ResolvedAiChannelTarget]:
    attempts: list[dict[str, Any]] = []
    last_error: AiChannelError | None = None
    for target in plan.targets:
        started = time.perf_counter()
        try:
            result = runner(_target_to_channel(target))
            latency_ms = int((time.perf_counter() - started) * 1000)
            attempts.append(_attempt_result(target, ok=True, latency_ms=latency_ms, message="候选调用成功。"))
            return result, attempts, target
        except AiChannelError as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            attempts.append(_attempt_result(target, ok=False, latency_ms=latency_ms, message=exc.message, error_code=exc.code))
            last_error = exc
            logger.warning("AI channel target failed purpose=%s priority=%s provider=%s model=%s error=%s latency_ms=%s", target.purpose, target.priority, target.provider, target.model, exc.code, latency_ms)
            continue
    if last_error is not None:
        if len(attempts) == 1:
            last_error.attempts = attempts
            raise last_error
        failure = AiChannelError("all_targets_failed", "所有 AI 渠道候选均请求失败，请检查 API Key、模型和 Base URL。")
        failure.attempts = attempts
        raise failure
    raise AiChannelError("invalid_channel_config", "AI 渠道没有可用候选。")


def generate_image_url(db: Session, prompt: str, framing_hint: str = "") -> str:
    from app.services import ai_provider_manager

    return ai_provider_manager.run_generation(
        db,
        IMAGE_PURPOSE,
        lambda channel: _generate_image_from_channel(channel, prompt, framing_hint),
    )


def generate_text(
    db: Session,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
    return_selected: bool = False,
):
    from app.services import ai_provider_manager

    return ai_provider_manager.run_generation(
        db,
        TEXT_PURPOSE,
        lambda channel: _generate_text_from_channel(
            channel,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            json_mode=json_mode,
        ),
        return_selected=return_selected,
    )


def _test_channel_inline(channel: ResolvedAiChannel) -> None:
    if channel.purpose == IMAGE_PURPOSE:
        _generate_image_from_channel(channel, "A small editorial test image for API connectivity.", "API connectivity test")
    else:
        _generate_text_from_channel(channel, [{"role": "user", "content": "请回复 OK，用于测试 API 连通性。"}])


def _test_response(plan: ResolvedAiChannelPlan, *, ok: bool, provider: str = "", model: str = "", message: str = "", error_code: str = "", latency_ms: int | None = None, attempts: list[dict[str, Any]] | None = None, selected: ResolvedAiChannelTarget | None = None) -> dict[str, Any]:
    return {
        "purpose": plan.purpose,
        "ok": ok,
        "provider": provider,
        "model": model,
        "message": message,
        "error_code": error_code,
        "latency_ms": latency_ms,
        "attempts": attempts or [],
        "selected_target_id": selected.id if selected else "",
        "selected_priority": selected.priority if selected else None,
    }


def test_channel(db: Session, purpose: str) -> dict[str, Any]:
    plan = resolve_channel_plan(db, purpose)
    started = time.perf_counter()
    try:
        _, attempts, selected = _run_plan(plan, _test_channel_inline)
        total_ms = int((time.perf_counter() - started) * 1000)
        return _test_response(plan, ok=True, provider=selected.provider, model=selected.model, message="AI 渠道测试成功。", latency_ms=total_ms, attempts=attempts, selected=selected)
    except AiChannelError as exc:
        total_ms = int((time.perf_counter() - started) * 1000)
        return _test_response(plan, ok=False, message=exc.message, error_code=exc.code, latency_ms=total_ms, attempts=getattr(exc, "attempts", []))


def _inline_plan_from_config(purpose: str, config: dict[str, Any], *, require_model: bool = True) -> ResolvedAiChannelPlan:
    normalized_purpose = normalize_purpose(purpose)
    raw_targets = config.get("targets") if isinstance(config.get("targets"), list) else None
    if raw_targets:
        targets = [_target_from_inline(item, normalized_purpose, require_model=require_model) for item in raw_targets]
        targets = [ResolvedAiChannelTarget(**{**target.__dict__, "priority": index + 1}) for index, target in enumerate(targets)]
    else:
        targets = [_channel_to_target(_inline_channel_from_config(normalized_purpose, config, require_model=require_model), target_id="inline-1", priority=1)]
    return ResolvedAiChannelPlan(purpose=normalized_purpose, enabled=True, db_configured=False, targets=targets)


def _inline_channel_from_config(purpose: str, config: dict[str, Any], *, require_model: bool = True) -> ResolvedAiChannel:
    target = _target_from_inline(config, normalize_purpose(purpose), require_model=require_model)
    return _target_to_channel(target)


def test_channel_with_config(purpose: str, config: dict[str, Any]) -> dict[str, Any]:
    plan = _inline_plan_from_config(purpose, config)
    started = time.perf_counter()
    try:
        _, attempts, selected = _run_plan(plan, _test_channel_inline)
        total_ms = int((time.perf_counter() - started) * 1000)
        return _test_response(plan, ok=True, provider=selected.provider, model=selected.model, message="AI 渠道测试成功。", latency_ms=total_ms, attempts=attempts, selected=selected)
    except AiChannelError as exc:
        total_ms = int((time.perf_counter() - started) * 1000)
        provider = str(config.get("provider") or DEFAULTS.get(plan.purpose, {}).get("provider", "")).strip()
        model = str(config.get("model") or "").strip()
        return _test_response(plan, ok=False, provider=provider, model=model, message=exc.message, error_code=exc.code, latency_ms=total_ms)


def _ensure_channel_ready_for_models(channel: ResolvedAiChannel) -> None:
    if not channel.enabled:
        raise AiChannelError("channel_disabled", "该 AI 渠道已停用。")
    if not channel.api_key:
        raise AiChannelError("missing_api_key", "AI 渠道缺少 API Key，请先填写新 API Key 或可用的环境变量名。")
    if not channel.base_url:
        raise AiChannelError("invalid_channel_config", "AI 渠道缺少 Base URL。")
    parsed = urlparse(channel.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AiChannelError("invalid_channel_config", "Base URL 必须是有效的 HTTP(S) 地址。")


def _model_capabilities(model_id: str, purpose: str) -> list[str]:
    lowered = model_id.lower()
    if purpose == TEXT_PURPOSE:
        if any(token in lowered for token in ("embedding", "embed", "rerank", "moderation")):
            return []
        return [TEXT_PURPOSE]
    if any(token in lowered for token in ("image", "dall", "imagen", "flux", "stable-diffusion", "cogview")):
        return [IMAGE_PURPOSE]
    return []


def _normalize_models_payload(payload: Any, purpose: str, *, default_owner: str = "") -> list[dict[str, Any]]:
    raw_items = None
    if isinstance(payload, dict):
        for key in ("data", "models", "model_list"):
            if isinstance(payload.get(key), list):
                raw_items = payload[key]
                break
    else:
        raw_items = payload
    if not isinstance(raw_items, list):
        raise AiChannelError("models_parse_failed", "模型列表响应结构不可识别。")

    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_items:
        if isinstance(item, str):
            model_id = item.strip()
            label = model_id
            owned_by = default_owner
        elif isinstance(item, dict):
            model_id = str(item.get("id") or item.get("name") or "").strip()
            label = str(item.get("display_name") or item.get("label") or item.get("name") or model_id).strip()
            owned_by = str(item.get("owned_by") or item.get("owner") or default_owner or "").strip()
        else:
            continue
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({
            "id": model_id,
            "label": label or model_id,
            "owned_by": owned_by,
            "capabilities": _model_capabilities(model_id, purpose),
        })
        if len(models) >= 500:
            break
    return models


def _openai_model_endpoints(base_url: str) -> list[str]:
    normalized = base_url.rstrip("/")
    endpoints = [f"{normalized}/models"]
    parsed = urlparse(normalized)
    path = (parsed.path or "").rstrip("/")
    if not path.endswith("/v1"):
        endpoints.append(f"{normalized}/v1/models")
    return endpoints


def _list_models_openai(channel: ResolvedAiChannel) -> list[dict[str, Any]]:
    last_error: AiChannelError | None = None
    for endpoint in _openai_model_endpoints(channel.base_url):
        try:
            response = httpx.get(
                endpoint,
                headers={"Authorization": f"Bearer {channel.api_key}", "Accept": "application/json"},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            return _normalize_models_payload(payload, channel.purpose)
        except httpx.HTTPStatusError as exc:
            last_error = AiChannelError("models_fetch_failed", f"模型列表请求失败，HTTP {exc.response.status_code}。")
        except ValueError:
            last_error = AiChannelError("models_parse_failed", "模型列表响应不是合法 JSON。")
        except httpx.HTTPError:
            last_error = AiChannelError("models_fetch_failed", "模型列表请求失败，请检查 Base URL 和网络连接。")
    if last_error is not None:
        raise last_error
    raise AiChannelError("models_fetch_failed", "模型列表请求失败，请检查 Base URL。")


def _list_models_anthropic(channel: ResolvedAiChannel) -> list[dict[str, Any]]:
    if channel.purpose == IMAGE_PURPOSE:
        raise AiChannelError("unsupported_provider_for_purpose", "Anthropic 当前不支持作为生图渠道自动拉取模型。")
    base_url = channel.base_url.rstrip("/")
    endpoint = f"{base_url}/models" if "/v1" in base_url else f"{base_url}/v1/models"
    try:
        response = httpx.get(
            endpoint,
            headers={
                "x-api-key": channel.api_key,
                "anthropic-version": "2023-06-01",
                "Accept": "application/json",
            },
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPStatusError as exc:
        raise AiChannelError("models_fetch_failed", f"模型列表请求失败，HTTP {exc.response.status_code}。") from exc
    except ValueError as exc:
        raise AiChannelError("models_parse_failed", "模型列表响应不是合法 JSON。") from exc
    except httpx.HTTPError as exc:
        raise AiChannelError("models_fetch_failed", "模型列表请求失败，请检查 Base URL 和网络连接。") from exc
    return _normalize_models_payload(payload, channel.purpose, default_owner="anthropic")


def _models_response(channel: ResolvedAiChannel, *, ok: bool, message: str, error_code: str = "", models: list[dict[str, Any]] | None = None, latency_ms: int | None = None) -> dict[str, Any]:
    return {
        "purpose": channel.purpose,
        "provider": channel.provider,
        "protocol": channel.protocol,
        "base_url": channel.base_url,
        "ok": ok,
        "message": message,
        "error_code": error_code,
        "latency_ms": latency_ms,
        "models": models or [],
    }


def list_models_with_config(purpose: str, config: dict[str, Any], db: Session | None = None) -> dict[str, Any]:
    normalized_purpose = normalize_purpose(purpose)
    started = time.perf_counter()
    target_config = config.get("target") if isinstance(config.get("target"), dict) else config
    if db is not None and isinstance(target_config, dict) and target_config.get("id") and not str(target_config.get("api_key_value") or "").strip():
        try:
            plan = resolve_channel_plan(db, normalized_purpose)
            saved_target = next((target for target in plan.targets if target.id == str(target_config.get("id"))), None)
            if saved_target is not None:
                channel = _target_to_channel(saved_target)
                _ensure_channel_ready_for_models(channel)
                models = _list_models_anthropic(channel) if channel.protocol == PROTOCOL_ANTHROPIC else _list_models_openai(channel)
                message = "已获取模型列表。" if models else "接口可用，但未返回模型列表。"
                latency_ms = int((time.perf_counter() - started) * 1000)
                return _models_response(channel, ok=True, message=message, models=models, latency_ms=latency_ms)
        except AiChannelError:
            pass
    try:
        channel = _inline_channel_from_config(normalized_purpose, target_config, require_model=False)
        _ensure_channel_ready_for_models(channel)
        models = _list_models_anthropic(channel) if channel.protocol == PROTOCOL_ANTHROPIC else _list_models_openai(channel)
        message = "已获取模型列表。" if models else "接口可用，但未返回模型列表。"
        latency_ms = int((time.perf_counter() - started) * 1000)
        return _models_response(channel, ok=True, message=message, models=models, latency_ms=latency_ms)
    except AiChannelError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        try:
            channel = _inline_channel_from_config(normalized_purpose, target_config, require_model=False)
        except AiChannelError:
            defaults = DEFAULTS[normalized_purpose]
            channel = ResolvedAiChannel(
                purpose=normalized_purpose,
                provider=str(target_config.get("provider") or defaults["provider"]),
                base_url=str(target_config.get("base_url") or "").strip().rstrip("/"),
                model="",
                api_key="",
                api_key_env_var=str(target_config.get("api_key_env_var") or ""),
                api_key_source="missing",
                enabled=True,
                db_configured=False,
                protocol=PROTOCOL_OPENAI,
            )
        return _models_response(channel, ok=False, message=exc.message, error_code=exc.code, latency_ms=latency_ms)

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.encryption import decrypt_value, encrypt_value
from app.env import clean_env
from app.models import AiChannelConfig

logger = logging.getLogger(__name__)

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
        "api_key_env_var": "",
        "protocol": PROTOCOL_OPENAI,
    },
}

DEFAULTS = {
    IMAGE_PURPOSE: {
        "provider": "xai",
        "base_url": "https://api.x.ai/v1",
        "model": "grok-imagine-image",
        "api_key_env_var": "XAI_API_KEY",
        "protocol": PROTOCOL_OPENAI,
    },
    TEXT_PURPOSE: {
        "provider": "siliconflow",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "deepseek-ai/DeepSeek-V3",
        "api_key_env_var": "SILICONFLOW_API_KEY",
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
    normalized_purpose = normalize_purpose(purpose)
    config = db.query(AiChannelConfig).filter(AiChannelConfig.purpose == normalized_purpose).first()
    if config is None:
        return _fallback_channel(normalized_purpose)

    try:
        provider = normalize_provider(config.provider, normalized_purpose)
    except AiChannelError:
        logger.warning("Invalid AI channel provider in DB; falling back to defaults for purpose=%s", normalized_purpose)
        return _fallback_channel(normalized_purpose)

    defaults = provider_defaults(provider, normalized_purpose)
    base_url = (config.base_url or defaults["base_url"]).strip().rstrip("/")
    model = (config.model or defaults["model"]).strip()
    env_var = (config.api_key_env_var or defaults["api_key_env_var"]).strip()
    db_key = decrypt_value((config.api_key_value or "").strip())
    env_key = clean_env(env_var) if env_var else ""
    api_key = db_key or env_key
    api_key_source = "db" if db_key else "env" if env_key else "missing"

    return ResolvedAiChannel(
        purpose=normalized_purpose,
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


def channel_to_public_dict(channel: ResolvedAiChannel) -> dict[str, Any]:
    if not channel.enabled:
        message = "该 AI 渠道已停用。"
    elif channel.is_configured:
        message = "AI 渠道已配置，可用于生成。"
    elif not channel.has_api_key:
        message = "AI 渠道缺少 API Key。"
    else:
        message = "AI 渠道配置不完整。"

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
    }


def _normalize_extra_json(value: str | None) -> str:
    text = str(value or "{}").strip() or "{}"
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AiChannelError("invalid_channel_config", "Extra JSON 不是合法 JSON。") from exc
    if not isinstance(parsed, dict):
        raise AiChannelError("invalid_channel_config", "Extra JSON 必须是对象。")
    return json.dumps(parsed, ensure_ascii=False)


def _apply_channel_payload(config: AiChannelConfig, payload, purpose: str) -> None:
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
    if api_key_value is not None:
        config.api_key_value = encrypt_value(str(api_key_value).strip())
    if getattr(payload, "enabled", None) is not None:
        config.enabled = bool(payload.enabled)
    if getattr(payload, "extra_json", None) is not None:
        config.extra_json = _normalize_extra_json(payload.extra_json)
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


def _generate_image_from_channel(channel: ResolvedAiChannel, prompt: str, framing_hint: str = "") -> str:
    ensure_channel_ready(channel)
    full_prompt = f"{framing_hint}: {prompt}" if framing_hint else prompt
    try:
        response = httpx.post(
            f"{channel.base_url}/images/generations",
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
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        raise AiChannelError("generation_failed", f"生图请求失败，HTTP {exc.response.status_code}。") from exc
    except httpx.HTTPError as exc:
        raise AiChannelError("generation_failed", "生图请求失败，请稍后重试。") from exc

    image_url = (data.get("data") or [{}])[0].get("url")
    if not image_url:
        raise AiChannelError("generation_failed", "生图服务未返回可用图片地址。")
    return image_url


def _generate_text_openai(channel: ResolvedAiChannel, messages: list[dict[str, str]]) -> str:
    try:
        response = httpx.post(
            f"{channel.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {channel.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": channel.model,
                "messages": messages,
                "temperature": 0.2,
            },
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        raise AiChannelError("generation_failed", f"生文字请求失败，HTTP {exc.response.status_code}。") from exc
    except httpx.HTTPError as exc:
        raise AiChannelError("generation_failed", "生文字请求失败，请稍后重试。") from exc

    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
    if not content:
        raise AiChannelError("generation_failed", "生文字服务未返回可用内容。")
    return str(content)


def _generate_text_anthropic(channel: ResolvedAiChannel, messages: list[dict[str, str]]) -> str:
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
        "max_tokens": 1024,
        "messages": chat_messages,
    }
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
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        raise AiChannelError("generation_failed", f"生文字请求失败，HTTP {exc.response.status_code}。") from exc
    except httpx.HTTPError as exc:
        raise AiChannelError("generation_failed", "生文字请求失败，请稍后重试。") from exc

    content_blocks = data.get("content") or []
    text_parts = [block.get("text", "") for block in content_blocks if block.get("type") == "text" and block.get("text")]
    content = "\n".join(text_parts).strip()
    if not content:
        raise AiChannelError("generation_failed", "生文字服务未返回可用内容。")
    return content


def _generate_text_from_channel(channel: ResolvedAiChannel, messages: list[dict[str, str]]) -> str:
    ensure_channel_ready(channel)
    if channel.protocol == PROTOCOL_ANTHROPIC:
        return _generate_text_anthropic(channel, messages)
    return _generate_text_openai(channel, messages)


def generate_image_url(db: Session, prompt: str, framing_hint: str = "") -> str:
    channel = resolve_channel(db, IMAGE_PURPOSE)
    return _generate_image_from_channel(channel, prompt, framing_hint)


def generate_text(db: Session, messages: list[dict[str, str]]) -> str:
    channel = resolve_channel(db, TEXT_PURPOSE)
    return _generate_text_from_channel(channel, messages)


def _test_channel_inline(channel: ResolvedAiChannel) -> dict[str, Any]:
    if channel.purpose == IMAGE_PURPOSE:
        _generate_image_from_channel(channel, "A small editorial test image for API connectivity.", "API connectivity test")
    else:
        _generate_text_from_channel(channel, [{"role": "user", "content": "请回复 OK，用于测试 API 连通性。"}])
    return {
        "purpose": channel.purpose,
        "ok": True,
        "provider": channel.provider,
        "model": channel.model,
        "message": "AI 渠道测试成功。",
        "error_code": "",
    }


def test_channel(db: Session, purpose: str) -> dict[str, Any]:
    normalized_purpose = normalize_purpose(purpose)
    channel = resolve_channel(db, normalized_purpose)
    try:
        return _test_channel_inline(channel)
    except AiChannelError as exc:
        return {
            "purpose": normalized_purpose,
            "ok": False,
            "provider": channel.provider,
            "model": channel.model,
            "message": exc.message,
            "error_code": exc.code,
        }


def test_channel_with_config(purpose: str, config: dict[str, Any]) -> dict[str, Any]:
    normalized_purpose = normalize_purpose(purpose)
    provider = normalize_provider(config.get("provider"), normalized_purpose)
    defaults = provider_defaults(provider, normalized_purpose)
    base_url = str(config.get("base_url") or defaults["base_url"]).strip().rstrip("/")
    model = str(config.get("model") or defaults["model"]).strip()
    env_var = str(config.get("api_key_env_var") or defaults["api_key_env_var"]).strip()
    api_key = str(config.get("api_key_value") or "").strip()
    if not api_key and env_var:
        api_key = clean_env(env_var) or ""
    protocol = defaults.get("protocol", PROTOCOL_OPENAI)

    channel = ResolvedAiChannel(
        purpose=normalized_purpose,
        provider=provider,
        base_url=base_url,
        model=model,
        api_key=api_key,
        api_key_env_var=env_var,
        api_key_source="inline" if api_key else ("env" if clean_env(env_var) else "missing"),
        enabled=True,
        db_configured=False,
        protocol=protocol,
    )
    try:
        return _test_channel_inline(channel)
    except AiChannelError as exc:
        return {
            "purpose": normalized_purpose,
            "ok": False,
            "provider": provider,
            "model": model,
            "message": exc.message,
            "error_code": exc.code,
        }

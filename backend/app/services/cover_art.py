import json
import re
from functools import lru_cache
from pathlib import Path

from app.models import Post, Series, SiteSettings, TopicProfile

_COVER_ART_CONFIG_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "config" / "cover-art-direction.json"
)

_MANUAL_PROMPT_PREFIX_RE = re.compile(
    r"^(?:wide|horizontal|landscape|vertical|4:5|banner|poster|cinematic|high quality|premium|homepage hero)[^:]*:\s*",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def load_cover_art_config() -> dict:
    try:
        raw = _COVER_ART_CONFIG_PATH.read_text(encoding="utf-8")
        parsed = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        parsed = {}

    presets = parsed.get("presets") if isinstance(parsed.get("presets"), dict) else {}
    return {
        "version": str(parsed.get("version") or "2026-04-editorial-tech-v1").strip(),
        "brand_palette": [
            str(item).strip() for item in parsed.get("brand_palette", []) if str(item).strip()
        ],
        "brand_motifs": [
            str(item).strip() for item in parsed.get("brand_motifs", []) if str(item).strip()
        ],
        "layout_rules": [
            str(item).strip() for item in parsed.get("layout_rules", []) if str(item).strip()
        ],
        "negative_rules": [
            str(item).strip() for item in parsed.get("negative_rules", []) if str(item).strip()
        ],
        "presets": {
            key: {
                "label": str(value.get("label") or "").strip(),
                "orientation": str(value.get("orientation") or "").strip(),
                "framing_hint": str(value.get("framing_hint") or "").strip(),
                "prompt_clause": str(value.get("prompt_clause") or "").strip(),
                "safe_area_clause": str(value.get("safe_area_clause") or "").strip(),
            }
            for key, value in presets.items()
            if isinstance(value, dict)
        },
    }


def cover_art_version() -> str:
    return str(load_cover_art_config().get("version") or "").strip()


def preset_framing_hint(preset: str) -> str:
    presets = load_cover_art_config().get("presets", {})
    details = presets.get(preset) if isinstance(presets, dict) else None
    if isinstance(details, dict):
        framing_hint = str(details.get("framing_hint") or "").strip()
        if framing_hint:
            return framing_hint
    return "Wide landscape editorial banner, high quality"


def sanitize_cover_prompt(prompt: str) -> str:
    sanitized = str(prompt or "").strip()
    sanitized = sanitized.replace("\n", " ")
    sanitized = re.sub(r"^['\"`]+|['\"`]+$", "", sanitized)
    sanitized = _MANUAL_PROMPT_PREFIX_RE.sub("", sanitized)
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized


def _strip_markdown(value: str, max_chars: int = 320) -> str:
    text = str(value or "")
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"`[^`]*`", " ", text)
    text = re.sub(r"!\[[^\]]*]\([^)]*\)", " ", text)
    text = re.sub(r"\[[^\]]*]\([^)]*\)", " ", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[>*_|-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}..."


def extract_post_headings(content_md: str, limit: int = 4) -> list[str]:
    headings: list[str] = []
    for line in str(content_md or "").splitlines():
        match = re.match(r"^##+\s+(.*)$", line.strip())
        if not match:
            continue
        heading = match.group(1).strip()
        if not heading:
            continue
        headings.append(heading)
        if len(headings) >= limit:
            break
    return headings


def _build_brand_clause(config: dict) -> str:
    palette = ", ".join(config.get("brand_palette", []))
    motifs = ", ".join(config.get("brand_motifs", []))
    layout = ", ".join(config.get("layout_rules", []))
    return (
        "Use a restrained premium AI editorial visual system with "
        f"{palette}. Include {motifs}. Composition rules: {layout}."
    )


def _build_negative_clause(config: dict) -> str:
    negative = ", ".join(config.get("negative_rules", []))
    return f"Strictly exclude {negative}."


def _build_content_clause(preset: str, content_hint: str, extra_hints: list[str]) -> str:
    default_map = {
        "site_hero": "Express a curated AI editorial identity instead of a literal product advertisement.",
        "post_cover": "Translate the article topic into one strong abstract visual metaphor rather than a literal screenshot.",
        "series_cover": "Express a stable recurring content lane instead of a one-off news event.",
        "topic_cover": "Express continuity, momentum, and long-term topic tracking instead of a single news moment.",
    }
    parts = [default_map.get(preset, "Use one polished editorial visual metaphor.")]
    if content_hint:
        parts.append(content_hint)
    parts.extend([hint for hint in extra_hints if hint])
    return " ".join(parts)


def build_cover_prompt(
    preset: str,
    *,
    manual_prompt: str = "",
    content_hint: str = "",
    extra_hints: list[str] | None = None,
) -> str:
    config = load_cover_art_config()
    presets = config.get("presets", {})
    preset_details = presets.get(preset) if isinstance(presets, dict) else None
    prompt_clause = (
        str(preset_details.get("prompt_clause") or "").strip()
        if isinstance(preset_details, dict)
        else ""
    )
    safe_area_clause = (
        str(preset_details.get("safe_area_clause") or "").strip()
        if isinstance(preset_details, dict)
        else ""
    )

    sanitized_manual = sanitize_cover_prompt(manual_prompt)
    content_clause = _build_content_clause(
        preset,
        sanitized_manual or content_hint,
        extra_hints or [],
    )

    parts = [
        prompt_clause,
        _build_brand_clause(config),
        safe_area_clause,
        content_clause,
        _build_negative_clause(config),
    ]
    return " ".join(part for part in parts if part).strip()


def build_site_hero_prompt(settings: SiteSettings | None = None, manual_prompt: str = "") -> str:
    extra_hints = [
        "Primary subject: a single sculptural glass signal tower or luminous knowledge beacon, not a robot, not a person, not a UI screen.",
        "Scene design: dark editorial studio atmosphere, soft volumetric light, layered translucent data ribbons, subtle geometric grid, refined depth of field.",
        "Quality target: premium magazine cover art, elegant 3D editorial illustration, calm and trustworthy, no clutter, no cheap neon, no random icons.",
        "Composition: vertical 4:5 poster, centered hero object, clear silhouette, generous negative space, suitable for a homepage right-side poster stage.",
    ]
    if settings and (settings.author_name or "").strip():
        extra_hints.append(f"Brand voice: curated by {settings.author_name.strip()}.")
    if settings and (settings.bio or "").strip():
        extra_hints.append(f"Editorial character: {_strip_markdown(settings.bio, 180)}.")
    return build_cover_prompt(
        "site_hero",
        manual_prompt=manual_prompt,
        content_hint="Represent an AI editorial observatory: collecting signals, filtering noise, and turning fast AI news into calm insight. The image should feel iconic, quiet, premium, and immediately usable as a blog homepage poster.",
        extra_hints=extra_hints,
    )


def build_series_cover_prompt(
    series: Series,
    recent_post: Post | None = None,
    manual_prompt: str = "",
) -> str:
    extra_hints = []
    if (series.title or "").strip():
        extra_hints.append(f"Series title: {series.title.strip()}.")
    if (series.description or "").strip():
        extra_hints.append(f"Series description: {_strip_markdown(series.description, 180)}.")
    if recent_post and (recent_post.title or "").strip():
        extra_hints.append(f"Representative article: {recent_post.title.strip()}.")
    return build_cover_prompt(
        "series_cover",
        manual_prompt=manual_prompt,
        content_hint="Build a stable editorial banner that feels like a recurring reading lane with layered information flow.",
        extra_hints=extra_hints,
    )


def build_topic_cover_prompt(
    profile: TopicProfile,
    recent_post: Post | None = None,
    manual_prompt: str = "",
) -> str:
    aliases = []
    try:
        aliases = json.loads(profile.aliases_json or "[]")
    except (TypeError, json.JSONDecodeError):
        aliases = []

    extra_hints = []
    topic_name = (profile.title or profile.topic_key or "").strip()
    if topic_name:
        extra_hints.append(f"Topic: {topic_name}.")
    if (profile.description or "").strip():
        extra_hints.append(f"Topic description: {_strip_markdown(profile.description, 180)}.")
    alias_text = ", ".join(str(item).strip() for item in aliases if str(item).strip())
    if alias_text:
        extra_hints.append(f"Aliases: {alias_text}.")
    if recent_post and (recent_post.title or "").strip():
        extra_hints.append(f"Recent article: {recent_post.title.strip()}.")
    if recent_post and (recent_post.summary or "").strip():
        extra_hints.append(f"Recent summary: {_strip_markdown(recent_post.summary, 180)}.")
    return build_cover_prompt(
        "topic_cover",
        manual_prompt=manual_prompt,
        content_hint="Show long-term tracking energy, momentum, and structured signal flow rather than a single literal event.",
        extra_hints=extra_hints,
    )


def build_post_cover_prompt(post: Post, artifact_prompt: str = "", manual_prompt: str = "") -> str:
    headings = extract_post_headings(post.content_md or "")
    summary = _strip_markdown(post.summary or "", 220)
    extra_hints = []
    if (post.title or "").strip():
        extra_hints.append(f"Article title: {post.title.strip()}.")
    if summary:
        extra_hints.append(f"Summary: {summary}.")
    if headings:
        extra_hints.append(f"Key angles: {'; '.join(headings[:3])}.")
    if (post.topic_key or "").strip():
        extra_hints.append(f"Topic line: {post.topic_key.strip()}.")
    return build_cover_prompt(
        "post_cover",
        manual_prompt=manual_prompt or artifact_prompt,
        content_hint="Translate the article into one clear abstract editorial metaphor that feels native to a polished tech publication.",
        extra_hints=extra_hints,
    )

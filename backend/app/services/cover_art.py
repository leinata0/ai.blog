import json
import re
from functools import lru_cache
from hashlib import sha1
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
        "post_cover_v3": parsed.get("post_cover_v3") if isinstance(parsed.get("post_cover_v3"), dict) else {},
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


def post_cover_prompt_version() -> str:
    config = load_cover_art_config().get("post_cover_v3", {})
    return str(config.get("prompt_version") or "post-cover-v3").strip()


def post_cover_history_window() -> int:
    config = load_cover_art_config().get("post_cover_v3", {})
    return max(1, min(int(config.get("history_window") or 12), 50))


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


def normalize_cover_brief(prompt: str, max_chars: int = 700) -> str:
    brief = sanitize_cover_prompt(prompt)
    if not brief:
        return ""
    legacy_markers = (
        "A horizontal editorial cover banner",
        "Use a blue-white editorial technology aesthetic",
        "Use a restrained premium AI editorial visual system",
    )
    if any(marker.lower() in brief.lower() for marker in legacy_markers):
        extracted = []
        manual = re.search(
            r"Translate the article topic[^.]*\.\s*(.*?)(?=\s+Article title:|\s+Summary:|\s+Key angles:|\s+Topic line:|\s+Signal hints:|\s+Strictly exclude)",
            brief,
            flags=re.IGNORECASE,
        )
        if manual and manual.group(1).strip() and "clear abstract editorial metaphor" not in manual.group(1).lower():
            extracted.append(f"Editorial idea: {manual.group(1).strip()}")
        labels = ("Article title", "Summary", "Key angles", "Topic line", "Signal hints")
        next_labels = "|".join(re.escape(item) for item in labels)
        for label in labels:
            match = re.search(
                rf"{re.escape(label)}:\s*(.*?)(?=\s+(?:{next_labels}):|\s+Strictly exclude|$)",
                brief,
                flags=re.IGNORECASE,
            )
            if match and match.group(1).strip():
                extracted.append(f"{label}: {match.group(1).strip().rstrip('.')}")
        brief = ". ".join(extracted)
    return brief[:max_chars].rstrip()


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


_GENERIC_CLICHES = (
    "glowing ai brain",
    "humanoid robot",
    "robot mascot",
    "holographic dashboard",
    "circuit board",
    "glass signal tower",
    "blue-purple cyberpunk",
)

_COMPOSITION_KEYS = (
    "asymmetric_left",
    "asymmetric_right",
    "aerial_wide",
    "diagonal_flow",
    "split_tension",
    "layered_depth",
    "centered_object",
)

_DEFAULT_POST_COVER_STYLES = (
    {
        "key": "conceptual_still_life",
        "label": "conceptual editorial still life",
        "medium": "carefully staged editorial still life using article-specific physical objects",
        "topic_hints": [],
        "default_palette": "article-specific neutral tones with one controlled accent",
        "default_texture": "paper, glass, metal or ceramic material detail",
    },
    {
        "key": "paper_cut",
        "label": "paper-cut editorial illustration",
        "medium": "layered tactile paper-cut editorial illustration",
        "topic_hints": [],
        "default_palette": "limited print palette chosen from the article mood",
        "default_texture": "paper fibers and subtle print registration",
    },
    {
        "key": "restrained_3d",
        "label": "restrained 3D object study",
        "medium": "restrained 3D study of one article-specific physical metaphor",
        "topic_hints": [],
        "default_palette": "article-specific studio palette without default neon blue",
        "default_texture": "high-quality physical materials with soft studio light",
    },
)


def post_cover_style_catalog() -> list[dict]:
    raw = load_cover_art_config().get("post_cover_v3", {}).get("styles", [])
    catalog = [item for item in raw if isinstance(item, dict) and str(item.get("key") or "").strip()]
    return catalog or [dict(item) for item in _DEFAULT_POST_COVER_STYLES]


def _post_cover_corpus(post: Post) -> str:
    context = _post_cover_context(post)
    return " ".join([
        context["title"], context["summary"], context["topic_key"], context["content_type"],
        " ".join(context["headings"]), context["body_preview"],
    ]).lower()


def applicable_post_cover_style_keys(post: Post) -> set[str]:
    catalog = post_cover_style_catalog()
    corpus = _post_cover_corpus(post)
    matched = {
        str(item.get("key"))
        for item in catalog
        if any(str(hint).strip().lower() in corpus for hint in item.get("topic_hints", []) if str(hint).strip())
    }
    if not matched:
        return {str(item.get("key")) for item in catalog}
    versatile = {"conceptual_still_life", "paper_cut", "restrained_3d"}
    return matched | versatile


def _post_cover_context(post: Post) -> dict:
    headings = extract_post_headings(post.content_md or "", limit=5)
    return {
        "title": str(post.title or "").strip(),
        "summary": _strip_markdown(post.summary or "", 320),
        "headings": headings,
        "topic_key": str(post.topic_key or "").strip(),
        "content_type": str(post.content_type or "post").strip(),
        "body_preview": _strip_markdown(post.content_md or "", 1200),
    }


def build_post_cover_direction_messages(
    post: Post,
    *,
    cover_brief: str = "",
    recent_directions: list[dict] | None = None,
) -> list[dict[str, str]]:
    allowed_style_keys = applicable_post_cover_style_keys(post)
    styles = [item for item in post_cover_style_catalog() if str(item.get("key")) in allowed_style_keys]
    style_payload = [
        {
            "key": item.get("key"),
            "label": item.get("label"),
            "medium": item.get("medium"),
            "topic_hints": item.get("topic_hints", []),
        }
        for item in styles
    ]
    recent_payload = [
        {
            "style_key": item.get("style_key"),
            "composition_key": item.get("composition_key"),
            "palette_key": item.get("palette_key"),
            "fingerprint": item.get("fingerprint"),
        }
        for item in (recent_directions or [])[:post_cover_history_window()]
        if isinstance(item, dict)
    ]
    system = "\n".join([
        "You are the art director for a Chinese AI and technology publication.",
        "Create exactly three strongly differentiated visual direction candidates for one article cover.",
        "Return JSON only with a top-level candidates array.",
        "Every candidate must contain: style_key, content_anchors, visual_metaphor, primary_subject, setting, palette_key, palette, composition_key, lighting, texture, avoid.",
        f"style_key must be one of: {', '.join(str(item.get('key')) for item in styles)}.",
        f"composition_key must be one of: {', '.join(_COMPOSITION_KEYS)}.",
        "content_anchors must contain 2-4 concrete facts, tensions or entities from this article, not generic AI language.",
        "The three candidates must use different style_key and composition_key values.",
        "Choose content-first subjects and palettes. Do not impose a recurring brand object or fixed blue-purple palette.",
        "Do not use readable text, logos, UI screenshots, code editors, human faces, hands, robots, glowing AI brains, holographic dashboards or circuit-board backgrounds.",
        "Design for a wide 16:9 editorial cover with a calm lower overlay-safe area.",
    ])
    user_payload = {
        "article": _post_cover_context(post),
        "cover_brief": normalize_cover_brief(cover_brief),
        "available_styles": style_payload,
        "recent_successful_covers_to_avoid_repeating": recent_payload,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]


def _parse_json_object(raw: str) -> dict:
    text = str(raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _clean_list(value, limit: int = 8, max_item_chars: int = 180) -> list[str]:
    if isinstance(value, str):
        value = re.split(r"[,;，；]", value)
    if not isinstance(value, list):
        return []
    cleaned = []
    seen = set()
    for item in value:
        text = str(item).strip()[:max_item_chars].rstrip()
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
        if len(cleaned) >= limit:
            break
    return cleaned


def _slug_key(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return normalized[:60] or fallback


def _direction_fingerprint(direction: dict) -> str:
    source = "|".join([
        str(direction.get("style_key") or ""),
        str(direction.get("composition_key") or ""),
        str(direction.get("palette_key") or ""),
        re.sub(r"\W+", " ", str(direction.get("primary_subject") or "").lower()).strip(),
    ])
    return sha1(source.encode("utf-8")).hexdigest()[:16]


def _anchor_units(value: str) -> set[str]:
    text = str(value or "").lower()
    units = set(re.findall(r"[a-z0-9][a-z0-9_-]{2,}", text))
    for chunk in re.findall(r"[\u3400-\u9fff]{2,}", text):
        units.update(chunk[index:index + 2] for index in range(len(chunk) - 1))
    return units


def _article_anchor_is_relevant(anchor: str, article_corpus: str, article_units: set[str]) -> bool:
    normalized_anchor = re.sub(r"\s+", "", str(anchor or "").lower())
    normalized_corpus = re.sub(r"\s+", "", article_corpus)
    if len(normalized_anchor) >= 4 and normalized_anchor in normalized_corpus:
        return True
    anchor_units = _anchor_units(anchor)
    if not anchor_units:
        return False
    overlap = anchor_units & article_units
    return len(overlap) >= min(2, len(anchor_units))


def _normalize_direction(raw: dict, post: Post, *, index: int) -> dict | None:
    if not isinstance(raw, dict):
        return None
    catalog = {str(item.get("key")): item for item in post_cover_style_catalog()}
    style_key = str(raw.get("style_key") or "").strip()
    if style_key not in catalog or style_key not in applicable_post_cover_style_keys(post):
        return None
    article_corpus = _post_cover_corpus(post)
    article_units = _anchor_units(article_corpus)
    anchors = [
        anchor
        for anchor in _clean_list(raw.get("content_anchors"), 4)
        if _article_anchor_is_relevant(anchor, article_corpus, article_units)
    ]
    if len(anchors) < 2:
        return None
    direction = {
        "candidate_index": index,
        "style_key": style_key,
        "style_label": str(catalog[style_key].get("label") or style_key),
        "content_anchors": anchors,
        "visual_metaphor": str(raw.get("visual_metaphor") or "").strip()[:300],
        "primary_subject": str(raw.get("primary_subject") or "").strip()[:300],
        "setting": str(raw.get("setting") or "").strip()[:300],
        "palette_key": _slug_key(raw.get("palette_key") or raw.get("palette"), "article_specific"),
        "palette": str(raw.get("palette") or catalog[style_key].get("default_palette") or "article-specific restrained palette").strip()[:240],
        "composition_key": str(raw.get("composition_key") or "").strip(),
        "lighting": str(raw.get("lighting") or "soft editorial lighting").strip()[:180],
        "texture": str(raw.get("texture") or catalog[style_key].get("default_texture") or "subtle material detail").strip()[:180],
        "avoid": _clean_list(raw.get("avoid"), 8),
    }
    if direction["composition_key"] not in _COMPOSITION_KEYS:
        return None
    concrete = " ".join([
        direction["visual_metaphor"],
        direction["primary_subject"],
        direction["setting"],
    ]).lower()
    if not direction["primary_subject"] or any(item in concrete for item in _GENERIC_CLICHES):
        return None
    direction["fingerprint"] = _direction_fingerprint(direction)
    return direction


def _score_direction(direction: dict, recent_directions: list[dict]) -> tuple[int, list[str]]:
    score = 100 - int(direction.get("candidate_index") or 0) * 3
    reasons = ["content-valid"]
    recent = [
        item for item in recent_directions if isinstance(item, dict)
    ][:post_cover_history_window()]
    if any(item.get("fingerprint") == direction.get("fingerprint") for item in recent):
        score -= 50
        reasons.append("fingerprint-repeat:-50")
    if any(item.get("style_key") == direction.get("style_key") for item in recent[:2]):
        score -= 35
        reasons.append("recent-style:-35")
    if any(item.get("composition_key") == direction.get("composition_key") for item in recent[:3]):
        score -= 20
        reasons.append("recent-composition:-20")
    if any(item.get("palette_key") == direction.get("palette_key") for item in recent[:4]):
        score -= 15
        reasons.append("recent-palette:-15")
    score += min(len(direction.get("content_anchors") or []), 4) * 5
    reasons.append(f"content-anchors:+{min(len(direction.get('content_anchors') or []), 4) * 5}")
    return score, reasons


def _fallback_style_keys(post: Post) -> list[str]:
    corpus = _post_cover_corpus(post)
    allowed = applicable_post_cover_style_keys(post)
    catalog = [item for item in post_cover_style_catalog() if str(item.get("key")) in allowed]
    ranked = []
    for item in catalog:
        hits = sum(1 for hint in item.get("topic_hints", []) if str(hint).lower() in corpus)
        ranked.append((hits, str(item.get("key"))))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [key for _, key in ranked]


def _fallback_post_cover_candidates(post: Post, recent_directions: list[dict] | None = None) -> list[dict]:
    recent = recent_directions or []
    catalog = {str(item.get("key")): item for item in post_cover_style_catalog()}
    context = _post_cover_context(post)
    anchors = [item for item in [context["title"], context["summary"], *context["headings"]] if item][:3]
    while len(anchors) < 2:
        anchors.append(context["topic_key"] or context["content_type"] or "article thesis")
    candidates = []
    for index, style_key in enumerate(_fallback_style_keys(post)):
        style = catalog[style_key]
        composition_key = _COMPOSITION_KEYS[(index + (int(getattr(post, "id", 0) or 0) % len(_COMPOSITION_KEYS))) % len(_COMPOSITION_KEYS)]
        direction = {
            "candidate_index": index,
            "style_key": style_key,
            "style_label": str(style.get("label") or style_key),
            "content_anchors": anchors,
            "visual_metaphor": f"A physical editorial metaphor for the tension expressed by {anchors[0]}",
            "primary_subject": "a small set of article-specific physical structures or objects showing pressure, movement and consequence",
            "setting": "a credible editorial environment derived from the article rather than a generic technology backdrop",
            "palette_key": f"{style_key}_adaptive",
            "palette": str(style.get("default_palette") or "article-specific restrained palette"),
            "composition_key": composition_key,
            "lighting": "controlled editorial lighting matched to the article mood",
            "texture": str(style.get("default_texture") or "subtle physical texture"),
            "avoid": [],
            "fallback": True,
        }
        direction["fingerprint"] = _direction_fingerprint(direction)
        candidates.append(direction)
    for candidate in candidates:
        candidate["score"], candidate["score_reasons"] = _score_direction(candidate, recent)
    return candidates


def fallback_post_cover_direction(post: Post, recent_directions: list[dict] | None = None) -> dict:
    candidates = _fallback_post_cover_candidates(post, recent_directions)[:3]
    selected = max(candidates, key=lambda item: item["score"])
    return {
        "candidates": candidates,
        "selected": selected,
        "source": "deterministic_fallback",
        "prompt_version": post_cover_prompt_version(),
        "style_summary": f"{selected['style_label']} · {selected['composition_key'].replace('_', ' ')} · {selected['palette']}",
    }


def select_post_cover_direction(raw: str, post: Post, recent_directions: list[dict] | None = None) -> dict:
    recent = recent_directions or []
    parsed = _parse_json_object(raw)
    raw_candidates = parsed.get("candidates") if isinstance(parsed.get("candidates"), list) else []
    candidates = []
    used_styles = set()
    used_compositions = set()
    for index, item in enumerate(raw_candidates[:6]):
        candidate = _normalize_direction(item, post, index=index)
        if candidate is None:
            continue
        if candidate["style_key"] in used_styles or candidate["composition_key"] in used_compositions:
            continue
        candidates.append(candidate)
        used_styles.add(candidate["style_key"])
        used_compositions.add(candidate["composition_key"])
        if len(candidates) >= 3:
            break
    if not candidates:
        return fallback_post_cover_direction(post, recent)
    accepted_model_count = len(candidates)
    for fallback_candidate in _fallback_post_cover_candidates(post, recent):
        if len(candidates) >= 3:
            break
        if fallback_candidate["style_key"] in used_styles or fallback_candidate["composition_key"] in used_compositions:
            continue
        fallback_candidate = {**fallback_candidate, "candidate_index": len(candidates), "fallback": True}
        candidates.append(fallback_candidate)
        used_styles.add(fallback_candidate["style_key"])
        used_compositions.add(fallback_candidate["composition_key"])
    if len(candidates) < 3:
        return fallback_post_cover_direction(post, recent)
    for candidate in candidates:
        candidate["score"], candidate["score_reasons"] = _score_direction(candidate, recent)
    selected = max(candidates, key=lambda item: item["score"])
    return {
        "candidates": candidates[:3],
        "selected": selected,
        "source": "text_model" if accepted_model_count == 3 else "text_model_with_fallback",
        "prompt_version": post_cover_prompt_version(),
        "style_summary": f"{selected['style_label']} · {selected['composition_key'].replace('_', ' ')} · {selected['palette']}",
        "validation": {
            "received_candidates": len(raw_candidates),
            "accepted_model_candidates": accepted_model_count,
            "fallback_candidates_added": max(0, len(candidates) - accepted_model_count),
        },
    }


def compile_post_cover_prompt(post: Post, direction: dict, *, cover_brief: str = "") -> str:
    config = load_cover_art_config().get("post_cover_v3", {})
    selected = direction.get("selected") if isinstance(direction.get("selected"), dict) else direction
    catalog = {str(item.get("key")): item for item in post_cover_style_catalog()}
    style = catalog.get(str(selected.get("style_key") or ""), {})
    anchors = _clean_list(selected.get("content_anchors"), 4)
    avoid = _clean_list([
        *_clean_list(config.get("negative_rules"), 30),
        *_clean_list(selected.get("avoid"), 8),
    ], 38, 100)
    brief = normalize_cover_brief(cover_brief)
    content_connection = f"Article connection: {'; '.join(anchors)}"
    if brief:
        content_connection += f". Editorial brief: {brief[:220]}"

    def bounded(text: str, max_chars: int) -> str:
        normalized = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(normalized) > max_chars:
            normalized = normalized[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;:.")
        return normalized.rstrip(" ,;:.") + "."

    parts = [
        bounded(f"Subject and scene: {selected.get('primary_subject', '')} in {selected.get('setting', '')}; visual metaphor: {selected.get('visual_metaphor', '')}", 260),
        bounded(content_connection, 300),
        bounded(f"Medium and finish: {style.get('medium') or selected.get('style_label')}; {selected.get('texture', '')}", 190),
        bounded(f"Palette and light: {selected.get('palette', '')}; {selected.get('lighting', '')}", 160),
        bounded(f"Composition: {selected.get('composition_key', '').replace('_', ' ')}; {'; '.join(_clean_list(config.get('universal_rules'), 10))}", 230),
        bounded(f"Exclude: {', '.join(avoid)}", 380),
    ]
    prompt = re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()
    prompt = re.sub(r"\b(vertical|portrait|4:5)\b", "", prompt, flags=re.IGNORECASE)
    prompt = re.sub(r"\s+", " ", prompt).strip()
    return prompt[:1600].rstrip(" ,;.") + "."


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

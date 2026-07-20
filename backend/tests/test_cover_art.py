import json

from app.models import Post
from app.services import cover_art


def _post() -> Post:
    return Post(
        id=17,
        title="Agent tool permissions collide with deployment speed",
        slug="agent-tool-permissions",
        summary="Agent workflows need strict tool permissions without blocking fast deployment.",
        content_md=(
            "## Permission boundaries\n\nTeams define tool access and audit rules.\n\n"
            "## Deployment speed\n\nAutomation shortens the path to production."
        ),
        topic_key="agent-workflows",
        content_type="daily_brief",
    )


def _candidate(style_key, composition_key, palette_key, subject, anchors=None):
    return {
        "style_key": style_key,
        "content_anchors": anchors or ["tool permissions", "deployment speed"],
        "visual_metaphor": "a controlled passage balancing access and velocity",
        "primary_subject": subject,
        "setting": "a credible operations environment",
        "palette_key": palette_key,
        "palette": "warm neutral materials with one amber accent",
        "composition_key": composition_key,
        "lighting": "controlled editorial side light",
        "texture": "tactile paper and matte metal",
        "avoid": ["random icons"],
    }


def test_post_cover_v3_selects_relevant_non_repeated_direction_and_keeps_three_candidates():
    post = _post()
    raw = json.dumps({
        "candidates": [
            _candidate("isometric_system", "asymmetric_left", "amber_slate", "a permission gate beside a fast workflow track"),
            _candidate("conceptual_still_life", "split_tension", "paper_charcoal", "a sealed key and a release lever on one table"),
            _candidate("paper_cut", "diagonal_flow", "ochre_ink", "layered paper lanes passing through access checkpoints"),
        ]
    })
    recent = [{
        "style_key": "isometric_system",
        "composition_key": "asymmetric_left",
        "palette_key": "amber_slate",
        "fingerprint": "another-fingerprint",
    }]

    result = cover_art.select_post_cover_direction(raw, post, recent)

    assert result["prompt_version"] == "post-cover-v3"
    assert result["source"] == "text_model"
    assert len(result["candidates"]) == 3
    assert result["selected"]["style_key"] == "conceptual_still_life"
    repeated = result["candidates"][0]
    assert "recent-style:-35" in repeated["score_reasons"]
    assert "recent-composition:-20" in repeated["score_reasons"]
    assert "recent-palette:-15" in repeated["score_reasons"]


def test_post_cover_v3_regeneration_avoids_the_same_article_fingerprint():
    post = _post()
    raw = json.dumps({
        "candidates": [
            _candidate("isometric_system", "asymmetric_left", "amber_slate", "a permission gate beside a fast workflow track"),
            _candidate("conceptual_still_life", "split_tension", "paper_charcoal", "a sealed key and a release lever on one table"),
            _candidate("paper_cut", "diagonal_flow", "ochre_ink", "layered paper lanes passing through access checkpoints"),
        ]
    })
    first = cover_art.select_post_cover_direction(raw, post, [])

    regenerated = cover_art.select_post_cover_direction(raw, post, [first["selected"]])

    assert regenerated["selected"]["fingerprint"] != first["selected"]["fingerprint"]
    repeated = next(item for item in regenerated["candidates"] if item["fingerprint"] == first["selected"]["fingerprint"])
    assert "fingerprint-repeat:-50" in repeated["score_reasons"]


def test_post_cover_v3_rejects_unrelated_anchors_and_generic_ai_cliches_with_fallback():
    post = _post()
    raw = json.dumps({
        "candidates": [
            _candidate(
                "restrained_3d",
                "centered_object",
                "neon_blue",
                "a glowing AI brain operated by a humanoid robot",
                anchors=["quantum ocean", "space tourism"],
            )
        ]
    })

    result = cover_art.select_post_cover_direction(raw, post, [])

    assert result["source"] == "deterministic_fallback"
    assert len(result["candidates"]) == 3
    assert len(result["selected"]["content_anchors"]) >= 2
    assert result["selected"]["fallback"] is True


def test_post_cover_v3_prompt_order_safety_rules_and_legacy_brief_compatibility():
    post = _post()
    direction = cover_art.fallback_post_cover_direction(post, [])
    legacy_prompt = (
        "A horizontal editorial cover banner. Use a blue-white editorial technology aesthetic. "
        "Translate the article topic into one strong abstract visual metaphor rather than a literal screenshot. "
        "A locked tool gate beside a fast release path. Article title: Agent tool permissions collide with deployment speed. "
        "Summary: Agent workflows need strict tool permissions. Key angles: Permission boundaries; Deployment speed. "
        "Strictly exclude readable text."
    )

    brief = cover_art.normalize_cover_brief(legacy_prompt)
    prompt = cover_art.compile_post_cover_prompt(post, direction, cover_brief=legacy_prompt)

    assert "Article title: Agent tool permissions" in brief
    assert "blue-white editorial technology aesthetic" not in brief
    assert prompt.index("Subject and scene:") < prompt.index("Article connection:")
    assert prompt.index("Article connection:") < prompt.index("Medium and finish:")
    assert prompt.index("Medium and finish:") < prompt.index("Palette and light:")
    assert prompt.index("Palette and light:") < prompt.index("Composition:")
    assert prompt.index("Composition:") < prompt.index("Exclude:")
    assert "wide 16:9 landscape editorial cover" in prompt
    assert "overlay-safe area" in prompt
    assert "readable text" in prompt
    assert "glass signal tower" not in prompt
    assert "Use a blue-white editorial technology aesthetic" not in prompt
    assert "Palette and light: blue-purple" not in prompt
    assert "vertical" not in prompt.lower()
    assert "portrait" not in prompt.lower()
    assert "4:5" not in prompt
    assert len(prompt) <= 1600

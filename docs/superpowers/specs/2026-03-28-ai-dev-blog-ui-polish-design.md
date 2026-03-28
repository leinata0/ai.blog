# AI Dev Blog UI Polish Design

**Date:** 2026-03-28

## Goal
Refine the existing AI developer blog UI into a warmer, more editorial reading experience while preserving the current information architecture and behavior. The polish must avoid pure black (`#000`), pure white (`#fff`), and common blue-purple AI gradients.

## Design Direction
Adopt a **Warm Editorial Minimal** visual language:

- warm charcoal and stone-gray surfaces instead of cold zinc-heavy blacks
- restrained moss/herb green accents instead of neon emerald or blue-violet gradients
- stronger typography hierarchy with a high-legibility sans-serif stack
- more deliberate whitespace and vertical rhythm across hero, filters, cards, and article detail
- calmer component chrome so content feels primary

## Non-Negotiable Constraints
- Do not use `#000` or `#fff`
- Do not introduce blue, indigo, violet, or purple hero/ambient gradients
- Do not change the app structure, routes, or data flow for this polish pass
- Do not turn the blog into a SaaS marketing aesthetic

## Visual System

### 1. Color Palette
Move from cold Tailwind zinc tokens toward custom warm neutrals.

Suggested semantic tokens:

- `--bg-canvas`: deep warm charcoal
- `--bg-surface`: slightly lifted warm gray-brown panel tone
- `--bg-surface-alt`: softer lifted tone for hover/active controls
- `--border-muted`: low-contrast warm border
- `--text-primary`: soft near-ivory warm gray, not pure white
- `--text-secondary`: muted taupe-gray for summaries and secondary copy
- `--text-tertiary`: subdued gray-brown for metadata
- `--accent`: moss/herb green
- `--accent-soft`: translucent moss background for pills and selection states
- `--danger-soft`: muted clay-red tint for error containers

Use color mostly to separate hierarchy, not to decorate. The interface should feel composed even in grayscale, with the moss accent only clarifying interaction and taxonomy.

### 2. Typography
Keep the site on a high-recognition sans-serif stack. A good direction is:

- `Inter`
- `ui-sans-serif`
- `system-ui`
- `sans-serif`

Typography treatment:

- Hero title: tighter tracking, strong weight, large but not oversized
- Card title: slightly smaller than now but denser and more refined
- Summary/deck text: more breathing room with softer contrast
- Tag/filter text: uppercase is acceptable, but reduce the feeling of shouty UI by tightening spacing discipline
- Article body: comfortable line-height and slightly warmer text color than the current `prose-invert` defaults

### 3. Spacing Rhythm
This is the main upgrade.

#### Home page rhythm
- Increase top/bottom page padding to make the layout feel calmer
- Hero block should breathe more before the filter bar begins
- Keep the filter bar visually attached to the list, but separated enough from the hero to read as a control layer
- Increase distance between cards slightly
- Increase card internal padding so titles, summaries, and tags feel intentionally placed rather than stacked

#### Detail page rhythm
- Turn the article container into a clear reading panel
- Increase separation between tags, title, summary, and markdown body
- Make body copy spacing more generous than list views
- Preserve a centered reading width instead of trying to fill the viewport

## Component-by-Component Direction

### `frontend/src/index.css`
Purpose: establish the new visual tokens and base page mood.

Changes:
- define CSS variables for warm background, surface, border, text, accent, and error tones
- update `body` background and foreground to the new palette
- keep dark color-scheme, but make it warm and matte rather than stark
- add global selection styling only if it remains subtle and on-palette

### `frontend/src/pages/HomePage.jsx`
Purpose: give the homepage a stronger editorial rhythm.

Changes:
- replace current cold page background/text utilities with semantic warm tokens
- widen and rebalance hero spacing
- refine heading scale and supporting copy width
- keep layout structure, but make spacing between hero, filters, and list more deliberate

### `frontend/src/components/PostCard.jsx`
Purpose: make cards feel like thoughtful content panels instead of generic dark product cards.

Changes:
- soften the border and remove the cold white-ish shadow treatment
- use warmer surfaces and subtler contrast
- increase internal padding
- tune title and summary spacing for clearer cadence
- keep tags visually subordinate to the title and summary

### `frontend/src/components/TagFilterBar.jsx`
Purpose: turn filters into quiet editorial controls.

Changes:
- selected state should rely on warm surface lift + text contrast + muted accent support
- unselected state should feel calm, not ghosted away
- hover states should be subtle and not glow
- avoid stark white-on-dark or neon accent fills

### `frontend/src/components/ArticleSkeleton.jsx`
Purpose: keep loading states visually consistent with the warmer interface.

Changes:
- replace cold zinc blocks with warm neutral skeleton fills
- preserve current structure and motion, just recolor and lightly rebalance radius/surface treatment

### `frontend/src/pages/PostDetailPage.jsx`
Purpose: make the article detail page feel like a reading surface.

Changes:
- same warm canvas as homepage
- article wrapper becomes a calm reading card with better spacing and softer border
- title, summary, and content colors should use the semantic text system
- error state should move from bright red styling to a muted clay-red surface consistent with the new palette
- preserve loading / error / success states exactly in behavior

## Interaction Guidelines
- No flashy motion additions in this pass
- Hover states should lift clarity slightly, not advertise animation
- Active states should be readable from tone and contrast changes alone
- Focus states should remain accessible but visually aligned with the moss accent

## Implementation Boundaries
This polish pass should stay within these files unless a small supporting change is strictly required:

- `frontend/src/index.css`
- `frontend/src/pages/HomePage.jsx`
- `frontend/src/pages/PostDetailPage.jsx`
- `frontend/src/components/PostCard.jsx`
- `frontend/src/components/TagFilterBar.jsx`
- `frontend/src/components/ArticleSkeleton.jsx`

## Acceptance Criteria
The UI polish is complete when all of the following are true:

1. The app no longer uses a cold near-black / near-white presentation as its dominant visual identity.
2. No pure black (`#000`) or pure white (`#fff`) values are introduced.
3. No blue-purple AI-style gradients are introduced.
4. The homepage reads with clearer editorial spacing between hero, controls, and cards.
5. Cards feel warmer, calmer, and more spacious than the current implementation.
6. Tag filters feel quieter and more refined, with a clear but restrained selected state.
7. The post detail page feels like a readable article surface, not just a dark card.
8. Loading and error states visually match the new palette.
9. Existing tests for homepage, post detail page, and API normalization continue to pass after the polish.

## Out of Scope
- changing copy/content
- adding markdown rendering enhancements
- adding dark/light theme switching
- redesigning routing or navigation structure
- adding new animations, illustrations, or decorative gradients

# Frontend Interaction Design

**Date:** 2026-07-11  
**Direction:** Public site = calm editorial desk · Admin = light operations cockpit

## Goals

1. **Public** — prioritize reading rhythm, hierarchy, and low-noise motion. Content first; chrome second.
2. **Admin** — make long-running AI jobs (cover / hero / series / topic) **visible and trackable** without blocking the current form.

## Public (editorial desk)

### Visual system (keep)

- Semantic tokens in `frontend/src/index.css` (`--bg-*`, `--text-*`, `--accent*`, light/dark).
- Surfaces: canvas → panel (`.editorial-panel`) → card (`.cover-card`).
- Display font for titles, body stack for reading.

### Motion (calmer defaults)

| Token / helper | Intent |
|---|---|
| `motionItemVariants` | ~360ms, 14px rise (was heavier) |
| `hoverLift` / `.cover-card:hover` | −4px lift, ~200ms |
| `prefers-reduced-motion` | already global in `index.css` |

Avoid extra ambient animation on list pages; keep hero orbs only on home hero.

### Reading patterns

- **Article progress** — top accent bar on `PostDetailPage` (Framer `useScroll` + spring).
- **Sticky tag filter** — home list filter bar sticks under the navbar so long scroll keeps context.
- **Prefetch on hover/focus** — post/topic cards already prefetch detail.
- **Four states** — prefer `LoadingSkeletonSet` / `EmptyStatePanel` / inline error; do not flash blank white.

### Content hierarchy (home)

1. Hero + search  
2. Tag filter (sticky)  
3. Weekly spotlight → daily rail → series → topic pulse → continue reading → subscription  
4. Full article stream + pagination  

## Admin (operations cockpit)

### Shell

- Header title: **编辑运营台** with short subtitle.
- Top-right **任务** dock (`AdminJobsDock`) when any session job exists.
- Tabs remain the primary navigation (posts, health, settings, …).

### Job tracking model

| Piece | Role |
|---|---|
| `adminJobsStore.js` | sessionStorage-backed list, subscribe API |
| `trackAdminImageJob()` | wrap submit + `waitForAdminImageGenerationJob` |
| `AdminJobsDock` | badge + drawer: status, error, result link |

Tracked from:

- Post editor cover generate / overwrite  
- Bulk missing/replace covers (dashboard)  
- Settings hero generate  
- Series / topic cover generate  

Statuses: `queued` → `running` → `succeeded` | `failed` | `timeout` (still running server-side).

### Operator feedback rules

1. Submit → immediate local status line **and** dock entry.  
2. Poll updates dock; form-level message still explains candidate/apply choices.  
3. Bulk covers: do not block on poll; dock shows submitted jobs; status banner points to the dock.  
4. “清理已完成” only removes terminal jobs.

## Out of scope (next)

- Server-side job list API for multi-device history  
- Text-generation job UI parity (pipeline already async; admin UI can reuse the same store kind)  
- Full design-system Storybook  

## Files touched (this pass)

- `frontend/src/components/admin/adminJobsStore.js`  
- `frontend/src/components/admin/AdminJobsDock.jsx`  
- `frontend/src/pages/AdminDashboardPage.jsx`  
- `AdminPostEditor` / `AdminSettings` / `AdminSeriesManager` / `AdminTopicProfiles`  
- `HomePage` sticky filter, motion tokens, cover-card hover  
- `frontend/tests/admin-jobs-store.test.js`  

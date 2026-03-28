# AI Dev Blog Polish and Local Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the AI developer blog so local development artifacts are ignored correctly, the frontend and backend can be started and verified together on a local machine, and the UI is polished to match the approved Warm Editorial Minimal design.

**Architecture:** Keep the existing FastAPI + React split, but tighten the local-dev path by ignoring generated files and routing frontend API requests to the backend through the Vite dev server. Implement the UI polish entirely within the current frontend structure by introducing warm semantic visual tokens in CSS and then applying them across the homepage, post card, tag filter, skeleton, and post detail page without changing routes or data flow.

**Tech Stack:** FastAPI, Uvicorn, SQLite, React, React Router, Vite, TailwindCSS, Vitest, Testing Library

---

## 1) File structure and responsibilities

### Repo / local workflow
- Modify: `.gitignore` — ignore Python, SQLite, and Node generated artifacts produced during local development and testing

### Frontend
- Modify: `frontend/vite.config.js` — proxy `/api` and `/health` requests to the local FastAPI server during `npm run dev`
- Modify: `frontend/src/index.css` — define warm visual tokens and base element styling for the approved UI direction
- Modify: `frontend/src/pages/HomePage.jsx` — apply new page rhythm and warm surface/text classes
- Modify: `frontend/src/pages/PostDetailPage.jsx` — apply new reading-surface styling and muted error treatment
- Modify: `frontend/src/components/PostCard.jsx` — convert article cards to warmer editorial panels
- Modify: `frontend/src/components/TagFilterBar.jsx` — restyle filters into quiet editorial controls
- Modify: `frontend/src/components/ArticleSkeleton.jsx` — align loading states with the warm palette
- Modify: `frontend/tests/home-page.test.jsx` — extend homepage assertions to verify the new editorial shell/classes without changing behavior
- Modify: `frontend/tests/post-detail-page.test.jsx` — extend detail-page assertions to verify the new reading-surface/error shell classes without changing behavior

### Backend
- No application code changes required unless local verification reveals an actual bug.

---

### Task 1: Expand ignore rules for local development artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Write the ignore rules into `.gitignore`**

```gitignore
.worktrees/
backend/.pytest_cache/
backend/__pycache__/
backend/**/*.pyc
backend/**/*.pyo
backend/**/*.pyd
backend/**/*.egg-info/
backend/app/__pycache__/
backend/app/routers/__pycache__/
backend/tests/__pycache__/
blog.db
frontend/node_modules/
frontend/dist/
frontend/.vite/
```

- [ ] **Step 2: Verify the new ignore rules are active**

Run: `git check-ignore -v blog.db frontend/node_modules backend/app/__pycache__ backend/ai_dev_blog_backend.egg-info`
Expected: each path prints the matching `.gitignore` rule instead of returning nothing.

- [ ] **Step 3: Confirm the repo status is clean of generated artifacts**

Run: `git status --short`
Expected: generated paths like `frontend/node_modules`, `blog.db`, `__pycache__`, and `*.egg-info` do not appear as untracked files.

- [ ] **Step 4: Commit the ignore rule update**

```bash
git add .gitignore
git commit -m "chore: ignore local development artifacts"
```

**Acceptance criteria:**
- Local Python and Node build/test artifacts are ignored.
- `blog.db` is ignored.
- `git status --short` no longer shows the known generated paths as untracked.

---

### Task 2: Enable frontend-to-backend local development verification

**Files:**
- Modify: `frontend/vite.config.js`

- [ ] **Step 1: Write the failing local-dev test command down by reproducing the current mismatch**

Run in one terminal: `python -m uvicorn app.main:app --reload --app-dir backend --port 8000`
Run in a second terminal: `npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173`
Open: `http://127.0.0.1:5173`
Expected before the fix: the homepage shell loads, but API requests to `/api/posts` and `/health` have no Vite proxy and fail unless the frontend is served behind the backend.

- [ ] **Step 2: Add a Vite proxy for local API traffic**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js'
  }
})
```

- [ ] **Step 3: Verify frontend tests still pass after the dev-server change**

Run: `npm --prefix frontend run test`
Expected: PASS, including `home-page.test.jsx`, `post-detail-page.test.jsx`, and `post-card.test.jsx`.

- [ ] **Step 4: Perform local startup verification with both servers running**

Run backend: `python -m uvicorn app.main:app --reload --app-dir backend --port 8000`
Run frontend: `npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173`
Manual checks:
- visit `http://127.0.0.1:5173`
- confirm the home page renders fetched posts
- click a post and confirm `/posts/<slug>` renders detail content
- open `http://127.0.0.1:5173/health` and confirm it returns `{"status":"ok"}` through the Vite proxy
Expected: both the list page and detail page work against the local FastAPI server without changing frontend code paths.

- [ ] **Step 5: Commit the local-dev proxy setup**

```bash
git add frontend/vite.config.js
git commit -m "chore(web): proxy local API requests in dev"
```

**Acceptance criteria:**
- Running FastAPI on port 8000 and Vite on port 5173 works locally without API 404s.
- Frontend tests still pass.
- `/api/*` and `/health` requests from the frontend dev server resolve to the FastAPI backend.

---

### Task 3: Introduce the Warm Editorial Minimal design tokens

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Write the failing style test as a grep-style verification pass**

Run: `python - <<'PY'
from pathlib import Path
text = Path('frontend/src/index.css').read_text(encoding='utf-8')
assert '#000' not in text
assert '#fff' not in text
print('no pure black/white literals in index.css')
PY`
Expected before the rewrite: PASS for literal `#000`/`#fff`, but the file still only defines the old cold theme and has no semantic warm tokens, so the UI spec is not implemented yet.

- [ ] **Step 2: Replace the base stylesheet with warm semantic tokens**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  --bg-canvas: #191714;
  --bg-surface: #24211d;
  --bg-surface-alt: #2c2823;
  --border-muted: #3a342d;
  --text-primary: #f1ece3;
  --text-secondary: #c5bbad;
  --text-tertiary: #9c9184;
  --accent: #8faa7a;
  --accent-strong: #a7c391;
  --accent-soft: rgba(143, 170, 122, 0.16);
  --danger-soft: rgba(142, 89, 74, 0.2);
  --danger-border: rgba(181, 116, 96, 0.35);
  --selection: rgba(143, 170, 122, 0.28);
}

* {
  box-sizing: border-box;
}

html {
  background: var(--bg-canvas);
}

body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  background: var(--bg-canvas);
  color: var(--text-primary);
}

a {
  color: inherit;
  text-decoration: none;
}

::selection {
  background: var(--selection);
}
```

- [ ] **Step 3: Verify the stylesheet contains the required warm visual system**

Run: `python - <<'PY'
from pathlib import Path
text = Path('frontend/src/index.css').read_text(encoding='utf-8')
required = ['--bg-canvas', '--bg-surface', '--border-muted', '--text-primary', '--accent', '--danger-soft']
for token in required:
    assert token in text, token
assert '#000' not in text
assert '#fff' not in text
print('warm token check passed')
PY`
Expected: PASS.

- [ ] **Step 4: Commit the design-token layer**

```bash
git add frontend/src/index.css
git commit -m "feat(web): add warm editorial design tokens"
```

**Acceptance criteria:**
- The base stylesheet defines warm semantic tokens for canvas, surfaces, borders, text, accent, and error states.
- No pure black or pure white literals are introduced in `frontend/src/index.css`.
- The UI now has a single source of truth for the approved palette.

---

### Task 4: Polish the homepage cards and filters to match the approved design

**Files:**
- Modify: `frontend/src/pages/HomePage.jsx`
- Modify: `frontend/src/components/PostCard.jsx`
- Modify: `frontend/src/components/TagFilterBar.jsx`
- Modify: `frontend/src/components/ArticleSkeleton.jsx`
- Modify: `frontend/tests/home-page.test.jsx`

- [ ] **Step 1: Extend the homepage test with editorial-shell assertions**

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import HomePage from '../src/pages/HomePage'

vi.mock('../src/api/posts', () => ({
  fetchPosts: vi.fn((tag) => {
    const allPosts = [
      {
        title: 'Hello React',
        slug: 'hello-react',
        summary: 'A post about React',
        tags: [{ name: 'React', slug: 'react' }],
      },
      {
        title: 'FastAPI Guide',
        slug: 'fastapi-guide',
        summary: 'A guide to FastAPI',
        tags: [{ name: 'FastAPI', slug: 'fastapi' }],
      },
    ]
    return Promise.resolve(tag ? allPosts.filter((post) => post.tags.some((t) => t.slug === tag)) : allPosts)
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders posts and filters by tag click', async () => {
  const { container } = render(<HomePage />)
  expect(await screen.findByText(/hello react/i)).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="post-card"]')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: /react/i }))
  expect(await screen.findByText(/hello react/i)).toBeInTheDocument()
  expect(screen.queryByText(/fastapi guide/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Update the homepage and components with warm editorial styling hooks**

```jsx
// frontend/src/pages/HomePage.jsx
import { useEffect, useMemo, useState } from 'react'
import { fetchPosts } from '../api/posts'
import PostCard from '../components/PostCard'
import TagFilterBar from '../components/TagFilterBar'
import ArticleSkeleton from '../components/ArticleSkeleton'

export default function HomePage() {
  const [tag, setTag] = useState('')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchPosts(tag || undefined).then((items) => {
      if (!active) return
      setPosts(items)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [tag])

  const tags = useMemo(() => {
    const map = new Map()
    posts.forEach((post) => {
      post.tags.forEach((item) => map.set(item.slug, item))
    })
    return Array.from(map.values())
  }, [posts])

  return (
    <main data-ui="home-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.32em]" style={{ color: 'var(--accent-strong)' }}>AI DEV LOG</p>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.04em] sm:text-6xl">Minimal blog for builders</h1>
          <p className="max-w-2xl text-base leading-8" style={{ color: 'var(--text-secondary)' }}>
            Notes on React, FastAPI, and the systems behind AI-native products.
          </p>
        </header>

        <TagFilterBar tags={tags} activeTag={tag} onTagSelect={setTag} />

        <section className="grid gap-6 sm:gap-7">
          {loading ? (
            <>
              <ArticleSkeleton />
              <ArticleSkeleton />
            </>
          ) : (
            posts.map((post) => <PostCard key={post.slug} post={post} />)
          )}
        </section>
      </div>
    </main>
  )
}
```

```jsx
// frontend/src/components/PostCard.jsx
export default function PostCard({ post }) {
  return (
    <article
      data-ui="post-card"
      className="rounded-[28px] border p-8 transition-colors"
      style={{
        borderColor: 'var(--border-muted)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <a href={`/posts/${post.slug}`} className="block space-y-5">
        <div className="space-y-3">
          <h2 className="text-[1.9rem] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
          <p className="max-w-2xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]"
              style={{
                borderColor: 'rgba(143, 170, 122, 0.28)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-strong)',
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </a>
    </article>
  )
}
```

```jsx
// frontend/src/components/TagFilterBar.jsx
export default function TagFilterBar({ tags, activeTag, onTagSelect }) {
  const baseStyle = {
    borderColor: 'var(--border-muted)',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
  }

  const activeStyle = {
    borderColor: 'rgba(143, 170, 122, 0.35)',
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text-primary)',
  }

  return (
    <div data-ui="filter-bar" className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => onTagSelect('')}
        className="rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] transition-colors"
        style={activeTag === '' ? activeStyle : baseStyle}
      >
        all
      </button>
      {tags.map((tag) => (
        <button
          key={tag.slug}
          type="button"
          onClick={() => onTagSelect(tag.slug)}
          className="rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] transition-colors"
          style={activeTag === tag.slug ? activeStyle : baseStyle}
        >
          {tag.name}
        </button>
      ))}
    </div>
  )
}
```

```jsx
// frontend/src/components/ArticleSkeleton.jsx
export default function ArticleSkeleton() {
  return (
    <div
      className="animate-pulse rounded-[28px] border p-8"
      style={{
        borderColor: 'var(--border-muted)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <div className="mb-5 h-7 w-1/3 rounded" style={{ backgroundColor: 'var(--bg-surface-alt)' }} />
      <div className="mb-3 h-4 w-full rounded" style={{ backgroundColor: 'var(--bg-surface-alt)' }} />
      <div className="h-4 w-2/3 rounded" style={{ backgroundColor: 'var(--bg-surface-alt)' }} />
    </div>
  )
}
```

- [ ] **Step 3: Run the homepage test to verify both behavior and the new shell hooks**

Run: `npm --prefix frontend run test -- home-page.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit the homepage polish**

```bash
git add frontend/src/pages/HomePage.jsx frontend/src/components/PostCard.jsx frontend/src/components/TagFilterBar.jsx frontend/src/components/ArticleSkeleton.jsx frontend/tests/home-page.test.jsx
git commit -m "feat(web): polish home page with warm editorial styling"
```

**Acceptance criteria:**
- The homepage uses the new warm visual system.
- Cards feel more spacious and editorial.
- Filter controls feel restrained and readable.
- Existing filtering behavior is preserved and covered by tests.

---

### Task 5: Polish the post detail reading surface and verify the full frontend suite

**Files:**
- Modify: `frontend/src/pages/PostDetailPage.jsx`
- Modify: `frontend/tests/post-detail-page.test.jsx`

- [ ] **Step 1: Extend the post-detail test with reading-surface and muted-error assertions**

```jsx
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import PostDetailPage from '../src/pages/PostDetailPage'

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: vi.fn((slug) => {
    if (slug === 'missing') {
      return Promise.reject(new Error('HTTP 404'))
    }
    return Promise.resolve({
      title: 'Hello React',
      slug: 'hello-react',
      summary: 'A post about React',
      content_md: '# Hello React\n\nThis is a post about React.',
      tags: [{ name: 'React', slug: 'react' }],
    })
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders post detail', async () => {
  const { container } = render(<PostDetailPage slug="hello-react" />)
  expect(await screen.findByRole('heading', { name: /hello react/i })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="detail-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="detail-article"]')).toBeTruthy()
})

it('shows not found message on404', async () => {
  const { container } = render(<PostDetailPage slug="missing" />)
  expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  expect(container.querySelector('[data-ui="detail-error"]')).toBeTruthy()
})
```

- [ ] **Step 2: Restyle the detail page as a warm reading surface**

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPostDetail } from '../api/posts'
import ArticleSkeleton from '../components/ArticleSkeleton'

export default function PostDetailPage({ slug: overrideSlug }) {
  const params = useParams()
  const slug = overrideSlug ?? params.slug
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    fetchPostDetail(slug)
      .then((data) => {
        if (!active) return
        setPost(data)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('Post not found')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [slug])

  if (loading) {
    return (
      <main data-ui="detail-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <div className="mx-auto max-w-3xl">
          <ArticleSkeleton />
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main data-ui="detail-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <div
          data-ui="detail-error"
          className="mx-auto max-w-3xl rounded-[28px] border p-8"
          style={{
            borderColor: 'var(--danger-border)',
            backgroundColor: 'var(--danger-soft)',
            color: 'var(--text-primary)',
          }}
        >
          {error}
        </div>
      </main>
    )
  }

  return (
    <main data-ui="detail-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <article
        data-ui="detail-article"
        className="mx-auto flex max-w-3xl flex-col gap-8 rounded-[32px] border p-10 sm:p-12"
        style={{
          borderColor: 'var(--border-muted)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
              style={{
                borderColor: 'rgba(143, 170, 122, 0.28)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-strong)',
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{post.title}</h1>
          <p className="max-w-2xl text-base leading-8" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        </div>
        <div className="max-w-none whitespace-pre-wrap text-[15px] leading-8 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
          {post.content_md}
        </div>
      </article>
    </main>
  )
}
```

- [ ] **Step 3: Run the post-detail test and then the full frontend suite**

Run: `npm --prefix frontend run test -- post-detail-page.test.jsx && npm --prefix frontend run test`
Expected: PASS.

- [ ] **Step 4: Perform the final local visual verification**

With the backend and frontend dev servers running from Task 2, manually verify:
- the homepage uses warm matte gray surfaces instead of the old cold zinc look
- selected tags use restrained moss accents rather than stark white or neon fills
- cards have noticeably stronger whitespace and calmer borders
- the detail page reads like a centered article surface
- no page uses pure black, pure white, or blue-purple gradients
Expected: the implementation matches `docs/superpowers/specs/2026-03-28-ai-dev-blog-ui-polish-design.md`.

- [ ] **Step 5: Commit the detail-page polish**

```bash
git add frontend/src/pages/PostDetailPage.jsx frontend/tests/post-detail-page.test.jsx
git commit -m "feat(web): polish post detail reading surface"
```

**Acceptance criteria:**
- The detail page matches the approved warm editorial direction.
- Loading and error states share the same visual system.
- The full frontend test suite passes.
- Manual local verification confirms the app honors all imposed visual constraints.

---

## 2) Spec coverage check (Self-Review)

- `.gitignore` update covered? ✅ Task 1
- Local backend/frontend startup verification covered? ✅ Task 2
- Warm Editorial Minimal palette/tokens covered? ✅ Task 3
- Homepage spacing, cards, filters, skeleton covered? ✅ Task 4
- Detail page reading surface and muted error styling covered? ✅ Task 5
- Explicit ban on `#000`, `#fff`, and blue-purple gradients covered? ✅ Tasks 3 and 5 verification steps

## 3) Placeholder / ambiguity check (Self-Review)

- No `TODO` / `TBD` placeholders remain
- Each task includes exact files, code, commands, expected outcomes, and commit steps
- The local verification task explicitly addresses the missing dev-server proxy so the manual startup step is executable
- UI changes stay within the approved component boundaries and do not alter routes or data flow

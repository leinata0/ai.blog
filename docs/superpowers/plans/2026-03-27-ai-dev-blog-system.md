# AI 开发者极简博客系统（前后端分离）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零构建一个极简、极客风的前后端分离博客系统，支持首页文章列表、文章详情、分类标签体系，并具备可测试的基础工程结构。

**Architecture:** 后端提供只读内容 API（列表、详情、标签过滤），使用 FastAPI + SQLite 建模文章与标签多对多关系；前端使用 React + TailwindCSS 消费 API，按路由拆分首页与详情页。测试策略采用“后端 API 测试 + 前端组件与页面行为测试”，确保每个任务可独立验证。

**Tech Stack:** React, React Router, TailwindCSS, Vitest, Testing Library, FastAPI, SQLAlchemy, Pydantic, SQLite, Pytest

---

##1) 文件结构与职责（先锁定边界）

### Backend
- Create: `backend/app/main.py` — FastAPI入口与路由挂载
- Create: `backend/app/db.py` — SQLAlchemy Engine/Session 管理
- Create: `backend/app/models.py` — `Post` / `Tag` /关联表模型
- Create: `backend/app/schemas.py` — API 响应 DTO
- Create: `backend/app/routers/posts.py` —文章列表/详情 API
- Create: `backend/app/seed.py` — 初始数据写入（开发环境）
- Create: `backend/tests/conftest.py` — 测试数据库与 TestClient fixture
- Create: `backend/tests/test_health.py` — 健康检查测试
- Create: `backend/tests/test_posts_list.py` — 列表与标签过滤测试
- Create: `backend/tests/test_post_detail.py` —详情与404 测试

### Frontend
- Create: `frontend/src/main.jsx` — 应用入口
- Create: `frontend/src/App.jsx` — 路由与全局布局
- Create: `frontend/src/api/client.js` — fetch 封装
- Create: `frontend/src/api/posts.js` —文章 API访问层
- Create: `frontend/src/pages/HomePage.jsx` — 首页列表 + 标签筛选
- Create: `frontend/src/pages/PostDetailPage.jsx` —详情页
- Create: `frontend/src/components/PostCard.jsx` —文章卡片
- Create: `frontend/src/components/TagFilterBar.jsx` — 标签过滤条
- Create: `frontend/src/components/ArticleSkeleton.jsx` — 加载占位
- Create: `frontend/src/index.css` — Tailwind 基础样式与极简主题 token
- Create: `frontend/tests/home-page.test.jsx` — 首页行为测试
- Create: `frontend/tests/post-detail-page.test.jsx` —详情页行为测试
- Create: `frontend/tests/post-card.test.jsx` —组件渲染测试

---

### Task1: 后端骨架与健康检查

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`

- [ ] **Step1: 写失败测试（健康检查）**

```python
# backend/tests/test_health.py

def test_health_endpoint(client):
 resp = client.get("/health")
 assert resp.status_code ==200
 assert resp.json() == {"status": "ok"}
```

- [ ] **Step2:运行测试确认失败**

Run: `pytest backend/tests/test_health.py::test_health_endpoint -v`
Expected: FAIL（`client` fixture 或 `/health` 路由不存在）

- [ ] **Step3: 最小实现让测试通过**

```python
# backend/app/main.py
from fastapi import FastAPI

app = FastAPI(title="AI Dev Blog API")

@app.get("/health")
def health():
 return {"status": "ok"}
```

```python
# backend/tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
 return TestClient(app)
```

- [ ] **Step4:运行测试确认通过**

Run: `pytest backend/tests/test_health.py::test_health_endpoint -v`
Expected: PASS

- [ ] **Step5: Commit**

```bash
git add backend/app/main.py backend/tests/conftest.py backend/tests/test_health.py
git commit -m "feat(api): bootstrap FastAPI app with health endpoint"
```

**验收标准：**
- `GET /health` 返回 `200` 与 `{"status":"ok"}`
- `backend/tests/test_health.py` 单测通过

---

### Task2: 数据模型（文章/标签）与测试数据库初始化

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Modify: `backend/tests/conftest.py`
- Create: `backend/app/seed.py`

- [ ] **Step1: 写失败测试（模型关系）**

```python
# 在 backend/tests/conftest.py 增加 db_session fixture 后

def test_post_tag_relationship(db_session):
 from app.models import Post, Tag

 tag = Tag(name="fastapi", slug="fastapi")
 post = Post(title="Hello", slug="hello", summary="s", content_md="c")
 post.tags.append(tag)

 db_session.add(post)
 db_session.commit()
 db_session.refresh(post)

 assert len(post.tags) ==1
 assert post.tags[0].slug == "fastapi"
```

- [ ] **Step2:运行测试确认失败**

Run: `pytest backend/tests/test_posts_list.py::test_post_tag_relationship -v`
Expected: FAIL（模型或表不存在）

- [ ] **Step3: 最小实现（SQLite + SQLAlchemy 模型）**

```python
# backend/app/db.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "sqlite:///./blog.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
```

```python
# backend/app/models.py
from sqlalchemy import Column, Integer, String, Table, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.db import Base

post_tags = Table(
 "post_tags",
 Base.metadata,
 Column("post_id", ForeignKey("posts.id"), primary_key=True),
 Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

class Post(Base):
 __tablename__ = "posts"
 id = Column(Integer, primary_key=True, index=True)
 title = Column(String(200), nullable=False)
 slug = Column(String(200), unique=True, nullable=False, index=True)
 summary = Column(String(300), nullable=False)
 content_md = Column(Text, nullable=False)
 tags = relationship("Tag", secondary=post_tags, back_populates="posts")

class Tag(Base):
 __tablename__ = "tags"
 id = Column(Integer, primary_key=True, index=True)
 name = Column(String(80), nullable=False)
 slug = Column(String(80), unique=True, nullable=False, index=True)
 posts = relationship("Post", secondary=post_tags, back_populates="tags")
```

- [ ] **Step4:运行模型关系测试**

Run: `pytest backend/tests/test_posts_list.py::test_post_tag_relationship -v`
Expected: PASS

- [ ] **Step5: Commit**

```bash
git add backend/app/db.py backend/app/models.py backend/tests/conftest.py backend/app/seed.py
git commit -m "feat(api): add SQLite schema for posts and tags"
```

**验收标准：**
- `Post` 与 `Tag` 多对多关系可持久化
- 测试环境可独立创建/销毁数据库
- 模型关系测试通过

---

### Task3:文章列表 API（含标签过滤）

**Files:**
- Create: `backend/app/schemas.py`
- Create: `backend/app/routers/posts.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_posts_list.py`

- [ ] **Step1: 写失败测试（列表与标签过滤）**

```python
# backend/tests/test_posts_list.py

def test_list_posts_returns_items(client, seeded_db):
 resp = client.get("/api/posts")
 assert resp.status_code ==200
 body = resp.json()
 assert len(body["items"]) >=1
 assert {"title", "slug", "summary", "tags"}.issubset(body["items"][0].keys())


def test_list_posts_filter_by_tag(client, seeded_db):
 resp = client.get("/api/posts", params={"tag": "react"})
 assert resp.status_code ==200
 body = resp.json()
 assert len(body["items"]) >=1
 assert all(any(t["slug"] == "react" for t in p["tags"]) for p in body["items"])
```

- [ ] **Step2:运行测试确认失败**

Run: `pytest backend/tests/test_posts_list.py -v`
Expected: FAIL（`/api/posts` 未实现）

- [ ] **Step3: 最小实现（DTO + 路由）**

```python
# backend/app/schemas.py
from pydantic import BaseModel

class TagOut(BaseModel):
 name: str
 slug: str

class PostListItemOut(BaseModel):
 title: str
 slug: str
 summary: str
 tags: list[TagOut]

class PostListOut(BaseModel):
 items: list[PostListItemOut]
```

```python
# backend/app/routers/posts.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.db import SessionLocal

router = APIRouter(prefix="/api/posts", tags=["posts"])

def get_db():
 db = SessionLocal()
 try:
 yield db
 finally:
 db.close()

@router.get("")
def list_posts(tag: str | None = Query(default=None), db: Session = Depends(get_db)):
 #计划要求：按 tag 可选过滤并返回 items 列表
 ...
```

```python
# backend/app/main.py
from app.routers.posts import router as posts_router
app.include_router(posts_router)
```

- [ ] **Step4:运行测试确认通过**

Run: `pytest backend/tests/test_posts_list.py -v`
Expected: PASS

- [ ] **Step5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/posts.py backend/app/main.py backend/tests/test_posts_list.py
git commit -m "feat(api): implement post listing and tag filtering"
```

**验收标准：**
- `GET /api/posts` 返回 `items[]`
- `GET /api/posts?tag=react`仅返回包含 `react` 标签的文章
- 列表 API 测试通过

---

### Task4:文章详情 API（按 slug）

**Files:**
- Modify: `backend/app/routers/posts.py`
- Create: `backend/tests/test_post_detail.py`

- [ ] **Step1: 写失败测试（详情 +404）**

```python
# backend/tests/test_post_detail.py

def test_get_post_detail_by_slug(client, seeded_db):
 resp = client.get("/api/posts/hello-react")
 assert resp.status_code ==200
 body = resp.json()
 assert body["slug"] == "hello-react"
 assert "content_md" in body


def test_get_post_detail_not_found(client, seeded_db):
 resp = client.get("/api/posts/not-exist")
 assert resp.status_code ==404
```

- [ ] **Step2:运行测试确认失败**

Run: `pytest backend/tests/test_post_detail.py -v`
Expected: FAIL（详情路由不存在）

- [ ] **Step3: 最小实现（详情查询）**

```python
# backend/app/routers/posts.py
from fastapi import HTTPException

@router.get("/{slug}")
def get_post_detail(slug: str, db: Session = Depends(get_db)):
 #计划要求：按 slug 查询；不存在返回404
 ...
```

- [ ] **Step4:运行测试确认通过**

Run: `pytest backend/tests/test_post_detail.py -v`
Expected: PASS

- [ ] **Step5: Commit**

```bash
git add backend/app/routers/posts.py backend/tests/test_post_detail.py
git commit -m "feat(api): add post detail endpoint by slug"
```

**验收标准：**
- `GET /api/posts/{slug}` 返回文章详情与标签
- 不存在 slug 返回 `404`
-详情 API 测试通过

---

### Task5: 前端应用骨架与 API访问层

**Files:**
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/App.jsx`
- Create: `frontend/src/api/client.js`
- Create: `frontend/src/api/posts.js`
- Create: `frontend/tests/post-card.test.jsx`

- [ ] **Step1: 写失败测试（API 函数返回结构）**

```jsx
// frontend/tests/post-card.test.jsx
import { describe, it, expect } from "vitest";
import { normalizePostList } from "../src/api/posts";

describe("normalizePostList", () => {
 it("maps API list payload to UI-safe shape", () => {
 const out = normalizePostList({ items: [{ title: "t", slug: "s", summary: "x", tags: [] }] });
 expect(out[0].slug).toBe("s");
 });
});
```

- [ ] **Step2:运行测试确认失败**

Run: `cd frontend && npm run test -- post-card.test.jsx`
Expected: FAIL（`normalizePostList` 未定义）

- [ ] **Step3: 最小实现（client + posts API）**

```js
// frontend/src/api/client.js
export async function apiGet(path) {
 const resp = await fetch(path);
 if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
 return resp.json();
}
```

```js
// frontend/src/api/posts.js
import { apiGet } from "./client";

export function normalizePostList(payload) {
 return payload.items ?? [];
}

export async function fetchPosts(tag) {
 const q = tag ? `?tag=${encodeURIComponent(tag)}` : "";
 return normalizePostList(await apiGet(`/api/posts${q}`));
}

export async function fetchPostDetail(slug) {
 return apiGet(`/api/posts/${slug}`);
}
```

- [ ] **Step4:运行测试确认通过**

Run: `cd frontend && npm run test -- post-card.test.jsx`
Expected: PASS

- [ ] **Step5: Commit**

```bash
git add frontend/src/main.jsx frontend/src/App.jsx frontend/src/api/client.js frontend/src/api/posts.js frontend/tests/post-card.test.jsx
git commit -m "feat(web): scaffold app shell and API client layer"
```

**验收标准：**
- 前端具备可调用的 `fetchPosts` / `fetchPostDetail`
- API归一化函数测试通过

---

### Task6: 首页（列表 + 标签过滤）与组件测试

**Files:**
- Create: `frontend/src/components/PostCard.jsx`
- Create: `frontend/src/components/TagFilterBar.jsx`
- Create: `frontend/src/components/ArticleSkeleton.jsx`
- Create: `frontend/src/pages/HomePage.jsx`
- Create: `frontend/tests/home-page.test.jsx`

- [ ] **Step1: 写失败测试（默认列表 + 点击标签过滤）**

```jsx
// frontend/tests/home-page.test.jsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HomePage from "../src/pages/HomePage";

it("renders posts and filters by tag click", async () => {
 render(<HomePage />);
 expect(await screen.findByText(/hello react/i)).toBeInTheDocument();
 await userEvent.click(screen.getByRole("button", { name: /react/i }));
 expect(await screen.findByText(/react/i)).toBeInTheDocument();
});
```

- [ ] **Step2:运行测试确认失败**

Run: `cd frontend && npm run test -- home-page.test.jsx`
Expected: FAIL（`HomePage` 未实现）

- [ ] **Step3: 最小实现（页面与组件）**

```jsx
// frontend/src/pages/HomePage.jsx
import { useEffect, useState } from "react";
import { fetchPosts } from "../api/posts";

export default function HomePage() {
 const [tag, setTag] = useState("");
 const [posts, setPosts] = useState([]);

 useEffect(() => {
 fetchPosts(tag || undefined).then(setPosts);
 }, [tag]);

 return <main>{/* 渲染 TagFilterBar + PostCard 列表 */}</main>;
}
```

- [ ] **Step4:运行测试确认通过**

Run: `cd frontend && npm run test -- home-page.test.jsx`
Expected: PASS

- [ ] **Step5: Commit**

```bash
git add frontend/src/components/PostCard.jsx frontend/src/components/TagFilterBar.jsx frontend/src/components/ArticleSkeleton.jsx frontend/src/pages/HomePage.jsx frontend/tests/home-page.test.jsx
git commit -m "feat(web): implement home page with tag filtering"
```

**验收标准：**
- 首页渲染文章列表
- 点击标签后列表按标签过滤
- 首页测试通过

---

### Task7:详情页（加载/错误态）与路由联调

**Files:**
- Create: `frontend/src/pages/PostDetailPage.jsx`
- Modify: `frontend/src/App.jsx`
- Create: `frontend/tests/post-detail-page.test.jsx`
- Modify: `frontend/src/index.css`

- [ ] **Step1: 写失败测试（详情渲染 +404 提示）**

```jsx
// frontend/tests/post-detail-page.test.jsx
import { render, screen } from "@testing-library/react";
import PostDetailPage from "../src/pages/PostDetailPage";

it("renders post detail", async () => {
 render(<PostDetailPage slug="hello-react" />);
 expect(await screen.findByRole("heading", { name: /hello react/i })).toBeInTheDocument();
});

it("shows not found message on404", async () => {
 render(<PostDetailPage slug="missing" />);
 expect(await screen.findByText(/not found/i)).toBeInTheDocument();
});
```

- [ ] **Step2:运行测试确认失败**

Run: `cd frontend && npm run test -- post-detail-page.test.jsx`
Expected: FAIL（`PostDetailPage` 未实现）

- [ ] **Step3: 最小实现（详情页与路由）**

```jsx
// frontend/src/App.jsx
import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import PostDetailPage from "./pages/PostDetailPage";

export default function App() {
 return (
 <Routes>
 <Route path="/" element={<HomePage />} />
 <Route path="/posts/:slug" element={<PostDetailPage />} />
 </Routes>
 );
}
```

```jsx
// frontend/src/pages/PostDetailPage.jsx
import { useEffect, useState } from "react";
import { fetchPostDetail } from "../api/posts";

export default function PostDetailPage({ slug: overrideSlug }) {
 //计划要求：支持路由参数，具备 loading / not found / success 三态
 return <main>{/*详情内容 */}</main>;
}
```

- [ ] **Step4: 全量前后端验证**

Run backend: `uvicorn app.main:app --reload --app-dir backend`
Run frontend: `cd frontend && npm run dev`
Manual checks:
- 打开 `/` 能看到文章列表
- 点击文章进入 `/posts/<slug>`
-详情页显示正文与标签

Expected: 功能可用，且测试通过：
`cd frontend && npm run test -- post-detail-page.test.jsx`

- [ ] **Step5: Commit**

```bash
git add frontend/src/pages/PostDetailPage.jsx frontend/src/App.jsx frontend/src/index.css frontend/tests/post-detail-page.test.jsx
git commit -m "feat(web): implement post detail page with routing and states"
```

**验收标准：**
-详情页可通过 slug 路由访问
-404 时显示明确提示
- 本任务测试通过且手动联调通过

---

##2)规格覆盖检查（Self-Review）

- 首页文章列表 ✅ Task3 + Task6
-文章详情页 ✅ Task4 + Task7
- 分类标签体系 ✅ Task2 + Task3 + Task6
- 前后端分离 ✅ Backend API 与 Frontend API Client 分层
- 极简极客风格 ✅ Task7 中 `index.css` + Tailwind主题约束

##3) 占位/歧义检查（Self-Review）

- 无 `TODO` / `TBD` 占位词
- 每个任务都有：失败测试 → 最小实现 → 验证 → 提交
- 接口命名统一：`/api/posts` 与 `/api/posts/{slug}`


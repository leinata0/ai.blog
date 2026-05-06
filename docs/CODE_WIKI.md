# AI 资讯观察 - Code Wiki 文档

## 目录

1. [项目概述](#项目概述)
2. [架构设计](#架构设计)
3. [技术栈](#技术栈)
4. [后端架构](#后端架构)
5. [前端架构](#前端架构)
6. [Scripts 自动化内容流水线](#scripts-自动化内容流水线)
7. [数据库模型](#数据库模型)
8. [API 文档](#api-文档)
9. [部署与开发](#部署与开发)
10. [常见问题与排障](#常见问题与排障)

---

## 项目概述

### 项目简介

**AI 资讯观察 (ai.blog)** 是一个面向公开访客的中文 AI 资讯与专题博客系统，采用前后端分离架构与自动化内容流水线。该系统不仅提供博客的基本功能，还支持自动化内容生产、智能主题管理、多渠道订阅等高级特性。

### 核心特性

- **公开内容优先可见**: 预渲染公开页面 HTML，提供优秀的首屏体验
- **多样化内容入口**: 文章、主题、系列、日报、周报、归档等
- **完整管理后台**: 文章管理、主题管理、系列管理、图片管理、站点配置
- **AI 能力集成**: 可配置的 AI 渠道用于封面生成和内容创作
- **多渠道订阅**: 支持邮件、Web Push、企业微信 Webhook
- **自动化内容流水线**: 从内容抓取到发布的完整自动化流程
- **媒体优化**: R2 存储 + CDN 分发，图片直连减少延迟

### 线上地址

正式访问地址: [https://www.563118077.xyz](https://www.563118077.xyz)

---

## 架构设计

### 系统架构图

```
┌─────────────────┐
│  访客浏览器      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│       Vercel (前端)                  │
│  - Vite 静态资源                     │
│  - 预渲染公开页面                    │
└────────────┬────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌──────────┐    ┌───────────────────┐
│ Render   │    │ Cloudflare R2/CDN │
│ (后端)   │    │ (图片存储)        │
└────┬─────┘    └───────────────────┘
     │
     ▼
┌──────────────────┐
│ Neon Postgres    │
│ (数据库)          │
└──────────────────┘
```

### 主要分层

1. **前端层 (Vite + React)**:
   - 负责 UI 展示与用户交互
   - 静态资源与预渲染页面托管在 Vercel
   - 支持按需加载与路由懒加载

2. **后端层 (FastAPI)**:
   - 提供公开读接口、管理接口、订阅服务
   - 处理图片代理与上传
   - 生成 RSS、sitemap

3. **数据层 (Postgres)**:
   - 使用 Neon Postgres 托管
   - 存储内容、用户、配置等数据

4. **媒体层 (R2 + CDN)**:
   - 使用 Cloudflare R2 存储图片
   - 通过自定义域名提供 CDN 加速

5. **自动化层 (Scripts)**:
   - 内容抓取、整理、发布流水线
   - 封面生成与质量评估

### 目录结构

```
ai.blog/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── routers/         # API 路由
│   │   ├── services/        # 业务逻辑服务
│   │   ├── models.py        # 数据模型
│   │   ├── schemas.py       # Pydantic 模式
│   │   └── main.py          # 主应用入口
│   ├── tests/               # 后端测试
│   └── pyproject.toml
├── frontend/                # Vite React 前端
│   ├── src/
│   │   ├── pages/           # 页面组件
│   │   ├── components/      # 可复用组件
│   │   ├── api/             # API 客户端
│   │   ├── utils/           # 工具函数
│   │   └── App.jsx          # 主应用
│   ├── public/
│   └── package.json
├── scripts/                 # 自动化工具链
│   ├── lib/                 # 库函数
│   ├── config/              # 配置文件
│   ├── tests/               # 脚本测试
│   └── auto-blog.mjs        # 主脚本
├── docs/                    # 项目文档
├── .github/workflows/       # GitHub Actions
└── README.md
```

---

## 技术栈

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3.1 | 核心 UI 库 |
| React Router | 6.30.1 | 路由管理 |
| Vite | 5.4.10 | 构建工具与开发服务器 |
| Tailwind CSS | 3.4.15 | 样式框架 |
| React Markdown | 10.1.0 | Markdown 渲染 |
| Framer Motion | 12.38.0 | 动画库 |
| Vitest | 2.1.4 | 测试框架 |

### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| FastAPI | 0.116.0+ | Web 框架 |
| SQLAlchemy | 2.0.36+ | ORM |
| Pydantic | 2.9.0+ | 数据验证与序列化 |
| Psycopg | 3.2.9+ | Postgres 驱动 |
| Boto3 | 1.39.0+ | R2 对象存储 |
| PyWebPush | 2.0.3+ | Web Push 通知 |
| Python | 3.11+ | 运行环境 |

### 自动化脚本技术栈

| 技术 | 用途 |
|------|------|
| Node.js | ESM 运行环境 |
| Node Test | 测试框架 |
| 自定义库 | 内容抓取、质量评估、封面生成 |

---

## 后端架构

### 核心文件结构

```
backend/app/
├── __init__.py
├── main.py                 # FastAPI 应用主入口
├── db.py                   # 数据库连接与会话管理
├── models.py               # SQLAlchemy 数据模型定义
├── schemas.py              # Pydantic 请求/响应模式
├── auth.py                 # 认证与授权
├── env.py                  # 环境变量处理
├── site_config.py          # 站点配置解析
├── storage.py              # R2 存储与图片处理
├── uploads.py              # 上传文件处理
├── http_cache.py           # HTTP 缓存控制
├── notifications.py        # 通知发送 (邮件、Web Push、WeCom)
├── frontend_refresh.py     # 前端刷新触发
├── seed.py                 # 数据库种子数据
├── bootstrap.py            # 应用初始化
├── feed_meta.py            # RSS feed 元数据
├── schema_compat.py        # API 兼容性处理
├── routers/
│   ├── __init__.py
│   ├── home.py             # 首页相关路由
│   ├── posts.py            # 文章相关路由
│   ├── admin.py            # 管理后台路由
│   └── subscriptions.py    # 订阅相关路由
└── services/
    ├── __init__.py
    ├── admin_posts.py      # 文章管理服务
    ├── ai_channels.py      # AI 渠道管理服务
    └── cover_art.py        # 封面艺术服务
```

### 主应用入口 ([main.py](file:///workspace/backend/app/main.py))

`main.py` 是 FastAPI 应用的核心入口，负责:
- 应用初始化与生命周期管理
- 路由注册
- CORS 中间件配置
- 健康检查、RSS、sitemap 等核心端点
- 图片代理服务

核心功能:
```python
app = FastAPI(title="AI Dev Blog API", lifespan=lifespan)

# 注册路由
app.include_router(posts_router)
app.include_router(admin_router)
app.include_router(home_router)
app.include_router(subscriptions_router)
```

### 路由模块

#### 1. Home Router ([home.py](file:///workspace/backend/app/routers/home.py))
负责首页相关接口:
- `/api/home/bootstrap`: 首页启动数据
- `/api/home/modules`: 首页模块数据

#### 2. Posts Router ([posts.py](file:///workspace/backend/app/routers/posts.py))
负责文章相关接口:
- `/api/posts`: 文章列表
- `/api/posts/{slug}`: 文章详情
- `/api/posts/{slug}/like`: 点赞功能
- 按主题、系列、内容类型筛选

#### 3. Admin Router ([admin.py](file:///workspace/backend/app/routers/admin.py))
负责管理后台接口:
- 文章 CRUD 操作
- 主题与系列管理
- 图片上传与管理
- AI 渠道配置
- 站点设置管理

#### 4. Subscriptions Router ([subscriptions.py](file:///workspace/backend/app/routers/subscriptions.py))
负责订阅相关接口:
- 邮件订阅管理
- Web Push 订阅管理
- 通知发送

### 数据库会话管理 ([db.py](file:///workspace/backend/app/db.py))

使用 SQLAlchemy 2.0 管理数据库连接:
```python
# 数据库引擎创建
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 依赖注入函数
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### 认证与授权 ([auth.py](file:///workspace/backend/app/auth.py))

- 使用 JWT 进行管理员认证
- 环境变量中配置管理员凭据: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SECRET_KEY`
- 提供 `get_current_admin` 依赖注入

### 环境变量管理 ([env.py](file:///workspace/backend/app/env.py))

提供安全的环境变量读取:
```python
def clean_env(key, default=""):
    """安全地清理并读取环境变量"""
```

关键环境变量:
- `DATABASE_URL`: 数据库连接字符串
- `PUBLIC_SITE_URL`: 公开站点 URL
- `ALLOWED_ORIGINS`: CORS 允许的源
- `R2_*`: R2 存储配置
- `SECRET_KEY`: JWT 密钥
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: 管理员凭据
- `RESEND_API_KEY`: 邮件发送 API 密钥
- `XAI_API_KEY`: 默认生图渠道
- `SILICONFLOW_API_KEY`: 默认生文字渠道

### 存储服务 ([storage.py](file:///workspace/backend/app/storage.py))

使用 Boto3 连接 Cloudflare R2:
- 支持图片上传与下载
- 支持生成签名 URL
- 提供安全的文件名验证

### HTTP 缓存 ([http_cache.py](file:///workspace/backend/app/http_cache.py))

为公开接口提供高效的缓存策略:
```python
build_public_cache_control(max_age=60, s_maxage=300, stale_while_revalidate=900)
```

缓存策略包括:
- `max-age`: 浏览器缓存时间
- `s-maxage`: CDN 缓存时间
- `stale-while-revalidate`: 后台重新验证期间使用旧内容

### 通知服务 ([notifications.py](file:///workspace/backend/app/notifications.py))

支持多种通知渠道:
1. **邮件通知**: 使用 Resend API
2. **Web Push**: 浏览器推送通知
3. **企业微信**: Webhook 推送

### 服务层

#### Admin Posts Service ([admin_posts.py](file:///workspace/backend/app/services/admin_posts.py))
- 文章创建、更新、删除
- 文章发布流程
- 文章质量评估

#### AI Channels Service ([ai_channels.py](file:///workspace/backend/app/services/ai_channels.py))
- AI 渠道配置管理
- 生图、生文字渠道抽象
- 支持多提供商 (OpenAI 兼容、xAI、SiliconFlow 等)

#### Cover Art Service ([cover_art.py](file:///workspace/backend/app/services/cover_art.py))
- 封面生成与优化
- 主题相关的艺术处理

---

## 前端架构

### 核心文件结构

```
frontend/src/
├── main.jsx                 # React 应用入口
├── App.jsx                  # 主应用组件与路由配置
├── index.css                # 全局样式与 Tailwind 配置
├── api/                     # API 客户端模块
│   ├── base.js              # 基础 API 配置
│   ├── client.js            # API 客户端封装
│   ├── auth.js              # 认证相关 API
│   ├── home.js              # 首页相关 API
│   ├── posts.js             # 文章相关 API
│   ├── admin.js             # 管理后台 API
│   └── subscriptions.js     # 订阅相关 API
├── components/              # React 组件
│   ├── Navbar.jsx           # 导航栏
│   ├── Footer.jsx           # 页脚
│   ├── Sidebar.jsx          # 侧边栏
│   ├── ArticleMarkdownRenderer.jsx  # Markdown 渲染
│   ├── CoverCard.jsx        # 封面卡片
│   ├── TagFilterBar.jsx     # 标签筛选栏
│   ├── Pagination.jsx       # 分页组件
│   ├── ErrorBoundary.jsx    # 错误边界
│   ├── ProtectedRoute.jsx   # 路由保护
│   ├── home/                # 首页特定组件
│   └── admin/               # 管理后台组件
├── pages/                   # 页面组件
│   ├── HomePage.jsx         # 首页
│   ├── PostDetailPage.jsx   # 文章详情页
│   ├── ArchivePage.jsx      # 归档页
│   ├── SeriesPage.jsx       # 系列页
│   ├── SeriesDetailPage.jsx # 系列详情页
│   ├── TopicsPage.jsx       # 主题页
│   ├── TopicDetailPage.jsx  # 主题详情页
│   ├── DiscoverPage.jsx     # 发现页
│   ├── SearchPage.jsx       # 搜索页
│   ├── FollowingPage.jsx    # 关注页
│   ├── FeedsPage.jsx        # RSS 订阅页
│   ├── TagsPage.jsx         # 标签页
│   ├── FriendsPage.jsx      # 友链页
│   ├── StartHerePage.jsx    # 新手引导页
│   ├── AdminLoginPage.jsx   # 管理员登录页
│   └── AdminDashboardPage.jsx # 管理后台主页
├── contexts/                # React Context
│   ├── SiteContext.jsx      # 站点全局状态
│   └── ThemeContext.jsx     # 主题状态
├── utils/                   # 工具函数
│   ├── date.js              # 日期处理
│   ├── proxyImage.js        # 图片代理
│   ├── publicApiUrl.js      # API URL 处理
│   ├── structuredData.js    # 结构化数据 (SEO)
│   └── webPush.js           # Web Push 处理
└── tests/                   # 前端测试
```

### 主应用路由 ([App.jsx](file:///workspace/frontend/src/App.jsx))

```jsx
<Routes>
  <Route path="/" element={<HomePage />} />
  <Route path="/posts/:slug" element={<PostDetailPage />} />
  <Route path="/archive" element={<ArchivePage />} />
  <Route path="/series" element={<SeriesPage />} />
  <Route path="/series/:slug" element={<SeriesDetailPage />} />
  <Route path="/topics" element={<TopicsPage />} />
  <Route path="/topics/:topicKey" element={<TopicDetailPage />} />
  <Route path="/daily" element={<ContentTypePage contentType="daily_brief" />} />
  <Route path="/weekly" element={<ContentTypePage contentType="weekly_review" />} />
  <Route path="/feeds" element={<FeedsPage />} />
  <Route path="/tags" element={<TagsPage />} />
  <Route path="/admin/login" element={<AdminLoginPage />} />
  <Route path="/admin/dashboard" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
  <Route path="*" element={<NotFoundPage />} />
</Routes>
```

### 状态管理与 Context

#### SiteContext ([SiteContext.jsx](file:///workspace/frontend/src/contexts/SiteContext.jsx))
管理站点全局状态:
- 站点设置
- 用户登录状态
- 当前查看的主题/系列等

#### ThemeContext ([ThemeContext.jsx](file:///workspace/frontend/src/contexts/ThemeContext.jsx))
管理主题状态 (亮色/暗色模式)

### API 客户端 ([api/](file:///workspace/frontend/src/api/))

API 客户端采用模块化设计:
```javascript
// api/base.js - 基础配置
export const API_BASE = import.meta.env.VITE_API_BASE || '';

// api/posts.js - 文章相关 API
export async function fetchPosts(page = 1, pageSize = 10) {
  return fetchJson(`${API_BASE}/api/posts?page=${page}&page_size=${pageSize}`);
}
```

### 关键组件

#### 首页组件 ([HomePage.jsx](file:///workspace/frontend/src/pages/HomePage.jsx))
- Hero 区域展示
- 首页模块 (热门主题、最新文章等)
- 文章列表展示

#### 文章详情 ([PostDetailPage.jsx](file:///workspace/frontend/src/pages/PostDetailPage.jsx))
- Markdown 内容渲染
- 目录导航
- 点赞功能
- 评论区

#### 管理后台 ([AdminDashboardPage.jsx](file:///workspace/frontend/src/pages/AdminDashboardPage.jsx))
提供完整的后台管理功能:
- 文章管理
- 主题管理
- 系列管理
- 图片管理
- 站点设置
- 质量评估

### 预渲染

前端在构建时会执行预渲染 ([prerender-public.mjs](file:///workspace/frontend/scripts/prerender-public.mjs)):
- 生成主要公开页面的静态 HTML
- 确保内容优先可见
- 提升 SEO 效果

### 样式系统

使用 Tailwind CSS 3 配合自定义主题变量:
```css
:root {
  --bg-canvas: #fafafa;
  --accent: #3b82f6;
  --text-primary: #111827;
  /* ... */
}
```

---

## Scripts 自动化内容流水线

### 核心脚本文件

```
scripts/
├── auto-blog.mjs             # 主自动化脚本 (日/周流水线)
├── publish-article.mjs       # 单篇文章发布
├── publish-content-file.mjs  # 从文件发布内容
├── generate-cover-for-post.mjs  # 为文章生成封面
├── generate-site-hero.mjs    # 生成站点 Hero
├── backfill-quality-snapshots.mjs  # 回填质量快照
├── backfill-series-covers.mjs     # 回填系列封面
├── backfill-topic-profiles.mjs    # 回填主题资料
├── repair-post-media.mjs     # 修复文章媒体
├── lib/                      # 库函数
│   ├── blog-api.mjs          # 博客 API 客户端
│   ├── blog-format.mjs       # 内容格式化
│   ├── blogwatcher.mjs       # 博客监控与抓取
│   ├── arxiv.mjs             # arXiv 论文抓取
│   ├── cover-art.mjs         # 封面生成
│   ├── quality-gate.mjs      # 质量门禁
│   └── source-image-picker.mjs  # 来源图片选择
├── config/                   # 配置文件
│   ├── auto-blog.config.json # 自动化流水线配置
│   ├── cover-art-direction.json  # 封面方向配置
│   ├── series-assignment.rules.json  # 系列分配规则
│   └── topic-presentation.rules.json  # 主题展示规则
├── tests/                    # 测试文件
├── package.json
└── .env.example
```

### 主自动化脚本 ([auto-blog.mjs](file:///workspace/scripts/auto-blog.mjs))

这是内容流水线的核心，支持:

**运行模式**:
- `daily_auto`: 每日自动流水线
- `daily_manual`: 每日手动触发
- `weekly_auto`: 每周自动流水线
- `weekly_manual`: 每周手动触发

**主要流程**:
1. 抓取来源内容 (RSS、博客、arXiv 等)
2. 去重与质量筛选
3. 整理研究材料与候选主题
4. 生成文章结构
5. 生成封面图片
6. 调用后台 API 发布
7. 触发前端刷新

### 核心库模块

#### blog-api.mjs
封装与后端 API 的交互:
- 认证与会话管理
- 文章 CRUD
- 主题与系列管理
- 图片上传

#### blogwatcher.mjs
负责内容监控与抓取:
- 多源 RSS 订阅监控
- 新内容检测与去重
- 内容元数据提取

#### arxiv.mjs
专门处理 arXiv 论文:
- 按主题分类搜索
- 论文元数据提取
- 摘要解析

#### quality-gate.mjs
内容质量评估:
- 多维度质量评分
- 问题检测与报告
- 质量门禁决策

#### cover-art.mjs
封面生成:
- 提示词生成
- AI 生图调用
- 图片优化与上传

#### blog-format.mjs
内容格式化:
- 文章结构生成
- Markdown 格式化
- 元数据注入

### 配置文件

#### auto-blog.config.json
```json
{
  "sources": [/* RSS 源配置 */],
  "topics": [/* 主题配置 */],
  "series": [/* 系列配置 */],
  "quality": { /* 质量配置 */ }
}
```

### 工作流示例

**每日流水线**:
```
抓取 RSS 源 → 筛选主题相关内容 → 去重 →
质量评估 → 整理研究包 → 生成文章 →
生成封面 → 发布 → 触发前端刷新
```

---

## 数据库模型

### 核心表结构

#### posts 表 ([Post](file:///workspace/backend/app/models.py#L30-L67))
存储文章内容与元数据:
```python
class Post(Base):
    id                  # 主键
    title               # 标题
    slug                # URL 友好标识 (唯一)
    summary             # 摘要
    content_md          # Markdown 内容
    cover_image         # 封面图片 URL
    content_type        # 内容类型 (post, daily_brief, weekly_review)
    topic_key           # 主题键
    series_slug         # 所属系列
    series_order        # 系列中的顺序
    quality_score       # 质量分数
    reading_time        # 阅读时间估算
    view_count          # 浏览数
    like_count          # 点赞数
    is_published        # 是否已发布
    is_pinned           # 是否置顶
    created_at          # 创建时间
    updated_at          # 更新时间
```

**索引**:
- `ix_posts_public_published_created_at`
- `ix_posts_public_published_content_type_created_at`
- `ix_posts_public_published_topic_key_created_at`
- `ix_posts_public_published_series_slug_created_at`

#### series 表 ([Series](file:///workspace/backend/app/models.py#L69-L81))
存储文章系列信息:
```python
class Series(Base):
    id                  # 主键
    slug                # URL 友好标识 (唯一)
    title               # 标题
    description         # 描述
    cover_image         # 封面
    content_types       # 包含的内容类型
    is_featured         # 是否精选
    sort_order          # 排序
```

#### tags 表与 post_tags 关联表 ([Tag](file:///workspace/backend/app/models.py#L83-L89))
标签与文章多对多关系。

#### topic_profiles 表 ([TopicProfile](file:///workspace/backend/app/models.py#L234-L251))
主题资料管理:
```python
class TopicProfile(Base):
    topic_key           # 主题键 (唯一)
    title               # 标题
    description         # 描述
    cover_image         # 封面
    aliases_json        # 别名列表
    focus_points_json   # 关注点
    content_types_json  # 内容类型
    is_featured         # 是否精选
    is_active           # 是否活跃
    priority            # 优先级
```

#### site_settings 表 ([SiteSettings](file:///workspace/backend/app/models.py#L104-L115))
单例站点配置:
```python
class SiteSettings(Base):
    author_name         # 作者名
    bio                 # 作者简介
    avatar_url          # 头像
    hero_image          # 站点 Hero 图片
    github_link         # GitHub 链接
    announcement        # 公告
    site_url            # 站点 URL
    friend_links        # 友链 JSON
```

#### ai_channel_configs 表 ([AiChannelConfig](file:///workspace/backend/app/models.py#L117-L130))
AI 渠道配置:
```python
class AiChannelConfig(Base):
    purpose             # 用途 (image_generation, text_generation)
    provider            # 提供商
    base_url            # API 基础 URL
    model               # 模型
    api_key_env_var     # API Key 环境变量名
    api_key_value       # API Key 值 (优先使用)
    enabled             # 是否启用
```

#### 订阅相关表
- `email_subscriptions`: 邮件订阅
- `web_push_subscriptions`: Web Push 订阅
- `post_notification_dispatches`: 文章通知分发记录

#### 质量与发布相关表
- `publishing_runs`: 发布运行记录
- `post_sources`: 文章来源
- `publishing_artifacts`: 发布产物
- `post_quality_snapshots`: 质量快照
- `post_quality_reviews`: 质量审核
- `search_insights`: 搜索洞察

#### 互动相关表
- `comments`: 评论
- `post_likes`: 点赞记录
- `view_logs`: 浏览日志

---

## API 文档

### 公开 API

#### 健康检查
```
GET /health
GET /api/health
```

响应:
```json
{"status": "ok"}
```

#### 站点设置
```
GET /api/settings
```

响应:
```json
{
  "author_name": "极客新生",
  "bio": "大一 CS 学生 / Python & C++ 爱好者",
  "avatar_url": "",
  "hero_image": "",
  "github_link": "https://github.com",
  "announcement": "...",
  "site_url": "https://www.563118077.xyz",
  "friend_links": "[]"
}
```

#### 首页 Bootstrap
```
GET /api/public/home-bootstrap?page=1&page_size=10
```

响应包含:
- `settings`: 站点设置
- `home_modules`: 首页模块
- `posts`: 文章列表

#### 文章列表
```
GET /api/posts?page=1&page_size=10
GET /api/posts?topic_key=some-topic
GET /api/posts?series_slug=some-series
GET /api/posts?content_type=daily_brief
```

#### 文章详情
```
GET /api/posts/{slug}
```

#### 文章点赞
```
POST /api/posts/{slug}/like
```

#### 主题列表
```
GET /api/topics
```

#### 主题详情
```
GET /api/topics/{topic_key}
```

#### 系列列表
```
GET /api/series
```

#### 系列详情
```
GET /api/series/{slug}
```

#### 搜索
```
GET /api/search?q=关键词
```

#### RSS Feed
```
GET /feed.xml
```

#### Sitemap
```
GET /sitemap.xml
```

#### 图片代理
```
GET /proxy-image?url=图片URL
```

### 管理 API (需认证)

#### 登录
```
POST /api/admin/login
{
  "username": "...",
  "password": "..."
}
```

响应:
```json
{"access_token": "...", "token_type": "bearer"}
```

#### 文章管理
```
GET    /api/admin/posts
POST   /api/admin/posts
GET    /api/admin/posts/{id}
PUT    /api/admin/posts/{id}
DELETE /api/admin/posts/{id}
POST   /api/admin/posts/{id}/publish
```

#### 主题管理
```
GET    /api/admin/topics
POST   /api/admin/topics
PUT    /api/admin/topics/{topic_key}
DELETE /api/admin/topics/{topic_key}
```

#### 系列管理
```
GET    /api/admin/series
POST   /api/admin/series
PUT    /api/admin/series/{slug}
DELETE /api/admin/series/{slug}
```

#### 图片上传
```
POST /api/admin/upload-image
Content-Type: multipart/form-data
```

#### AI 渠道配置
```
GET    /api/admin/ai-channels
PUT    /api/admin/ai-channels/{purpose}
```

#### 站点设置更新
```
PUT /api/settings
```

### 订阅 API

#### 邮件订阅
```
POST /api/subscriptions/email
{
  "email": "...",
  "content_types": ["all"],
  "topic_keys": [],
  "series_slugs": []
}
```

#### Web Push 订阅
```
POST /api/subscriptions/webpush
{
  "endpoint": "...",
  "p256dh": "...",
  "auth": "..."
}
```

---

## 部署与开发

### 本地开发

#### 前置要求
- Python 3.11+
- Node.js 18+
- PostgreSQL 14+ (或使用 Neon)
- uv (Python 包管理工具)

#### 环境变量配置

复制各目录下的 `.env.example` 为 `.env` 并填写相应值。

**后端**:
```
DATABASE_URL=postgresql://...
SECRET_KEY=...
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
PUBLIC_SITE_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
```

**前端**:
```
VITE_API_BASE=http://localhost:8000
PUBLIC_SITE_URL=http://localhost:5173
```

**Scripts**:
```
BLOG_API_BASE=http://localhost:8000
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
```

#### 启动后端

```powershell
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload
```

后端默认地址: [http://127.0.0.1:8000](http://127.0.0.1:8000)

#### 启动前端

```powershell
cd frontend
npm install
npm run dev
```

前端默认地址: [http://127.0.0.1:5173](http://127.0.0.1:5173)

#### 运行测试

后端测试:
```powershell
uv run --project backend pytest backend/tests
```

前端测试:
```powershell
cd frontend
npm test
```

脚本测试:
```powershell
cd scripts
npm test
```

### 生产部署

#### 前端部署 (Vercel)

1. 将仓库连接到 Vercel
2. 配置环境变量
3. 部署

构建命令: `npm run build`
输出目录: `dist`

#### 后端部署 (Render)

使用仓库根目录的 [render.yaml](file:///workspace/render.yaml) 配置。

关键配置:
- Runtime: Docker
- Port: 8000
- Health Check Path: `/health`

环境变量在 Render Dashboard 中配置。

#### 数据库 (Neon)

1. 创建 Neon Postgres 实例
2. 获取连接字符串
3. 配置 `DATABASE_URL` 环境变量

#### 图片存储 (Cloudflare R2)

1. 创建 R2 桶
2. 生成 API Token
3. 配置 `R2_*` 环境变量
4. 配置自定义域名用于 CDN 访问

### CI/CD

GitHub Actions 工作流:
- [auto-blog.yml](file:///workspace/.github/workflows/auto-blog.yml): 自动化内容发布
- [generate-cover.yml](file:///workspace/.github/workflows/generate-cover.yml): 封面生成
- [backfill-*.yml]: 数据回填

---

## 常见问题与排障

### Vercel 构建失败

检查点:
1. `VITE_API_BASE` 是否指向可访问的后端
2. `PUBLIC_SITE_URL` 是否正确
3. 后端 API 是否正常响应

### 首屏加载慢

优化方向:
1. 确认预渲染正常生成
2. 检查 Render 后端冷启动问题
3. 确认一方图片使用直连而非代理
4. 检查 API 缓存是否生效

### 图片不显示

检查点:
1. `R2_PUBLIC_BASE_URL` 配置
2. 前端 `VITE_IMAGE_DIRECT_BASES` 配置
3. R2 桶权限是否公开
4. CDN 域名是否正确解析

### 自动化流水线故障

排查步骤:
1. 检查 GitHub Actions 日志
2. 验证 API 凭据是否有效
3. 检查 AI 渠道配额与可用性
4. 确认数据库连接正常

### 通知发送失败

检查:
1. Resend API Key 配置
2. Web Push VAPID 密钥
3. 企业微信 Webhook 地址
4. 订阅者列表是否有效

---

## 参考资料

- [本地启动指南](file:///workspace/docs/local-bootstrap.md)
- [Neon & R2 配置](file:///workspace/docs/neon-r2-setup.md)
- [仓库维护](file:///workspace/docs/repo-maintenance.md)
- [项目 README](file:///workspace/README.md)

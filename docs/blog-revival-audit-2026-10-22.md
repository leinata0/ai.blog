# ai.blog 恢复审查与运行清单

审查日期：2026-10-22（Asia/Taipei）。方向：中文 AI 新闻展示与专题阅读，浅色报刊式前端；每周维护预算 2–4 小时。

本轮交付是恢复修复、新闻前端改革与轻运营材料，需经 PR 合并和部署后才会在生产生效。未执行生产文章改写、群发、付费模型生成、服务配置变更或计划启停。线上读取与本地测试分别列出，不把本地通过解释为生产生成已恢复。

## 判断

站点有可继续使用的架构与历史内容。供给空转、来源可信度和首屏阅读效率需要分别处理：保留现有架构与历史 URL，用浅色报刊式首页展示头条、紧凑资讯和真实日期；自动化恢复按下方运行清单单独验收。详细方案见[新闻站定位与运营计划](blog-positioning-options-2026-10-22.md)。

## 证据与优先级

| 优先级 | 发现 | 影响与证据 | 本轮处理 |
| --- | --- | --- | --- |
| P1 | 日报 0 产出仍显示成功 | [10/22 运行](https://github.com/leinata0/ai.blog/actions/runs/39740663805)有 23 个候选，均未满足来源门槛；成功状态掩盖停更 | 区分正常去重跳过与来源/质量/调用阻断；全部受阻时失败，输出候选数、草稿数、发布数和原因摘要 |
| P1 | 周报上游模型不可用 | [10/19 运行](https://github.com/leinata0/ai.blog/actions/runs/39219993278)报 `all_models_failed`，HTTP 503 | 代码修复无法替代可用服务；生产模型需单独验收 |
| P1 | 已有来源链接可绕过校验 | [7/25 日报 API](https://www.563118077.xyz/api/posts/ai-brief-2026-07-25-helps-scientists-design-next-generation-medicines)存在 `[object Object]` 来源地址及正文引用，自动评分仍为 100 | 已知 `[Sx]` 链接统一绑定研究包 URL；门禁拒绝非法来源和错指目标。历史文章尚未批量修订 |
| P1 | 浏览与点赞刷新编辑时间 | `Post.updated_at` 的 `onupdate` 被计数 UPDATE 触发，连带影响文章日期和 sitemap lastmod | 六类计数更新保留原更新时间；正文编辑仍正常更新时间；不猜测还原历史日期 |
| P2 | 静态页刷新缺配置 | 上述 Actions 日志 `VERCEL_DEPLOY_HOOK_URL` 为空；SSG 页面可能落后于 API | 记录运行配置验收步骤，不伪造 hook、不触发部署 |
| P2 | 栏目故障显示成无内容 | `/daily`、`/weekly` 新旧 API 都失败时吞掉异常 | 展示可重试的失败状态，保留旧接口回退 |
| P2 | 历史文章被称为今日/实时 | 原首页固定展示“今日 AI 信号台 / LIVE SIGNAL”，主卡缺日期 | 新闻首页按真实文章日期展示；阅读指南解释头条、日报、周报、主题与来源；不伪造实时更新或人工核实标签 |
| P2 | 就绪不等于无待办 | [公开 readyz](https://ai-blog-hbur.onrender.com/readyz)为 ready，但诊断为 attention，报告 1 条历史明文密钥记录 | 仅记录诊断结果；生产需走已有后台加密修复功能，随后重启以刷新启动诊断 |

## 线上检查边界

- canonical 首页、旧 Vercel 地址、`/api/stats`、`/api/posts`、`/livez`、`/readyz`、RSS、sitemap、robots 在检查时均返回 200。
- [统计](https://www.563118077.xyz/api/stats)：141 篇文章、91 个标签、5 个系列。[列表](https://www.563118077.xyz/api/posts?page=1&page_size=5)最新新发文章为 2026-07-26 周报，阅读时间 38 分钟。旧文 `updated_at` 不是新发文证据。
- 现有 `scripts/smoke-check.mjs` 的公开模式通过。它只覆盖首页和几个公共 API，不代表登录、邮件、订阅、支付或实际模型生成已验收。
- 没有读取 Search Console、真实独立访客、邮件送达或费用数据。文章 view_count 不能当作真实读者规模。
- 发现部分 RSS 已失效，需逐个核对官方来源；本轮没有以未经验证的第三方镜像替换官方 feed。

## 运行恢复顺序

1. 审查本 PR，先把修复部署到后端和前端。后端无模型/表结构变更，不需要新增迁移步骤。
2. 在管理后台检查 AI 服务源、模型实例和运行计划。确认配置的是当前可用服务；必要时小范围验证文本生成。保存密钥通过已有后台功能完成，密钥不粘贴到文章、Issue 或日志。
3. 使用已有后台“诊断 / 加密”功能预览并修复历史明文记录。该功能已存在于 `/api/admin/diagnostics/encryption/reencrypt`；完成后重新启动服务，复查启动诊断。这个计数本身不表示已经发生泄露。
4. 若保留自动公开发布，在 GitHub 设置正确的 `BLOG_API_BASE`、`PUBLIC_SITE_URL` 变量及 `VERCEL_DEPLOY_HOOK_URL` Secret。hook 应来自当前 Vercel 前端项目的目标生产分支。核对发布后的 API 与静态 HTML 是否一致。
5. 手动验收一篇文章，核对来源、引用对应、图片、日期、RSS 和静态页面，再决定是否保留现有定时发布。先用抽查验证来源与引用，确认发布策略；若要求全量人工审核需另行实现待审与发布门禁，本轮未改定时任务。
6. 抽查最近及代表性的 10 篇旧文，优先修首页重点和高相关主题文章。坏来源应回到原文核实，无法确认就标明限制，不凭标题补造 URL。

模型 503、部署 hook 和历史修订仍属于生产侧待办。即使新任务现在会正确报红，也不意味着它已获得足够来源或恢复模型服务。

## 本地验证

三套测试分别使用各自的测试数据。流水线回归使用离线 fetch 替身，不调用真实模型；CLI 的 `--dry-run` 在正常来源足够时仍可能调用计费 LLM，它只禁止发布副作用，不是免费模式。

```powershell
uv run --project backend pytest backend/tests -q
Set-Location frontend
npm test
$env:PRERENDER_API_BASE='https://ai-blog-hbur.onrender.com'
$env:PUBLIC_SITE_URL='https://www.563118077.xyz'
npm run build
Set-Location ..\scripts
npm test
```

公开 smoke 可从仓库根目录运行，不传管理凭据：

```powershell
$env:PUBLIC_SITE_URL='https://www.563118077.xyz'
$env:BLOG_API_BASE='https://ai-blog-hbur.onrender.com'
$env:INCLUDE_ADMIN_SMOKE='0'
node scripts/smoke-check.mjs
```

恢复修复阶段验证：后端 890 项、前端 333 项、内容脚本 488 项测试通过；正式构建完成 88 个主题、5 个系列和 141 篇文章预渲染。独立审查发现的 Markdown 图片/代码误改已修复并复核通过。

恢复修复阶段的 Playwright 检查了当时首页与开始阅读的桌面和 390px 手机布局，手机无横向溢出；模拟栏目两个 API 均返回 503 时显示错误，恢复连接并点击重试后正常返回文章。浏览器通过仅允许 GET 的本地代理读取公开 API，没有操作生产写接口。构建保留现有较大的后台 Markdown 编辑器分包与 Browserslist 数据陈旧提示；本轮未升级框架或合并 Dependabot 的跨版本更新。

## 一周的最低维护动作

用 20–30 分钟检查运行状态、真实发布数与坏链接；用 40–60 分钟检查重点候选来源；用 30–60 分钟整理首页标题、摘要和主题关系；其余时间修订旧文或整理有新增事实的资讯。长文作为有材料时的可选深读，更新节奏由真实供给和维护预算决定。[恢复记录草稿](drafts/blog-relaunch-case-study.md)仅作内部工程记录，新闻供给依照已验证来源推进。

## 新闻改版独立复核

StartHere、HomePage 与 NavbarNavigation 的 13 项定向测试通过。独立 Playwright 会话通过本地 Vite 与只允许 GET 的公开 API 代理读取真实内容，检查了 390px 首页、文章预览、手机菜单及阅读指南，以及 768px 首页、搜索、标签与分页。以上宽度的页面 scrollWidth 均等于视口宽度。首页日期分别取自真实文章字段，头条为 2026-07-26，没有把旧文章标成今天或实时。

搜索无结果时显示明确空态；清空后回到首页；标签和第 2 页保留查询状态。模拟文章列表接口返回 503 时显示失败和重试按钮；恢复接口并点击重试后回到正常空结果，错误状态清除。浏览器检查未操作生产写接口。

## 新闻改版整体验收

前端测试涵盖新闻层级、真实发布日期、来源数量、导航焦点、旧接口回退、预览、无效来源，以及 HTML 注释与内部规划数据隐藏。正式构建生成 88 个主题、5 个系列和 141 篇文章页面；无 JS 首页也有报头、头条、日期、栏目和 GET 搜索入口。最终测试数及云端 CI 见本 PR 检查记录。

1440px 桌面、768px 平板、390px 手机检查中，首页、阅读指南、栏目与文章页没有横向溢出；暗色偏好保留，登录与后台不继承公共纸面主题。阅读页的旧 source_summary JSON 不再直接展示，坏来源地址显示为不可用，自动质量分折叠且注明“非事实审校”。

本地截图：`frontend/output/playwright/news-home-desktop.png`、`news-home-mobile.png`，以及 `frontend/output/news-article-*.png`、`news-daily-*.png`。截图和构建产物不纳入 Git。

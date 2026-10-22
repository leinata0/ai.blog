# ai.blog 恢复审查与运行清单

审查日期：2026-10-22（Asia/Taipei）。目标：个人品牌与作品展示；每周预算 2–4 小时。

本轮交付是代码修复、转型入口与运营材料，需经 PR 合并和部署后才会在生产生效。未执行生产文章改写、群发、付费模型生成、服务配置变更或计划启停。线上读取与本地测试分别列出，不把本地通过解释为生产生成已恢复。

## 判断

站点有可继续使用的基础，无需重写。真正的阻碍是供给空转、内容可信度和定位超出维护预算。保留现有架构与历史 URL，先把“自动生成很多资讯”转向“少量可以核验的实践案例”。详细选择见[转型计划](blog-positioning-options-2026-10-22.md)。

## 证据与优先级

| 优先级 | 发现 | 影响与证据 | 本轮处理 |
| --- | --- | --- | --- |
| P1 | 日报 0 产出仍显示成功 | [10/22 运行](https://github.com/leinata0/ai.blog/actions/runs/39740663805)有 23 个候选，均未满足来源门槛；成功状态掩盖停更 | 区分正常去重跳过与来源/质量/调用阻断；全部受阻时失败，输出候选数、草稿数、发布数和原因摘要 |
| P1 | 周报上游模型不可用 | [10/19 运行](https://github.com/leinata0/ai.blog/actions/runs/39219993278)报 `all_models_failed`，HTTP 503 | 代码修复无法替代可用服务；生产模型需单独验收 |
| P1 | 已有来源链接可绕过校验 | [7/25 日报 API](https://www.563118077.xyz/api/posts/ai-brief-2026-07-25-helps-scientists-design-next-generation-medicines)存在 `[object Object]` 来源地址及正文引用，自动评分仍为 100 | 已知 `[Sx]` 链接统一绑定研究包 URL；门禁拒绝非法来源和错指目标。历史文章尚未批量修订 |
| P1 | 浏览与点赞刷新编辑时间 | `Post.updated_at` 的 `onupdate` 被计数 UPDATE 触发，连带影响文章日期和 sitemap lastmod | 六类计数更新保留原更新时间；正文编辑仍正常更新时间；不猜测还原历史日期 |
| P2 | 静态页刷新缺配置 | 上述 Actions 日志 `VERCEL_DEPLOY_HOOK_URL` 为空；SSG 页面可能落后于 API | 记录运行配置验收步骤，不伪造 hook、不触发部署 |
| P2 | 栏目故障显示成无内容 | `/daily`、`/weekly` 新旧 API 都失败时吞掉异常 | 展示可重试的失败状态，保留旧接口回退 |
| P2 | 历史文章被称为今日/实时 | 原首页固定展示“今日 AI 信号台 / LIVE SIGNAL”，主卡缺日期 | 展示真实发布日期；去掉每日/实时承诺；首页及开始阅读明确处于实践转型阶段 |
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
5. 手动验收一篇文章，核对来源、引用对应、图片、日期、RSS 和静态页面，再决定是否保留现有定时发布。按个人品牌目标，建议先改成人工审核后发布；本轮未改定时任务。
6. 抽查最近及代表性的 10 篇旧文，优先修被新案例链接的文章。坏来源应回到原文核实，无法确认就标明限制，不凭标题补造 URL。

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

本轮最终验证：后端 890 项、前端 333 项、内容脚本 488 项测试通过；正式构建完成 88 个主题、5 个系列和 141 篇文章预渲染。独立审查发现的 Markdown 图片/代码误改已修复并复核通过。

Playwright 检查了首页与开始阅读的桌面和 390px 手机布局，手机无横向溢出；模拟栏目两个 API 均返回 503 时显示错误，恢复连接并点击重试后正常返回文章。浏览器通过仅允许 GET 的本地代理读取公开 API，没有操作生产写接口。构建保留现有较大的后台 Markdown 编辑器分包与 Browserslist 数据陈旧提示；本轮未升级框架或合并 Dependabot 的跨版本更新。

## 一周的最低维护动作

用 20 分钟检查运行状态与 broken links；用 60–120 分钟收集一个真实问题和复现材料；用剩余时间整理案例或更新旧文。双周发布一篇即可，四周先交付两个作品。首篇可从[恢复案例草稿](drafts/blog-relaunch-case-study.md)开始，作者复核后通过现有编辑器发布。

# 2026-10-25 加载性能试行与回退

本次是可独立撤销的性能试行，保持现有视觉和首页动效。没有数据库迁移，不覆盖或删除文章原图，不改 Cloudflare 账号规则。图片衍生文件跟随 Git 和 Vercel 部署版本保存。

## 固定回退基线

| 项目 | 已保存的版本 |
| --- | --- |
| Git 提交 | `15cff8f1f8c08aca75a28091af0d97e3eb229e46`，四个栏目沉浸式改版完成后的正式版本（PR #81） |
| 远程标记 | `rollback/pre-performance-trial-20261025`（带说明的 tag） |
| 原生产部署 | <https://ai-blog-9ettsxdrp-leinata0s-projects.vercel.app> |
| 试行前紧邻部署 | <https://ai-blog-aa98jp43n-leinata0s-projects.vercel.app>，后端基础 PR 触发的同版前端构建，可用作 Instant Rollback 目标 |
| 前端试行分支 | `codex/performance-trial` |
| 后端基础合并 | [PR #82](https://github.com/leinata0/ai.blog/pull/82)，`830381f10f37ef01f64c5cb62b9993fa6f562dc2` |
| 前端试行合并 | [PR #83](https://github.com/leinata0/ai.blog/pull/83)，`69743f3dc4747107aa18eb8781ed71fa43dea88d` |
| 试行版远程标记 | `trial/performance-20261025`，固定指向 PR #83 合并 SHA |
| 首次试行生产部署 | <https://ai-blog-n6dcp2zn6-leinata0s-projects.vercel.app>，deployment `7308921897` |
| 正式域名 | <https://www.563118077.xyz> |

本次拆成后端缓存基础、前端性能试行两个 PR。发布时应在两个 PR 中分别记录最终合并 SHA 和部署结果，并在前端试行 PR 记录新生产部署 URL、紧邻的前端回退目标、Render 源站头部及实际 `x-vercel-cache` 结果。配置和测试通过不等于已经命中 CDN 缓存。

后端基础验收：2026-10-25 04:54:22 UTC，Render 直接请求 `GET /api/discover?content_type=daily_brief&sections=items,total` 为 200，已确认 `Cache-Control: public,max-age=0,must-revalidate`、`CDN-Cache-Control: no-store`、`Vercel-CDN-Cache-Control: public,max-age=60,stale-while-revalidate=120` 和 `Vercel-Cache-Tag: public-collections-trial`。对应 Vercel Production deployment ID 为 `7308781031`。

前端验收：PR #83 最终 CI 为前端 571 项、后端 939 项、脚本 487 项通过与 1 项跳过；完成四个栏目的桌面与手机实页检查，以及首页场景初始化、暂停和继续。没有测得整页 LCP 或 FPS。相同周报封面原 PNG 为 2,390,857 字节，960w WebP 为 79,750 字节（减少 96.66%）；分组顺序测量的资源下载中位耗时为 5.477 秒与 0.771 秒，包含不同资源域名及网络/缓存差异，不能当作整页提速倍数。

首次上线后，日报和周报匿名查询各连续 3 次均为 `x-vercel-cache: MISS`、Cloudflare `DYNAMIC`、无 `Age`。Cookie、Authorization、401 和 422 响应禁止共享缓存的检查通过。API 缓存加速尚未验收通过，不能与图片优化一并宣称已生效。

后续缓存路由补丁在 `codex/performance-cache-routing` 独立分支：原 `/api/(.*)` 禁用规则也匹配三个公开列表。补丁让默认禁用路径排除这三个精确路径，凭证请求单独禁用，匿名公开列表才启用；所有匹配规则不能同时给出 `0` 和 `1`。这是排除配置歧义的试行修复，是否解决 `MISS` 必须在部署后实测。该补丁的最终 SHA、部署与结果记在其发布 PR；已有两个版本 tag 不移动。

## 试行内容与边界

- 图片：把当前公开栏目封面和首页大图生成多尺寸 WebP 衍生文件，通过版本化清单选图。新图片尚未收录时继续使用原图。保留原图、透明通道与比例，不固定替换为不相关图片。此次衍生文件放在 Vercel 的静态资源中，内容哈希 URL 使用一年不可变缓存；后续再评估接入发布流程或 R2。
- 首屏与切页：日报、周报、主题、系列携带受限的公开列表摘要，优先呈现可用快照，随后请求 API 更新。只保存当前标签页的公开列表，不保存文章正文、账号、令牌或管理员数据。会话快照最长 5 分钟，构建快照最长 30 分钟；更新失败显示状态提示，超时不无限保留旧快照。
- 预取：主导航在明确悬停/聚焦意图后预取栏目代码，避免启动时无差别下载全部栏目。
- 公共 API：只对精确路径 `/api/discover`、`/api/topics`、`/api/series` 进行 Vercel 单层短缓存试行。保留原完整查询参数；日报/周报、分页/筛选等不能合并为同一个缓存键。

Vercel 配置仅负责为没有 `Authorization`、`Cookie` 请求头的三个列表开启外部重写缓存，其他 `/api/…` 明确关闭。默认禁用规则与匿名公开列表启用规则不重叠；带凭证的列表单独禁用。缓存 TTL 由源站决定，不能在 Vercel 配置中用公共 TTL 覆盖私有或错误响应。

源站仅允许匿名 `GET`、`200/304`、公开 JSON（或对应的 304）进入缓存；带 `Authorization`、`Cookie`、`Range`，返回 `Set-Cookie`，原策略已是 `private`、`no-store`、`no-cache`，以及其他方法、非 JSON、错误与重定向都返回禁止边缘缓存的策略。三个列表以外的源站缓存行为保持原样。

| 缓存层 | 成功列表响应策略 |
| --- | --- |
| 浏览器 | `Cache-Control: public, max-age=0, must-revalidate`，不增加浏览器新鲜缓存时间 |
| 其他 CDN / Cloudflare | `CDN-Cache-Control: no-store` |
| Vercel | `Vercel-CDN-Cache-Control: public, max-age=60, stale-while-revalidate=120` |

Vercel 消费并移除自己的专用缓存头，浏览器看不到该头是正常情况。源站可看到它。Vercel 缓存命中需通过实际 `x-vercel-cache: HIT` 验证，不能把 Cloudflare 的 `DYNAMIC` 误判为 Vercel 缓存失败。

## 发布与验收顺序

1. 后端缓存基础独立 PR 先发布，前端试行仍在独立分支准备，分别跑相应前端、后端和构建检查。后端 PR 不改变前端体验，也不启用 Vercel 重写缓存。
2. 验证 Render 新源站策略已经生效，再通过第二个 PR 正式启用新 Vercel 前端版本及重写缓存。旧源站的通用缓存头是更长 TTL，不应把它当成本次 60 秒试行策略。后端 PR 可能触发一次内容相同的 Vercel 构建，记录该部署作为前端试行紧邻的回退目标。
3. 对同一精确公开 URL 连续正常请求，验证首个回源、随后 `HIT`；避免添加随机查询参数、`Pragma: no-cache` 或开发者工具“禁用缓存”，这些会改变测量条件。
4. 分别请求日报与周报查询，验证内容不同、列表数量与链接正确。检查带 Cookie/Authorization、无效参数、私有路由不命中试行缓存。
5. 桌面和手机检查封面清晰度、透明人物图、首页原动效、四个栏目切换、文章链接及失败恢复。按相同网络分别记录首次访问和重复访问，不能只报告一次最快值。
6. 记录新生产部署与合并 SHA 后再交付用户体验。若该平台/项目无法产生实际 `HIT`，应如实记录，不能声称 CDN 优化已生效。

## 用户反馈不好时怎样回退

### 快速恢复前端体验

在 [Vercel 项目](https://vercel.com/leinata0s-projects/ai-blog) 的 Production Deployment 中选择 Instant Rollback，核对目标为前端试行之前的生产部署（后端基础 PR 如触发前端构建，其前端体验仍与基线一致）。它切回原前端构建、图片选择清单和路由配置，不需要重建。Hobby 方案通常只允许回退到上一个生产部署，保留这份 Git tag 可以避免依赖平台的历史保留范围。

Instant Rollback **不会回退独立部署在 Render 的后端**，也不会修改 Git 分支或数据库。后端的短缓存策略兼容旧前端，但要完整撤销此次试行，仍需执行下面的代码回退；后续部署也应基于回退后的 Git，避免新构建覆盖已恢复的前端。

### 完整恢复代码和两端部署

在干净工作树从最新 `origin/master` 新建回退分支，按发布的反向顺序撤销：若缓存路由后续补丁也已上线，先 `git revert <该补丁PR的squash合并SHA>`；然后 `git revert 69743f3dc4747107aa18eb8781ed71fa43dea88d`（前端试行），最后 `git revert 830381f10f37ef01f64c5cb62b9993fa6f562dc2`（后端基础），经 PR 检查后合并。只想恢复可见体验时可保留兼容的后端短缓存策略。不要 `reset --hard`、强推或移动基线 tag；保留版本历史，避免覆盖试行之后其他独立修改。若试行后已有相关改动，先审查 revert diff 并处理冲突。

Git revert 合并后，分别确认 Vercel 和 Render 部署成功，再验证正式站和 API。完整回退会恢复原图片选择与数据加载方式，并移除此次专用边缘缓存策略；衍生文件可保留在历史中，原图始终可用。此方案无需回滚数据库。

### 只关闭某一项试行

| 开关 | 操作与范围 |
| --- | --- |
| `VITE_PERFORMANCE_TRIAL=0` | Vercel 构建环境设为 `0` 并重新构建，关闭前端图片清单、首屏快照和意图预取。它不是运行时开关，也不会关闭后端/CDN 配置。 |
| `PUBLIC_EDGE_CACHE_TRIAL=0` | Render 环境设为 `0` 并使服务应用新环境，三个列表返回 `private, no-store` 和 Vercel 专用 `no-store`。不改 API 返回内容，不影响静态图片缓存。 |
| 只关闭 Vercel API 缓存 | 将三个精确列表的 `x-vercel-enable-rewrite-caching` 改为 `0` 后部署，其他改进可保留。 |

关闭源站开关不会主动删除已存在的边缘副本，正常策略下可能还需等待最多约 60 秒新鲜期加 120 秒 SWR 窗口。涉及撤稿等要求立即失效的情况，使用 Vercel 针对 `public-collections-trial` 标签的缓存失效功能并复测；不要为了列表缓存清理个人数据或全站静态资源。浏览器已经打开的页面需刷新或重新进入栏目，旧标签页不会被远程强制重载。

## 依据

- [Vercel 外部重写与缓存开关](https://vercel.com/docs/routing/rewrites)：旧项目需显式 opt-in，源站缓存头参与决策。
- [Vercel 专用缓存头优先级](https://vercel.com/docs/caching/cache-control-headers)：`Vercel-CDN-Cache-Control` 优先于通用缓存头，且不传递给下游。
- [Vercel 可缓存响应条件](https://vercel.com/docs/caching/cdn-cache)：方法、授权、响应 Cookie 与私有响应的限制。
- [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)：回退既有构建及不同方案的历史部署限制。
- [Cloudflare CDN-Cache-Control](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/)：分别控制 CDN 与浏览器行为。

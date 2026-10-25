# 2026-10-25 栏目首屏加载修复

## 现象与已确认原因

用户截图中的日报停在“正在载入日报”，发生在文章数据到达前。图片压缩无法解决这一阶段。

- 正式日报 HTML 中实际存在 24 条公开摘要，但构建快照 30 分钟后就被浏览器丢弃。复测时快照已约 39 分钟；新会话重新等待 Render API。
- 首页原先只有首页数据，没有另外四个栏目的摘要。SPA 切入日报时，即使页面代码已预取，也没有可直接展示的列表。
- API 客户端原先在收到响应头后就清理超时及外部取消监听，读取响应体时可能无限等待。
- 外部 API rewrite 连续请求仍 MISS；后端自身 app 时间约 80–110ms，不能把此次等待归因为数据库慢或已经证实的冷启动。

## 本次边界

1. 所有公共 HTML 携带四栏目的有限公开摘要。构建复用原有请求，最多每栏 24 条、128 KiB，单独包有总量上限，不包含正文、草稿、账号或后台字段。私有 shell 不携带该包。
2. 未过期的会话摘要直接显示；过期的已发布摘要仅作为带时间提示的核验预览，最多 8 秒。验证失败或超时就停止展示，不把旧内容伪装为当前已核验列表。
3. 独立 `/public-data/{daily,weekly,topics,series}.json` Function 只访问固定 Render 公开路径，输出同一字段白名单，匿名成功结果使用 Vercel 60 秒新鲜期加 120 秒 SWR。源站完整响应体总预算 5 秒；客户端总预算 8 秒。错误、私有源站、响应 Cookie 或异常 JSON 不缓存。
4. 生产正式域名的数据请求显式省略凭证。受 Vercel 登录保护的部署预览保留同源平台会话。该资源始终只含固定公开摘要，浏览器凭证从不传给 Render；命中 CDN 时，带 Cookie 的请求也可能收到同一公开缓存，Range 请求可能收到标准 206。实际调用 Function 的带凭证请求返回 private/no-store；原受保护 API 的访问与缓存边界不变。
5. 导航意图同时预取栏目代码与公开数据。进入栏目复用同一进行中请求；单个组件离开不取消其他消费者的共享请求。完成后的源时间保留，不用“收到时间”续长内容有效期。
6. 成功空列表权威覆盖旧内容；旧 CDN 结果不得覆盖已知新结果。已覆盖的构建版本需跨刷新保持抑制，避免撤下的文章重新出现。

## 发布与回退

修复前基线是 `86c43393bc7a5df7acdcd94ce1248efc47ec1b2b`，已保存远端 annotated tag `rollback/pre-collection-paint-fix-20261025`。原生产部署是 <https://ai-blog-modr0hu18-leinata0s-projects.vercel.app>。原整轮试行前标签 `rollback/pre-performance-trial-20261025`（`15cff8f1f8c08aca75a28091af0d97e3eb229e46`）保留不动。

先独立发布公开数据 Function，必须用正常匿名请求取得实际 HIT/Age 证据；再接入前端。预览受平台登录保护时，不能把凭证请求或 401 当作匿名缓存性能证据。两个发布 PR 应分别记录最终 squash SHA、准确部署 URL、HTTP 结果与限制。

Function 基础已由 PR #85 上线：`26512cde9d3fe83d1fad42db6bae764bdfbcbc7b`，不可变部署 <https://ai-blog-r5i6y0rhi-leinata0s-projects.vercel.app>，发布标签 `trial/public-collection-endpoint-20261025`。四个栏目匿名请求均验证 MISS → HIT，完整 JSON 哈希与源时间在命中前后保持一致。日报三次 Age 为 0/1/2；该组 TTFB 为 1.602/0.773/1.124 秒，只代表资源请求，不能视为整页加载时间。原外部 rewrite 未据此宣称命中。

边界实测：Authorization 为 BYPASS/private-no-store；未知 `url`、`limit` 连续返回 400/no-store。公开 alias 路径的 `route` 查询由固定 rewrite 覆盖，不宣称这类参数被 400 拒绝。Cookie HIT 与 Range 206 HIT 是同一固定公开资源的 CDN 行为。

撤销此次栏目加载修复时，从最新 master 建 `codex/` 回退分支，先 revert 前端接入 PR，再 revert Function 基础 PR，经检查后合并。若要撤销整轮性能试行，再按反向顺序撤销 PR #84、#83、#82。使用 revert 保留历史，不移动标签或强推，不恢复数据库、不覆盖原图。

`VITE_PERFORMANCE_TRIAL=0` 重新构建可关闭前端试行行为；它不会删除已部署 Function 或改变后端配置。若撤销 Function，必须先撤销前端接入，避免前端继续请求不存在的路径。

## 验收要求

必须覆盖部署超过 30 分钟的摘要、首页跨栏目首屏、慢响应体/取消、8 秒预览到期、成功空列表、旧 CDN 晚到与跨刷新撤稿抑制。不能再只检查刚部署的未过期快照。最终正式域名应复测 Function 匿名 HIT、页面内容与封面、首页原动效；网络资源用时不等于整页 LCP。

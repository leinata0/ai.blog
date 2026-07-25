# Signal Desk 认证与运营台 2.1

**日期：** 2026-07-26  
**范围：** 认证、账号、管理员登录与全部现有管理模块  
**技术基线：** React 18、React Router 6、Vite 5、Tailwind CSS、Framer Motion

## 已验证根因

1. 顶层 `Suspense` 包裹 `AnimatePresence mode="sync"`。首次进入懒加载路由时，新页面挂载但旧页面不退出，生产环境会同时保留两个页面主区域。
2. `/login`、`/account` 和 `/admin/*` 被主动映射到旧 `standard` surface，因此认证与管理页面必然恢复蓝灰主题。
3. 未预渲染的认证和管理路径统一回退到首页 HTML，直接访问或弱网加载时会先看到首页快照。

## 设计决策

### 三种语义表面

- `editorial`：公开内容与阅读体验。
- `auth`：认证、恢复与账号管理；沿用 Signal Desk 品牌，但降低信息密度和装饰。
- `operations`：管理端高密度运营驾驶舱；复用信号青、电紫、暖橙与统一交互时序。

旧 `standard` surface 不再承担任何路由。

### 路由过渡

- 全局只保留新页面的入场动画，旧页面在路径变化时立即卸载。
- `Suspense` 位于当前路径的过渡容器内部。
- 稳定态必须只有一个 `#main-content`、一个页面过渡容器和一个页面级 `h1`。

### 管理信息架构

| 分组 | 分区 |
|---|---|
| 内容 | 文章、主题、系列、评论、图片 |
| 智能 | 质量收件箱、主题反馈、搜索洞察、内容健康、主题健康 |
| 运行 | 发布状态、接口与订阅健康、任务、统计 |
| 系统 | 站点设置、Provider、模型实例、运行计划 |

桌面采用可折叠侧栏，移动端采用顶部栏与全屏导航抽屉。公开站命令搜索和管理命令搜索按 surface 分离。

## URL 契约

管理端继续使用 `/admin/dashboard`，状态写入查询参数：

- `section`：管理分区，默认 `posts`。
- `view`：`list` 或 `editor`。
- `post`：`new` 或文章 ID。
- `panel`：设置中的 `site`、`providers`、`models` 或 `runtime`。
- 文章筛选：`q`、`content_type`、`published`、`published_mode`、`coverage_date`、`series_slug`、`page`、`page_size`。

非法值使用默认值并通过 replace navigation 修正，浏览器前进、后退和刷新必须恢复上下文。

## 安全与兼容边界

- 不修改后端 API、JWT、localStorage key、Provider payload、生成任务轮询或批量并发限制。
- 管理员 401 在应用内发布 unauthorized 事件并使用 replace navigation；无监听器时才整页跳转。
- 删除、覆盖、清空和撤销类操作必须显示目标与影响并二次确认。
- 编辑器在未保存时阻止误离开；Markdown 编辑器只做主题和容器适配。
- 认证与管理静态 shell 使用 `noindex,nofollow`，不得包含用户或管理员数据。

## 验收预算

- 动画仅使用 `opacity` 和 `transform`；点击 80–120ms，局部切换和页面入场 180–240ms。
- 可见触摸目标至少 44px；表单有可点击标签、正确 autocomplete 与可见焦点。
- dialog/sheet 支持焦点圈定、Escape、焦点恢复、overscroll containment 和状态播报。
- 390、768、1024、1440px 明暗主题无横向溢出。
- 管理模块和 Markdown 编辑器不进入公开页面首屏包。
- 完整 Vitest、生产构建、SSG 与真实生产域名空缓存导航测试必须通过。

## 本地验收记录

- Vitest：46 个测试文件、163 项测试通过。
- 生产构建：Vite 成功转换 3016 个模块；SSG 生成 87 个主题、5 个系列和 140 篇文章。
- 私有 shell：登录、注册、找回、重置、邮箱验证、账号中心、管理员登录和管理控制台均为 `noindex,nofollow`，不包含首页内容或 bootstrap 数据。
- 路由生命周期：首页进入登录后，DOM 中只有一个页面过渡容器、一个 `#main-content`、一个 `<main>` 和一个 `<h1>`。
- 管理端：在 API mock 下逐一走查 14 个分区，验证 URL、页面标题、页面级标题和无错误状态。
- 响应式截图：
  - [用户登录 390px](../../frontend/output/playwright/login-390.png)
  - [用户登录 1440px](../../frontend/output/playwright/login-1440.png)
  - [管理员登录 390px](../../frontend/output/playwright/admin-login-390.png)
  - [管理文章 390px](../../frontend/output/playwright/admin-dashboard-390.png)
  - [管理文章 768px](../../frontend/output/playwright/admin-dashboard-768.png)
  - [管理文章 1024px](../../frontend/output/playwright/admin-dashboard-1024.png)
  - [管理文章 1440px](../../frontend/output/playwright/admin-dashboard-1440.png)
  - [管理文章深色主题](../../frontend/output/playwright/admin-dashboard-dark-1440.png)
  - [管理文章命令搜索](../../frontend/output/playwright/admin-command-search-1440.png)

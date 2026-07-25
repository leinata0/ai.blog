# 智能编辑部 2.0 设计决策

**日期：** 2026-07-25
**范围：** 公开站点；账号、认证和管理后台维持现状
**技术基线：** React 18、React Router 6、Vite 5、Tailwind CSS、Framer Motion

## 目标与原则

智能编辑部不是霓虹装饰层，而是一套帮助读者校准信息、理解关联并快速行动的内容界面。设计优先级为：品牌辨识度 30%、任务效率 25%、无障碍 20%、性能 15%、实现风险 10%。

1. 以编辑可信度承载 AI 实时感，避免机器人、粒子和无意义光效。
2. 第一屏同时回答“这里是什么”“今天最重要的是什么”“下一步去哪里”。
3. 搜索、筛选、预览、阅读全文和关注反馈使用一致交互语言。
4. 状态可分享、可恢复、可使用键盘完成，动画不妨碍阅读。

## 参考来源与提炼

| 来源 | 采用的模式 | 明确不采用 |
|---|---|---|
| [OpenAI](https://openai.com/) | 高对比排版、克制状态色、内容优先 | 产品营销式超大留白 |
| [Anthropic](https://www.anthropic.com/) | 编辑感标题、温和但明确的品牌语气 | 大面积暖米色单色主题 |
| [Perplexity](https://www.perplexity.ai/) | 搜索作为主任务、结果分组与键盘流 | 将所有内容压缩成问答框 |
| [Linear](https://linear.app/) | 快捷命令、快速反馈、精确动效 | 紫蓝渐变与玻璃层叠泛用化 |
| [Vercel](https://vercel.com/) | 系统字体、清晰性能边界、渐进披露 | 黑白技术品牌的直接复制 |
| [MIT Technology Review](https://www.technologyreview.com/) | 新闻层级、专题入口、长文可信度 | 传统门户式栏目密度 |
| [机器之心](https://www.jiqizhixin.com/) | 中文 AI 信息分类与时效表达 | 首屏堆叠大量同权卡片 |
| [少数派](https://sspai.com/) | 中文阅读节奏、专题与系列组织 | 生活方式媒体的视觉语气 |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | 焦点、目标尺寸、对比度、状态播报 | 仅依赖颜色或悬停表达状态 |
| [web.dev Core Web Vitals](https://web.dev/articles/vitals) | LCP、CLS、INP 性能预算 | 为动效牺牲首屏稳定性 |

三路隐藏 CLI 调研中，视觉与工程代理完成了只读报告，交互代理因本机 Codex 认证代理返回 401 而失败；当前会话原生子代理入口同时返回 unsupported，无法补跑正式交叉质询。视觉报告确认应保留 Signal Desk、减少玻璃与装饰竞争；工程报告推动修复了筛选接口、搜索历史同步、模态键盘行为、reduced-motion、SSG 静态路由和 standard surface 隔离。最终决策只引用已核验的公开模式和代码、测试、浏览器证据，不伪造缺失的代理结论。

## 方向评分

评分为 1-5，最终分为加权百分制。

| 方向 | 品牌 30% | 效率 25% | 无障碍 20% | 性能 15% | 风险 10% | 总分 | 结论 |
|---|---:|---:|---:|---:|---:|---:|---|
| 智能编辑部 / Signal Desk | 5 | 5 | 4 | 4 | 4 | 90 | 采用 |
| 霓虹 AI 控制台 | 4 | 3 | 2 | 2 | 2 | 57 | 否决 |
| 极简对话搜索首页 | 3 | 4 | 4 | 5 | 3 | 76 | 否决 |

### 被否决：霓虹 AI 控制台

高饱和紫蓝、玻璃卡片和持续动画能快速制造“AI 感”，但会削弱中文长文可信度、对比度与低端设备性能，也容易与大量 SaaS 产品同质化。

### 被否决：极简对话搜索首页

单一输入框效率高、性能好，但会隐藏编辑精选、专题关系和持续更新的媒体属性。它适合工具，不适合需要建立判断和阅读路径的内容站。

## 主方案

### 视觉系统

- 浅色为矿物白，深色为深墨；信号青表示实时与可行动状态，电紫表示知识关联，暖橙只用于编辑精选。
- 中文标题保持编辑部气质，正文使用系统中文字体栈；英文、数字和状态使用等宽系统字体，不加载大型中文 WebFont。
- 网格、坐标、信号线表达信息系统；公开卡片减少 backdrop blur 和层层嵌套。

### 信息与交互

- 首页第一屏为“今日 AI 信号台”，同时展示主信号、趋势脉冲、搜索和下一屏内容提示。
- `Ctrl/Cmd + K` 打开全局命令搜索，支持文章、主题、系列、页面及完整键盘操作。
- 桌面卡片提供快速预览抽屉，移动端保留明确链接直接进入文章。
- 首页 `q/tag/page`、发现页 `q/content_type/series`、归档页 `type/series/sort` 由 URL 驱动。
- 文章页保留阅读进度和活跃目录，增加关联阅读轨道、上下文入口和可播报的关注/点赞反馈。

### 动效规范

- 点击反馈 80-120ms，局部切换 180-240ms，页面过渡不超过 320ms。
- 只动画 `transform` 与 `opacity`；颜色和边框过渡只用于状态反馈。
- `prefers-reduced-motion: reduce` 下关闭位移、循环动画和平滑滚动。
- React 保持 18.x，使用现有 Framer Motion；不引入 React canary 或 View Transition API。

## 预算与验收

- 可见触摸目标至少 44px；焦点环清晰，命令面板和抽屉关闭后恢复焦点。
- 每页一个 `h1`，语义按钮/链接分工明确，异步成功和失败通过 `aria-live` 播报。
- 公共页面 CLS <= 0.1、LCP <= 2.5s、INP <= 200ms；Accessibility 和 Best Practices 目标均 >= 95。
- 公开入口不包含 Markdown 编辑器；管理端编辑器继续独立按需加载。
- 390、768、1024、1440px 均不得产生横向溢出，长标题、无图、空状态和明暗主题需保持可读。

## 实现映射

- 全局：`App.jsx`、`CommandPalette.jsx`、`PageTransition.jsx`、`Navbar.jsx`、`Footer.jsx`
- 首页：`TodaySignalBoard.jsx`、`ArticleQuickPreview.jsx`、`HomePage.jsx`
- 阅读：`PostDetailPage.jsx`、`FollowTopicButton.jsx`、`TableOfContents.jsx`
- 状态：`DiscoverPage.jsx`、`ArchivePage.jsx`、`SearchPage.jsx`
- 设计令牌与响应式规则：`frontend/src/index.css`

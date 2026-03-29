from app.models import Post, Tag

FULLSTACK_ARTICLE = """\
# 大一新生的全栈破局：AI 辅助构建极客博客的实战复盘

## 一、极客起航：为什么要自己造一个博客？

作为一名大一计算机专业的学生，我的课余时间几乎都泡在终端和编辑器里。用 Python 写 Selenium + Pandas 自动化脚本抓数据、啃 C/C++ 的指针与内存管理、研究 OpenClaw 开源项目的私有化部署——这些"硬核折腾"构成了我大学生活的主旋律。

零散的笔记越攒越多，我迫切需要一个属于自己的发布平台——不是在第三方博客上写，而是从前端到后端、从数据库到部署，全部自己掌控。正好学校的 AI 编程挑战赛给了我一个契机：用 AI 辅助，从零搭建一个全栈极客博客，并把它部署到公网。

## 二、架构大图：三层分离，各司其职

经过调研，我选定了一套轻量但完整的技术栈：

| 层级 | 技术选型 | 托管平台 |
|------|---------|---------|
| 前端 | React + Vite + Tailwind CSS | Vercel |
| 后端 | Python FastAPI + SQLAlchemy ORM | Render |
| 数据库 | SQLite（文件型，零运维） | Render 持久化磁盘 |

**前端**使用 React 搭配 Vite 构建，Tailwind CSS 负责极客风格的暗色主题 UI。通过 Vercel 的 Git 集成，每次 push 自动触发构建部署，体验丝滑。

**后端**选择 FastAPI，原因很简单：Python 是我最熟悉的语言，FastAPI 的异步性能和自动生成 API 文档的能力让开发效率拉满。SQLAlchemy 作为 ORM 层，让我不用手写 SQL 就能完成数据建模。

**数据库**用 SQLite 而非 PostgreSQL，是因为个人博客的并发量极低，SQLite 的零配置特性省去了大量运维成本。一个 `.db` 文件就是整个数据库，备份只需复制文件。

前后端通过 RESTful API 通信，Vercel 端配置了 `rewrites` 规则，将 `/api/*` 请求代理到 Render 上的后端服务，实现了跨域无感调用。

## 三、踩坑与反杀：Render 部署的三重关卡

本地开发一路顺畅，真正的挑战从部署 Render 开始。

### 关卡一：持久化磁盘的"付费墙"

SQLite 的数据存储在文件里，而 Render 免费实例每次重启都会重置文件系统。这意味着——每次服务休眠唤醒，我的博客文章就全没了。

解决方案是挂载 Render 的 Persistent Disk，把 `blog.db` 放到持久化路径 `/data` 下。但这个功能需要 Starter Plan 起步，于是我绑定了支付方式升级到付费计划。这一步还顺带解除了 Render 的"防滥用限制"，后续部署再也没被卡过。

### 关卡二：配置文件的连环修改

挂载磁盘后，需要同步修改多处配置：

- `render.yaml`：声明 disk 挂载点和容量
- `Dockerfile`：确保数据目录存在并设置正确权限
- `db.py`：通过环境变量 `DATABASE_URL` 指向 `/data/blog.db`
- Render Dashboard：手动配置环境变量和磁盘绑定

任何一处遗漏都会导致服务启动失败或数据写入临时目录。我前后调试了好几轮，Claude Code 在这个过程中帮我逐一排查配置项，省去了大量翻文档的时间。

### 关卡三：消失的 Dockerfile

最惊险的一幕发生在某次 git 操作后——Dockerfile 不见了。Render 构建直接报错，服务下线。当时我心态差点崩了，但冷静下来后，通过 `git log` 和 `git show` 找回了文件内容，重新提交后服务恢复。这次事故让我深刻体会到：**版本控制不是可选项，而是救命绳。**

## 四、人机协作感悟：终端里的 AI 搭档

整个项目从零到上线，Claude Code 作为终端 AI 助手全程参与。以下是我最深的几点体会：

**1. 脚手架搭建效率惊人。** 项目初始化阶段，从 FastAPI 项目结构、SQLAlchemy 模型定义、React 路由配置到 Tailwind 主题定制，Claude Code 能在几分钟内生成完整的可运行代码框架。对于大一学生来说，这相当于跳过了最枯燥的"从零配置"阶段，直接进入业务逻辑开发。

**2. 部署排错的"第二双眼睛"。** Render 部署过程中的配置问题往往涉及多个文件的联动修改，人工逐一排查容易遗漏。Claude Code 能快速定位配置不一致的地方，并给出修复方案，这在 Dockerfile、render.yaml、环境变量三者需要严格对齐的场景下尤为关键。

**3. 人类决策 + AI 执行 = 最佳组合。** AI 不会替你做架构决策——选 SQLite 还是 PostgreSQL、用 Vercel 还是 Netlify，这些判断需要结合实际场景由人来拍板。但一旦方向确定，AI 能极大加速执行层面的工作。这种"人类掌舵、AI 划桨"的协作模式，是我在这个项目中最大的收获。

## 五、写在最后

从一个只会写 Python 脚本的大一新生，到独立完成前后端分离的全栈博客并部署上线，这个过程既是技术能力的跃迁，也是工程思维的启蒙。AI 不会让学习变得不重要——恰恰相反，你需要足够的基础知识才能向 AI 提出正确的问题、判断它给出的方案是否靠谱。

这个博客会持续更新，记录我在 Python、C/C++ 和开源项目中的所有折腾。如果你也是一个喜欢动手的极客新生，欢迎一起交流。

> 工具会迭代，但解决问题的思维方式不会过时。
"""


def seed_data(db_session):
    tag_python = Tag(name="Python", slug="python")
    tag_automation = Tag(name="Automation", slug="automation")
    tag_cpp = Tag(name="C/C++", slug="cpp")
    tag_notes = Tag(name="Notes", slug="notes")
    tag_devops = Tag(name="DevOps", slug="devops")
    tag_openclaw = Tag(name="OpenClaw", slug="openclaw")

    post1 = Post(
        title="Python 自动化实战：Selenium 与 Pandas 结合",
        slug="python-automation-selenium-pandas",
        summary="从页面抓取到表格清洗，串起 Selenium 与 Pandas 的一套高频自动化工作流。",
        content_md="# Python 自动化实战：Selenium 与 Pandas 结合\n\n结合 Selenium 的页面操作能力与 Pandas 的数据整理能力，可以快速搭建抓取、清洗、导出一体化的自动化脚本。\n\n## 适用场景\n\n- 后台报表下载与整理\n- 重复性网页录入\n- 批量数据校验与汇总\n\n## 实战要点\n\n1. 先用 Selenium 保证页面状态稳定。\n2. 再把结构化结果交给 Pandas 清洗。\n3. 最后输出为 Excel 或 CSV，形成可复用流程。",
    )
    post1.tags.extend([tag_python, tag_automation])

    post2 = Post(
        title="C/C++ 核心概念学习与排坑记录",
        slug="cpp-core-concepts-notes",
        summary="围绕指针、内存管理、对象生命周期与编译链接问题的持续学习笔记。",
        content_md="# C/C++ 核心概念学习与排坑记录\n\n学习 C/C++ 时，最容易反复踩坑的地方通常集中在内存、对象生命周期、头文件组织和编译链接阶段。\n\n## 持续关注\n\n- 指针与引用的边界\n- 栈与堆的使用差异\n- RAII 与资源释放\n- 头文件重复包含与链接错误\n\n## 排坑建议\n\n先理解语言模型，再写示例验证；把每次编译错误、运行时错误和修复方式沉淀成笔记，进步会更快。",
    )
    post2.tags.extend([tag_cpp, tag_notes])

    post3 = Post(
        title="OpenClaw 部署指南：从零搭建你的私有化平台",
        slug="openclaw-deployment-guide",
        summary="手把手教你用 Docker Compose 部署 OpenClaw，涵盖环境准备、配置调优与常见问题排查。",
        content_md="# OpenClaw 部署指南：从零搭建你的私有化平台\n\nOpenClaw 是一个轻量级的开源平台，支持快速私有化部署。本指南将带你从零开始，完成从环境准备到服务上线的全流程。\n\n## 环境准备\n\n- Docker 20.10+ 与 Docker Compose V2\n- 至少 2 核 CPU、4GB 内存的服务器\n- 一个已备案的域名（可选，用于 HTTPS 访问）\n\n## 部署步骤\n\n1. 克隆仓库并进入项目目录。\n2. 复制 `.env.example` 为 `.env`，根据实际情况修改数据库密码与密钥。\n3. 运行 `docker compose up -d` 启动所有服务。\n4. 访问 `http://your-server:8080` 完成初始化设置。\n\n## 配置调优\n\n- 调整 worker 数量以匹配 CPU 核数。\n- 为数据库挂载独立的 SSD 卷以提升 I/O 性能。\n- 启用 Redis 缓存减少重复查询。\n\n## 常见问题\n\n- 容器启动失败：检查端口占用与 `.env` 配置。\n- 数据库连接超时：确认网络模式与防火墙规则。\n- 页面空白：清除浏览器缓存或检查前端构建日志。",
    )
    post3.tags.extend([tag_devops, tag_openclaw])

    tag_ai = Tag(name="AI", slug="ai")
    tag_fullstack = Tag(name="全栈", slug="fullstack")

    post4 = Post(
        title="大一新生的全栈破局：AI 辅助构建极客博客的实战复盘",
        slug="freshman-fullstack-ai-blog",
        summary="从零到公网上线，一个大一新生用 Claude Code 辅助搭建 React + FastAPI 全栈博客的完整复盘。",
        content_md=FULLSTACK_ARTICLE,
    )
    post4.tags.extend([tag_ai, tag_fullstack, tag_python, tag_devops])

    db_session.add_all([post1, post2, post3, post4])
    db_session.commit()

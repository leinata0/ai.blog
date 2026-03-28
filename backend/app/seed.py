from app.models import Post, Tag


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

    db_session.add_all([post1, post2, post3])
    db_session.commit()

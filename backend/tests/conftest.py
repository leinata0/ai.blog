import sys
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.main import app
from app.db import Base
from app.models import Post, Tag, SiteSettings


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def seeded_db(db_session):
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
        content_md="# Python 自动化实战：Selenium 与 Pandas 结合\n\n结合 Selenium 的页面操作能力与 Pandas 的数据整理能力，可以快速搭建抓取、清洗、导出一体化的自动化脚本。",
    )
    post1.tags.extend([tag_python, tag_automation])

    post2 = Post(
        title="C/C++ 核心概念学习与排坑记录",
        slug="cpp-core-concepts-notes",
        summary="围绕指针、内存管理、对象生命周期与编译链接问题的持续学习笔记。",
        content_md="# C/C++ 核心概念学习与排坑记录\n\n学习 C/C++ 时，最容易反复踩坑的地方通常集中在内存、对象生命周期、头文件组织和编译链接阶段。",
    )
    post2.tags.extend([tag_cpp, tag_notes])

    post3 = Post(
        title="OpenClaw 部署指南：从零搭建你的私有化平台",
        slug="openclaw-deployment-guide",
        summary="手把手教你用 Docker Compose 部署 OpenClaw，涵盖环境准备、配置调优与常见问题排查。",
        content_md="# OpenClaw 部署指南：从零搭建你的私有化平台\n\nOpenClaw 是一个轻量级的开源平台，支持快速私有化部署。",
    )
    post3.tags.extend([tag_devops, tag_openclaw])

    db_session.add_all([post1, post2, post3])
    db_session.commit()
    return db_session


@pytest.fixture
def client(db_session):
    from app.routers import posts as posts_router_mod
    from app.routers import admin as admin_router_mod
    import app.main as main_mod

    def _get_test_db():
        yield db_session

    # Seed default SiteSettings for tests
    if db_session.query(SiteSettings).count() == 0:
        db_session.add(SiteSettings(id=1))
        db_session.commit()

    app.dependency_overrides[posts_router_mod.get_db] = _get_test_db
    app.dependency_overrides[admin_router_mod.get_db] = _get_test_db
    app.dependency_overrides[main_mod.get_db] = _get_test_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

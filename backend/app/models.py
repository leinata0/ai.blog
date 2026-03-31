from sqlalchemy import Column, Integer, String, Table, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.db import Base

post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", ForeignKey("posts.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class Post(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    slug = Column(String(200), unique=True, nullable=False, index=True)
    summary = Column(String(300), nullable=False)
    content_md = Column(Text, nullable=False)
    tags = relationship("Tag", secondary=post_tags, back_populates="posts")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    slug = Column(String(80), unique=True, nullable=False, index=True)
    posts = relationship("Post", secondary=post_tags, back_populates="tags")


class SiteSettings(Base):
    __tablename__ = "site_settings"
    id = Column(Integer, primary_key=True, default=1)
    author_name = Column(String(100), nullable=False, default="极客新生")
    bio = Column(String(300), nullable=False, default="大一 CS 学生 / Python & C++ 爱好者")
    avatar_url = Column(String(500), nullable=False, default="")
    github_link = Column(String(500), nullable=False, default="https://github.com")
    announcement = Column(Text, nullable=False, default="欢迎来到我的技术博客！这里分享前端开发、全栈技术和编程心得。")

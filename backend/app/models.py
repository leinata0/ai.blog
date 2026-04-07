from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

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
    cover_image = Column(String(500), nullable=False, default="")
    view_count = Column(Integer, nullable=False, default=0)
    is_published = Column(Boolean, nullable=False, default=True)
    is_pinned = Column(Boolean, nullable=False, default=False)
    like_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    tags = relationship("Tag", secondary=post_tags, back_populates="posts")
    comments = relationship("Comment", back_populates="post", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    slug = Column(String(80), unique=True, nullable=False, index=True)
    posts = relationship("Post", secondary=post_tags, back_populates="tags")


class Comment(Base):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    nickname = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)
    ip_address = Column(String(50), nullable=False, default="")
    is_approved = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    post = relationship("Post", back_populates="comments")


class SiteSettings(Base):
    __tablename__ = "site_settings"
    id = Column(Integer, primary_key=True, default=1)
    author_name = Column(String(100), nullable=False, default="极客新生")
    bio = Column(String(300), nullable=False, default="大一 CS 学生 / Python & C++ 爱好者")
    avatar_url = Column(String(500), nullable=False, default="")
    hero_image = Column(String(500), nullable=False, default="")
    github_link = Column(String(500), nullable=False, default="https://github.com")
    announcement = Column(Text, nullable=False, default="欢迎来到我的技术博客！这里分享前端开发、全栈技术和编程心得。")
    site_url = Column(String(500), nullable=False, default="https://563118077.xyz")
    friend_links = Column(Text, nullable=False, default="[]")


class PostLike(Base):
    __tablename__ = "post_likes"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    ip_address = Column(String, nullable=False)
    created_at = Column(DateTime, default=func.now())
    __table_args__ = (UniqueConstraint("post_id", "ip_address", name="uq_post_like"),)


class ViewLog(Base):
    __tablename__ = "view_logs"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    ip_address = Column(String, nullable=False)
    created_at = Column(DateTime, default=func.now())

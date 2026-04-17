from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Table, Text, UniqueConstraint
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
    content_type = Column(String(50), nullable=False, default="post")
    topic_key = Column(String(200), nullable=False, default="")
    published_mode = Column(String(20), nullable=False, default="manual")
    coverage_date = Column(String(20), nullable=False, default="")
    series_slug = Column(String(120), nullable=True, default=None, index=True)
    series_order = Column(Integer, nullable=True, default=None)
    editor_note = Column(Text, nullable=True, default=None)
    source_count = Column(Integer, nullable=True, default=None)
    quality_score = Column(Float, nullable=True, default=None)
    reading_time = Column(Integer, nullable=True, default=None)
    view_count = Column(Integer, nullable=False, default=0)
    is_published = Column(Boolean, nullable=False, default=True)
    is_pinned = Column(Boolean, nullable=False, default=False)
    like_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    tags = relationship("Tag", secondary=post_tags, back_populates="posts")
    comments = relationship("Comment", back_populates="post", cascade="all, delete-orphan")
    sources = relationship("PostSource", back_populates="post", cascade="all, delete-orphan")
    publishing_artifacts = relationship("PublishingArtifact", back_populates="post", cascade="all, delete-orphan")
    quality_snapshot = relationship("PostQualitySnapshot", back_populates="post", uselist=False, cascade="all, delete-orphan")
    quality_review = relationship("PostQualityReview", back_populates="post", uselist=False, cascade="all, delete-orphan")
    notification_dispatch = relationship("PostNotificationDispatch", back_populates="post", uselist=False, cascade="all, delete-orphan")


class Series(Base):
    __tablename__ = "series"
    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(120), unique=True, nullable=False, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    cover_image = Column(String(500), nullable=False, default="")
    content_types = Column(Text, nullable=False, default="[]")
    is_featured = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


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


class PublishingRun(Base):
    __tablename__ = "publishing_runs"
    id = Column(Integer, primary_key=True, index=True)
    workflow_key = Column(String(50), nullable=False, index=True, default="daily_auto")
    external_run_id = Column(String(120), nullable=False, index=True, default="")
    run_mode = Column(String(20), nullable=False, default="auto")
    status = Column(String(20), nullable=False, default="success")
    coverage_date = Column(String(20), nullable=False, default="")
    message = Column(Text, nullable=False, default="")
    candidate_count = Column(Integer, nullable=False, default=0)
    published_count = Column(Integer, nullable=False, default=0)
    skipped_count = Column(Integer, nullable=False, default=0)
    payload_json = Column(Text, nullable=False, default="{}")
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PostSource(Base):
    __tablename__ = "post_sources"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(50), nullable=False, default="")
    source_name = Column(String(200), nullable=False, default="")
    source_url = Column(String(500), nullable=False, default="")
    published_at = Column(DateTime, nullable=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    post = relationship("Post", back_populates="sources")


class PublishingArtifact(Base):
    __tablename__ = "publishing_artifacts"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    publishing_run_id = Column(Integer, ForeignKey("publishing_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_key = Column(String(50), nullable=False, default="daily_auto")
    coverage_date = Column(String(20), nullable=False, default="")
    research_pack_summary = Column(Text, nullable=False, default="")
    quality_gate_json = Column(Text, nullable=False, default="{}")
    image_plan_json = Column(Text, nullable=False, default="[]")
    candidate_topics_json = Column(Text, nullable=False, default="[]")
    failure_reason = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    post = relationship("Post", back_populates="publishing_artifacts")


class PostQualitySnapshot(Base):
    __tablename__ = "post_quality_snapshots"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    overall_score = Column(Float, nullable=True, default=None)
    structure_score = Column(Float, nullable=True, default=None)
    source_score = Column(Float, nullable=True, default=None)
    analysis_score = Column(Float, nullable=True, default=None)
    packaging_score = Column(Float, nullable=True, default=None)
    resonance_score = Column(Float, nullable=True, default=None)
    issues_json = Column(Text, nullable=False, default="[]")
    strengths_json = Column(Text, nullable=False, default="[]")
    notes = Column(Text, nullable=False, default="")
    generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    post = relationship("Post", back_populates="quality_snapshot")


class PostQualityReview(Base):
    __tablename__ = "post_quality_reviews"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    editor_verdict = Column(String(20), nullable=False, default="")
    editor_labels_json = Column(Text, nullable=False, default="[]")
    editor_note = Column(Text, nullable=False, default="")
    followup_recommended = Column(Boolean, nullable=True, default=None)
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(String(120), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    post = relationship("Post", back_populates="quality_review")


class TopicProfile(Base):
    __tablename__ = "topic_profiles"
    id = Column(Integer, primary_key=True, index=True)
    topic_key = Column(String(200), nullable=False, unique=True, index=True)
    title = Column(String(200), nullable=False, default="")
    description = Column(Text, nullable=False, default="")
    cover_image = Column(String(500), nullable=False, default="")
    aliases_json = Column(Text, nullable=False, default="[]")
    focus_points_json = Column(Text, nullable=False, default="[]")
    content_types_json = Column(Text, nullable=False, default="[]")
    series_slug = Column(String(120), nullable=True, default=None)
    is_featured = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    priority = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SearchInsight(Base):
    __tablename__ = "search_insights"
    id = Column(Integer, primary_key=True, index=True)
    query = Column(String(200), nullable=False, unique=True, index=True)
    search_count = Column(Integer, nullable=False, default=0)
    last_result_count = Column(Integer, nullable=False, default=0)
    first_searched_at = Column(DateTime, nullable=True)
    last_searched_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class EmailSubscription(Base):
    __tablename__ = "email_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    content_types_json = Column(Text, nullable=False, default='["all"]')
    topic_keys_json = Column(Text, nullable=False, default="[]")
    series_slugs_json = Column(Text, nullable=False, default="[]")
    is_active = Column(Boolean, nullable=False, default=True)
    source = Column(String(50), nullable=False, default="feeds_page")
    last_notified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class WebPushSubscription(Base):
    __tablename__ = "web_push_subscriptions"
    id = Column(Integer, primary_key=True, index=True)
    endpoint = Column(String(1000), nullable=False, unique=True, index=True)
    p256dh = Column(String(255), nullable=False, default="")
    auth = Column(String(255), nullable=False, default="")
    content_types_json = Column(Text, nullable=False, default='["all"]')
    topic_keys_json = Column(Text, nullable=False, default="[]")
    series_slugs_json = Column(Text, nullable=False, default="[]")
    is_active = Column(Boolean, nullable=False, default=True)
    user_agent = Column(String(255), nullable=False, default="")
    last_notified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PostNotificationDispatch(Base):
    __tablename__ = "post_notification_dispatches"
    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    email_sent_at = Column(DateTime, nullable=True)
    email_recipient_count = Column(Integer, nullable=False, default=0)
    web_push_sent_at = Column(DateTime, nullable=True)
    web_push_recipient_count = Column(Integer, nullable=False, default=0)
    wecom_sent_at = Column(DateTime, nullable=True)
    wecom_target_count = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    post = relationship("Post", back_populates="notification_dispatch")

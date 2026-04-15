from datetime import datetime

from pydantic import BaseModel, Field


class TagOut(BaseModel):
    model_config = {"from_attributes": True}
    name: str
    slug: str


class PostListItemOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    title: str
    slug: str
    summary: str
    cover_image: str
    content_type: str
    topic_key: str
    published_mode: str
    coverage_date: str
    series_slug: str | None = None
    series_order: int | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    view_count: int
    is_published: bool
    is_pinned: bool
    like_count: int
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut]


class PostListOut(BaseModel):
    model_config = {"from_attributes": True}
    items: list[PostListItemOut]
    total: int
    page: int
    page_size: int


class PostDetailOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    title: str
    slug: str
    summary: str
    content_md: str
    cover_image: str
    content_type: str
    topic_key: str
    published_mode: str
    coverage_date: str
    series_slug: str | None = None
    series_order: int | None = None
    editor_note: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    view_count: int
    is_pinned: bool
    like_count: int
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut]


# ── Admin schemas ──────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    model_config = {"from_attributes": True}
    access_token: str
    token_type: str = "bearer"


class PostCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=200)
    summary: str = Field(..., min_length=1, max_length=300)
    content_md: str
    cover_image: str = ""
    content_type: str = "post"
    topic_key: str = ""
    published_mode: str = "manual"
    coverage_date: str = ""
    series_slug: str | None = None
    series_order: int | None = None
    editor_note: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    is_published: bool = True
    is_pinned: bool = False
    tags: list[str] = Field(default_factory=list)


class PostUpdateRequest(BaseModel):
    title: str | None = None
    slug: str | None = None
    summary: str | None = None
    content_md: str | None = None
    cover_image: str | None = None
    content_type: str | None = None
    topic_key: str | None = None
    published_mode: str | None = None
    coverage_date: str | None = None
    series_slug: str | None = None
    series_order: int | None = None
    editor_note: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    is_published: bool | None = None
    is_pinned: bool | None = None
    tags: list[str] | None = None


class PostAdminOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    title: str
    slug: str
    summary: str
    content_md: str
    cover_image: str
    content_type: str
    topic_key: str
    published_mode: str
    coverage_date: str
    series_slug: str | None = None
    series_order: int | None = None
    editor_note: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    view_count: int
    is_published: bool
    is_pinned: bool
    like_count: int
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut]


class UploadOut(BaseModel):
    model_config = {"from_attributes": True}
    url: str


class PublishingTopicOut(BaseModel):
    topic_key: str = ""
    title: str
    summary: str = ""
    source_count: int = 0
    source_names: list[str] = Field(default_factory=list)
    content_type: str = "daily_brief"
    published_mode: str = ""
    coverage_date: str = ""
    post_id: int | None = None
    post_slug: str = ""
    published_at: datetime | None = None
    reason: str = ""
    status: str = ""


class PublishingRunSummaryOut(BaseModel):
    candidate_count: int = 0
    published_count: int = 0
    skipped_count: int = 0
    auto_published_count: int = 0
    manual_published_count: int = 0


class PublishingRunOut(BaseModel):
    id: int
    workflow_key: str
    external_run_id: str = ""
    run_mode: str
    status: str
    coverage_date: str = ""
    message: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime
    summary: PublishingRunSummaryOut
    candidate_topics: list[PublishingTopicOut] = Field(default_factory=list)
    published_topics: list[PublishingTopicOut] = Field(default_factory=list)
    skipped_topics: list[PublishingTopicOut] = Field(default_factory=list)


class PublishingRunUpsertRequest(BaseModel):
    workflow_key: str = Field(..., min_length=1, max_length=50)
    external_run_id: str = ""
    run_mode: str = "auto"
    status: str = "success"
    coverage_date: str = ""
    message: str = ""
    started_at: datetime | None = None
    finished_at: datetime | None = None
    candidate_topics: list[PublishingTopicOut] = Field(default_factory=list)
    published_topics: list[PublishingTopicOut] = Field(default_factory=list)
    skipped_topics: list[PublishingTopicOut] = Field(default_factory=list)


class PublishingStatusResponse(BaseModel):
    latest_runs: dict[str, PublishingRunOut | None]
    recent_runs: list[PublishingRunOut] = Field(default_factory=list)
    recent_posts: list[PostListItemOut] = Field(default_factory=list)


class SeriesBase(BaseModel):
    slug: str = Field(..., min_length=1, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    cover_image: str = ""
    content_types: list[str] = Field(default_factory=list)
    is_featured: bool = False
    sort_order: int = 0


class SeriesCreateRequest(SeriesBase):
    pass


class SeriesUpdateRequest(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    cover_image: str | None = None
    content_types: list[str] | None = None
    is_featured: bool | None = None
    sort_order: int | None = None


class SeriesOut(SeriesBase):
    id: int
    post_count: int = 0
    latest_post_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SeriesDetailOut(SeriesOut):
    posts: list[PostListItemOut] = Field(default_factory=list)


class DiscoverOut(BaseModel):
    featured_series: list[SeriesOut] = Field(default_factory=list)
    latest_daily: list[PostListItemOut] = Field(default_factory=list)
    latest_weekly: list[PostListItemOut] = Field(default_factory=list)
    editor_picks: list[PostListItemOut] = Field(default_factory=list)


class ContentHealthSummaryOut(BaseModel):
    total_posts: int = 0
    posts_with_series: int = 0
    posts_with_sources: int = 0
    posts_with_quality_score: int = 0
    published_posts: int = 0


class ContentHealthItemOut(BaseModel):
    post_id: int
    slug: str
    title: str
    content_type: str = "post"
    coverage_date: str = ""
    is_published: bool = True
    series_slug: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    has_cover_image: bool = False
    score: int = 0
    issues: list[str] = Field(default_factory=list)


class ContentHealthOut(BaseModel):
    summary: ContentHealthSummaryOut
    items: list[ContentHealthItemOut] = Field(default_factory=list)


class QualitySnapshotOut(BaseModel):
    id: int
    post_id: int
    overall_score: float | None = None
    structure_score: float | None = None
    source_score: float | None = None
    analysis_score: float | None = None
    packaging_score: float | None = None
    resonance_score: float | None = None
    issues: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    notes: str = ""
    generated_at: datetime | None = None
    updated_at: datetime | None = None


class QualitySnapshotInput(BaseModel):
    overall_score: float | None = None
    structure_score: float | None = None
    source_score: float | None = None
    analysis_score: float | None = None
    packaging_score: float | None = None
    resonance_score: float | None = None
    quality_score: float | None = None
    source_count: int | None = None
    reading_time: int | None = None
    issues: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    notes: str = ""
    generated_at: datetime | None = None


class QualitySnapshotUpsertRequest(BaseModel):
    model_config = {"extra": "ignore"}

    post_id: int | None = None
    post_slug: str | None = None
    quality_snapshot: QualitySnapshotInput


class QualityReviewOut(BaseModel):
    id: int
    post_id: int
    editor_verdict: str = ""
    editor_labels: list[str] = Field(default_factory=list)
    editor_note: str = ""
    followup_recommended: bool | None = None
    reviewed_at: datetime | None = None
    reviewed_by: str = ""
    updated_at: datetime | None = None


class QualityReviewUpsertRequest(BaseModel):
    editor_verdict: str = Field(default="", pattern=r"^(|excellent|solid|weak)$")
    editor_labels: list[str] = Field(default_factory=list)
    editor_note: str = ""
    followup_recommended: bool | None = None
    reviewed_by: str = ""


class QualityInboxItemOut(BaseModel):
    post_id: int
    slug: str
    title: str
    content_type: str = "post"
    series_slug: str | None = None
    coverage_date: str = ""
    overall_score: float | None = None
    structure_score: float | None = None
    source_score: float | None = None
    analysis_score: float | None = None
    packaging_score: float | None = None
    resonance_score: float | None = None
    editor_verdict: str = ""
    followup_recommended: bool | None = None
    issues: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    snapshot_updated_at: datetime | None = None
    reviewed_at: datetime | None = None


class QualityInboxSummaryOut(BaseModel):
    total_posts: int = 0
    with_snapshot_count: int = 0
    reviewed_count: int = 0
    followup_recommended_count: int = 0
    avg_overall_score: float | None = None


class QualityInboxOut(BaseModel):
    summary: QualityInboxSummaryOut
    items: list[QualityInboxItemOut] = Field(default_factory=list)


class PostQualityDetailOut(BaseModel):
    post: dict
    quality_snapshot: QualitySnapshotOut | None = None
    quality_review: QualityReviewOut | None = None


class TopicFeedbackItemOut(BaseModel):
    topic_key: str = ""
    series_slug: str | None = None
    content_type: str = "post"
    post_count: int = 0
    avg_overall_score: float | None = None
    avg_structure_score: float | None = None
    avg_source_score: float | None = None
    avg_analysis_score: float | None = None
    avg_packaging_score: float | None = None
    avg_resonance_score: float | None = None
    avg_views: float = 0
    avg_likes: float = 0
    followup_rate: float | None = None
    dominant_issues: list[str] = Field(default_factory=list)
    latest_post_title: str = ""
    latest_post_slug: str = ""
    recommendation: str = "maintain"


class TopicFeedbackSummaryOut(BaseModel):
    topic_count: int = 0
    strong_topic_count: int = 0
    weak_topic_count: int = 0


class TopicFeedbackOut(BaseModel):
    summary: TopicFeedbackSummaryOut
    items: list[TopicFeedbackItemOut] = Field(default_factory=list)


class TopicProfileBase(BaseModel):
    topic_key: str = Field(..., min_length=1, max_length=200)
    title: str = ""
    display_title: str = ""
    description: str = ""
    cover_image: str = ""
    aliases: list[str] = Field(default_factory=list)
    focus_points: list[str] = Field(default_factory=list)
    content_types: list[str] = Field(default_factory=list)
    series_slug: str | None = None
    is_featured: bool = False
    sort_order: int = 0
    is_active: bool = True
    priority: int = 0


class TopicProfileCreateRequest(TopicProfileBase):
    pass


class TopicProfileUpdateRequest(BaseModel):
    topic_key: str | None = Field(default=None, min_length=1, max_length=200)
    title: str | None = None
    display_title: str | None = None
    description: str | None = None
    cover_image: str | None = None
    aliases: list[str] | None = None
    focus_points: list[str] | None = None
    content_types: list[str] | None = None
    series_slug: str | None = None
    is_featured: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    priority: int | None = None


class TopicProfileOut(TopicProfileBase):
    id: int
    profile_exists: bool = True
    is_virtual: bool = False
    source_count: int = 0
    latest_post_title: str = ""
    latest_post_slug: str = ""
    display_title_source: str = "manual"
    post_count: int = 0
    latest_post_at: datetime | None = None
    avg_quality_score: float | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TopicListItemOut(BaseModel):
    topic_key: str
    title: str
    description: str = ""
    content_types: list[str] = Field(default_factory=list)
    series_slug: str | None = None
    post_count: int = 0
    latest_post_at: datetime | None = None
    avg_quality_score: float | None = None
    profile: TopicProfileOut | None = None


class TopicsOut(BaseModel):
    items: list[TopicListItemOut] = Field(default_factory=list)
    total: int = 0


class TopicDetailOut(BaseModel):
    topic_key: str
    title: str
    description: str = ""
    content_types: list[str] = Field(default_factory=list)
    series_slug: str | None = None
    post_count: int = 0
    avg_quality_score: float | None = None
    profile: TopicProfileOut | None = None
    recent_posts: list[PostListItemOut] = Field(default_factory=list)


class SearchResultItemOut(PostListItemOut):
    match_score: float = 0
    match_reason: str = ""


class SearchOut(BaseModel):
    query: str
    items: list[SearchResultItemOut] = Field(default_factory=list)
    total: int = 0


class SearchInsightOut(BaseModel):
    id: int
    query: str
    search_count: int = 0
    last_result_count: int = 0
    first_searched_at: datetime | None = None
    last_searched_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SearchInsightsOut(BaseModel):
    items: list[SearchInsightOut] = Field(default_factory=list)
    total: int = 0


class TopicHealthItemOut(BaseModel):
    topic_key: str
    series_slug: str | None = None
    post_count: int = 0
    avg_quality_score: float | None = None
    latest_post_at: datetime | None = None
    profile_exists: bool = False
    recommendation: str = "maintain"


class TopicHealthOut(BaseModel):
    items: list[TopicHealthItemOut] = Field(default_factory=list)
    total: int = 0


class CoverGenerateRequest(BaseModel):
    prompt: str | None = None
    image_url: str | None = None
    overwrite: bool = False


class CoverGenerateResponse(BaseModel):
    id: int
    cover_image: str
    generated: bool = False
    error: str = ""
    error_code: str = ""


class CoverGenerationStatusOut(BaseModel):
    provider: str = "grok"
    has_xai_api_key: bool = False
    can_generate: bool = False
    message: str = ""


class PostSourceInput(BaseModel):
    source_type: str = "news"
    source_name: str
    source_url: str
    published_at: datetime | None = None
    is_primary: bool = False


class PublishingArtifactInput(BaseModel):
    publishing_run_id: int | None = None
    workflow_key: str = "daily_auto"
    coverage_date: str = ""
    research_pack_summary: str = ""
    quality_gate_json: str = "{}"
    image_plan_json: str = "[]"
    candidate_topics_json: str = "[]"
    failure_reason: str = ""


class PublishingMetadataFields(BaseModel):
    series_slug: str | None = None
    series_order: int | None = None
    editor_note: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None


class PublishingMetadataUpsertRequest(BaseModel):
    model_config = {"extra": "ignore"}

    post_id: int | None = None
    post_slug: str | None = None
    series_slug: str | None = None
    series_order: int | None = None
    editor_note: str | None = None
    source_count: int | None = None
    quality_score: float | None = None
    reading_time: int | None = None
    sources: list[PostSourceInput] = Field(default_factory=list)
    artifact: PublishingArtifactInput | None = None
    metadata: PublishingMetadataFields | None = None
    post_sources: list[PostSourceInput] = Field(default_factory=list)
    publishing_artifact: PublishingArtifactInput | None = None

    def resolved_metadata(self) -> PublishingMetadataFields:
        if self.metadata is not None:
            return self.metadata
        return PublishingMetadataFields(
            series_slug=self.series_slug,
            series_order=self.series_order,
            editor_note=self.editor_note,
            source_count=self.source_count,
            quality_score=self.quality_score,
            reading_time=self.reading_time,
        )

    def resolved_sources(self) -> list[PostSourceInput]:
        return self.sources or self.post_sources

    def resolved_artifact(self) -> PublishingArtifactInput:
        return self.artifact or self.publishing_artifact or PublishingArtifactInput()


class PublishingMetadataUpsertResponse(BaseModel):
    post_id: int
    post_slug: str
    source_count: int
    artifact_id: int
    workflow_key: str
    coverage_date: str


class TopicMetadataSnapshotInput(BaseModel):
    topic_key: str = ""
    topic_family: str = ""
    content_type: str = ""
    coverage_date: str = ""
    source_count: int | None = None
    high_quality_source_count: int | None = None
    analysis_signal_count: int | None = None
    reading_time: int | None = None
    source_names: list[str] = Field(default_factory=list)
    primary_thesis: str = ""
    topic_title: str = ""
    gate_passed: bool | None = None
    notes: str = ""
    generated_at: str = ""
    snapshot_version: str = ""
    freshness_window: str = ""


class TopicMetadataUpsertRequest(BaseModel):
    model_config = {"extra": "ignore"}

    post_id: int | None = None
    post_slug: str | None = None
    topic_key: str | None = None
    topic_metadata: TopicMetadataSnapshotInput | None = None

    def resolved_topic_key(self) -> str:
        if self.topic_metadata and self.topic_metadata.topic_key:
            return self.topic_metadata.topic_key
        return self.topic_key or ""


class TopicMetadataUpsertResponse(BaseModel):
    post_id: int
    post_slug: str
    topic_key: str
    profile_id: int | None = None
    artifact_id: int | None = None


# ── Settings schemas ──────────────────────────────

class SiteSettingsOut(BaseModel):
    model_config = {"from_attributes": True}
    author_name: str
    bio: str
    avatar_url: str
    hero_image: str
    github_link: str
    announcement: str
    site_url: str
    friend_links: str


class SiteSettingsUpdate(BaseModel):
    author_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    hero_image: str | None = None
    github_link: str | None = None
    announcement: str | None = None
    site_url: str | None = None
    friend_links: str | None = None


# ── Stats schemas ─────────────────────────────────

class StatsOut(BaseModel):
    model_config = {"from_attributes": True}
    post_count: int
    tag_count: int


# ── Comment schemas ───────────────────────────────

class CommentCreate(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=2000)


class CommentOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    nickname: str
    content: str
    created_at: datetime


class CommentAdminOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    post_id: int
    nickname: str
    content: str
    ip_address: str
    is_approved: bool
    created_at: datetime


# ── Archive schemas ───────────────────────────────

class ArchiveItem(BaseModel):
    model_config = {"from_attributes": True}
    title: str
    slug: str
    created_at: datetime
    content_type: str = "post"
    topic_key: str = ""
    published_mode: str = "manual"
    coverage_date: str = ""
    is_pinned: bool = False


class ArchiveGroup(BaseModel):
    model_config = {"from_attributes": True}
    year: int
    posts: list[ArchiveItem]


# ── Tag with count ────────────────────────────────

class TagWithCount(BaseModel):
    model_config = {"from_attributes": True}
    name: str
    slug: str
    post_count: int


# ── FriendLink schema ────────────────────────────

class FriendLink(BaseModel):
    model_config = {"from_attributes": True}
    url: str = ""
    name: str = ""
    description: str = ""
    avatar: str = ""

from datetime import datetime

from pydantic import BaseModel


class TagOut(BaseModel):
    name: str
    slug: str


class PostListItemOut(BaseModel):
    id: int
    title: str
    slug: str
    summary: str
    cover_image: str
    view_count: int
    is_published: bool
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut]


class PostListOut(BaseModel):
    items: list[PostListItemOut]
    total: int
    page: int
    page_size: int


class PostDetailOut(BaseModel):
    id: int
    title: str
    slug: str
    summary: str
    content_md: str
    cover_image: str
    view_count: int
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut]


# ── Admin schemas ──────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PostCreateRequest(BaseModel):
    title: str
    slug: str
    summary: str
    content_md: str
    cover_image: str = ""
    is_published: bool = True
    tags: list[str] = []


class PostUpdateRequest(BaseModel):
    title: str | None = None
    slug: str | None = None
    summary: str | None = None
    content_md: str | None = None
    cover_image: str | None = None
    is_published: bool | None = None
    tags: list[str] | None = None


class PostAdminOut(BaseModel):
    id: int
    title: str
    slug: str
    summary: str
    content_md: str
    cover_image: str
    view_count: int
    is_published: bool
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut]


class UploadOut(BaseModel):
    url: str


# ── Settings schemas ──────────────────────────────

class SiteSettingsOut(BaseModel):
    author_name: str
    bio: str
    avatar_url: str
    hero_image: str
    github_link: str
    announcement: str


class SiteSettingsUpdate(BaseModel):
    author_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    hero_image: str | None = None
    github_link: str | None = None
    announcement: str | None = None


# ── Stats schemas ─────────────────────────────────

class StatsOut(BaseModel):
    post_count: int
    tag_count: int
    category_count: int


# ── Comment schemas ───────────────────────────────

class CommentCreate(BaseModel):
    nickname: str
    content: str


class CommentOut(BaseModel):
    id: int
    nickname: str
    content: str
    created_at: datetime


# ── Archive schemas ───────────────────────────────

class ArchiveItem(BaseModel):
    title: str
    slug: str
    created_at: datetime


class ArchiveGroup(BaseModel):
    year: int
    posts: list[ArchiveItem]


# ── Tag with count ────────────────────────────────

class TagWithCount(BaseModel):
    name: str
    slug: str
    post_count: int

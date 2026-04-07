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
    is_published: bool = True
    is_pinned: bool = False
    tags: list[str] = []


class PostUpdateRequest(BaseModel):
    title: str | None = None
    slug: str | None = None
    summary: str | None = None
    content_md: str | None = None
    cover_image: str | None = None
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

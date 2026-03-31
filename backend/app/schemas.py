from pydantic import BaseModel


class TagOut(BaseModel):
    name: str
    slug: str


class PostListItemOut(BaseModel):
    title: str
    slug: str
    summary: str
    tags: list[TagOut]


class PostListOut(BaseModel):
    items: list[PostListItemOut]


class PostDetailOut(BaseModel):
    title: str
    slug: str
    summary: str
    content_md: str
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
    tags: list[str] = []


class PostUpdateRequest(BaseModel):
    title: str | None = None
    slug: str | None = None
    summary: str | None = None
    content_md: str | None = None
    tags: list[str] | None = None


class PostAdminOut(BaseModel):
    id: int
    title: str
    slug: str
    summary: str
    content_md: str
    tags: list[TagOut]


# ── Settings schemas ──────────────────────────────

class SiteSettingsOut(BaseModel):
    author_name: str
    bio: str
    avatar_url: str
    github_link: str
    announcement: str


class SiteSettingsUpdate(BaseModel):
    author_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    github_link: str | None = None
    announcement: str | None = None


# ── Stats schemas ─────────────────────────────────

class StatsOut(BaseModel):
    post_count: int
    tag_count: int
    category_count: int

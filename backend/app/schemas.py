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

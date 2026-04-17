from dataclasses import dataclass

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Post


@dataclass(frozen=True)
class AdminPostFilters:
    q: str | None = None
    content_type: str | None = None
    is_published: bool | None = None
    published_mode: str | None = None
    coverage_date: str | None = None
    series_slug: str | None = None


def _apply_admin_post_filters(stmt: Select, filters: AdminPostFilters) -> Select:
    if filters.q:
        pattern = f"%{filters.q.strip()}%"
        stmt = stmt.where(
            or_(
                Post.title.ilike(pattern),
                Post.summary.ilike(pattern),
                Post.slug.ilike(pattern),
                Post.topic_key.ilike(pattern),
            )
        )
    if filters.content_type:
        stmt = stmt.where(Post.content_type == filters.content_type)
    if filters.is_published is not None:
        stmt = stmt.where(Post.is_published == filters.is_published)
    if filters.published_mode:
        stmt = stmt.where(Post.published_mode == filters.published_mode)
    if filters.coverage_date:
        stmt = stmt.where(Post.coverage_date == filters.coverage_date)
    if filters.series_slug:
        stmt = stmt.where(Post.series_slug == filters.series_slug)
    return stmt


def list_admin_posts(
    db: Session,
    *,
    filters: AdminPostFilters,
    page: int,
    page_size: int,
) -> tuple[list[Post], int]:
    stmt = (
        select(Post)
        .options(selectinload(Post.tags))
        .order_by(Post.created_at.desc(), Post.id.desc())
    )
    count_stmt = select(func.count(Post.id))

    stmt = _apply_admin_post_filters(stmt, filters)
    count_stmt = _apply_admin_post_filters(count_stmt, filters)

    total = db.execute(count_stmt).scalar() or 0
    posts = db.execute(
        stmt.offset((page - 1) * page_size).limit(page_size)
    ).scalars().all()
    return posts, int(total)

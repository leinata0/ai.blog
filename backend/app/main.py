from fastapi import FastAPI
from sqlalchemy import select, delete

from app.db import Base, SessionLocal, engine
from app.models import Post, Tag, post_tags
from app.routers.posts import router as posts_router
from app.seed import seed_data, FULLSTACK_ARTICLE

app = FastAPI(title="AI Dev Blog API")
app.include_router(posts_router)


def _ensure_new_posts(db):
    """Upsert the fullstack article: delete old version and re-insert to get highest id."""
    slug = "freshman-fullstack-ai-blog"
    old = db.execute(select(Post).where(Post.slug == slug)).scalar_one_or_none()
    if old is not None:
        db.execute(delete(post_tags).where(post_tags.c.post_id == old.id))
        db.delete(old)
        db.flush()

    def get_or_create_tag(name, tag_slug):
        tag = db.execute(select(Tag).where(Tag.slug == tag_slug)).scalar_one_or_none()
        if tag is None:
            tag = Tag(name=name, slug=tag_slug)
            db.add(tag)
            db.flush()
        return tag

    tag_ai = get_or_create_tag("AI", "ai")
    tag_fullstack = get_or_create_tag("全栈", "fullstack")
    tag_python = get_or_create_tag("Python", "python")
    tag_devops = get_or_create_tag("DevOps", "devops")

    post = Post(
        title="大一新生的全栈破局：AI 辅助构建极客博客的实战复盘",
        slug=slug,
        summary="从零到公网上线，一个大一新生用 Claude Code 辅助搭建 React + FastAPI 全栈博客的完整复盘。",
        content_md=FULLSTACK_ARTICLE,
    )
    post.tags.extend([tag_ai, tag_fullstack, tag_python, tag_devops])
    db.add(post)
    db.commit()


@app.on_event("startup")
def initialize_database():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        has_posts = db.execute(select(Post.id).limit(1)).first()
        if has_posts is None:
            seed_data(db)
        else:
            _ensure_new_posts(db)


@app.get("/health")
def health():
    return {"status": "ok"}

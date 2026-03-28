from fastapi import FastAPI
from sqlalchemy import select

from app.db import Base, SessionLocal, engine
from app.models import Post
from app.routers.posts import router as posts_router
from app.seed import seed_data

app = FastAPI(title="AI Dev Blog API")
app.include_router(posts_router)


@app.on_event("startup")
def initialize_database():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        has_posts = db.execute(select(Post.id).limit(1)).first()
        if has_posts is None:
            seed_data(db)


@app.get("/health")
def health():
    return {"status": "ok"}

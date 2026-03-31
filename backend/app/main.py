from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import Base, SessionLocal, engine
from app.models import Post
from app.routers.posts import router as posts_router
from app.seed import seed_data


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.query(Post).count() == 0:
            seed_data(db)
    yield


app = FastAPI(title="AI Dev Blog API", lifespan=lifespan)
app.include_router(posts_router)


@app.get("/health")
def health():
    return {"status": "ok"}

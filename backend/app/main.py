from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import Base, SessionLocal, engine
from app.models import Post
from app.routers.posts import router as posts_router
from app.routers.admin import router as admin_router
from app.seed import seed_data


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.query(Post).count() == 0:
            seed_data(db)
    yield


app = FastAPI(title="AI Dev Blog API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(posts_router)
app.include_router(admin_router)


@app.get("/health")
def health():
    return {"status": "ok"}

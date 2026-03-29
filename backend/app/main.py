from fastapi import FastAPI

from app.db import Base, SessionLocal, engine
from app.routers.posts import router as posts_router
from app.seed import seed_data

app = FastAPI(title="AI Dev Blog API")
app.include_router(posts_router)


@app.on_event("startup")
def initialize_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_data(db)


@app.get("/health")
def health():
    return {"status": "ok"}

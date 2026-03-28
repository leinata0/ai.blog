from fastapi import FastAPI

from app.routers.posts import router as posts_router

app = FastAPI(title="AI Dev Blog API")
app.include_router(posts_router)


@app.get("/health")
def health():
    return {"status": "ok"}

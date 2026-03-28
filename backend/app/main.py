from fastapi import FastAPI

app = FastAPI(title="AI Dev Blog API")


@app.get("/health")
def health():
    return {"status": "ok"}

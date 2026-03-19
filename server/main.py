import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import psycopg

from routers.polls import router as polls_router

app = FastAPI(title="WhoeverWants API", redirect_slashes=False)

# CORS: allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")

app.include_router(polls_router)


@app.get("/health")
async def health():
    try:
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute("SELECT 1")
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": str(e)}

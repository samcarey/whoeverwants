import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import psycopg

from middleware import BrowserIdMiddleware, RateLimitMiddleware
from routers.polls import router as polls_router
from routers.questions import router as questions_router
from routers.search import router as search_router
from routers.client_logs import router as client_logs_router
from routers.groups import router as groups_router

app = FastAPI(title="WhoeverWants API", redirect_slashes=False)

# Rate limiting (must be added before CORS so it runs first)
app.add_middleware(RateLimitMiddleware, read_rpm=120, write_rpm=30)

# Phase B.3: capture (or mint) browser_id per request. CORS exposes the
# response header so the FE can read it cross-origin (same-origin in prod
# via Next.js rewrite, but dev/CI sometimes hits the API directly).
app.add_middleware(BrowserIdMiddleware)

# CORS: allow any origin (anonymous API, no credentials needed). Expose the
# X-Browser-Id response header so the FE can adopt server-assigned ids.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Browser-Id"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")

app.include_router(questions_router)
app.include_router(polls_router)
app.include_router(groups_router)
app.include_router(search_router)
app.include_router(client_logs_router)


@app.get("/health")
async def health():
    try:
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute("SELECT 1")
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": str(e)}

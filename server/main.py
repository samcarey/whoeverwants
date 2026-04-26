import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import psycopg

from middleware import RateLimitMiddleware
from routers.multipolls import router as multipolls_router
from routers.polls import router as polls_router
from routers.search import router as search_router
from routers.client_logs import router as client_logs_router

app = FastAPI(title="WhoeverWants API", redirect_slashes=False)

# Rate limiting (must be added before CORS so it runs first)
app.add_middleware(RateLimitMiddleware, read_rpm=120, write_rpm=30)

# CORS: allow any origin (anonymous API, no credentials needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")

app.include_router(polls_router)
app.include_router(multipolls_router)
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

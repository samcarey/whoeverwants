import os

from fastapi import FastAPI
import psycopg

app = FastAPI(title="WhoeverWants API")

DATABASE_URL = os.environ["DATABASE_URL"]


@app.get("/health")
async def health():
    try:
        with psycopg.connect(DATABASE_URL) as conn:
            conn.execute("SELECT 1")
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "database": str(e)}

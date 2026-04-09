"""Client-side log collection endpoint (dev/debug only)."""

import logging
import time
from collections import deque
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/client-logs", tags=["client-logs"])

# In-memory ring buffer: last 2000 log entries, auto-evicts oldest
_LOG_BUFFER: deque[dict] = deque(maxlen=2000)


class ClientLogEntry(BaseModel):
    level: str  # "log", "warn", "error", "info", "debug"
    message: str
    timestamp: str  # ISO string from the browser
    url: Optional[str] = None
    userAgent: Optional[str] = None


class ClientLogBatch(BaseModel):
    logs: list[ClientLogEntry]
    sessionId: Optional[str] = None


@router.post("")
async def receive_client_logs(batch: ClientLogBatch, request: Request):
    """Receive a batch of console logs from the browser client."""
    client_ip = request.client.host if request.client else "unknown"
    for entry in batch.logs:
        _LOG_BUFFER.append({
            "level": entry.level,
            "message": entry.message,
            "timestamp": entry.timestamp,
            "url": entry.url or "",
            "userAgent": entry.userAgent or "",
            "sessionId": batch.sessionId or "",
            "clientIp": client_ip,
            "receivedAt": time.time(),
        })
    return {"status": "ok", "accepted": len(batch.logs)}


@router.get("")
async def get_client_logs(
    limit: int = 200,
    level: Optional[str] = None,
    since: Optional[float] = None,
    search: Optional[str] = None,
):
    """Retrieve recent client logs. Use query params to filter.

    - limit: max entries to return (default 200)
    - level: filter by level (e.g. "error", "warn")
    - since: unix timestamp, only return logs received after this time
    - search: substring search in message text
    """
    search_lower = search.lower() if search else None
    results = [
        r for r in _LOG_BUFFER
        if (not level or r["level"] == level)
        and (not since or r["receivedAt"] >= since)
        and (not search_lower or search_lower in r["message"].lower())
    ]

    # Return most recent first, capped at limit
    results = results[-limit:]
    results.reverse()
    return {"logs": results, "total": len(_LOG_BUFFER)}


@router.delete("")
async def clear_client_logs():
    """Clear all stored client logs."""
    count = len(_LOG_BUFFER)
    _LOG_BUFFER.clear()
    return {"status": "ok", "cleared": count}

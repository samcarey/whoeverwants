"""Showtime catalog endpoint for the `showtime` poll type.

``GET /api/showtimes/nearby`` returns the whole normalized Alamo catalog for a
radius + horizon in one shot (the FE loads it once with a progress indicator,
then movie-filter / calendar / curation are pure client-side). It's a heavy
cached catalog, not a per-keystroke proxy, so it lives in its own router rather
than under ``/api/search``. Identity-free (no ``X-Browser-Id``) like ``/preview``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from routers.search import _haversine_miles
from services.showtimes.alamo import (
    AlamoShowtimeSource,
    filter_sessions_by_horizon,
    group_by_film,
)
from services.showtimes.cache import get_market_showtimes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/showtimes", tags=["showtimes"])

_source = AlamoShowtimeSource()

_MAX_HORIZON_DAYS = 21
_MAX_RADIUS_MILES = 100.0


@router.get("/nearby")
async def nearby(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: float = Query(25.0, gt=0),
    days: int = Query(_MAX_HORIZON_DAYS, ge=1),
    label: str | None = Query(None),
):
    """Normalized showtime catalog for cinemas within ``radius`` miles, over the
    next ``days`` (best-effort, capped at 3 weeks)."""
    horizon = min(days, _MAX_HORIZON_DAYS)
    radius = min(radius, _MAX_RADIUS_MILES)

    directory = _source.directory()
    in_radius = [
        c for c in directory if _haversine_miles(lat, lng, c.lat, c.lng) <= radius
    ]
    if not in_radius:
        return {
            "reference": {"lat": lat, "lng": lng, "radius_miles": radius, "label": label},
            "horizon_days": horizon,
            "films": [],
        }

    in_radius_ids = {c.cinema_id for c in in_radius}
    # Distinct (market_id, market_slug) covering the in-radius cinemas.
    markets = {(c.market_id, c.market_slug) for c in in_radius}

    all_showtimes = []
    for market_id, market_slug in sorted(markets):
        try:
            all_showtimes.extend(await get_market_showtimes(_source, market_id, market_slug))
        except Exception as e:  # noqa: BLE001 — one bad market shouldn't 500 the whole call
            logger.warning("showtimes: market %s fetch failed: %s", market_id, e)

    visible = [s for s in all_showtimes if s.cinema_id in in_radius_ids]
    visible = filter_sessions_by_horizon(visible, horizon)
    films = group_by_film(visible)

    return {
        "reference": {"lat": lat, "lng": lng, "radius_miles": radius, "label": label},
        "horizon_days": horizon,
        "films": films,
    }

"""Showtime catalog endpoint for the `showtime` poll type.

``GET /api/showtimes/nearby`` returns the whole normalized Alamo catalog for a
radius + horizon in one shot (the FE loads it once with a progress indicator,
then movie-filter / calendar / curation are pure client-side). It's a heavy
cached catalog, not a per-keystroke proxy, so it lives in its own router rather
than under ``/api/search``. Identity-free (no ``X-Browser-Id``) like ``/preview``.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query

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
    markets = sorted({(c.market_id, c.market_slug) for c in in_radius})

    # Fetch every covered market concurrently (each is cached per day, so this
    # is usually a no-op disk read; on a cold day a multi-market radius pays one
    # round-trip total instead of N sequential ones).
    results = await asyncio.gather(
        *(get_market_showtimes(_source, mid, mslug) for mid, mslug in markets),
        return_exceptions=True,
    )
    all_showtimes = []
    for (market_id, _), res in zip(markets, results):
        if isinstance(res, Exception):
            logger.warning("showtimes: market %s fetch failed: %s", market_id, res)
        else:
            all_showtimes.extend(res)

    visible = [s for s in all_showtimes if s.cinema_id in in_radius_ids]
    visible = filter_sessions_by_horizon(visible, horizon)
    films = group_by_film(visible)

    # In-radius theaters, sorted by distance — the FE shows these for the
    # creator to pick which to search before listing movies.
    cinemas_with_sessions = {s["cinema_id"] for f in films for s in f["sessions"]}
    cinemas = sorted(
        (
            {
                "cinema_id": c.cinema_id,
                "name": c.name,
                "slug": c.slug,
                "address": c.address,
                "distance_miles": round(_haversine_miles(lat, lng, c.lat, c.lng), 1),
                "has_sessions": c.cinema_id in cinemas_with_sessions,
            }
            for c in in_radius
        ),
        key=lambda c: c["distance_miles"],
    )

    return {
        "reference": {"lat": lat, "lng": lng, "radius_miles": radius, "label": label},
        "horizon_days": horizon,
        "cinemas": cinemas,
        "films": films,
    }

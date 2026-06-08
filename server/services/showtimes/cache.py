"""Per-(market, day) TTL disk+memory cache for normalized showtimes.

Decision #3 (owner): upstream feeds are fetched **at most once per day** per
market, so any number of users hitting the same area share a single upstream
fetch. The sessions feed is per-market and one pull covers every cinema in it.

Mirrors ``server/routers/search.py``'s favicon cache: a module-level dict
persisted to disk with an atomic ``NamedTemporaryFile`` + ``os.replace`` write.
The cache key is ``"{market_id}:{fetch_date}"`` and the value is the normalized
flat showtime list for that whole market (the radius filter happens on read).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from dataclasses import asdict
from datetime import date as date_cls

from .alamo import Showtime, ShowtimeSource, normalize

logger = logging.getLogger(__name__)

_CACHE_PATH = os.environ.get(
    "SHOWTIME_CACHE_PATH",
    os.path.expanduser("~/.cache/whoeverwants/showtimes_cache.json"),
)
_CACHE_DIR = os.path.dirname(os.path.abspath(_CACHE_PATH))
_CACHE_MAX_DAYS = 3  # keep at most this many distinct fetch-dates per market
_RETRY_DELAY_SECONDS = 3.0  # pause before the single retry of an empty fetch


def _load() -> dict[str, list[dict]]:
    try:
        with open(_CACHE_PATH) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
        logger.warning("Showtime cache at %s had unexpected type, ignoring", _CACHE_PATH)
    except FileNotFoundError:
        pass
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Could not load showtime cache from %s: %s", _CACHE_PATH, e)
    return {}


_cache: dict[str, list[dict]] = _load()
os.makedirs(_CACHE_DIR, exist_ok=True)


def _save() -> None:
    try:
        payload = json.dumps(_cache)
        with tempfile.NamedTemporaryFile("w", dir=_CACHE_DIR, delete=False, suffix=".tmp") as f:
            f.write(payload)
            tmp_path = f.name
        os.replace(tmp_path, _CACHE_PATH)
    except OSError as e:
        logger.warning("Failed to save showtime cache: %s", e)


def _key(market_id: str, fetch_date: str) -> str:
    return f"{market_id}:{fetch_date}"


def _prune_old_dates(market_id: str, keep_date: str) -> None:
    """Drop stale fetch-dates for a market so the file can't grow unbounded."""
    prefix = f"{market_id}:"
    dates = sorted(
        (k for k in _cache if k.startswith(prefix) and k != _key(market_id, keep_date)),
    )
    # Keep at most _CACHE_MAX_DAYS - 1 historical entries beside today's.
    for stale in dates[: max(0, len(dates) - (_CACHE_MAX_DAYS - 1))]:
        _cache.pop(stale, None)


async def get_market_showtimes(
    source: ShowtimeSource,
    market_id: str,
    market_slug: str,
    *,
    fetch_date: str | None = None,
) -> list[Showtime]:
    """Return the normalized showtimes for a whole market, fetching upstream at
    most once per (market, day)."""
    fetch_date = fetch_date or date_cls.today().isoformat()
    cache_key = _key(market_id, fetch_date)

    cached = _cache.get(cache_key)
    if cached is not None:
        return [Showtime(**d) for d in cached]

    showtimes = await _fetch_normalized(source, market_id, market_slug)
    if not showtimes:
        # The fetch failed/timed-out (``fetch_market`` returns ``({}, {})`` on
        # error) or the feed momentarily returned no sessions. Retry once after
        # a short pause before giving up — a single transient blip shouldn't
        # surface "No Alamo showtimes found near here".
        await asyncio.sleep(_RETRY_DELAY_SECONDS)
        showtimes = await _fetch_normalized(source, market_id, market_slug)

    # Only cache a non-empty result. An empty list (failed/timed-out fetch, or
    # a momentarily session-less feed) would otherwise poison the whole market
    # for the rest of the day (``cached is not None`` serves ``[]`` until the
    # fetch-date rolls over). Alamo markets always carry upcoming showtimes, so
    # a genuinely-empty market is indistinguishable from a transient failure;
    # skip the write and let the next request retry upstream.
    if showtimes:
        _cache[cache_key] = [asdict(s) for s in showtimes]
        _prune_old_dates(market_id, fetch_date)
        _save()
    return showtimes


async def _fetch_normalized(
    source: ShowtimeSource, market_id: str, market_slug: str
) -> list[Showtime]:
    sessions_payload, catalog_payload = await source.fetch_market(market_id, market_slug)
    market_cinemas = [c for c in source.directory() if c.market_id == market_id]
    return normalize(sessions_payload, catalog_payload, market_cinemas)


def clear_cache() -> None:
    """Test helper — drop all in-memory entries (does not touch disk)."""
    _cache.clear()

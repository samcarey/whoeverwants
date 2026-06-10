"""Cache-behavior tests for the showtime data layer (no live network).

Invariants:
* An EMPTY normalized result is never cached, so a transient upstream failure
  (``fetch_market`` returns ``({}, {})`` on error → ``normalize`` returns ``[]``)
  doesn't poison the whole market for the rest of the day.
* An empty first fetch is RETRIED once (after a short pause) before giving up,
  so a single blip recovers within the same request.
* A non-empty result IS cached and reused without re-fetching.
"""

import pytest

from services.showtimes import cache as cache_mod
from services.showtimes.alamo import Showtime, _DirectoryCinema


def _showtime(cinema_id: str = "0701") -> Showtime:
    return Showtime(
        session_id="s1", film_id="f1", film_name="Dune", film_year="2026",
        film_rating="PG-13", runtime=90, poster_url=None, cinema_id=cinema_id,
        cinema_name="Alamo Richardson", cinema_slug="richardson", fmt="Digital",
        brand=None, group_key="dune",
        seats_left=None, sales_url=None, datetime_local="2026-06-08T19:00:00",
        date="2026-06-08", start_time="19:00", key="2026-06-08 19:00-20:30",
    )


class _FakeSource:
    """Counts upstream fetches and returns scripted normalized lists.

    Pass ``showtimes`` for a fixed result on every fetch, or ``sequence`` for a
    per-fetch script (e.g. ``[[], [show]]`` = empty then success).
    """

    def __init__(self, showtimes=None, sequence=None):
        self._showtimes = showtimes if showtimes is not None else []
        self._sequence = list(sequence) if sequence is not None else None
        self.fetch_calls = 0

    def directory(self):
        return [
            _DirectoryCinema(
                cinema_id="0701", slug="richardson", name="Alamo Richardson",
                address=None, market_id="0700", market_slug="dfw",
                lat=32.9483, lng=-96.7299, timezone="America/Chicago",
            )
        ]

    async def fetch_market(self, market_id, market_slug):
        self.fetch_calls += 1
        if self._sequence is not None:
            shows = self._sequence.pop(0) if self._sequence else []
        else:
            shows = self._showtimes
        # cache.normalize is monkeypatched to pass this straight through.
        return {"_showtimes": shows}, {}


@pytest.fixture(autouse=True)
def _isolate_cache(monkeypatch):
    cache_mod.clear_cache()
    monkeypatch.setattr(cache_mod, "_save", lambda: None)  # don't touch disk
    monkeypatch.setattr(cache_mod, "_RETRY_DELAY_SECONDS", 0)  # no real wait
    monkeypatch.setattr(
        cache_mod, "normalize",
        lambda sessions, catalog, cinemas: sessions.get("_showtimes", []),
    )
    yield
    cache_mod.clear_cache()


@pytest.mark.asyncio
async def test_empty_result_retries_once_and_is_not_cached():
    src = _FakeSource([])  # empty on every fetch
    result = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert result == []
    assert src.fetch_calls == 2  # initial + one retry
    assert "0700:2026-06-08" not in cache_mod._cache  # not poisoned


@pytest.mark.asyncio
async def test_retry_recovers_within_one_request():
    # First fetch empty, retry succeeds — recovers without a poisoned entry.
    src = _FakeSource(sequence=[[], [_showtime()]])
    result = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert len(result) == 1
    assert src.fetch_calls == 2
    assert "0700:2026-06-08" in cache_mod._cache  # success was cached


@pytest.mark.asyncio
async def test_nonempty_first_fetch_does_not_retry_and_is_cached():
    src = _FakeSource([_showtime()])
    first = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert len(first) == 1
    assert src.fetch_calls == 1  # no retry needed
    assert "0700:2026-06-08" in cache_mod._cache
    # Second call is served from cache — no extra upstream fetch.
    second = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert len(second) == 1
    assert src.fetch_calls == 1

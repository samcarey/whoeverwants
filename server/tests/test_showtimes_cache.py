"""Cache-behavior tests for the showtime data layer (no live network).

The key invariant: an EMPTY normalized result is never cached, so a transient
upstream failure (``fetch_market`` returns ``({}, {})`` on error → ``normalize``
returns ``[]``) doesn't poison the whole market for the rest of the day. A
non-empty result IS cached, and a second call for the same (market, day) reuses
it instead of re-fetching upstream.
"""

import pytest

from services.showtimes import cache as cache_mod
from services.showtimes.alamo import Showtime, _DirectoryCinema


def _showtime(cinema_id: str = "0701") -> Showtime:
    return Showtime(
        session_id="s1", film_id="f1", film_name="Dune", film_year="2026",
        film_rating="PG-13", runtime=90, poster_url=None, cinema_id=cinema_id,
        cinema_name="Alamo Richardson", cinema_slug="richardson", fmt="Digital",
        seats_left=None, sales_url=None, datetime_local="2026-06-08T19:00:00",
        date="2026-06-08", start_time="19:00", key="2026-06-08 19:00-20:30",
    )


class _FakeSource:
    """Counts upstream fetches and returns a scripted normalized list."""

    def __init__(self, showtimes):
        self._showtimes = showtimes
        self.fetch_calls = 0

    def directory(self):
        return [
            _DirectoryCinema(
                cinema_id="0701", slug="richardson", name="Alamo Richardson",
                market_id="0700", market_slug="dfw", lat=32.9483, lng=-96.7299,
                timezone="America/Chicago",
            )
        ]

    async def fetch_market(self, market_id, market_slug):
        self.fetch_calls += 1
        # The cache calls normalize() on what we return; return a payload whose
        # normalization yields exactly self._showtimes. Easiest: monkeypatch
        # normalize separately — done in the fixture below via the patched fn.
        return {"_showtimes": self._showtimes}, {}


@pytest.fixture(autouse=True)
def _isolate_cache(monkeypatch):
    cache_mod.clear_cache()
    monkeypatch.setattr(cache_mod, "_save", lambda: None)  # don't touch disk
    # normalize() is exercised by the adapter tests; here we just pass the
    # fake source's scripted list straight through.
    monkeypatch.setattr(
        cache_mod, "normalize",
        lambda sessions, catalog, cinemas: sessions.get("_showtimes", []),
    )
    yield
    cache_mod.clear_cache()


@pytest.mark.asyncio
async def test_empty_result_is_not_cached():
    src = _FakeSource([])
    first = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert first == []
    assert "0700:2026-06-08" not in cache_mod._cache  # not poisoned
    # A second call re-fetches upstream (no poisoned empty entry served).
    second = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert second == []
    assert src.fetch_calls == 2


@pytest.mark.asyncio
async def test_nonempty_result_is_cached_and_reused():
    src = _FakeSource([_showtime()])
    first = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert len(first) == 1
    assert "0700:2026-06-08" in cache_mod._cache
    # Second call is served from cache — no extra upstream fetch.
    second = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert len(second) == 1
    assert src.fetch_calls == 1


@pytest.mark.asyncio
async def test_recovers_after_transient_empty_fetch():
    # First fetch fails (empty), second succeeds — the failure must not have
    # been cached, so the success lands.
    src = _FakeSource([])
    assert await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08") == []
    src._showtimes = [_showtime()]
    recovered = await cache_mod.get_market_showtimes(src, "0700", "dfw", fetch_date="2026-06-08")
    assert len(recovered) == 1
    assert src.fetch_calls == 2

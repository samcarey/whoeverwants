"""Adapter tests for the Alamo showtime data layer (no live network).

Drives ``normalize`` + ``group_by_film`` + the radius filter against a trimmed
real-payload fixture (`tests/fixtures/alamo_market_fixture.json`). The fixture
is two real onsale dates from market 0000, two cinemas (South Lamar 0004,
Lakeline 0007), a handful of films + onsale sessions, plus matching catalog
poster entries.
"""

import json
import os
from datetime import date, timedelta

import pytest

from services.showtimes.alamo import (
    Showtime,
    _display_format,
    _split_brand,
    filter_sessions_by_horizon,
    group_by_film,
    load_directory,
    normalize,
)
from routers.search import _haversine_miles

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "alamo_market_fixture.json")


@pytest.fixture
def payloads():
    with open(_FIXTURE) as f:
        data = json.load(f)
    return data["sessions"], data["catalog"]


@pytest.fixture
def directory():
    return load_directory()


def test_directory_loads_austin_cinemas(directory):
    by_id = {c.cinema_id: c for c in directory}
    assert "0004" in by_id
    assert by_id["0004"].name == "Alamo South Lamar"
    assert by_id["0004"].market_id == "0000"
    assert by_id["0004"].timezone == "America/Chicago"


def test_normalize_joins_sessions_directory_and_posters(payloads, directory):
    sessions, catalog = payloads
    shows = normalize(sessions, catalog, directory)
    assert shows, "fixture should produce showtimes"

    s = shows[0]
    # Cinema name/coords come from the directory, not the feed.
    assert s.cinema_name.startswith("Alamo ")
    assert s.cinema_id in {"0004", "0007"}
    # Option key is the time-slot format and parseable by the winner tiebreak.
    assert s.key == f"{s.date} {s.start_time}-{s.key.split('-')[-1]}"
    parts = s.key.split(" ")
    assert len(parts) == 2 and parts[0] == s.date
    # Posters are best-effort but present for joinable slugs.
    assert any(x.poster_url for x in shows)
    # Ticketing link is the stable per-cinema movie showpage (theater + movie),
    # NOT a session deep link (those 404 once the session expires).
    assert s.sales_url is not None
    assert s.sales_url.startswith("https://drafthouse.com/")
    assert "/show/" in s.sales_url and f"?cinemaId={s.cinema_id}" in s.sales_url
    assert "/ticketing/" not in s.sales_url


def test_normalize_drops_cinemas_outside_directory(payloads, directory):
    sessions, catalog = payloads
    # A directory with ONLY South Lamar → Lakeline sessions must be dropped.
    only_south = [c for c in directory if c.cinema_id == "0004"]
    shows = normalize(sessions, catalog, only_south)
    assert shows
    assert {s.cinema_id for s in shows} == {"0004"}


def test_normalize_skips_past_sessions(directory):
    sessions = {
        "Market": {
            "MarketId": "0000",
            "Dates": [
                {
                    "DateId": "20260605",
                    "Date": "Friday, June 5, 2026",
                    "Cinemas": [
                        {
                            "CinemaId": "0004",
                            "CinemaName": "South Lamar",
                            "CinemaSlug": "south-lamar",
                            "Films": [
                                {
                                    "FilmId": "F1",
                                    "FilmName": "Test Film",
                                    "FilmRuntime": "120",
                                    "FilmSlug": "test-film",
                                    "Series": [
                                        {
                                            "Formats": [
                                                {
                                                    "FormatName": "Digital",
                                                    "Sessions": [
                                                        {
                                                            "SessionId": "1",
                                                            "SessionStatus": "past",
                                                            "SessionDateTime": "2026-06-05T12:00:00",
                                                        },
                                                        {
                                                            "SessionId": "2",
                                                            "SessionStatus": "onsale",
                                                            "SessionDateTime": "2026-06-05T19:00:00",
                                                            "SeatsLeft": "42",
                                                        },
                                                    ],
                                                }
                                            ]
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
        }
    }
    shows = normalize(sessions, {}, directory)
    assert len(shows) == 1
    assert shows[0].session_id == "2"
    assert shows[0].seats_left == 42
    # end = 19:00 + 120m = 21:00
    assert shows[0].key == "2026-06-05 19:00-21:00"


def test_key_handles_runtime_past_midnight(directory):
    sessions = {
        "Market": {
            "Dates": [
                {
                    "Cinemas": [
                        {
                            "CinemaId": "0004",
                            "CinemaName": "South Lamar",
                            "CinemaSlug": "south-lamar",
                            "Films": [
                                {
                                    "FilmId": "F1",
                                    "FilmName": "Long Movie",
                                    "FilmRuntime": "166",
                                    "FilmSlug": "long-movie",
                                    "Series": [
                                        {
                                            "Formats": [
                                                {
                                                    "FormatName": "70mm",
                                                    "Sessions": [
                                                        {
                                                            "SessionId": "9",
                                                            "SessionStatus": "onsale",
                                                            "SessionDateTime": "2026-06-05T23:10:00",
                                                        }
                                                    ],
                                                }
                                            ]
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                }
            ]
        }
    }
    shows = normalize(sessions, {}, directory)
    # 23:10 + 166m = 25:56 → wraps to 01:56
    assert shows[0].key == "2026-06-05 23:10-01:56"
    assert shows[0].fmt == "70mm"


def test_group_by_film_collapses_and_sorts(payloads, directory):
    sessions, catalog = payloads
    films = group_by_film(normalize(sessions, catalog, directory))
    assert films
    # One film entry per FilmId, each with its sessions.
    film_ids = [f["film_id"] for f in films]
    assert len(film_ids) == len(set(film_ids))
    # Sorted by session count desc.
    counts = [len(f["sessions"]) for f in films]
    assert counts == sorted(counts, reverse=True)
    # Each film's sessions are chronologically sorted.
    for f in films:
        keys = [(s["date"], s["time"]) for s in f["sessions"]]
        assert keys == sorted(keys)


def test_keys_are_unique_per_film_across_cinemas(directory):
    # Two different cinemas, same film, same start time + runtime → the raw key
    # collides. group_by_film must disambiguate so every session key is unique
    # (it's the React render key AND the options_metadata / vote reference key).
    def cinema_block(cid, name, slug):
        return {
            "CinemaId": cid, "CinemaName": name, "CinemaSlug": slug,
            "Films": [{
                "FilmId": "F1", "FilmName": "Dune", "FilmRuntime": "160", "FilmSlug": "dune",
                "Series": [{"Formats": [{"FormatName": "Digital", "Sessions": [{
                    "SessionId": f"s-{cid}", "SessionStatus": "onsale",
                    "SessionDateTime": "2026-06-12T12:00:00", "SeatsLeft": "10",
                }]}]}],
            }],
        }
    sessions = {"Market": {"Dates": [{"Cinemas": [
        cinema_block("0004", "South Lamar", "south-lamar"),
        cinema_block("0003", "Village", "village"),
    ]}]}}
    films = group_by_film(normalize(sessions, {}, directory))
    assert len(films) == 1
    keys = [s["key"] for s in films[0]["sessions"]]
    assert len(keys) == 2
    assert len(set(keys)) == 2, f"keys must be unique, got {keys}"
    # Start times stay exact (drive the chronological sort + displayed time).
    assert all(k.split(" ")[1].split("-")[0] == "12:00" for k in keys)


def test_horizon_filter():
    today = date.today()
    def mk(d):
        ds = d.isoformat()
        return Showtime(
            session_id="x", film_id="f", film_name="n", film_year=None, film_rating=None,
            runtime=90, poster_url=None, cinema_id="0004", cinema_name="South Lamar",
            cinema_slug="south-lamar", fmt="Digital", brand=None, group_key="n",
            seats_left=None, sales_url=None,
            datetime_local=f"{ds}T19:00:00", date=ds, start_time="19:00",
            key=f"{ds} 19:00-20:30",
        )
    shows = [
        mk(today - timedelta(days=1)),  # past → dropped
        mk(today),                       # today → kept
        mk(today + timedelta(days=10)),  # within → kept
        mk(today + timedelta(days=40)),  # beyond → dropped
    ]
    kept = filter_sessions_by_horizon(shows, 21)
    assert len(kept) == 2
    assert {s.date for s in kept} == {today.isoformat(), (today + timedelta(days=10)).isoformat()}


@pytest.mark.parametrize(
    "name,canonical,brand",
    [
        ("The Big Show: DISCLOSURE DAY", "DISCLOSURE DAY", "The Big Show"),
        ("Kids Camp: MATILDA", "MATILDA", "Kids Camp"),
        ("Guest Selects: THE GRADUATE", "THE GRADUATE", "Guest Selects"),
        # Real titles with a colon must survive untouched (allowlist gate).
        ("JACKASS: BEST AND LAST", "JACKASS: BEST AND LAST", None),
        ("STAR WARS: THE MANDALORIAN AND GROGU", "STAR WARS: THE MANDALORIAN AND GROGU", None),
        # No colon at all.
        ("BACKROOMS", "BACKROOMS", None),
    ],
)
def test_split_brand(name, canonical, brand):
    assert _split_brand(name) == (canonical, brand)


def test_display_format_dedupes_and_appends():
    # Brand repeated as the FormatName collapses to a single label.
    assert _display_format("The Big Show", "The Big Show") == "The Big Show"
    # Generic projection format → brand alone.
    assert _display_format("Kids Camp", "Digital") == "Kids Camp"
    # Distinctive format → appended after the brand.
    assert _display_format("The Big Show", "70mm") == "The Big Show · 70mm"
    # No brand → format passes through (empty → Digital).
    assert _display_format(None, "70mm") == "70mm"
    assert _display_format(None, "") == "Digital"


def _sessions_payload(films):
    """films: list of (FilmId, FilmName, FilmSlug, FormatName, [datetime])."""
    by_film = {}
    for fid, fname, slug, fmt, times in films:
        sess = [{"SessionId": f"{fid}-{i}", "SessionDateTime": t, "SessionStatus": "onsale"}
                for i, t in enumerate(times)]
        by_film.setdefault((fid, fname, slug), []).append({"FormatName": fmt, "Sessions": sess})
    return {"Market": {"Dates": [{"Cinemas": [{"CinemaId": "0004", "CinemaName": "South Lamar",
        "Films": [{"FilmId": fid, "FilmName": fname, "FilmSlug": slug, "FilmRuntime": "120",
                   "Series": [{"Formats": fmts}]} for (fid, fname, slug), fmts in by_film.items()]}]}]}}


def test_brand_variants_merge_into_one_film():
    directory = [c for c in load_directory() if c.cinema_id == "0004"]
    payload = _sessions_payload([
        ("F1", "MASTERS OF THE UNIVERSE (2026)", "motu", "Digital", ["2099-01-01T19:00:00"]),
        ("F2", "The Big Show: MASTERS OF THE UNIVERSE (2026)", "big-show-motu", "The Big Show", ["2099-01-01T21:00:00"]),
        ("F3", "JACKASS: BEST AND LAST", "jackass", "Digital", ["2099-01-01T20:00:00"]),
    ])
    films = group_by_film(normalize(payload, {}, directory))
    names = {f["name"]: f for f in films}
    # The two MOTU variants collapse into ONE film…
    assert "MASTERS OF THE UNIVERSE (2026)" in names
    assert "The Big Show: MASTERS OF THE UNIVERSE (2026)" not in names
    motu = names["MASTERS OF THE UNIVERSE (2026)"]
    assert len(motu["sessions"]) == 2
    # …with the brand visible per-session via the format label.
    assert sorted(s["format"] for s in motu["sessions"]) == ["Digital", "The Big Show"]
    # The real-colon title is its own untouched film.
    assert "JACKASS: BEST AND LAST" in names


def test_brand_only_film_shows_clean_name():
    # Only the branded variant is in range → still displays the canonical name,
    # with the brand on its sessions.
    directory = [c for c in load_directory() if c.cinema_id == "0004"]
    payload = _sessions_payload([
        ("F1", "The Big Show: DISCLOSURE DAY", "big-show-disclosure", "The Big Show", ["2099-01-01T19:00:00"]),
    ])
    films = group_by_film(normalize(payload, {}, directory))
    assert [f["name"] for f in films] == ["DISCLOSURE DAY"]
    assert films[0]["sessions"][0]["format"] == "The Big Show"


def test_radius_filter_against_directory():
    # Downtown Austin → the 5 Austin (market 0000) cinemas within 25mi; the
    # DFW cinemas (~180mi away) are excluded; a far point → none.
    directory = load_directory()
    austin = [c for c in directory if _haversine_miles(30.2672, -97.7431, c.lat, c.lng) <= 25]
    assert {c.market_id for c in austin} == {"0000"}
    assert len(austin) == sum(1 for c in directory if c.market_id == "0000")
    far = [c for c in directory if _haversine_miles(40.7128, -74.0060, c.lat, c.lng) <= 25]
    assert far == []

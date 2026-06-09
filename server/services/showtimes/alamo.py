"""Alamo Drafthouse showtime adapter.

Two upstream feeds plus a static directory are joined into a normalized
``list[Showtime]``:

* **Sessions** (legacy): ``feeds.drafthouse.com/adcService/showtimes.svc/market/{marketId}/``
  — the real showtimes (per market): ``Market → Dates → Cinemas → Films →
  Series → Formats → Sessions``. Carries runtime, seats-left, format names,
  human cinema names, and a (sometimes-empty) sales URL. **No coords, no
  posters.** NOTE the trailing slash — the bare path 307-redirects to it.
* **Catalog** (modern): ``drafthouse.com/s/mother/v2/schedule/market/{marketSlug}``
  — film metadata: posters, certification, headline, joined on the film slug.
  **No sessions/times we rely on** (we take posters only).
* **Directory** (`server/data/alamo_cinemas.json`): coords + timezone per cinema,
  and the market each cinema belongs to. Neither feed carries coordinates, so
  this is what makes the geo/radius query possible.

The join is on the film slug (legacy ``FilmSlug`` == catalog ``slug`` /
``legacySlug``); posters are best-effort and omitted gracefully when the slug
doesn't line up.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import date as date_cls
from datetime import datetime
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)

_DIRECTORY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data",
    "alamo_cinemas.json",
)

_SESSIONS_URL = "https://feeds.drafthouse.com/adcService/showtimes.svc/market/{market_id}/"
_CATALOG_URL = "https://drafthouse.com/s/mother/v2/schedule/market/{market_slug}"

_HTTP_TIMEOUT = 25.0
_HTTP_HEADERS = {
    "User-Agent": "WhoeverWants/1.0 (+https://whoeverwants.com)",
    "Accept": "application/json",
}

# Alamo merchandises the SAME film under branded "presentations" — premium
# auditoriums ("The Big Show", "Crafthouse"), themed/repertory events ("Kids
# Camp", "Movie Party", "Guest Selects", ...). Each gets its own FilmId +
# FilmName with the brand baked in as a `"<Brand>: <MOVIE>"` prefix (the
# feed's structured `Series` field is empty in practice). Left unhandled, one
# movie fragments into several picker rows ("DISCLOSURE DAY" vs "The Big Show:
# DISCLOSURE DAY"), which defeats searching + apples-to-apples comparison.
#
# We strip a KNOWN brand prefix to recover the canonical title (so branded +
# plain variants merge into one film), and fold the brand into the per-session
# format label so it stays visible on every showtime bubble when curating /
# voting. The allowlist is load-bearing: a generic "split on the first colon"
# would mangle real titles like "JACKASS: BEST AND LAST" or "STAR WARS: THE
# MANDALORIAN AND GROGU". Match is case-insensitive on the text before ": ".
_BRAND_PREFIXES: frozenset[str] = frozenset(
    p.casefold()
    for p in (
        "The Big Show",
        "Crafthouse",
        "Kids Camp",
        "Movie Party",
        "Family Party",
        "Guest Selects",
        "Sad Girl Cinema Club",
        "Queer Film Theory 101",
        "Terror Tuesday",
        "Weird Wednesday",
        "Champagne Cinema",
        "Afternoon Tea",
        "Video Vortex",
        "Time Capsule",
        "Alamo Time Capsule",
        "Tough Guy Cinema",
        "Cinema Cocktails",
    )
)

# Projection formats that carry no extra signal beside a brand, so the brand
# alone is shown; anything else (e.g. "70mm") is appended after the brand.
_GENERIC_FORMATS: frozenset[str] = frozenset({"", "digital", "standard", "2d"})


def _split_brand(film_name: str) -> tuple[str, str | None]:
    """``("The Big Show: DISCLOSURE DAY",) -> ("DISCLOSURE DAY", "The Big Show")``.

    Returns ``(canonical_name, brand)``. Only strips when the text before the
    first ``": "`` is a known Alamo brand (see ``_BRAND_PREFIXES``); otherwise
    returns the name unchanged with ``brand=None`` (so real colon titles like
    "JACKASS: BEST AND LAST" survive).
    """
    prefix, sep, rest = film_name.partition(": ")
    if sep and rest.strip() and prefix.strip().casefold() in _BRAND_PREFIXES:
        return rest.strip(), prefix.strip()
    return film_name, None


def _display_format(brand: str | None, fmt_name: str | None) -> str:
    """Per-session format label, brand-first so it's visible on every bubble."""
    fmt = (fmt_name or "").strip()
    if brand:
        # Alamo often repeats the brand AS the FormatName ("The Big Show");
        # only append a format that adds real signal (e.g. "70mm").
        fmt_cf = fmt.casefold()
        if fmt and fmt_cf not in _GENERIC_FORMATS and fmt_cf != brand.casefold():
            return f"{brand} · {fmt}"
        return brand
    return fmt or "Digital"


def _group_key(canonical_name: str) -> str:
    """Merge key: brand-stripped title, case/whitespace-insensitive."""
    return " ".join(canonical_name.split()).casefold()


@dataclass
class Showtime:
    """One normalized, in-radius movie showtime."""

    session_id: str
    film_id: str
    film_name: str  # canonical (brand prefix stripped)
    film_year: str | None
    film_rating: str | None
    runtime: int | None
    poster_url: str | None
    cinema_id: str
    cinema_name: str
    cinema_slug: str
    fmt: str  # brand-first label: "The Big Show", "The Big Show · 70mm", "Digital", ...
    brand: str | None  # "The Big Show", "Kids Camp", ... or None
    group_key: str  # canonical-name merge key (see _group_key)
    seats_left: int | None
    sales_url: str | None
    datetime_local: str  # "2026-06-20T19:10:00" (cinema-local, naive)
    date: str  # "2026-06-20"
    start_time: str  # "19:10"
    key: str  # "YYYY-MM-DD HH:MM-HH:MM" (end = start + runtime, mod 24h)

    def to_session_json(self) -> dict:
        return {
            "key": self.key,
            "session_id": self.session_id,
            "cinema_id": self.cinema_id,
            "cinema_name": self.cinema_name,
            "cinema_slug": self.cinema_slug,
            "date": self.date,
            "time": self.start_time,
            "datetime": self.datetime_local,
            "format": self.fmt,
            "seats_left": self.seats_left,
            "sales_url": self.sales_url,
        }


@dataclass
class _DirectoryCinema:
    cinema_id: str
    slug: str
    name: str
    address: str | None
    market_id: str
    market_slug: str
    lat: float
    lng: float
    timezone: str


def load_directory() -> list[_DirectoryCinema]:
    """Load the static cinema directory (coords + market enumeration)."""
    with open(_DIRECTORY_PATH) as f:
        data = json.load(f)
    return [
        _DirectoryCinema(
            cinema_id=str(c["cinema_id"]),
            slug=c["slug"],
            name=c["name"],
            address=c.get("address"),
            market_id=str(c["market_id"]),
            market_slug=c["market_slug"],
            lat=float(c["lat"]),
            lng=float(c["lng"]),
            timezone=c["timezone"],
        )
        for c in data.get("cinemas", [])
    ]


def _minutes(time_str: str) -> int:
    h, m = time_str.split(":")
    return int(h) * 60 + int(m)


def _fmt_hhmm(total_minutes: int) -> str:
    total_minutes %= 1440
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def _build_poster_map(catalog: dict) -> dict[str, str | None]:
    """slug/legacySlug → poster URL from the catalog feed (best-effort)."""
    poster_by_slug: dict[str, str | None] = {}
    data = (catalog or {}).get("data") or {}
    for pres in data.get("presentations") or []:
        show = pres.get("show") or {}
        posters = show.get("posterImages") or []
        uri = posters[0].get("uri") if posters else None
        for key in (pres.get("slug"), pres.get("legacySlug"), show.get("slug")):
            if key:
                poster_by_slug.setdefault(key, uri)
    return poster_by_slug


def normalize(
    sessions_payload: dict,
    catalog_payload: dict,
    directory: list[_DirectoryCinema],
) -> list[Showtime]:
    """Join the two feeds + directory into a flat list of normalized showtimes.

    Only sessions whose ``CinemaId`` is in the supplied directory are kept
    (so callers pass the in-radius subset). Past sessions are dropped.
    """
    poster_by_slug = _build_poster_map(catalog_payload)
    dir_by_id = {c.cinema_id: c for c in directory}

    out: list[Showtime] = []
    market = (sessions_payload or {}).get("Market") or {}
    for day in market.get("Dates") or []:
        for cinema in day.get("Cinemas") or []:
            cinema_id = str(cinema.get("CinemaId") or "")
            dir_cinema = dir_by_id.get(cinema_id)
            if dir_cinema is None:
                continue  # not in radius / not in directory
            for film in cinema.get("Films") or []:
                film_slug = film.get("FilmSlug") or ""
                runtime = None
                try:
                    runtime = int(film.get("FilmRuntime")) if film.get("FilmRuntime") else None
                except (TypeError, ValueError):
                    runtime = None
                poster = poster_by_slug.get(film_slug)
                canonical_name, brand = _split_brand(film.get("FilmName") or "")
                grp_key = _group_key(canonical_name)
                for series in film.get("Series") or []:
                    for fmt in series.get("Formats") or []:
                        fmt_name = fmt.get("FormatName") or "Digital"
                        for sess in fmt.get("Sessions") or []:
                            if (sess.get("SessionStatus") or "").lower() == "past":
                                continue
                            dt = sess.get("SessionDateTime") or ""
                            if "T" not in dt:
                                continue
                            date_part, time_part = dt.split("T", 1)
                            start_hhmm = time_part[:5]
                            try:
                                start_min = _minutes(start_hhmm)
                            except (ValueError, IndexError):
                                continue
                            end_min = start_min + (runtime or 0)
                            key = f"{date_part} {start_hhmm}-{_fmt_hhmm(end_min)}"
                            seats = None
                            try:
                                seats = int(sess.get("SeatsLeft")) if sess.get("SeatsLeft") else None
                            except (TypeError, ValueError):
                                seats = None
                            # Ticketing link = the per-cinema MOVIE showpage,
                            # NOT a session deep link. `drafthouse.com/ticketing/{SessionId}`
                            # 404s in-browser once a session expires/sells out
                            # (the checkout SPA can't resolve a stale id), and
                            # `SessionSalesURL` is empty in practice. The
                            # `/{market}/show/{film}?cinemaId={cinema}` page is
                            # stable and as specific as we can get without the
                            # gated checkout API (theater + movie).
                            session_id = str(sess.get("SessionId") or "")
                            sales_url = (
                                f"https://drafthouse.com/{dir_cinema.market_slug}/show/{film_slug}?cinemaId={cinema_id}"
                                if film_slug
                                else None
                            )
                            out.append(
                                Showtime(
                                    session_id=session_id,
                                    film_id=str(film.get("FilmId") or ""),
                                    film_name=canonical_name,
                                    film_year=film.get("FilmYear") or None,
                                    film_rating=film.get("FilmRating") or None,
                                    runtime=runtime,
                                    poster_url=poster,
                                    cinema_id=cinema_id,
                                    cinema_name=dir_cinema.name,
                                    cinema_slug=dir_cinema.slug,
                                    fmt=_display_format(brand, fmt_name),
                                    brand=brand,
                                    group_key=grp_key,
                                    seats_left=seats,
                                    sales_url=sales_url,
                                    datetime_local=dt,
                                    date=date_part,
                                    start_time=start_hhmm,
                                    key=key,
                                )
                            )
    return out


def group_by_film(showtimes: list[Showtime]) -> list[dict]:
    """Collapse a flat showtime list into ``[{film…, sessions:[…]}]`` for the API.

    Films merge on ``group_key`` (the brand-stripped canonical title), so
    "DISCLOSURE DAY" and "The Big Show: DISCLOSURE DAY" become ONE entry. The
    representative ``film_id`` / ``name`` / ``poster_url`` prefer an UNBRANDED
    variant when one exists (the plain film carries the canonical name + the
    catalog poster); otherwise the first branded variant seeds them, already
    showing its cleaned canonical name. The brand stays visible per session via
    the ``format`` label (see ``_display_format``).
    """
    films: dict[str, dict] = {}
    for s in showtimes:
        film = films.get(s.group_key)
        if film is None:
            film = {
                "film_id": s.film_id,
                "name": s.film_name,
                "year": s.film_year,
                "rating": s.film_rating,
                "runtime": s.runtime,
                "poster_url": s.poster_url,
                "sessions": [],
                "_unbranded": s.brand is None,
            }
            films[s.group_key] = film
        elif s.brand is None and not film["_unbranded"]:
            # An unbranded variant outranks a branded seed for the identity
            # fields (canonical name, base FilmId, base poster slug).
            film["film_id"] = s.film_id
            film["name"] = s.film_name
            film["poster_url"] = s.poster_url
            film["_unbranded"] = True
        # First non-null poster/runtime wins (some sessions lack one).
        if film["poster_url"] is None and s.poster_url:
            film["poster_url"] = s.poster_url
        if film["runtime"] is None and s.runtime:
            film["runtime"] = s.runtime
        film["sessions"].append(s.to_session_json())

    result = list(films.values())
    for film in result:
        film.pop("_unbranded", None)
        film["sessions"].sort(key=lambda x: (x["date"], x["time"], x["cinema_name"]))
        _disambiguate_keys(film["sessions"])
    result.sort(key=lambda f: (-len(f["sessions"]), f["name"].lower()))
    return result


def _disambiguate_keys(sessions: list[dict]) -> None:
    """Ensure every session in a film has a unique option key, in place.

    The key format ("YYYY-MM-DD HH:MM-HH:MM") deliberately omits cinema/format
    so the shared time-slot parsers work — but that means two distinct sessions
    (same movie, same start time, same runtime, DIFFERENT cinemas) collide. The
    key is the React render key AND the `options_metadata` map key AND the vote
    liked/disliked reference, so it MUST be unique. On collision we nudge the
    END minute (+1m, mod 24h) until unique: the START time + date — which drive
    the chronological winner sort and the displayed time — stay exact; only the
    rarely-shown end/runtime label shifts by a minute or two.
    """
    seen: set[str] = set()
    for sess in sessions:
        key = sess["key"]
        while key in seen:
            try:
                date_part, time_range = key.split(" ")
                start_str, end_str = time_range.split("-")
                end_min = (_minutes(end_str) + 1) % 1440
                key = f"{date_part} {start_str}-{_fmt_hhmm(end_min)}"
            except (ValueError, IndexError):
                # Malformed key — fall back to a guaranteed-unique suffix-free
                # nudge isn't possible, so break to avoid an infinite loop.
                break
        sess["key"] = key
        seen.add(key)


class ShowtimeSource(Protocol):
    """Pluggable chain adapter. Implement this to add AMC/others later."""

    def directory(self) -> list[_DirectoryCinema]:
        ...

    async def fetch_market(self, market_id: str, market_slug: str) -> tuple[dict, dict]:
        """Return ``(sessions_payload, catalog_payload)`` for one market."""
        ...


@dataclass
class AlamoShowtimeSource:
    """The single chain wired for v1."""

    _directory: list[_DirectoryCinema] = field(default_factory=load_directory)

    def directory(self) -> list[_DirectoryCinema]:
        return self._directory

    async def fetch_market(self, market_id: str, market_slug: str) -> tuple[dict, dict]:
        async with httpx.AsyncClient(
            timeout=_HTTP_TIMEOUT, headers=_HTTP_HEADERS, follow_redirects=True
        ) as client:
            sessions: dict = {}
            catalog: dict = {}
            try:
                r = await client.get(_SESSIONS_URL.format(market_id=market_id))
                r.raise_for_status()
                sessions = r.json()
            except (httpx.HTTPError, json.JSONDecodeError) as e:
                logger.warning("Alamo sessions fetch failed for market %s: %s", market_id, e)
            try:
                r = await client.get(_CATALOG_URL.format(market_slug=market_slug))
                r.raise_for_status()
                catalog = r.json()
            except (httpx.HTTPError, json.JSONDecodeError) as e:
                logger.warning("Alamo catalog fetch failed for market %s: %s", market_slug, e)
            return sessions, catalog


def filter_sessions_by_horizon(showtimes: list[Showtime], horizon_days: int) -> list[Showtime]:
    """Drop sessions whose date is before today or beyond the horizon."""
    today = date_cls.today()
    out: list[Showtime] = []
    for s in showtimes:
        try:
            d = datetime.strptime(s.date, "%Y-%m-%d").date()
        except ValueError:
            continue
        delta = (d - today).days
        if 0 <= delta <= horizon_days:
            out.append(s)
    return out

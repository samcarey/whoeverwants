"""Search/autocomplete endpoints for poll categories."""

import logging
import math
import os
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
RAWG_API_KEY = os.environ.get("RAWG_API_KEY", "")
_http_client = httpx.AsyncClient(timeout=5.0)

# LRU-style cache: normalized restaurant name -> favicon URL.
# Bounded to 500 entries; oldest entries evicted when full.
_FAVICON_CACHE_MAX = 500
_restaurant_favicon_cache: dict[str, str] = {}

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_HEADERS = {
    "User-Agent": "WhoeverWants/1.0 (whoeverwants.com)",
    "Accept-Language": "en",
}

# OSM amenity types considered "food/drink" for restaurant search filtering.
_FOOD_TYPES = frozenset({
    "restaurant", "fast_food", "cafe", "bar", "pub", "food_court",
    "ice_cream", "biergarten", "bakery",
})


def _favicon_url(website: str) -> str | None:
    """Extract a Google favicon URL from a website URL."""
    if not website:
        return None
    try:
        domain = urlparse(website).netloc or urlparse(website).path.split("/")[0]
        if domain:
            return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
    except Exception:
        pass
    return None


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in miles."""
    R = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _extract_website(extratags: dict) -> str:
    """Extract website URL from OSM extratags, checking common tag variants."""
    return (
        extratags.get("website")
        or extratags.get("contact:website")
        or extratags.get("brand:website")
        or ""
    )


async def _nominatim_fetch(
    query: str,
    lat: float | None,
    lon: float | None,
    max_distance: float,
    min_delta: float = 0,
) -> list[dict]:
    """Fetch raw Nominatim results with bounded search and unbounded fallback.

    Returns the raw JSON items from Nominatim (not yet processed into results).
    """
    has_ref = lat is not None and lon is not None

    params: dict = {
        "q": query,
        "format": "jsonv2",
        "limit": 20,
        "addressdetails": 1,
        "extratags": 1,
    }

    if has_ref and max_distance > 0:
        delta = max_distance / 69.0
        if min_delta:
            delta = max(delta, min_delta)
        params["viewbox"] = f"{lon - delta},{lat + delta},{lon + delta},{lat - delta}"
        params["bounded"] = 1

    resp = await _http_client.get(_NOMINATIM_URL, params=params, headers=_NOMINATIM_HEADERS)
    resp.raise_for_status()
    data = resp.json()

    # If bounded search returned no results, retry unbounded
    if not data and has_ref and max_distance > 0:
        params.pop("bounded", None)
        params.pop("viewbox", None)
        params["limit"] = 10
        resp = await _http_client.get(_NOMINATIM_URL, params=params, headers=_NOMINATIM_HEADERS)
        resp.raise_for_status()
        data = resp.json()

    return data


def _filter_by_distance(
    items: list[dict],
    lat: float | None,
    lon: float | None,
    max_distance: float,
) -> list[tuple[dict, float | None]]:
    """Filter Nominatim items by distance and return (item, distance) pairs."""
    has_ref = lat is not None and lon is not None
    results = []
    for item in items:
        item_lat = item.get("lat")
        item_lon = item.get("lon")
        distance = None
        if has_ref and item_lat and item_lon:
            distance = round(
                _haversine_miles(lat, lon, float(item_lat), float(item_lon)), 1
            )
            if max_distance > 0 and distance > max_distance:
                continue
        results.append((item, distance))
    if has_ref:
        results.sort(key=lambda r: r[1] if r[1] is not None else float("inf"))
    return results


async def _nominatim_search(
    query: str,
    lat: float | None,
    lon: float | None,
    max_distance: float,
) -> list[dict]:
    """Run a Nominatim search and return processed results with distance."""
    data = await _nominatim_fetch(query, lat, lon, max_distance)
    filtered = _filter_by_distance(data, lat, lon, max_distance)

    results = []
    for item, distance in filtered:
        extratags = item.get("extratags") or {}
        image_url = _favicon_url(_extract_website(extratags))

        entry: dict = {
            "label": item.get("display_name", ""),
            "name": item.get("name") or "",
            "description": item.get("type", "").replace("_", " ").title(),
            "lat": item.get("lat"),
            "lon": item.get("lon"),
            "imageUrl": image_url,
            "infoUrl": (
                f"https://www.openstreetmap.org/?mlat={item.get('lat')}&mlon={item.get('lon')}#map=15/{item.get('lat')}/{item.get('lon')}"
                if item.get("lat") and item.get("lon") else None
            ),
        }
        if distance is not None:
            entry["distance_miles"] = distance
        results.append(entry)

    return results


@router.get("/locations")
async def search_locations(
    q: str = Query(..., min_length=2, max_length=100),
    lat: float | None = Query(None, description="Reference latitude for proximity bias"),
    lon: float | None = Query(None, description="Reference longitude for proximity bias"),
    max_distance: float = Query(25, description="Maximum distance in miles (0 = no limit)"),
):
    """Search for locations using OpenStreetMap Nominatim.

    When lat/lon are provided, results are restricted to a bounding box
    derived from max_distance, sorted by proximity, and include distance_miles.
    """
    results = await _nominatim_search(q, lat, lon, max_distance)
    return results[:6]


@router.get("/geocode")
async def geocode(q: str = Query(..., min_length=2, max_length=200)):
    """Geocode an address or zip code to coordinates + label (city/zip).

    Returns the first matching result with lat, lon, and a short label
    suitable for display (city name or zip code).
    """
    resp = await _http_client.get(
        _NOMINATIM_URL,
        params={
            "q": q,
            "format": "jsonv2",
            "limit": 1,
            "addressdetails": 1,
        },
        headers=_NOMINATIM_HEADERS,
    )
    resp.raise_for_status()
    data = resp.json()

    if not data:
        return None

    item = data[0]
    addr = item.get("address", {})
    # Build a short label: prefer city/town, fall back to postcode
    label = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("hamlet")
        or addr.get("county")
    )
    postcode = addr.get("postcode")
    state = addr.get("state")
    # Format: "City, ST" or "City, ST 12345" or just "12345"
    if label and state:
        label = f"{label}, {state}"
    elif postcode:
        label = postcode

    return {
        "lat": item.get("lat"),
        "lon": item.get("lon"),
        "label": label or item.get("display_name", ""),
    }


@router.get("/movies")
async def search_movies(q: str = Query(..., min_length=2, max_length=100)):
    """Search for movies using TMDB API."""
    if not TMDB_API_KEY:
        return []

    resp = await _http_client.get(
        "https://api.themoviedb.org/3/search/movie",
        params={
            "api_key": TMDB_API_KEY,
            "query": q,
            "page": 1,
        },
    )
    resp.raise_for_status()
    data = resp.json()

    results = []
    for movie in data.get("results", [])[:6]:
        year = movie.get("release_date", "")[:4]
        title = movie.get("title", "")
        label = f"{title} ({year})" if year else title
        poster = movie.get("poster_path")
        movie_id = movie.get("id")
        results.append({
            "label": label,
            "description": (movie.get("overview", "") or "")[:120],
            "imageUrl": f"https://image.tmdb.org/t/p/w92{poster}" if poster else None,
            "infoUrl": f"https://www.themoviedb.org/movie/{movie_id}" if movie_id else None,
        })
    return results


def _rawg_crop_image(url: str | None, width: int = 200, height: int = 200) -> str | None:
    """Resize a RAWG media URL to a smaller thumbnail."""
    if not url or "media.rawg.io" not in url:
        return url
    return url.replace("/media/", f"/media/resize/{width}/-/")


@router.get("/video-games")
async def search_video_games(q: str = Query(..., min_length=2, max_length=100)):
    """Search for video games using RAWG API."""
    if not RAWG_API_KEY:
        return []

    try:
        resp = await _http_client.get(
            "https://api.rawg.io/api/games",
            params={
                "key": RAWG_API_KEY,
                "search": q,
                "page_size": 6,
            },
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError:
        logger.warning("RAWG API returned error for query %r", q)
        return []

    data = resp.json()

    results = []
    for game in data.get("results", [])[:6]:
        year = (game.get("released") or "")[:4]
        name = game.get("name", "")
        label = f"{name} ({year})" if year else name
        genres = ", ".join(g["name"] for g in game.get("genres", [])[:3])
        slug = game.get("slug")
        results.append({
            "label": label,
            "description": genres or None,
            "imageUrl": _rawg_crop_image(game.get("background_image")),
            "infoUrl": f"https://rawg.io/games/{slug}" if slug else None,
        })
    return results


def _format_cuisine(extratags: dict, osm_type: str) -> str | None:
    """Build a cuisine/category string from OSM extratags and type.

    OSM cuisine values use semicolons for multiple values, e.g. "mexican;burrito".
    The type field gives the broad category (restaurant, fast_food, cafe, etc.).
    """
    cuisine_raw = extratags.get("cuisine") or ""
    cuisines = []
    for c in cuisine_raw.split(";"):
        c = c.strip()
        if c:
            cuisines.append(c.replace("_", " ").title())
            if len(cuisines) == 3:
                break
    if cuisines:
        return ", ".join(cuisines)
    if osm_type and osm_type not in ("yes", "place"):
        return osm_type.replace("_", " ").title()
    return None


def _cache_favicon(name: str, favicon: str | None) -> str | None:
    """Store or retrieve a favicon from the name-based cache."""
    key = name.strip().lower()
    if not key:
        return favicon
    if favicon:
        if len(_restaurant_favicon_cache) >= _FAVICON_CACHE_MAX:
            _restaurant_favicon_cache.pop(next(iter(_restaurant_favicon_cache)))
        _restaurant_favicon_cache[key] = favicon
        return favicon
    return _restaurant_favicon_cache.get(key)


@router.get("/restaurants")
async def search_restaurants(
    q: str = Query(..., min_length=2, max_length=100),
    lat: float | None = Query(None, description="Reference latitude for proximity"),
    lon: float | None = Query(None, description="Reference longitude for proximity"),
    max_distance: float = Query(25, description="Maximum distance in miles (0 = no limit)"),
):
    """Search for restaurants using OpenStreetMap Nominatim.

    Returns up to 6 results with name, cuisine categories, distance,
    and favicon image. Uses OSM extratags for cuisine data.
    """
    data = await _nominatim_fetch(q, lat, lon, max_distance, min_delta=0.02)
    # Filter to food-related POIs only (excludes streets, landmarks, etc.)
    data = [item for item in data if item.get("type", "") in _FOOD_TYPES]
    filtered = _filter_by_distance(data, lat, lon, max_distance)

    results = []
    for item, distance in filtered:
        extratags = item.get("extratags") or {}
        cuisine = _format_cuisine(extratags, item.get("type", ""))

        name = item.get("name") or ""
        image_url = _cache_favicon(name, _favicon_url(_extract_website(extratags)))

        # Build address from addressdetails
        addr = item.get("address", {})
        road = " ".join(p for p in [addr.get("road", ""), addr.get("house_number", "")] if p)
        city = addr.get("city") or addr.get("town") or addr.get("village") or ""
        state = addr.get("state") or ""
        address = ", ".join(p for p in [road, city, state] if p)

        label = f"{name}, {address}" if name and address else name or item.get("display_name", "")
        item_lat = item.get("lat")
        item_lon = item.get("lon")

        entry: dict = {
            "label": label,
            "name": name,
            "description": cuisine,
            "imageUrl": image_url,
            "infoUrl": (
                f"https://www.openstreetmap.org/?mlat={item_lat}&mlon={item_lon}#map=17/{item_lat}/{item_lon}"
                if item_lat and item_lon else None
            ),
            "lat": item_lat,
            "lon": item_lon,
            "cuisine": cuisine,
        }
        if distance is not None:
            entry["distance_miles"] = distance

        results.append(entry)

    return results[:6]

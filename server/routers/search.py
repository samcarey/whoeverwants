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
YELP_API_KEY = os.environ.get("YELP_API_KEY", "")

_http_client = httpx.AsyncClient(timeout=5.0)


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


async def _find_osm_websites(
    name: str, ref_lat: float, ref_lon: float, max_distance: float,
) -> list[dict]:
    """Search Nominatim once for a business name in the area.

    Returns a list of OSM results that have a website, with their coordinates
    and favicon URL. Uses a single API call covering the whole search area
    (respects Nominatim's 1 req/sec policy).
    """
    headers = {
        "User-Agent": "WhoeverWants/1.0 (whoeverwants.com)",
        "Accept-Language": "en",
    }
    delta = max(max_distance / 69.0, 0.02)  # at least ~1.4 miles

    try:
        resp = await _http_client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": name,
                "format": "jsonv2",
                "limit": 20,
                "extratags": 1,
                "viewbox": f"{ref_lon - delta},{ref_lat + delta},{ref_lon + delta},{ref_lat - delta}",
                "bounded": 1,
            },
            headers=headers,
        )
        resp.raise_for_status()
        results = resp.json()

        # If bounded search found nothing, retry unbounded (biased, not restricted)
        if not results:
            resp = await _http_client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": name,
                    "format": "jsonv2",
                    "limit": 10,
                    "extratags": 1,
                    "viewbox": f"{ref_lon - delta},{ref_lat + delta},{ref_lon + delta},{ref_lat - delta}",
                },
                headers=headers,
            )
            resp.raise_for_status()
            results = resp.json()

        osm_entries = []
        for item in results:
            extratags = item.get("extratags") or {}
            website = (
                extratags.get("website")
                or extratags.get("contact:website")
                or extratags.get("brand:website")
            )
            if not website:
                continue
            item_lat = item.get("lat")
            item_lon = item.get("lon")
            if item_lat and item_lon:
                osm_entries.append({
                    "lat": float(item_lat),
                    "lon": float(item_lon),
                    "favicon": _favicon_url(website),
                })
        return osm_entries
    except Exception:
        return []


def _match_osm_favicon(
    biz_lat: float, biz_lon: float, osm_entries: list[dict],
) -> str | None:
    """Find the closest OSM entry with a favicon within 0.5 miles of a business."""
    best_favicon = None
    best_dist = 0.5  # max match distance in miles
    for entry in osm_entries:
        dist = _haversine_miles(biz_lat, biz_lon, entry["lat"], entry["lon"])
        if dist < best_dist:
            best_dist = dist
            best_favicon = entry["favicon"]
    return best_favicon


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in miles."""
    R = 3958.8  # Earth radius in miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _nominatim_search(
    query: str,
    lat: float | None,
    lon: float | None,
    max_distance: float,
) -> list[dict]:
    """Run a Nominatim search and return processed results with distance."""
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
        params["viewbox"] = f"{lon - delta},{lat + delta},{lon + delta},{lat - delta}"
        params["bounded"] = 1

    headers = {
        "User-Agent": "WhoeverWants/1.0 (whoeverwants.com)",
        "Accept-Language": "en",
    }

    resp = await _http_client.get(
        "https://nominatim.openstreetmap.org/search",
        params=params,
        headers=headers,
    )
    resp.raise_for_status()
    data = resp.json()

    # If bounded search returned no results, retry unbounded
    if not data and has_ref and max_distance > 0:
        params.pop("bounded", None)
        params.pop("viewbox", None)
        params["limit"] = 10
        resp = await _http_client.get(
            "https://nominatim.openstreetmap.org/search",
            params=params,
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data:
        item_lat = item.get("lat")
        item_lon = item.get("lon")
        distance = None
        if has_ref and item_lat and item_lon:
            distance = round(
                _haversine_miles(lat, lon, float(item_lat), float(item_lon)), 1
            )
            if max_distance > 0 and distance > max_distance:
                continue

        # Extract website from extratags for favicon
        extratags = item.get("extratags") or {}
        website = extratags.get("website") or extratags.get("contact:website") or ""
        image_url = _favicon_url(website)

        entry: dict = {
            "label": item.get("display_name", ""),
            "name": item.get("name") or "",
            "description": item.get("type", "").replace("_", " ").title(),
            "lat": item_lat,
            "lon": item_lon,
            "imageUrl": image_url,
            "infoUrl": (
                f"https://www.openstreetmap.org/?mlat={item_lat}&mlon={item_lon}#map=15/{item_lat}/{item_lon}"
                if item_lat and item_lon else None
            ),
        }
        if distance is not None:
            entry["distance_miles"] = distance
        results.append(entry)

    if has_ref:
        results.sort(key=lambda r: r.get("distance_miles", float("inf")))

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
        "https://nominatim.openstreetmap.org/search",
        params={
            "q": q,
            "format": "jsonv2",
            "limit": 1,
            "addressdetails": 1,
        },
        headers={
            "User-Agent": "WhoeverWants/1.0 (whoeverwants.com)",
            "Accept-Language": "en",
        },
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


@router.get("/restaurants")
async def search_restaurants(
    q: str = Query(..., min_length=2, max_length=100),
    lat: float | None = Query(None, description="Reference latitude for proximity"),
    lon: float | None = Query(None, description="Reference longitude for proximity"),
    max_distance: float = Query(25, description="Maximum distance in miles (0 = no limit)"),
):
    """Search for restaurants using the Yelp Fusion API.

    Returns up to 6 results with name, cuisine categories, rating, distance,
    and image. Requires YELP_API_KEY environment variable.
    Falls back to Nominatim location search filtered to food-related results
    if no Yelp key is configured.
    """
    if not YELP_API_KEY:
        # Fallback: use Nominatim with food keywords appended
        results = await _nominatim_search(f"{q} restaurant", lat, lon, max_distance)
        return results[:6]

    has_ref = lat is not None and lon is not None

    params: dict = {
        "term": q,
        "categories": "restaurants,food",
        "limit": 6,
        "sort_by": "best_match",
    }

    if has_ref:
        params["latitude"] = lat
        params["longitude"] = lon
        if max_distance > 0:
            # Yelp uses meters for radius (max 40000)
            radius_meters = min(int(max_distance * 1609.34), 40000)
            params["radius"] = radius_meters

    try:
        resp = await _http_client.get(
            "https://api.yelp.com/v3/businesses/search",
            params=params,
            headers={"Authorization": f"Bearer {YELP_API_KEY}"},
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError:
        logger.warning("Yelp API error for query %r, falling back to Nominatim", q)
        results = await _nominatim_search(f"{q} restaurant", lat, lon, max_distance)
        return results[:6]

    data = resp.json()

    businesses = data.get("businesses", [])[:6]

    # Pre-filter and extract coordinates
    filtered = []
    for biz in businesses:
        biz_lat = biz.get("coordinates", {}).get("latitude")
        biz_lon = biz.get("coordinates", {}).get("longitude")

        distance = None
        if has_ref and biz_lat and biz_lon:
            distance = round(_haversine_miles(lat, lon, biz_lat, biz_lon), 1)
            if max_distance > 0 and distance > max_distance:
                continue

        filtered.append((biz, biz_lat, biz_lon, distance))

    # Single Nominatim search for the query in the area to find websites/favicons.
    # This avoids per-result lookups that would violate Nominatim's rate limit.
    osm_entries: list[dict] = []
    if has_ref:
        osm_entries = await _find_osm_websites(q, lat, lon, max_distance)

    results = []
    for biz, biz_lat, biz_lon, distance in filtered:
        # Build cuisine string from Yelp categories
        categories = biz.get("categories", [])
        cuisine = ", ".join(c.get("title", "") for c in categories[:3])

        # Build address label
        location = biz.get("location", {})
        address_parts = [
            location.get("address1", ""),
            location.get("city", ""),
            location.get("state", ""),
        ]
        address = ", ".join(p for p in address_parts if p)

        name = biz.get("name", "")
        label = f"{name}, {address}" if address else name

        # Prefer favicon from OSM website, fall back to Yelp business photo
        favicon = None
        if biz_lat and biz_lon and osm_entries:
            favicon = _match_osm_favicon(biz_lat, biz_lon, osm_entries)
        image_url = favicon or biz.get("image_url") or None

        entry: dict = {
            "label": label,
            "name": name,
            "description": cuisine or None,
            "imageUrl": image_url,
            "infoUrl": biz.get("url") or None,
            "lat": str(biz_lat) if biz_lat else None,
            "lon": str(biz_lon) if biz_lon else None,
            "rating": biz.get("rating"),
            "reviewCount": biz.get("review_count"),
            "cuisine": cuisine or None,
            "priceLevel": biz.get("price"),
        }
        if distance is not None:
            entry["distance_miles"] = distance

        results.append(entry)

    return results

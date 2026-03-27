"""Search/autocomplete endpoints for poll content types."""

import logging
import os

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
RAWG_API_KEY = os.environ.get("RAWG_API_KEY", "")

_http_client = httpx.AsyncClient(timeout=5.0)


@router.get("/locations")
async def search_locations(q: str = Query(..., min_length=2, max_length=100)):
    """Search for locations using OpenStreetMap Nominatim."""
    resp = await _http_client.get(
        "https://nominatim.openstreetmap.org/search",
        params={
            "q": q,
            "format": "jsonv2",
            "limit": 6,
            "addressdetails": 1,
        },
        headers={"User-Agent": "WhoeverWants/1.0 (whoeverwants.com)"},
    )
    resp.raise_for_status()
    data = resp.json()

    return [
        {
            "label": item.get("display_name", ""),
            "description": item.get("type", "").replace("_", " ").title(),
            "lat": item.get("lat"),
            "lon": item.get("lon"),
            "infoUrl": f"https://www.openstreetmap.org/?mlat={item.get('lat')}&mlon={item.get('lon')}#map=15/{item.get('lat')}/{item.get('lon')}"
            if item.get("lat") and item.get("lon") else None,
        }
        for item in data
    ]


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

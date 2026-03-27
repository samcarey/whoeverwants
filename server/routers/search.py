"""Search/autocomplete endpoints for poll content types."""

import os

import httpx
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/search", tags=["search"])

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")

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
        results.append({
            "label": label,
            "description": (movie.get("overview", "") or "")[:120],
            "imageUrl": f"https://image.tmdb.org/t/p/w92{poster}" if poster else None,
        })
    return results

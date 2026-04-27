import { SEARCH_BASE } from "./_internal";

export interface SearchResult {
  label: string;
  name?: string;
  address?: string;
  description?: string;
  imageUrl?: string;
  infoUrl?: string;
  lat?: string;
  lon?: string;
  distance_miles?: number;
  rating?: number;
  reviewCount?: number;
  cuisine?: string;
  priceLevel?: string;
}

async function searchWithLocation(endpoint: string, query: string, refLat?: number, refLon?: number, maxDistance?: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (refLat !== undefined && refLon !== undefined) {
    params.set('lat', String(refLat));
    params.set('lon', String(refLon));
  }
  if (maxDistance !== undefined) {
    params.set('max_distance', String(maxDistance));
  }
  const res = await fetch(`${SEARCH_BASE}/${endpoint}?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export function apiSearchLocations(query: string, refLat?: number, refLon?: number, maxDistance?: number): Promise<SearchResult[]> {
  return searchWithLocation('locations', query, refLat, refLon, maxDistance);
}

export function apiSearchRestaurants(query: string, refLat?: number, refLon?: number, maxDistance?: number): Promise<SearchResult[]> {
  return searchWithLocation('restaurants', query, refLat, refLon, maxDistance);
}

export async function apiGeocode(query: string): Promise<{ lat: string; lon: string; label: string } | null> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${SEARCH_BASE}/geocode?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function apiSearchMovies(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${SEARCH_BASE}/movies?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export async function apiSearchVideoGames(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${SEARCH_BASE}/video-games?${params}`);
  if (!res.ok) return [];
  return res.json();
}

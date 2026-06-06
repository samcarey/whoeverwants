import { getApiEndpoint } from "./_internal";

const SHOWTIMES_BASE = getApiEndpoint("showtimes");

export interface ShowtimeSession {
  key: string; // "YYYY-MM-DD HH:MM-HH:MM" — the poll option key
  session_id: string;
  cinema_id: string;
  cinema_name: string;
  cinema_slug: string;
  date: string; // "2026-06-20"
  time: string; // "19:10"
  datetime: string; // local ISO
  format: string;
  seats_left: number | null;
  sales_url: string | null;
}

export interface ShowtimeFilm {
  film_id: string;
  name: string;
  year: string | null;
  rating: string | null;
  runtime: number | null;
  poster_url: string | null;
  sessions: ShowtimeSession[];
}

export interface ShowtimeCinema {
  cinema_id: string;
  name: string;
  slug: string;
  distance_miles: number;
  has_sessions: boolean;
}

export interface ShowtimesNearbyResponse {
  reference: { lat: number; lng: number; radius_miles: number; label: string | null };
  horizon_days: number;
  cinemas: ShowtimeCinema[];
  films: ShowtimeFilm[];
}

/** Load the whole normalized Alamo showtime catalog for a radius + horizon in
 *  one shot. The FE caches the result in component state and does movie-filter,
 *  calendar `allowedDays`, and per-day curation entirely client-side.
 *  Identity-free (no X-Browser-Id) like /preview. */
export async function apiShowtimesNearby(
  lat: number,
  lng: number,
  radius: number,
  days: number = 21,
  label?: string | null,
): Promise<ShowtimesNearbyResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius: String(radius),
    days: String(days),
  });
  if (label) params.set("label", label);
  const res = await fetch(`${SHOWTIMES_BASE}/nearby?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to load showtimes (${res.status})`);
  }
  return res.json();
}

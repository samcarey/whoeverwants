"use client";

import { useEffect, useMemo, useState } from "react";
import ReferenceLocationInput from "@/components/ReferenceLocationInput";
import DaysSelector from "@/components/DaysSelector";
import ShowtimeBubbles, { ShowtimeSlot } from "@/components/ShowtimeBubbles";
import {
  apiShowtimesNearby,
  ShowtimesNearbyResponse,
  ShowtimeFilm,
  ShowtimeSession,
} from "@/lib/api/showtimes";
import type { OptionsMetadata } from "@/lib/types";

export interface ShowtimeCurated {
  options: string[];
  optionsMetadata: OptionsMetadata;
  filmName: string;
  filmId: string | null;
}

interface Props {
  refLatitude?: number;
  refLongitude?: number;
  refLocationLabel: string;
  onLocationChange: (lat: number | undefined, lng: number | undefined, label: string) => void;
  searchRadius: number;
  onSearchRadiusChange: (r: number) => void;
  selectedKeys: string[];
  onChange: (curated: ShowtimeCurated) => void;
  isLoading?: boolean;
}

const HORIZON_DAYS = 21;

export default function ShowtimeCreateFlow({
  refLatitude,
  refLongitude,
  refLocationLabel,
  onLocationChange,
  searchRadius,
  onSearchRadiusChange,
  selectedKeys,
  onChange,
  isLoading,
}: Props) {
  const [catalog, setCatalog] = useState<ShowtimesNearbyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which theaters the creator has chosen to search within.
  const [selectedCinemas, setSelectedCinemas] = useState<Set<string>>(new Set());
  const [filmFilter, setFilmFilter] = useState("");
  const [selectedFilmId, setSelectedFilmId] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [curated, setCurated] = useState<Set<string>>(new Set(selectedKeys));

  const hasLocation = refLatitude !== undefined && refLongitude !== undefined;

  const loadShowtimes = async () => {
    if (!hasLocation) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiShowtimesNearby(
        refLatitude!,
        refLongitude!,
        searchRadius,
        HORIZON_DAYS,
        refLocationLabel || null,
      );
      setCatalog(res);
      // Reset downstream selections — they refer to the previous load.
      setSelectedCinemas(new Set());
      setSelectedFilmId(null);
      setSelectedDays([]);
      setCurated(new Set());
      if (res.films.length === 0) {
        setError("No Alamo showtimes found near here. Try a wider radius.");
      }
    } catch {
      setError("Couldn't load showtimes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Theaters with showtimes in the horizon, nearest first.
  const theaters = useMemo(
    () => (catalog?.cinemas ?? []).filter((c) => c.has_sessions),
    [catalog],
  );

  // Films that play at ≥1 selected theater.
  const availableFilms = useMemo(() => {
    if (!catalog || selectedCinemas.size === 0) return [];
    return catalog.films.filter((f) => f.sessions.some((s) => selectedCinemas.has(s.cinema_id)));
  }, [catalog, selectedCinemas]);

  const selectedFilm: ShowtimeFilm | null = useMemo(
    () => availableFilms.find((f) => f.film_id === selectedFilmId) ?? null,
    [availableFilms, selectedFilmId],
  );

  // The picked film's sessions, restricted to the selected theaters.
  const filmSessions: ShowtimeSession[] = useMemo(
    () => (selectedFilm?.sessions ?? []).filter((s) => selectedCinemas.has(s.cinema_id)),
    [selectedFilm, selectedCinemas],
  );

  const sessionByKey = useMemo(() => {
    const m = new Map<string, ShowtimeSession>();
    for (const s of filmSessions) m.set(s.key, s);
    return m;
  }, [filmSessions]);

  const allowedDays = useMemo(
    () => Array.from(new Set(filmSessions.map((s) => s.date))).sort(),
    [filmSessions],
  );

  // Push the curated selection (restricted to still-valid sessions) up to the
  // page draft whenever it, the film, or the theater selection changes.
  useEffect(() => {
    if (!selectedFilm) return;
    const keys = Array.from(curated).filter((k) => sessionByKey.has(k)).sort();
    const metadata: OptionsMetadata = {};
    for (const key of keys) {
      const s = sessionByKey.get(key)!;
      metadata[key] = {
        session_id: s.session_id,
        film_id: selectedFilm.film_id,
        film_name: selectedFilm.name,
        poster_url: selectedFilm.poster_url ?? undefined,
        cinema_id: s.cinema_id,
        cinema_name: s.cinema_name,
        cinema_slug: s.cinema_slug,
        format: s.format,
        seats_left: s.seats_left ?? undefined,
        sales_url: s.sales_url ?? undefined,
        datetime: s.datetime,
        runtime: selectedFilm.runtime ?? undefined,
      } as Record<string, unknown>;
    }
    onChange({ options: keys, optionsMetadata: metadata, filmName: selectedFilm.name, filmId: selectedFilm.film_id });
    // onChange is stable from the page; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curated, selectedFilm, sessionByKey]);

  const filteredFilms = useMemo(() => {
    const q = filmFilter.trim().toLowerCase();
    if (!q) return availableFilms;
    return availableFilms.filter((f) => f.name.toLowerCase().includes(q));
  }, [availableFilms, filmFilter]);

  function toggleCinema(cinemaId: string) {
    setSelectedCinemas((prev) => {
      const next = new Set(prev);
      if (next.has(cinemaId)) next.delete(cinemaId);
      else next.add(cinemaId);
      return next;
    });
    // A theater change can invalidate the picked film / curation; let the
    // memos + write-back effect reconcile (curated keys at dropped theaters are
    // filtered out by sessionByKey automatically).
  }

  function pickFilm(f: ShowtimeFilm) {
    setSelectedFilmId(f.film_id);
    setSelectedDays([]);
    setCurated(new Set());
  }

  function toggleCurate(key: string, selected: boolean) {
    setCurated((prev) => {
      const next = new Set(prev);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="space-y-3 pt-2 pb-4">
      <div>
        <ReferenceLocationInput
          latitude={refLatitude}
          longitude={refLongitude}
          label={refLocationLabel}
          onLocationChange={onLocationChange}
          searchRadius={searchRadius}
          onSearchRadiusChange={onSearchRadiusChange}
          disabled={isLoading}
        />
        {!hasLocation && (
          <p className="mt-2 text-sm text-orange-600 dark:text-orange-400">
            Pick a location to find nearby movie theaters.
          </p>
        )}
      </div>

      {hasLocation && !catalog && (
        <button
          type="button"
          onClick={loadShowtimes}
          disabled={loading || isLoading}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-base font-medium text-white hover:bg-blue-700 active:scale-95 disabled:opacity-50"
        >
          {loading ? `Finding theaters near ${refLocationLabel || "you"}…` : "Find theaters"}
        </button>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Step 2: theater selection. */}
      {catalog && theaters.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[15px] font-medium text-gray-500 dark:text-gray-400">
            Theaters to include
          </p>
          <div className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
            {theaters.map((c) => {
              const checked = selectedCinemas.has(c.cinema_id);
              return (
                <button
                  key={c.cinema_id}
                  type="button"
                  onClick={() => toggleCinema(c.cinema_id)}
                  disabled={isLoading}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:scale-[0.99]"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      checked
                        ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {checked && (
                      <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base">{c.name}</span>
                  <span className="shrink-0 text-sm font-medium text-blue-600 dark:text-blue-400">
                    {c.distance_miles} mi
                  </span>
                </button>
              );
            })}
          </div>
          {selectedCinemas.size === 0 && (
            <p className="px-1 text-sm text-orange-600 dark:text-orange-400">
              Select at least one theater to search for movies.
            </p>
          )}
        </div>
      )}

      {/* Step 3: movie picker (only once ≥1 theater is selected and no film picked). */}
      {catalog && selectedCinemas.size > 0 && !selectedFilm && (
        <div className="space-y-2">
          <input
            type="text"
            value={filmFilter}
            onChange={(e) => setFilmFilter(e.target.value)}
            placeholder="Search movies…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-base focus:outline-none"
          />
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
            {filteredFilms.map((f) => {
              const count = f.sessions.filter((s) => selectedCinemas.has(s.cinema_id)).length;
              return (
                <button
                  key={f.film_id}
                  type="button"
                  onClick={() => pickFilm(f)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 active:scale-[0.99]"
                >
                  {f.poster_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.poster_url} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-gray-200 dark:bg-gray-600 text-lg">🎬</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium">{f.name}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {count} showtime{count === 1 ? "" : "s"}
                      {f.runtime ? ` · ${f.runtime} min` : ""}
                      {f.rating ? ` · ${f.rating}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {filteredFilms.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No movies match.</p>
            )}
          </div>
        </div>
      )}

      {/* Step 4: calendar + per-day curation (sessions limited to selected theaters). */}
      {selectedFilm && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {selectedFilm.poster_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedFilm.poster_url} alt="" className="h-12 w-8 rounded object-cover" />
            )}
            <span className="flex-1 truncate text-base font-semibold">{selectedFilm.name}</span>
            <button
              type="button"
              onClick={() => {
                setSelectedFilmId(null);
                setSelectedDays([]);
                setCurated(new Set());
              }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Change movie
            </button>
          </div>

          <div>
            <p className="mb-1 px-1 text-[15px] font-medium text-gray-500 dark:text-gray-400">
              Pick days with showtimes
            </p>
            <DaysSelector
              selectedDays={selectedDays}
              onChange={setSelectedDays}
              allowedDays={allowedDays}
              inline
              compact
              currentMonth={calendarMonth}
              disabled={isLoading}
            />
          </div>

          {[...selectedDays].sort().map((day) => {
            const daySlots: ShowtimeSlot[] = filmSessions
              .filter((s) => s.date === day)
              .map((s) => ({
                key: s.key,
                time: s.time,
                cinema_name: s.cinema_name,
                format: s.format,
                seats_left: s.seats_left,
              }));
            return (
              <div key={day}>
                <ShowtimeBubbles
                  mode="curate"
                  slots={daySlots}
                  selectedKeys={Array.from(curated)}
                  onToggle={toggleCurate}
                  disabled={isLoading}
                />
              </div>
            );
          })}

          {selectedDays.length > 0 && curated.size === 0 && (
            <p className="text-center text-sm text-orange-600 dark:text-orange-400">
              Tap the showtimes you&apos;d offer to vote on.
            </p>
          )}
          {curated.size > 0 && (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              {curated.size} showtime{curated.size === 1 ? "" : "s"} selected
            </p>
          )}
        </div>
      )}
    </div>
  );
}

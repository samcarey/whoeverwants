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

  // Auto-search once a reference location + radius are set (and whenever either
  // changes). Debounced so a location+radius landing together fires one request.
  useEffect(() => {
    if (!hasLocation) return;
    const t = setTimeout(() => {
      loadShowtimes();
    }, 400);
    return () => clearTimeout(t);
    // loadShowtimes reads the latest lat/lng/radius from its closure; re-run on input changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refLatitude, refLongitude, searchRadius]);

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

  // cinema_id -> distance from the creator's reference location, so curated
  // slots (and the persisted metadata) carry distance into the ballot legend.
  const distanceByCinema = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of catalog?.cinemas ?? []) m.set(c.cinema_id, c.distance_miles);
    return m;
  }, [catalog]);

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
        distance_miles: distanceByCinema.get(s.cinema_id) ?? undefined,
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
    <div className="space-y-3 pt-2 pb-[0.9rem]">
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

      {hasLocation && loading && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          Finding theaters near {refLocationLabel || "you"}…
        </p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Step 2: theater selection. */}
      {catalog && theaters.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[15px] font-medium text-gray-500 dark:text-gray-400">
            Theaters to include
          </p>
          <div className="flex flex-wrap justify-center gap-[6.4px]">
            {theaters.map((c) => {
              const checked = selectedCinemas.has(c.cinema_id);
              return (
                <button
                  key={c.cinema_id}
                  type="button"
                  onClick={() => toggleCinema(c.cinema_id)}
                  disabled={isLoading}
                  className={`max-w-full rounded-[20.4px] border px-[7.2px] py-0.5 text-left active:scale-[0.98] ${
                    checked
                      ? "border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/30"
                      : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
                  }`}
                >
                  <div className="whitespace-nowrap text-[12.8px] font-medium leading-tight">
                    {c.name}
                  </div>
                  <div className="mt-px flex w-0 min-w-full items-baseline gap-1.5 text-xs leading-tight">
                    <span className="shrink-0 font-medium text-blue-600 dark:text-blue-400">
                      {c.distance_miles} mi
                    </span>
                    {c.address && (
                      <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">
                        {c.address}
                      </span>
                    )}
                  </div>
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

          {selectedDays.length > 0 && (() => {
            // One combined ShowtimeBubbles across every selected day (it groups
            // by day internally) so the location legend + colors are computed
            // once over the full set, not redrawn / reassigned per day.
            const daySet = new Set(selectedDays);
            const curateSlots: ShowtimeSlot[] = filmSessions
              .filter((s) => daySet.has(s.date))
              .sort((a, b) => a.key.localeCompare(b.key))
              .map((s) => ({
                key: s.key,
                time: s.time,
                cinema_name: s.cinema_name,
                format: s.format,
                seats_left: s.seats_left,
                distance_miles: distanceByCinema.get(s.cinema_id) ?? null,
              }));
            return (
              <ShowtimeBubbles
                mode="curate"
                slots={curateSlots}
                selectedKeys={Array.from(curated)}
                onToggle={toggleCurate}
                disabled={isLoading}
              />
            );
          })()}

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

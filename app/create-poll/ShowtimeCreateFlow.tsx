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
  // Pre-existing curated keys (e.g. restored from a draft) so the flow can
  // re-highlight them once the catalog reloads.
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
  const [filmFilter, setFilmFilter] = useState("");
  const [selectedFilmId, setSelectedFilmId] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  // Curated showtime keys (across all selected days), as a stable Set.
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
      if (res.films.length === 0) {
        setError("No Alamo showtimes found near here. Try a wider radius.");
      }
    } catch {
      setError("Couldn't load showtimes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const selectedFilm: ShowtimeFilm | null = useMemo(
    () => catalog?.films.find((f) => f.film_id === selectedFilmId) ?? null,
    [catalog, selectedFilmId],
  );

  // Sessions for the picked film, keyed for fast lookup.
  const sessionByKey = useMemo(() => {
    const m = new Map<string, ShowtimeSession>();
    for (const s of selectedFilm?.sessions ?? []) m.set(s.key, s);
    return m;
  }, [selectedFilm]);

  const allowedDays = useMemo(
    () => Array.from(new Set((selectedFilm?.sessions ?? []).map((s) => s.date))).sort(),
    [selectedFilm],
  );

  // Push the curated selection back up to the page draft whenever it (or the
  // film) changes.
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
    // onChange is stable enough from the page; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curated, selectedFilm, sessionByKey]);

  const filteredFilms = useMemo(() => {
    const q = filmFilter.trim().toLowerCase();
    const films = catalog?.films ?? [];
    if (!q) return films;
    return films.filter((f) => f.name.toLowerCase().includes(q));
  }, [catalog, filmFilter]);

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

  // ---- Render ----

  // Step 1: location gate.
  return (
    <div className="space-y-3 pt-2">
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
            Pick a location to find nearby movie showtimes.
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
          {loading ? `Loading showtimes near ${refLocationLabel || "you"}…` : "Load showtimes"}
        </button>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Step 2: movie picker (only before a film is chosen). */}
      {catalog && !selectedFilm && (
        <div className="space-y-2">
          <input
            type="text"
            value={filmFilter}
            onChange={(e) => setFilmFilter(e.target.value)}
            placeholder="Search movies…"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-base focus:outline-none"
          />
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
            {filteredFilms.map((f) => (
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
                    {f.sessions.length} showtime{f.sessions.length === 1 ? "" : "s"}
                    {f.runtime ? ` · ${f.runtime} min` : ""}
                    {f.rating ? ` · ${f.rating}` : ""}
                  </span>
                </span>
              </button>
            ))}
            {filteredFilms.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">No movies match.</p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: calendar (days with sessions for the picked film). */}
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

          {/* Step 4: per-day curation. */}
          {selectedDays.sort().map((day) => {
            const daySlots: ShowtimeSlot[] = (selectedFilm.sessions ?? [])
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

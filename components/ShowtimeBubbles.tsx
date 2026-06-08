"use client";

import { useMemo } from "react";
import { formatDayLabel, groupSlotsByDay, parseSlotStart, periodColorClass } from "@/lib/timeUtils";
import type { OptionsMetadata } from "@/lib/types";

/**
 * Per-day flex-wrap of concrete movie showtimes. Deliberately NOT routed
 * through TimeSlotBubbles' 15-minute grid (`expandHourRowsToQuarters` snaps
 * to :00/:15/:30/:45; real showtimes are arbitrary-minute). Each bubble shows
 * the time + a format/cinema tag + seats.
 *
 * Two modes share the same layout:
 *  - `curate` (creator): 2-state include/exclude. Selected = green (viable),
 *    unselected = neutral (excluded). Tap toggles.
 *  - `vote` (ballot): 3-state want / neutral / can't-attend. Tap cycles
 *    neutral → want(green) → can't(red) → neutral, mirroring the time
 *    preference ballot where red = "can't attend".
 *
 * `disabled` renders read-only (results / submitted-summary).
 */

export interface ShowtimeSlot {
  key: string; // "YYYY-MM-DD HH:MM-HH:MM"
  time: string; // "19:10"
  cinema_name?: string | null;
  format?: string | null;
  seats_left?: number | null;
  distance_miles?: number | null; // from the creator's reference location
}

/** Per-cinema colors so each theater reads as one color across the bubble grid
 *  + the top legend. Deliberately avoids orange/purple (reserved for the AM/PM
 *  period tint) so the two color systems don't get confused. */
const LOCATION_COLORS: { text: string; dot: string }[] = [
  { text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  { text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  { text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
  { text: "text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500" },
  { text: "text-pink-600 dark:text-pink-400", dot: "bg-pink-500" },
  { text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500" },
  { text: "text-indigo-600 dark:text-indigo-400", dot: "bg-indigo-500" },
  { text: "text-lime-600 dark:text-lime-400", dot: "bg-lime-500" },
];

const NEUTRAL_LOCATION_COLOR = {
  text: "text-gray-500 dark:text-gray-400",
  dot: "bg-gray-400 dark:bg-gray-500",
};

interface LocationInfo {
  name: string; // "Alamo "-stripped display name
  distance: number | null;
  color: { text: string; dot: string };
}

/** Strip the "Alamo " prefix used everywhere a cinema name is displayed. */
function cinemaShortName(name: string | null | undefined): string | null {
  return name ? name.replace(/^Alamo /, "") : null;
}

/** Assign a stable color (+ keep the distance) to each distinct cinema in the
 *  slot set, ordered nearest-first so the legend reads top-down by proximity.
 *  Keyed on the stripped display name so the bubble + legend agree. */
function buildLocationMap(slots: ShowtimeSlot[]): Map<string, LocationInfo> {
  const seen = new Map<string, { distance: number | null }>();
  for (const s of slots) {
    const name = cinemaShortName(s.cinema_name);
    if (!name) continue;
    const dist = typeof s.distance_miles === "number" ? s.distance_miles : null;
    const prev = seen.get(name);
    if (!prev) seen.set(name, { distance: dist });
    else if (prev.distance == null && dist != null) prev.distance = dist;
  }
  const ordered = Array.from(seen.entries()).sort((a, b) => {
    const da = a[1].distance,
      db = b[1].distance;
    if (da == null && db == null) return a[0].localeCompare(b[0]);
    if (da == null) return 1;
    if (db == null) return -1;
    if (da !== db) return da - db;
    return a[0].localeCompare(b[0]);
  });
  const map = new Map<string, LocationInfo>();
  ordered.forEach(([name, { distance }], i) => {
    map.set(name, {
      name,
      distance,
      color: LOCATION_COLORS[i % LOCATION_COLORS.length],
    });
  });
  return map;
}

/** Build the bubble slot list from a poll's option keys + their metadata.
 *  Shared by the ballot section and the results view (both render bubbles from
 *  question.options + question.options_metadata). The create flow builds slots
 *  from raw catalog sessions instead, so it doesn't use this. */
export function slotsFromOptions(
  options: string[] | undefined,
  meta: OptionsMetadata | null | undefined,
): ShowtimeSlot[] {
  return (options ?? []).map((key) => {
    const m = (meta?.[key] ?? {}) as Record<string, unknown>;
    const { h, m: mm } = parseSlotStart(key);
    return {
      key,
      time: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      cinema_name: (m.cinema_name as string) ?? null,
      format: (m.format as string) ?? null,
      seats_left: typeof m.seats_left === "number" ? (m.seats_left as number) : null,
      distance_miles:
        typeof m.distance_miles === "number" ? (m.distance_miles as number) : null,
    };
  });
}

interface CurateProps {
  mode: "curate";
  slots: ShowtimeSlot[];
  selectedKeys: string[];
  onToggle: (key: string, selected: boolean) => void;
  disabled?: boolean;
}

interface VoteProps {
  mode: "vote";
  slots: ShowtimeSlot[];
  likedKeys: string[];
  dislikedKeys: string[];
  onToggle: (key: string, next: "want" | "neutral" | "cant") => void;
  disabled?: boolean;
}

type Props = CurateProps | VoteProps;

/** Split "19:10" into the 12h "7:10" part + its AM/PM period, so the period
 *  can be tinted with the app-wide orange(AM)/purple(PM) convention. */
function fmt12Parts(time: string): { hm: string; period: "AM" | "PM" } {
  const [hStr, m] = time.split(":");
  let h = parseInt(hStr, 10);
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return { hm: `${h}:${m}`, period };
}

export default function ShowtimeBubbles(props: Props) {
  const { slots, disabled } = props;
  const byKey = useMemo(() => {
    const m = new Map<string, ShowtimeSlot>();
    for (const s of slots) m.set(s.key, s);
    return m;
  }, [slots]);

  const days = useMemo(
    () => groupSlotsByDay(slots.map((s) => s.key)),
    [slots],
  );

  const likedSet = props.mode === "vote" ? new Set(props.likedKeys) : null;
  const dislikedSet = props.mode === "vote" ? new Set(props.dislikedKeys) : null;
  const selectedSet = props.mode === "curate" ? new Set(props.selectedKeys) : null;

  function bubbleState(key: string): "on" | "neutral" | "off" {
    if (props.mode === "curate") return selectedSet!.has(key) ? "on" : "neutral";
    if (likedSet!.has(key)) return "on";
    if (dislikedSet!.has(key)) return "off";
    return "neutral";
  }

  function handleTap(key: string) {
    if (disabled) return;
    if (props.mode === "curate") {
      props.onToggle(key, !selectedSet!.has(key));
      return;
    }
    const state = bubbleState(key);
    const next = state === "neutral" ? "want" : state === "on" ? "cant" : "neutral";
    props.onToggle(key, next);
  }

  // State is conveyed by border + background only (mirroring the theater
  // suggestion pills), so the AM/PM tint + the muted secondary line stay
  // consistent across want/neutral/can't — exactly how the time-slot bubbles
  // keep the period column orange/purple regardless of like/dislike state.
  const classFor = (state: "on" | "neutral" | "off") => {
    if (state === "on")
      return "border-green-500 bg-green-50 dark:border-green-500 dark:bg-green-900/30";
    if (state === "off")
      return "border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-900/30";
    return "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800";
  };

  const locationMap = useMemo(() => buildLocationMap(slots), [slots]);

  return (
    <div className="space-y-2">
      {/* Top legend: each theater's color + distance from the creator's
          reference location, ordered nearest-first. */}
      {locationMap.size > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {Array.from(locationMap.values()).map((loc) => (
            <span key={loc.name} className="flex items-center gap-1">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${loc.color.dot}`} />
              <span className={`font-medium ${loc.color.text}`}>{loc.name}</span>
              {loc.distance != null && <span>{loc.distance} mi</span>}
            </span>
          ))}
        </div>
      )}
      {days.map(([date, keys]) => (
        <div key={date} className="flex gap-3">
          <div className="w-14 shrink-0 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400 leading-tight">
            {formatDayLabel(date)}
          </div>
          <div className="flex flex-1 flex-wrap gap-[6.4px]">
            {keys.map((key, idx) => {
              const slot = byKey.get(key);
              if (!slot) return null;
              const state = bubbleState(key);
              const { hm, period } = fmt12Parts(slot.time);
              const cinema = cinemaShortName(slot.cinema_name);
              const locColor =
                (cinema && locationMap.get(cinema)?.color) || NEUTRAL_LOCATION_COLOR;
              const seats =
                typeof slot.seats_left === "number" && slot.seats_left >= 0
                  ? `${slot.seats_left} left`
                  : null;
              return (
                <button
                  // Defense-in-depth: the server guarantees unique keys per
                  // film, but include the index so a stray duplicate (stale
                  // cached catalog, future data source) can't hard-crash React.
                  key={`${key}#${idx}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleTap(key)}
                  className={`max-w-full rounded-[20.4px] border px-[10.8px] py-0.5 text-left transition-colors ${classFor(state)} ${disabled ? "cursor-default" : "active:scale-[0.98]"}`}
                >
                  <div className="whitespace-nowrap text-[12.8px] font-semibold leading-tight tabular-nums text-gray-900 dark:text-gray-100">
                    {hm} <span className={periodColorClass(period)}>{period}</span>
                    {slot.format && (
                      <span className="ml-1 text-[11px] font-normal text-gray-500 dark:text-gray-400">
                        {slot.format}
                      </span>
                    )}
                  </div>
                  {(cinema || seats) && (
                    <div className="mt-px whitespace-nowrap text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                      {cinema && (
                        <span className={`font-medium ${locColor.text}`}>{cinema}</span>
                      )}
                      {cinema && seats && " · "}
                      {seats}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {props.mode === "vote" && (
        <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border border-green-500 bg-green-50 dark:bg-green-900/30" /> Want
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border border-red-500 bg-red-50 dark:bg-red-900/30" /> Can&apos;t attend
          </span>
        </div>
      )}
    </div>
  );
}

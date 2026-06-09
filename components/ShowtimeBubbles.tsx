"use client";

import { useMemo, useRef, useState } from "react";
import { formatDayLabel, groupSlotsByDay, parseSlotStart, periodColorClass } from "@/lib/timeUtils";
import { haptic } from "@/lib/haptics";
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
  cinema_id?: string | null;
  cinema_name?: string | null;
  format?: string | null;
  seats_left?: number | null;
  distance_miles?: number | null; // from the creator's reference location
  // Per-cinema movie showpage on drafthouse.com (theater + movie — NOT a
  // session deep link; those 404 once a session expires). Long-pressing a
  // bubble opens it so the user buys at the authoritative source — live price
  // + seat map live only in Alamo's checkout flow.
  sales_url?: string | null;
}

/** Per-cinema colors so each theater reads as one color across the bubble grid
 *  + the top legend. Ordered so the early entries (the typical 2–4 theaters)
 *  steer clear of the green "want" / red "can't" state borders and the
 *  orange(AM)/purple(PM) period tint — keeping the three color systems
 *  (state / time-of-day / location) visually distinct. */
const LOCATION_COLORS: { text: string; dot: string }[] = [
  { text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  { text: "text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500" },
  { text: "text-pink-600 dark:text-pink-400", dot: "bg-pink-500" },
  { text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500" },
  { text: "text-indigo-600 dark:text-indigo-400", dot: "bg-indigo-500" },
  { text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
  { text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
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

/** Stable per-theater key for the color/distance map: the cinema_id (canonical,
 *  survives renames + disambiguates same-named theaters), falling back to the
 *  display name for any slot missing an id. */
function cinemaKeyOf(slot: ShowtimeSlot): string | null {
  return slot.cinema_id || cinemaShortName(slot.cinema_name);
}

/** Assign a stable color (+ keep the distance + display name) to each distinct
 *  cinema in the slot set, keyed on cinema_id and ordered nearest-first so the
 *  legend reads top-down by proximity. */
function buildLocationMap(slots: ShowtimeSlot[]): Map<string, LocationInfo> {
  const seen = new Map<string, { name: string; distance: number | null }>();
  for (const s of slots) {
    const key = cinemaKeyOf(s);
    const name = cinemaShortName(s.cinema_name);
    if (!key || !name) continue;
    const dist = typeof s.distance_miles === "number" ? s.distance_miles : null;
    const prev = seen.get(key);
    if (!prev) seen.set(key, { name, distance: dist });
    else if (prev.distance == null && dist != null) prev.distance = dist;
  }
  const ordered = Array.from(seen.entries()).sort((a, b) => {
    const da = a[1].distance,
      db = b[1].distance;
    if (da == null && db == null) return a[1].name.localeCompare(b[1].name);
    if (da == null) return 1;
    if (db == null) return -1;
    if (da !== db) return da - db;
    return a[1].name.localeCompare(b[1].name);
  });
  const map = new Map<string, LocationInfo>();
  ordered.forEach(([key, { name, distance }], i) => {
    map.set(key, {
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
      cinema_id: (m.cinema_id as string) ?? null,
      cinema_name: (m.cinema_name as string) ?? null,
      format: (m.format as string) ?? null,
      seats_left: typeof m.seats_left === "number" ? (m.seats_left as number) : null,
      distance_miles:
        typeof m.distance_miles === "number" ? (m.distance_miles as number) : null,
      sales_url: typeof m.sales_url === "string" ? (m.sales_url as string) : null,
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

// State is conveyed by border + background only (mirroring the theater
// suggestion pills), so the AM/PM tint + the muted secondary line stay
// consistent across want/neutral/can't — exactly how the time-slot bubbles
// keep the period column orange/purple regardless of like/dislike state.
function classFor(state: "on" | "neutral" | "off"): string {
  if (state === "on")
    return "border-green-500 bg-green-50 dark:border-green-500 dark:bg-green-900/30";
  if (state === "off")
    return "border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-900/30";
  return "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800";
}

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX2 = 100; // (10px)^2

/**
 * One showtime bubble. Tap toggles its vote/curate state (when not `disabled`);
 * press-and-hold opens the showtime's Alamo ticketing page — works in EVERY
 * mode (curate / vote / disabled results), since buying tickets is orthogonal
 * to whether the ballot is still editable. We deliberately do NOT set the
 * `disabled` HTML attribute (a disabled <button> swallows pointer events, which
 * would kill the long-press on results bubbles); the toggle is gated in
 * `handleClick`.
 *
 * The link opens in `pointerup` (the real user gesture), NOT from the arm
 * timer: `window.open(_blank)` fired from a setTimeout has no transient user
 * activation, so the popup blocker (notably iOS Safari) silently drops it. The
 * timer only ARMS the gesture (ring + haptic at the hold threshold) so the user
 * knows they can release to buy; the open happens synchronously on release,
 * which preserves activation. A >10px move cancels (it's a scroll).
 */
function ShowtimeBubbleButton({
  slot,
  state,
  disabled,
  locColorText,
  onTap,
}: {
  slot: ShowtimeSlot;
  state: "on" | "neutral" | "off";
  disabled?: boolean;
  locColorText: string;
  onTap: () => void;
}) {
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef(false); // hold passed the threshold → release opens
  const openedRef = useRef(false); // a long-press just opened → swallow the click
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const ticketable = !!slot.sales_url;

  const clearArm = () => {
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    armedRef.current = false;
    startRef.current = null;
    setArmed(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ticketable) return;
    openedRef.current = false;
    armedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null;
      armedRef.current = true;
      setArmed(true);
      haptic.light(); // "release to buy tickets"
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX2) clearArm(); // treat as a scroll
  };

  const onPointerUp = () => {
    const url = slot.sales_url;
    if (armedRef.current && url) {
      openedRef.current = true;
      haptic.medium();
      // Synchronous, inside the pointerup gesture → preserves user activation.
      // Sandboxed iframes (the Claude preview pane) + some webviews still block
      // _blank popups (window.open returns null) — fall back to same-tab nav so
      // the link always activates.
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) window.location.href = url;
    }
    clearArm();
  };

  const handleClick = () => {
    if (openedRef.current) {
      openedRef.current = false;
      return; // long-press just opened tickets; don't also toggle
    }
    if (!disabled) onTap();
  };

  const { hm, period } = fmt12Parts(slot.time);
  const cinema = cinemaShortName(slot.cinema_name);
  const seats =
    typeof slot.seats_left === "number" && slot.seats_left >= 0
      ? `${slot.seats_left} left`
      : null;

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={clearArm}
      onPointerCancel={clearArm}
      onContextMenu={(e) => e.preventDefault()}
      onClick={handleClick}
      // select-none + touch-callout:none stop iOS from selecting the showtime
      // text / popping the copy-callout magnifier during a press-and-hold.
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
      className={`max-w-full select-none rounded-[20.4px] border px-[10.8px] py-0.5 text-left transition-colors ${classFor(state)} ${armed ? "ring-2 ring-blue-400 dark:ring-blue-500" : ""} ${disabled ? "cursor-default" : "active:scale-[0.98]"}`}
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
          {cinema && <span className={`font-medium ${locColorText}`}>{cinema}</span>}
          {cinema && seats && " · "}
          {seats}
        </div>
      )}
    </button>
  );
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

  const locationMap = useMemo(() => buildLocationMap(slots), [slots]);
  const anyTicketable = useMemo(() => slots.some((s) => !!s.sales_url), [slots]);

  return (
    <div className="space-y-2">
      {/* Top legend: each theater's color + distance from the creator's
          reference location, ordered nearest-first. */}
      {locationMap.size > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {Array.from(locationMap.entries()).map(([key, loc]) => (
            <span key={key} className="flex items-center gap-1">
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
              const cinemaKey = cinemaKeyOf(slot);
              const locColor =
                (cinemaKey && locationMap.get(cinemaKey)?.color) ||
                NEUTRAL_LOCATION_COLOR;
              return (
                <ShowtimeBubbleButton
                  // Defense-in-depth: the server guarantees unique keys per
                  // film, but include the index so a stray duplicate (stale
                  // cached catalog, future data source) can't hard-crash React.
                  key={`${key}#${idx}`}
                  slot={slot}
                  state={bubbleState(key)}
                  disabled={disabled}
                  locColorText={locColor.text}
                  onTap={() => handleTap(key)}
                />
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
      {anyTicketable && (
        <p className="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">
          Press &amp; hold a showtime to buy tickets
        </p>
      )}
    </div>
  );
}

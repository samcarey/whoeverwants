"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import ModalPortal from "@/components/ModalPortal";
import {
  formatDayLabel,
  groupSlotsByDay,
  parseSlotDate,
  parseSlotStart,
  periodColorClass,
} from "@/lib/timeUtils";
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
  address?: string | null; // hand-entered theater street address (one-line, truncated)
  // Per-cinema movie showpage on drafthouse.com (theater + movie — NOT a
  // session deep link; those 404 once a session expires). The link icon to the
  // left of each bubble opens it so the user buys at the authoritative source —
  // live price + seat map live only in Alamo's checkout flow.
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

/** The cinema's display name, kept verbatim (e.g. "Alamo Richardson"). The
 *  "Alamo " prefix is no longer stripped — the brand reads as part of the name,
 *  and one-row-per-showtime leaves room for the full name + address. */
function cinemaShortName(name: string | null | undefined): string | null {
  return name ? name.trim() : null;
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
      address: typeof m.address === "string" ? (m.address as string) : null,
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

/** External-link glyph (square with an arrow exiting diagonally). Marks the
 *  non-selectable ticket link sitting to the left of each showtime. */
function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

// Pointer travel (px) before a press is treated as a range-drag instead of a tap.
const DRAG_THRESHOLD = 8;
const withinTapThreshold = (x1: number, y1: number, x2: number, y2: number) =>
  Math.hypot(x2 - x1, y2 - y1) < DRAG_THRESHOLD;

/**
 * One full-width showtime row: a non-selectable ticket link (external-link
 * icon) on the LEFT, then a single-line toggle bubble holding the time (+ a
 * distinctive format), the theatre name + street address (truncated to fit the
 * line), and seats on the right. The theatre name is location-colored to match
 * the top legend. The link opens the showtime's Alamo ticketing page; it's a
 * plain <a> sibling of the toggle button, so tapping it never changes the
 * vote/curate selection. (Buying tickets is orthogonal to whether the ballot is
 * editable, so the link works in every mode — curate / vote / disabled.)
 *
 * The toggle bubble carries `data-slot` / `data-slot-available` + touch-action:
 * none + stopped touch propagation so a press-and-DRAG across rows lassoes a
 * range (mirroring the time-preference ballot) instead of selecting text /
 * scrolling / triggering the page swipe-back. A plain tap (no drag) cycles the
 * one bubble. select-none + touch-callout:none stop a long-press from selecting
 * the row text or popping iOS's copy magnifier.
 */
function ShowtimeBubbleButton({
  slot,
  state,
  disabled,
  locColorText,
  selected,
  onPointerDown,
  onKeyTap,
}: {
  slot: ShowtimeSlot;
  state: "on" | "neutral" | "off";
  disabled?: boolean;
  locColorText: string;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyTap: () => void;
}) {
  const stopTouch = (e: React.TouchEvent) => e.stopPropagation();
  const { hm, period } = fmt12Parts(slot.time);
  const cinema = cinemaShortName(slot.cinema_name);
  const address = slot.address?.trim() || null;
  // "Digital" is the default format — only distinctive formats (70mm, The Big
  // Show, …) earn a spot on the line.
  const format =
    slot.format && slot.format.toLowerCase() !== "digital" ? slot.format : null;
  const seats =
    typeof slot.seats_left === "number" && slot.seats_left >= 0
      ? `${slot.seats_left} left`
      : null;

  return (
    <div className="flex items-center gap-1.5">
      {slot.sales_url && (
        <a
          href={slot.sales_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Buy tickets"
          className="shrink-0 text-gray-400 transition-colors hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400"
        >
          <ExternalLinkIcon />
        </a>
      )}
      <button
        type="button"
        data-slot={slot.key}
        data-slot-available="true"
        draggable={false}
        onPointerDown={onPointerDown}
        onTouchStart={stopTouch}
        onTouchMove={stopTouch}
        onTouchEnd={stopTouch}
        onTouchCancel={stopTouch}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onKeyTap();
          }
        }}
        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
        className={`flex min-w-0 flex-1 select-none touch-none items-baseline gap-2 rounded-md border px-2 py-1 text-left text-sm leading-tight transition-colors ${classFor(state)} ${selected ? "ring-2 ring-blue-500" : ""} ${disabled ? "cursor-default" : "active:scale-[0.99]"}`}
      >
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{hm}</span>
          <span className={`font-semibold ${periodColorClass(period)}`}>{period}</span>
        </span>
        {(cinema || address) && (
          <span className="min-w-0 flex-1 truncate text-xs">
            {cinema && <span className={`font-medium ${locColorText}`}>{cinema}</span>}
            {cinema && address && (
              <span className="text-gray-400 dark:text-gray-500"> · </span>
            )}
            {address && (
              <span className="text-gray-500 dark:text-gray-400">{address}</span>
            )}
          </span>
        )}
        {format && (
          <span className="shrink-0 whitespace-nowrap text-xs font-normal text-gray-500 dark:text-gray-400">
            {format}
          </span>
        )}
        {seats && (
          <span className="shrink-0 whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
            {seats}
          </span>
        )}
      </button>
    </div>
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

  // Flat key list in render order (chronological, day-grouped) — drives the
  // range index so a lasso selects exactly the rows the finger passed over.
  const orderedKeys = useMemo(() => days.flatMap(([, keys]) => keys), [days]);
  const optionIndex = useMemo(() => {
    const m = new Map<string, number>();
    orderedKeys.forEach((k, i) => m.set(k, i));
    return m;
  }, [orderedKeys]);

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

  // ---- drag-to-select range + bulk-mark (mirrors TimeSlotBubbles) ----
  // Lassoed slot keys; cleared after applying a bulk mark or cancelling.
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  // Intersect with the live keys so a stale selection (a slot that vanished as
  // the curated set shifted) drops out instead of lingering.
  const effectiveSelection = useMemo(
    () => orderedKeys.filter((k) => selection.has(k)),
    [orderedKeys, selection],
  );
  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const gestureRef = useRef<{
    pointerId: number;
    anchor: string;
    startX: number;
    startY: number;
    moved: boolean;
    current: string;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Defensive teardown if the component unmounts mid-drag.
  useEffect(() => () => cleanupRef.current?.(), []);
  // Drop any selection if the ballot becomes read-only.
  useEffect(() => {
    if (disabled) clearSelection();
  }, [disabled, clearSelection]);

  // Tapping outside the bubbles + toolbar deselects; a DRAG outside leaves the
  // selection intact so the page can still scroll with one active. Capture phase
  // so a bubble's own stopPropagation can't hide the event.
  useEffect(() => {
    if (disabled || selection.size === 0) return;
    let start: { x: number; y: number; outside: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const inside = !!target?.closest?.(
        '[data-slot-available="true"],[data-slot-toolbar="true"]',
      );
      start = { x: e.clientX, y: e.clientY, outside: !inside };
    };
    const onUp = (e: PointerEvent) => {
      if (start?.outside && withinTapThreshold(start.x, start.y, e.clientX, e.clientY)) {
        clearSelection();
      }
      start = null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [disabled, selection.size, clearSelection]);

  const rangeBetween = useCallback(
    (a: string, b: string): string[] => {
      const ia = optionIndex.get(a);
      if (ia == null) return [];
      const anchorDate = parseSlotDate(a);
      const ib = optionIndex.get(b);
      if (ib == null) return [a];
      const lo = Math.min(ia, ib);
      const hi = Math.max(ia, ib);
      // Constrain to the anchor's day so the slice can't spill into adjacent days.
      return orderedKeys.slice(lo, hi + 1).filter((s) => parseSlotDate(s) === anchorDate);
    },
    [optionIndex, orderedKeys],
  );

  // Pointer-down on a bubble: maybe a tap, maybe a range-drag. The decision is
  // deferred to window move/up handlers so the finger can be tracked across
  // other rows (touch implicitly captures to the target, but pointer events
  // still bubble to window).
  const handleBubblePointerDown = (key: string, e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    setSelection((prev) => (prev.size === 0 ? prev : new Set()));
    gestureRef.current = {
      pointerId: e.pointerId,
      anchor: key,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      current: key,
    };
    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || ev.pointerId !== g.pointerId) return;
      if (!g.moved && withinTapThreshold(g.startX, g.startY, ev.clientX, ev.clientY)) return;
      g.moved = true;
      const target = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-slot-available="true"]');
      if (target?.dataset.slot) g.current = target.dataset.slot;
      setSelection(new Set(rangeBetween(g.anchor, g.current)));
    };
    const onUp = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (g && ev.pointerId === g.pointerId) {
        if (!g.moved) handleTap(g.anchor); // no drag → plain tap cycles the bubble
        gestureRef.current = null;
        cleanup();
      }
    };
    const onCancel = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (g && ev.pointerId === g.pointerId) {
        gestureRef.current = null;
        cleanup();
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      cleanupRef.current = null;
    };
    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const applyVote = (next: "want" | "cant" | "neutral") => {
    if (props.mode !== "vote") return;
    effectiveSelection.forEach((k) => props.onToggle(k, next));
    clearSelection();
  };
  const applyCurate = (selected: boolean) => {
    if (props.mode !== "curate") return;
    effectiveSelection.forEach((k) => props.onToggle(k, selected));
    clearSelection();
  };

  const locationMap = useMemo(() => buildLocationMap(slots), [slots]);
  const anyTicketable = useMemo(() => slots.some((s) => !!s.sales_url), [slots]);

  const toolbarBtn =
    "h-10 px-4 rounded-full text-sm font-semibold transition-transform active:scale-95";

  return (
    <div className="space-y-2.5">
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
        <div key={date} className="flex gap-2.5">
          <div className="w-14 shrink-0 pt-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 leading-tight">
            {formatDayLabel(date)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
                  selected={selection.has(key)}
                  onPointerDown={(e) => handleBubblePointerDown(key, e)}
                  onKeyTap={() => handleTap(key)}
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
          Tap the link icon beside a showtime to buy tickets, or drag across rows
          to mark several at once
        </p>
      )}

      {/* Range-selection toolbar — fixed to the viewport (via portal) so it
          never reflows the page. Appears while a drag-selection is active. */}
      {!disabled && effectiveSelection.length > 0 && (
        <ModalPortal>
          <div
            data-slot-toolbar="true"
            className="fixed left-1/2 -translate-x-1/2 z-50 animate-slide-up"
            style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 shadow-xl">
              {props.mode === "vote" ? (
                <>
                  <button
                    type="button"
                    onClick={() => applyVote("want")}
                    className={`${toolbarBtn} bg-green-500 hover:bg-green-600 text-white`}
                  >
                    Want
                  </button>
                  <button
                    type="button"
                    onClick={() => applyVote("cant")}
                    className={`${toolbarBtn} bg-red-500 hover:bg-red-600 text-white`}
                  >
                    Can&apos;t
                  </button>
                  <button
                    type="button"
                    onClick={() => applyVote("neutral")}
                    className={`${toolbarBtn} bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600`}
                  >
                    Neutral
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => applyCurate(true)}
                    className={`${toolbarBtn} bg-green-500 hover:bg-green-600 text-white`}
                  >
                    Include
                  </button>
                  <button
                    type="button"
                    onClick={() => applyCurate(false)}
                    className={`${toolbarBtn} bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600`}
                  >
                    Exclude
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={clearSelection}
                aria-label="Cancel selection"
                className="h-10 w-10 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

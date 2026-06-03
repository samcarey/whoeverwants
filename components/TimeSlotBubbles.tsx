"use client";

/**
 * TimeSlotBubbles — compact day-row bubble grid for time question preferences.
 *
 * Layout: one row per day, day label on the left, tappable time bubbles on the right.
 * Each bubble cycles through: neutral → liked (green) → disliked (red) → neutral.
 *
 * Dragging across multiple bubbles selects a contiguous (chronological) range of
 * them; a floating toolbar then offers Like / Dislike / Neutral, which apply the
 * chosen preference to every selected slot and dismiss the selection. The toolbar
 * is portaled out and fixed to the viewport so it never shifts the page layout.
 *
 * An orange badge (top-right) shows how many availability voters are excluded by that slot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import ModalPortal from "@/components/ModalPortal";
import {
  expandHourRowsToQuarters,
  formatStackedDayLabel,
  getBubbleLabel,
  groupSlotsByDay,
  periodColorClass,
  slotExcludedCount,
  type SlotCell,
} from "@/lib/timeUtils";

export type SlotState = "neutral" | "liked" | "disliked";

const SLOT_CELL_SIZE =
  "min-w-12 h-8 px-2 flex items-center justify-center text-[0.9rem] font-mono font-medium leading-none whitespace-nowrap";

// Pointer travel (px) before a press is treated as a range-drag instead of a tap.
const DRAG_THRESHOLD = 8;

interface TimeSlotBubblesProps {
  /** Slot keys in display order, already filtered and sorted. */
  options: string[];
  likedSlots: string[];
  dislikedSlots: string[];
  onToggle: (slot: string, nextState: SlotState) => void;
  /** availability_counts from results: slot_key → voter count */
  availabilityCounts?: Record<string, number>;
  maxAvailability?: number;
  /** Weighted headcount of everyone who submitted availability. The orange
   *  badge shows ABSOLUTE exclusion (respondents − count), so even the
   *  best-attended slot shows how many it leaves out. Falls back to
   *  maxAvailability (relative) when not provided. */
  availabilityRespondents?: number;
  disabled?: boolean;
}

export default function TimeSlotBubbles({
  options,
  likedSlots,
  dislikedSlots,
  onToggle,
  availabilityCounts,
  maxAvailability,
  availabilityRespondents,
  disabled = false,
}: TimeSlotBubblesProps) {
  const likedSet = useMemo(() => new Set(likedSlots), [likedSlots]);
  const dislikedSet = useMemo(() => new Set(dislikedSlots), [dislikedSlots]);

  // Chronological index of every selectable slot, for range computation.
  const optionIndex = useMemo(() => {
    const m = new Map<string, number>();
    options.forEach((slot, i) => m.set(slot, i));
    return m;
  }, [options]);

  // Slots currently lassoed by a drag. Cleared after applying or cancelling.
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  // Intersect with the live options so a stale selection (slots that vanished
  // when tentative availability shifted) silently drops out instead of lingering.
  const effectiveSelection = useMemo(
    () => options.filter((slot) => selection.has(slot)),
    [options, selection],
  );

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  // Drag bookkeeping for the in-flight gesture + a teardown for window listeners.
  const gestureRef = useRef<{
    pointerId: number;
    anchor: string;
    startX: number;
    startY: number;
    moved: boolean;
    current: string;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Defensive teardown if the component unmounts mid-drag (phase change, etc.).
  useEffect(() => () => cleanupRef.current?.(), []);

  // Drop any selection if the ballot becomes read-only.
  useEffect(() => {
    if (disabled) clearSelection();
  }, [disabled, clearSelection]);

  // How many voters a slot excludes, ABSOLUTE: everyone who submitted
  // availability minus the slot's own count — so even the best-attended slot
  // shows the people it leaves out. Falls back to the relative (max − count)
  // baseline when the respondent total isn't supplied.
  const excludedBaseline = availabilityRespondents ?? maxAvailability;
  const excludedCount = useCallback(
    (slot: string) =>
      availabilityCounts != null
        ? slotExcludedCount(excludedBaseline, availabilityCounts[slot] ?? 0)
        : 0,
    [excludedBaseline, availabilityCounts],
  );

  // Whether any slot would render an orange "excludes N voter(s)" badge — used
  // to gate the matching legend entry.
  const hasExcluded = useMemo(
    () => options.some((slot) => excludedCount(slot) > 0),
    [options, excludedCount],
  );

  const days = useMemo(
    () =>
      groupSlotsByDay(options).map(([dateStr, slots]) => ({
        dateStr,
        dayLabel: formatStackedDayLabel(dateStr),
        hourRows: expandHourRowsToQuarters(slots),
      })),
    [options],
  );

  function getState(slot: string): SlotState {
    if (likedSet.has(slot)) return "liked";
    if (dislikedSet.has(slot)) return "disliked";
    return "neutral";
  }

  function handleTap(slot: string) {
    if (disabled) return;
    const current = getState(slot);
    const next: SlotState = current === "neutral" ? "liked" : current === "liked" ? "disliked" : "neutral";
    onToggle(slot, next);
  }

  const rangeBetween = useCallback(
    (a: string, b: string): string[] => {
      const ia = optionIndex.get(a);
      const ib = optionIndex.get(b);
      if (ia == null || ib == null) return ia != null ? [a] : [];
      const lo = Math.min(ia, ib);
      const hi = Math.max(ia, ib);
      return options.slice(lo, hi + 1);
    },
    [optionIndex, options],
  );

  // Pointer-down on a bubble: maybe a tap, maybe the start of a range-drag.
  // The decision is deferred to window-level move/up handlers so we can track
  // the finger across other bubbles (touch implicitly captures to the target,
  // but the events still bubble to window).
  const handleBubblePointerDown = (slot: string, e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;

    // Starting a fresh gesture dismisses any toolbar from a previous selection.
    setSelection((prev) => (prev.size === 0 ? prev : new Set()));

    gestureRef.current = {
      pointerId: e.pointerId,
      anchor: slot,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      current: slot,
    };

    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || ev.pointerId !== g.pointerId) return;
      if (!g.moved && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < DRAG_THRESHOLD) {
        return;
      }
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

  const applyToSelection = (state: SlotState) => {
    effectiveSelection.forEach((slot) => onToggle(slot, state));
    clearSelection();
  };

  // A drag that STARTS on an available bubble must select, not scroll the page
  // or trigger the page's swipe-back transition — but only on the bubbles
  // themselves, never the day labels, gaps, or greyed-out (unavailable) cells,
  // which stay normally scrollable/swipeable. Touch events target the element
  // the touch started on for the whole gesture, so `touch-action: none` +
  // stopping propagation on the bubble fully covers any drag begun there:
  // touch-action blocks the browser pan/scroll, and stopPropagation keeps the
  // ancestor swipe-back gesture (PollDetail's React onTouch* handlers) from
  // seeing it. Pointer events (which drive the range selection) are a separate
  // event type and still reach our window listeners.
  const stopTouch = (e: React.TouchEvent) => e.stopPropagation();

  const renderCell = (cell: SlotCell, prevSlot: string | null) => {
    const { time } = getBubbleLabel(cell.slot, prevSlot);
    if (!cell.available) {
      return (
        <div
          key={cell.slot}
          data-slot={cell.slot}
          data-slot-available="false"
          className={`${SLOT_CELL_SIZE} text-gray-300 dark:text-gray-600 select-none`}
          aria-hidden="true"
        >
          <span className="block cap-height-text">{time}</span>
        </div>
      );
    }
    const state = getState(cell.slot);
    const isSelected = selection.has(cell.slot);
    const excluded = excludedCount(cell.slot);
    return (
      <button
        key={cell.slot}
        type="button"
        data-slot={cell.slot}
        data-slot-available="true"
        draggable={false}
        onPointerDown={(e) => handleBubblePointerDown(cell.slot, e)}
        onTouchStart={stopTouch}
        onTouchMove={stopTouch}
        onTouchEnd={stopTouch}
        onTouchCancel={stopTouch}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleTap(cell.slot);
          }
        }}
        disabled={disabled}
        title={cell.slot}
        className={[
          "relative select-none touch-none rounded-full transition-colors",
          SLOT_CELL_SIZE,
          "border focus:outline-none focus:ring-2 focus:ring-offset-1",
          disabled ? "cursor-default opacity-60" : "cursor-pointer active:scale-95",
          state === "liked"
            ? "bg-green-100/70 dark:bg-green-900/70 border-green-300 dark:border-green-600 text-green-800 dark:text-green-100 focus:ring-green-400"
            : state === "disliked"
            ? "bg-red-100/70 dark:bg-red-900/70 border-red-300 dark:border-red-600 text-red-800 dark:text-red-100 focus:ring-red-400"
            : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 focus:ring-blue-400",
          isSelected
            ? "ring-2 ring-blue-500"
            : "",
        ].join(" ")}
      >
        <span className="block cap-height-text">{time}</span>
        {excluded > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white leading-none pointer-events-none">
            {excluded}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {days.map(({ dateStr, dayLabel: { weekday, monthDay }, hourRows }) => (
        <div key={dateStr} className="flex gap-2 items-start py-3 first:pt-0 last:pb-0">
          <div className="w-12 shrink-0 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-left leading-tight">
            <div>{weekday}</div>
            <div>{monthDay}</div>
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            {hourRows.map((hourRow, rowIdx) => {
              const firstPrev = rowIdx > 0
                ? hourRows[rowIdx - 1][hourRows[rowIdx - 1].length - 1].slot
                : null;
              const rowPeriod = getBubbleLabel(hourRow[0].slot, firstPrev).period;
              const [first, ...rest] = hourRow;
              return (
                <div key={first.slot} className="flex gap-1.5 items-start">
                  <div className={`w-7 shrink-0 h-8 flex items-center justify-end text-xs font-semibold tabular-nums ${periodColorClass(rowPeriod)}`}>
                    {rowPeriod ?? ""}
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-1.5 items-start flex-1">
                    {renderCell(first, firstPrev)}
                    <div className="flex flex-wrap gap-1.5">
                      {rest.map((cell, i) => renderCell(cell, hourRow[i].slot))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500" /> Liked
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Disliked
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600" /> Neutral
        </span>
        {hasExcluded && (
          <span className="flex items-center gap-1">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">N</span> Excludes Voters
          </span>
        )}
      </div>

      {/* Range-selection toolbar — fixed to the viewport (via portal) so it never
          reflows the page. Appears while a drag-selection is active. */}
      {!disabled && effectiveSelection.length > 0 && (
        <ModalPortal>
          <div
            className="fixed left-1/2 -translate-x-1/2 z-50 animate-slide-up"
            style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 shadow-xl">
              <button
                type="button"
                onClick={() => applyToSelection("liked")}
                className="h-10 px-4 rounded-full text-sm font-semibold bg-green-500 hover:bg-green-600 text-white transition-transform active:scale-95"
              >
                Like
              </button>
              <button
                type="button"
                onClick={() => applyToSelection("disliked")}
                className="h-10 px-4 rounded-full text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-transform active:scale-95"
              >
                Dislike
              </button>
              <button
                type="button"
                onClick={() => applyToSelection("neutral")}
                className="h-10 px-4 rounded-full text-sm font-semibold bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-transform active:scale-95"
              >
                Neutral
              </button>
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

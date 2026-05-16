"use client";

/**
 * TimeSlotBubbles — compact day-row bubble grid for time question preferences.
 *
 * Layout: one row per day, day label on the left, tappable time bubbles on the right.
 * Each bubble cycles through: neutral → liked (green) → disliked (red) → neutral.
 *
 * An orange badge (top-right) shows how many availability voters are excluded by that slot.
 */

import { useMemo } from "react";
import {
  expandHourRowsToQuarters,
  formatStackedDayLabel,
  getBubbleLabel,
  groupSlotsByDay,
  type SlotCell,
} from "@/lib/timeUtils";

export type SlotState = "neutral" | "liked" | "disliked";

interface TimeSlotBubblesProps {
  /** Slot keys in display order, already filtered and sorted. */
  options: string[];
  likedSlots: string[];
  dislikedSlots: string[];
  onToggle: (slot: string, nextState: SlotState) => void;
  /** availability_counts from results: slot_key → voter count */
  availabilityCounts?: Record<string, number>;
  maxAvailability?: number;
  disabled?: boolean;
}

export default function TimeSlotBubbles({
  options,
  likedSlots,
  dislikedSlots,
  onToggle,
  availabilityCounts,
  maxAvailability,
  disabled = false,
}: TimeSlotBubblesProps) {
  const likedSet = useMemo(() => new Set(likedSlots), [likedSlots]);
  const dislikedSet = useMemo(() => new Set(dislikedSlots), [dislikedSlots]);

  // Group slots by date, preserving order
  const days = useMemo(() => groupSlotsByDay(options), [options]);

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

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {days.map(([dateStr, slots]) => {
        const { weekday, monthDay } = formatStackedDayLabel(dateStr);
        return (
        <div key={dateStr} className="flex gap-2 items-start py-3 first:pt-0 last:pb-0">
          <div className="w-12 shrink-0 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-left leading-tight">
            <div>{weekday}</div>
            <div>{monthDay}</div>
          </div>

          <div className="flex flex-col gap-1.5 flex-1">
            {(() => {
              const hourRows = expandHourRowsToQuarters(slots);
              const flat: SlotCell[] = hourRows.flat();
              const renderCell = (cell: SlotCell, prevSlot: string | null) => {
                const { time } = getBubbleLabel(cell.slot, prevSlot);
                const sizeClass =
                  "min-w-12 h-8 px-2 flex items-center justify-center text-[0.9rem] font-medium tabular-nums leading-none whitespace-nowrap";
                if (!cell.available) {
                  return (
                    <div
                      key={cell.slot}
                      className={`${sizeClass} text-gray-300 dark:text-gray-600 select-none`}
                      aria-hidden="true"
                    >
                      <span className="block cap-height-text">{time}</span>
                    </div>
                  );
                }
                const state = getState(cell.slot);
                const excluded =
                  maxAvailability != null && availabilityCounts != null
                    ? maxAvailability - (availabilityCounts[cell.slot] ?? 0)
                    : 0;
                return (
                  <button
                    key={cell.slot}
                    type="button"
                    onClick={() => handleTap(cell.slot)}
                    disabled={disabled}
                    title={cell.slot}
                    className={[
                      "relative select-none rounded-full transition-colors",
                      sizeClass,
                      "border focus:outline-none focus:ring-2 focus:ring-offset-1",
                      disabled ? "cursor-default opacity-60" : "cursor-pointer active:scale-95",
                      state === "liked"
                        ? "bg-green-500 border-green-500 text-white focus:ring-green-400"
                        : state === "disliked"
                        ? "bg-red-500 border-red-500 text-white focus:ring-red-400"
                        : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 focus:ring-blue-400",
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
              let flatIdx = 0;
              return hourRows.map((hourRow) => {
                const rowStart = flatIdx;
                const firstPrev = rowStart > 0 ? flat[rowStart - 1].slot : null;
                const rowPeriod = getBubbleLabel(hourRow[0].slot, firstPrev).period;
                const periodLabelClass = rowPeriod === "AM"
                  ? "text-orange-500 dark:text-orange-400"
                  : "text-purple-600 dark:text-purple-400";
                const cellsWithPrev = hourRow.map((cell, i) => {
                  const prev = rowStart + i > 0 ? flat[rowStart + i - 1].slot : null;
                  return { cell, prev };
                });
                flatIdx += hourRow.length;
                const [first, ...rest] = cellsWithPrev;
                return (
                  <div key={first.cell.slot} className="flex gap-1.5 items-start">
                    <div className={`w-7 shrink-0 h-8 flex items-center justify-end text-xs font-semibold tabular-nums ${rowPeriod ? periodLabelClass : ""}`}>
                      {rowPeriod ?? ""}
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-1.5 items-start flex-1">
                      {renderCell(first.cell, first.prev)}
                      <div className="flex flex-wrap gap-1.5">
                        {rest.map(({ cell, prev }) => renderCell(cell, prev))}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-3 pt-1 text-xs text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500" /> liked
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> disliked
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600" /> neutral
        </span>
        {maxAvailability != null && maxAvailability > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">N</span> excludes N voter(s)
          </span>
        )}
      </div>
    </div>
  );
}

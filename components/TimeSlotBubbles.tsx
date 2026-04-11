"use client";

/**
 * TimeSlotBubbles — compact day-row bubble grid for time poll preferences.
 *
 * Layout: one row per day, day label on the left, tappable time bubbles on the right.
 * Each bubble cycles through: neutral → liked (green) → disliked (red) → neutral.
 *
 * Bubble labels use compressed notation to reduce visual clutter:
 *   First bubble of day (or different AM/PM):  "9 AM", "1 PM"
 *   Same AM/PM period but different hour:       "10", "11"
 *   Same hour as previous bubble:               ":15", ":30", ":45"
 *
 * An orange badge (top-right) shows how many availability voters are excluded by that slot.
 */

import { useMemo } from "react";

function formatStackedDayLabel(dateStr: string): { weekday: string; monthDay: string } {
  const date = new Date(dateStr + "T00:00:00");
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { weekday, monthDay };
}

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

function parseSlotStart(slot: string): { h: number; m: number } {
  // slot format: "YYYY-MM-DD HH:MM-HH:MM"
  const startStr = slot.split(" ")[1].split("-")[0];
  const [h, m] = startStr.split(":").map(Number);
  return { h, m };
}

function parseSlotDate(slot: string): string {
  return slot.split(" ")[0]; // "YYYY-MM-DD"
}


function getBubbleLabel(slot: string, prevSlot: string | null): string {
  const { h, m } = parseSlotStart(slot);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;

  if (prevSlot) {
    const prev = parseSlotStart(prevSlot);
    const prevPeriod = prev.h < 12 ? "AM" : "PM";
    const prevH12 = prev.h % 12 === 0 ? 12 : prev.h % 12;

    if (h12 === prevH12 && period === prevPeriod) {
      // Same hour → show only :MM
      return `:${String(m).padStart(2, "0")}`;
    }
    if (period === prevPeriod) {
      // Same AM/PM → show hour, omit period
      return String(h12);
    }
  }

  // First bubble or period changed → full label
  return `${h12} ${period}`;
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
  const days = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const slot of options) {
      const date = parseSlotDate(slot);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(slot);
    }
    return Array.from(map.entries()); // [dateStr, slots[]]
  }, [options]);

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
          {/* Day label — stacked, left-aligned, narrow fixed width for consistent bubble alignment */}
          <div className="w-12 shrink-0 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-left leading-tight">
            <div>{weekday}</div>
            <div>{monthDay}</div>
          </div>

          {/* Bubbles — fixed width so labels sit in vertically aligned columns */}
          <div className="flex flex-wrap gap-1.5">
            {slots.map((slot, idx) => {
              const state = getState(slot);
              const label = getBubbleLabel(slot, idx > 0 ? slots[idx - 1] : null);
              const excluded =
                maxAvailability != null && availabilityCounts != null
                  ? maxAvailability - (availabilityCounts[slot] ?? 0)
                  : 0;

              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => handleTap(slot)}
                  disabled={disabled}
                  title={slot}
                  className={[
                    "relative select-none rounded-full py-1 text-[0.9rem] font-medium transition-colors",
                    "w-12 text-center tabular-nums",
                    "border focus:outline-none focus:ring-2 focus:ring-offset-1",
                    disabled ? "cursor-default opacity-60" : "cursor-pointer active:scale-95",
                    state === "liked"
                      ? "bg-green-500 border-green-500 text-white focus:ring-green-400"
                      : state === "disliked"
                      ? "bg-red-500 border-red-500 text-white focus:ring-red-400"
                      : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 focus:ring-blue-400",
                  ].join(" ")}
                >
                  {label}
                  {excluded > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white leading-none pointer-events-none">
                      {excluded}
                    </span>
                  )}
                </button>
              );
            })}
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

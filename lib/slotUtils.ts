/**
 * Playlist slot helpers: the per-activity color map, and the slot span /
 * header / duration computation the SlotCard renders.
 *
 * COLOR ALGORITHM. Each distinct activity (keyed case-insensitively) gets one
 * color from a curated palette, satisfying the three requirements:
 *   1. Consistent per activity across time slots — the key is the lowercased
 *      activity name, so "Hiking" is the same color in every slot.
 *   2. Contrasts the other colors on the timeline — colors are assigned in the
 *      activity's first-appearance order across the chronologically-sorted
 *      slots, cycling the palette; consecutive activities get distinct hues, so
 *      a slot's (small) subset almost never collides.
 *   3. Pretty + high-contrast in both themes — the palette is a hand-picked set
 *      of vivid, evenly-spaced hues with light/dark text variants.
 */

import type { DayTimeWindow, TimeWindow } from "@/lib/types";
import type { Slot } from "@/lib/api/slots";
import {
  timeToMinutes,
  windowDurationMinutes,
  formatDayLabel,
  formatLocalDateISO,
  getRelativeDayLabel,
} from "@/lib/timeUtils";

export interface ActivityColor {
  /** Solid bar background (visible in both themes). */
  bar: string;
  /** Name / emoji-fallback text color, theme-aware. */
  text: string;
}

// Curated, evenly-spaced hues. Grays are excluded so bars never read as
// "disabled"; the order interleaves warm/cool so early neighbors contrast.
const ACTIVITY_COLORS: ActivityColor[] = [
  { bar: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { bar: "bg-pink-500", text: "text-pink-600 dark:text-pink-400" },
  { bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  { bar: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400" },
  { bar: "bg-orange-500", text: "text-orange-600 dark:text-orange-400" },
  { bar: "bg-teal-500", text: "text-teal-600 dark:text-teal-400" },
  { bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  { bar: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400" },
  { bar: "bg-lime-500", text: "text-lime-600 dark:text-lime-400" },
  { bar: "bg-fuchsia-500", text: "text-fuchsia-600 dark:text-fuchsia-400" },
];

/** Map every distinct activity (lowercased key) across `slots` to a stable
 *  color. Pass slots already sorted soonest-first so first-appearance order is
 *  chronological. */
export function buildActivityColorMap(slots: Slot[]): Map<string, ActivityColor> {
  const map = new Map<string, ActivityColor>();
  let i = 0;
  for (const slot of slots) {
    for (const activity of slot.activities) {
      const key = activity.name.trim().toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]);
      i += 1;
    }
  }
  return map;
}

/** The color for a single activity name (case-insensitive lookup). Falls back
 *  to the first palette entry when absent (defensive; shouldn't happen for a
 *  slot built into the map). */
export function activityColor(
  name: string,
  colors: Map<string, ActivityColor>,
): ActivityColor {
  return colors.get(name.trim().toLowerCase()) ?? ACTIVITY_COLORS[0];
}

// --- Span / header ---------------------------------------------------------

/** Days since the Unix epoch for a "YYYY-MM-DD" (local midnight). */
function dayIndex(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor(d.getTime() / 86_400_000);
}

interface Interval {
  /** Absolute start, in minutes since epoch. */
  startAbs: number;
  /** Absolute end, in minutes since epoch (rolls to next day for cross-midnight). */
  endAbs: number;
  day: string;
  startMin: number;
  /** Raw "HH:MM" window bounds, for the clock labels. */
  min: string;
  max: string;
  durationMin: number;
}

function intervalsOf(dayTimeWindows: DayTimeWindow[]): Interval[] {
  const out: Interval[] = [];
  for (const dtw of dayTimeWindows || []) {
    if (!dtw?.day) continue;
    const base = dayIndex(dtw.day) * 1440;
    for (const w of dtw.windows || []) {
      if ((w as TimeWindow).enabled === false) continue;
      if (!w?.min || !w?.max) continue;
      const startMin = timeToMinutes(w.min);
      const dur = windowDurationMinutes(w);
      out.push({
        startAbs: base + startMin,
        endAbs: base + startMin + dur,
        day: dtw.day,
        startMin,
        min: w.min,
        max: w.max,
        durationMin: dur,
      });
    }
  }
  return out;
}

/** Absolute start (minutes since epoch) of a slot's earliest window — the
 *  chronological sort key. Slots with no windows sort last. */
export function slotStartAbs(slot: Slot): number {
  const ints = intervalsOf(slot.day_time_windows);
  if (ints.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...ints.map((i) => i.startAbs));
}

/** Slots soonest-first (earliest availability start at top), created_at as a
 *  stable tiebreak. Returns a new array. Each slot's windows are parsed once
 *  (decorate-sort-undecorate) rather than on every comparison. */
export function sortSlotsChronological(slots: Slot[]): Slot[] {
  return slots
    .map((slot) => ({ slot, start: slotStartAbs(slot) }))
    .sort((a, b) => a.start - b.start || (a.slot.created_at ?? "").localeCompare(b.slot.created_at ?? ""))
    .map((d) => d.slot);
}

/** "2.25h" — decimal hours, trailing zeros stripped (135min → "2.25h",
 *  60min → "1h", 90min → "1.5h"). */
export function formatDecimalHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours}h`;
}

/** Format "HH:MM" as a 12-hour clock label, e.g. "2:00 PM". */
function formatClock(hhmm: string): string {
  const mins = timeToMinutes(hhmm);
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

export interface SlotHeader {
  /** Relative specifier for the START date, e.g. "Tomorrow" (rendered blue). */
  relative: string;
  /** Start date label, e.g. "Mon, Jan 16". */
  startDate: string;
  /** Start time, e.g. "2:00 PM". */
  startTime: string;
  /** End time, e.g. "4:15 PM". */
  endTime: string;
  /** End date label when the span crosses days, else null (omit end date). */
  endDate: string | null;
  /** Total availability across all windows, e.g. "2.25h". */
  duration: string;
}

/** Compute the display header for a slot's overall span: earliest window start
 *  → latest window end, with the total availability as a decimal-hour note.
 *  Null when the slot has no usable windows. */
export function slotHeader(dayTimeWindows: DayTimeWindow[]): SlotHeader | null {
  const ints = intervalsOf(dayTimeWindows);
  if (ints.length === 0) return null;

  const first = ints.reduce((a, b) => (b.startAbs < a.startAbs ? b : a));
  const last = ints.reduce((a, b) => (b.endAbs > a.endAbs ? b : a));
  const totalMin = ints.reduce((sum, i) => sum + i.durationMin, 0);

  // The end date is the day the latest window ENDS on: its start day plus the
  // intra-window rollover (0, or 1 for a cross-midnight window). Computed via
  // date-string arithmetic to avoid any UTC/local offset skew.
  const rollover = Math.floor((last.startMin + last.durationMin) / 1440);
  const endDateStr = addDaysToDateStr(last.day, rollover);

  return {
    relative: getRelativeDayLabel(first.day),
    startDate: formatDayLabel(first.day),
    startTime: formatClock(first.min),
    endTime: formatClock(last.max),
    endDate: endDateStr !== first.day ? formatDayLabel(endDateStr) : null,
    duration: formatDecimalHours(totalMin),
  };
}

/** Add `days` to a "YYYY-MM-DD" string in local time, returning "YYYY-MM-DD". */
function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatLocalDateISO(d);
}

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
  /** Vertical-bar background — a DARKER shade in light mode, LIGHTER in dark
   *  mode (`bg-*-600 dark:bg-*-400`), for contrast against each theme's bg. */
  bar: string;
  /** Matching text color, theme-aware. */
  text: string;
}

// Curated, evenly-spaced hues. Grays are excluded so bars never read as
// "disabled"; the order interleaves warm/cool so early neighbors contrast.
const ACTIVITY_COLORS: ActivityColor[] = [
  { bar: "bg-blue-600 dark:bg-blue-400", text: "text-blue-600 dark:text-blue-400" },
  { bar: "bg-emerald-600 dark:bg-emerald-400", text: "text-emerald-600 dark:text-emerald-400" },
  { bar: "bg-amber-600 dark:bg-amber-400", text: "text-amber-600 dark:text-amber-400" },
  { bar: "bg-pink-600 dark:bg-pink-400", text: "text-pink-600 dark:text-pink-400" },
  { bar: "bg-violet-600 dark:bg-violet-400", text: "text-violet-600 dark:text-violet-400" },
  { bar: "bg-cyan-600 dark:bg-cyan-400", text: "text-cyan-600 dark:text-cyan-400" },
  { bar: "bg-orange-600 dark:bg-orange-400", text: "text-orange-600 dark:text-orange-400" },
  { bar: "bg-teal-600 dark:bg-teal-400", text: "text-teal-600 dark:text-teal-400" },
  { bar: "bg-rose-600 dark:bg-rose-400", text: "text-rose-600 dark:text-rose-400" },
  { bar: "bg-indigo-600 dark:bg-indigo-400", text: "text-indigo-600 dark:text-indigo-400" },
  { bar: "bg-lime-600 dark:bg-lime-400", text: "text-lime-600 dark:text-lime-400" },
  { bar: "bg-fuchsia-600 dark:bg-fuchsia-400", text: "text-fuchsia-600 dark:text-fuchsia-400" },
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

/** Compact preview of a per-activity participant range, or null when neither
 *  bound is set: both → "2–5", min only → "2+", max only → "≤5". Used faded
 *  next to the activity name in the sheet AND tiny above the emoji on the
 *  timeline. */
export function formatPeopleRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  const lo = typeof min === "number" && min >= 1 ? min : null;
  const hi = typeof max === "number" && max >= 1 ? max : null;
  if (lo !== null && hi !== null) return `${lo}–${hi}`;
  if (lo !== null) return `${lo}+`;
  if (hi !== null) return `≤${hi}`;
  return null;
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

export interface SlotWindowLine {
  /** Relative specifier for this window's date, e.g. "Tomorrow" (rendered blue). */
  relative: string;
  /** Date label, e.g. "Mon, Jan 16". */
  date: string;
  /** Start time, e.g. "2:00 PM". */
  startTime: string;
  /** End time, e.g. "4:15 PM". */
  endTime: string;
  /** End date label when THIS window crosses midnight, else null (omit). */
  endDate: string | null;
  /** This window's duration, e.g. "2.25h". */
  duration: string;
  /** Stable-ish React key ("<day>#<min>-<max>"; disambiguate with an index at
   *  the callsite for the rare identical-window case). */
  key: string;
}

/** Build the display line for a single availability window. */
function lineFromInterval(iv: Interval): SlotWindowLine {
  // End date = this window's start day plus its intra-window rollover
  // (0, or 1 for a cross-midnight window). Date-string arithmetic to avoid
  // any UTC/local offset skew.
  const rollover = Math.floor((iv.startMin + iv.durationMin) / 1440);
  const endDateStr = addDaysToDateStr(iv.day, rollover);
  return {
    relative: getRelativeDayLabel(iv.day),
    date: formatDayLabel(iv.day),
    startTime: formatClock(iv.min),
    endTime: formatClock(iv.max),
    endDate: endDateStr !== iv.day ? formatDayLabel(endDateStr) : null,
    duration: formatDecimalHours(iv.durationMin),
    key: `${iv.day}#${iv.min}-${iv.max}`,
  };
}

/** One display line PER availability window (not a single collapsed span) —
 *  chronologically sorted, each with its own date · start–end · duration. */
export function slotWindowLines(dayTimeWindows: DayTimeWindow[]): SlotWindowLine[] {
  return intervalsOf(dayTimeWindows)
    .slice()
    .sort((a, b) => a.startAbs - b.startAbs)
    .map(lineFromInterval);
}

export interface SlotWindowEntry {
  /** The owning slot (its activities render the bars; tapping edits it). */
  slot: Slot;
  /** This one window's date/time line. */
  line: SlotWindowLine;
  /** Absolute start (minutes since epoch) for the global chronological sort. */
  startAbs: number;
  /** Stable React key. */
  key: string;
}

/** Explode every slot into ONE entry per availability window, sorted soonest
 *  first across ALL slots. Each window then occupies its own row — its own set
 *  of activity bars + its own vertical space in the playlist — rather than
 *  several windows of a slot sharing one card. Slots with no windows contribute
 *  nothing. */
export function slotWindowEntries(slots: Slot[]): SlotWindowEntry[] {
  const entries: SlotWindowEntry[] = [];
  for (const slot of slots) {
    intervalsOf(slot.day_time_windows).forEach((iv, i) => {
      entries.push({
        slot,
        line: lineFromInterval(iv),
        startAbs: iv.startAbs,
        key: `${slot.id}#${iv.day}#${iv.min}-${iv.max}#${i}`,
      });
    });
  }
  return entries.sort(
    (a, b) =>
      a.startAbs - b.startAbs ||
      (a.slot.created_at ?? "").localeCompare(b.slot.created_at ?? ""),
  );
}

/** Add `days` to a "YYYY-MM-DD" string in local time, returning "YYYY-MM-DD". */
function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return formatLocalDateISO(d);
}

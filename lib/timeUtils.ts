/** Format a "YYYY-MM-DD" date string as a short day label, e.g. "Mon, Jan 15" */
export function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Format a Date as "YYYY-MM-DD" using local-time components. */
export function formatLocalDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format a Date as "September 2026". */
export function formatMonthYearLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Return a new Date shifted by `delta` months (positive forward, negative back). */
export function shiftMonth(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + delta);
  return next;
}

/** Convert "HH:MM" to total minutes since midnight */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Calculate window duration in minutes, handling cross-midnight */
export function windowDurationMinutes(w: { min: string; max: string }): number {
  const minMins = timeToMinutes(w.min);
  const maxMins = timeToMinutes(w.max);
  if (maxMins <= minMins) {
    return (1440 - minMins) + maxMins;
  }
  return maxMins - minMins;
}

/** Format a duration in minutes as a compact label (e.g. "2h 30m", "45m", "1h") */
export function formatDurationLabel(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

/** Format a remaining-time milliseconds difference for countdown display.
 *  Hides seconds whenever ≥ 60 seconds remain — only the final sub-minute
 *  window shows the seconds counter ticking down. */
export function formatCountdownTime(diffMs: number): string {
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Single-unit compact countdown — promotes to the next larger unit at the
 *  unit boundary itself (0s–59s show in seconds, 1m–59m in minutes, 1h–23h
 *  in hours, 1d–6d in days, 1w–3w in weeks, 1mo–11mo in months, then years).
 *  Differs from `compactDurationSince` which uses a ≥ 2 threshold (e.g. 1m
 *  there reads "1m ago", but here we'd already be in seconds — countdowns
 *  want the larger unit as soon as it crosses 1 so the displayed glyph
 *  matches user-typed deadline durations like "Suggestions cutoff in 1h"). */
export function formatCompactCountdown(diffMs: number): string {
  if (diffMs <= 0) return 'Expired';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(seconds / 86400);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Format "label (clock time)" showing the absolute time `minutes` from now.
 *  Returns just the label on the server or when minutes <= 0. */
export function formatDeadlineLabel(minutes: number, label: string): string {
  if (typeof window === 'undefined' || minutes <= 0) return label;
  const deadline = new Date(Date.now() + minutes * 60 * 1000);
  const timeString = deadline.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${label} (${timeString})`;
}

/** Compact absolute creation timestamp — e.g. "@ 12:30 AM 4/18/26". */
export function formatCreationTimestamp(iso: string): string {
  const dt = new Date(iso);
  const t = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const d = dt.toLocaleDateString("en-US", { year: "2-digit", month: "numeric", day: "numeric" });
  return `@ ${t} ${d}`;
}

/** Compact date-time for question close/expire messages — e.g. "4/18/26, 12:30 AM". */
export function formatShortDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// --- Time slot helpers (slot format: "YYYY-MM-DD HH:MM-HH:MM") ---

/** Parse slot start time → {h, m} */
export function parseSlotStart(slot: string): { h: number; m: number } {
  const startStr = slot.split(' ')[1].split('-')[0];
  const [h, m] = startStr.split(':').map(Number);
  return { h, m };
}

/** Extract "YYYY-MM-DD" from a slot key */
export function parseSlotDate(slot: string): string {
  return slot.split(' ')[0];
}

/** Format a date string as stacked day label: { weekday: "Sat", monthDay: "Apr 18" } */
export function formatStackedDayLabel(dateStr: string): { weekday: string; monthDay: string } {
  const date = new Date(dateStr + 'T00:00:00');
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { weekday, monthDay };
}

/** Generate a compact bubble label for a slot based on its predecessor.
 *  First bubble of day / period change (on hour):    { time: "1:00",  period: "PM" }
 *  First bubble of day / period change (off hour):   { time: "10:15", period: "AM" }
 *  Same AM/PM, different hour (on hour):             { time: "2:00",  period: null }
 *  Same AM/PM, different hour (off hour):            { time: "11:30", period: null }
 *  Same hour, different minute:                      { time: ":15",   period: null }
 *  `period` is non-null only when this bubble starts a new period (or is the
 *  first of the row), so callers can color it without re-parsing.
 */
export function getBubbleLabel(
  slot: string,
  prevSlot: string | null,
): { time: string; period: 'AM' | 'PM' | null } {
  const { h, m } = parseSlotStart(slot);
  const period: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, '0');
  // Pad single-digit hours with a non-breaking space so column-aligned
  // monospace renderers line the digit/colon/minute up across rows.
  const h12Str = h12 < 10 ? ` ${h12}` : String(h12);
  const hourLabel = `${h12Str}:${mm}`;

  if (prevSlot) {
    const prev = parseSlotStart(prevSlot);
    const prevPeriod = prev.h < 12 ? 'AM' : 'PM';
    const prevH12 = prev.h % 12 === 0 ? 12 : prev.h % 12;

    if (h12 === prevH12 && period === prevPeriod) {
      return { time: `:${mm}`, period: null };
    }
    if (period === prevPeriod) {
      return { time: hourLabel, period: null };
    }
  }

  return { time: hourLabel, period };
}

/** Group slot keys by date, preserving order within each day. */
export function groupSlotsByDay(options: string[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const slot of options) {
    const date = parseSlotDate(slot);
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(slot);
  }
  return Array.from(map.entries());
}

/** Pad each hour-row to four 15-minute cells (:00, :15, :30, :45),
 *  filling missing positions with synthetic "ghost" cells. The ghost
 *  cell's `slot` is `${date} HH:MM` (no end time) — usable with
 *  `parseSlotStart` / `getBubbleLabel` but distinct from real keys so
 *  state lookups don't collide. */
export type SlotCell = { slot: string; available: boolean };
export function expandHourRowsToQuarters(daySlots: string[]): SlotCell[][] {
  if (daySlots.length === 0) return [];
  const date = parseSlotDate(daySlots[0]);
  // Map preserves insertion order, so the iteration below yields hours in
  // the order they first appeared in daySlots.
  const byHour = new Map<number, Map<number, string>>();
  for (const slot of daySlots) {
    const { h, m } = parseSlotStart(slot);
    let minuteMap = byHour.get(h);
    if (!minuteMap) {
      minuteMap = new Map();
      byHour.set(h, minuteMap);
    }
    minuteMap.set(m, slot);
  }
  return Array.from(byHour.entries()).map(([h, minuteMap]) =>
    [0, 15, 30, 45].map((m) => {
      const real = minuteMap.get(m);
      if (real) return { slot: real, available: true };
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      return { slot: `${date} ${hh}:${mm}`, available: false };
    }),
  );
}

/** Tailwind color class for an AM/PM badge — orange for AM, purple for PM.
 *  Returns "" when no period (used for empty slot in the period column). */
export function periodColorClass(period: 'AM' | 'PM' | null): string {
  if (period === 'AM') return 'text-orange-500 dark:text-orange-400';
  if (period === 'PM') return 'text-purple-600 dark:text-purple-400';
  return '';
}

/** Check whether a voter's day_time_windows fully cover the given slot.
 *  Mirrors the backend `_voter_available_at` in `server/algorithms/time_slots.py`.
 *  Handles cross-midnight windows where `w.max <= w.min`.
 *  A day with an empty `windows` array means "all day available". */
export function isVoterAvailableForSlot(
  slot: string,
  voterDayTimeWindows: Array<{ day: string; windows?: Array<{ min: string; max: string }> }>
): boolean {
  if (!voterDayTimeWindows || voterDayTimeWindows.length === 0) return false;
  const [dateStr, timeRange] = slot.split(' ');
  const [startStr, endStr] = timeRange.split('-');
  const startMin = timeToMinutes(startStr);
  const endMin = timeToMinutes(endStr);
  // Reconstruct absolute end for cross-midnight slots.
  const effectiveEnd = endMin > startMin ? endMin : endMin + 24 * 60;

  for (const dtw of voterDayTimeWindows) {
    if (dtw.day !== dateStr) continue;
    const windows = dtw.windows || [];
    if (windows.length === 0) return true;
    for (const w of windows) {
      const wStart = timeToMinutes(w.min);
      const wEnd = timeToMinutes(w.max);
      const wEffectiveEnd = wEnd <= wStart ? wEnd + 24 * 60 : wEnd;
      if (startMin >= wStart && effectiveEnd <= wEffectiveEnd) return true;
    }
  }
  return false;
}

/** Format a slot key "YYYY-MM-DD HH:MM-HH:MM" as a readable label like
 *  "Mon, Apr 28 • 10:00 AM – 10:30 AM (30m)". */
export function formatTimeSlot(slot: string): string {
  try {
    const [datePart, timePart] = slot.split(' ');
    const [startStr, endStr] = timePart.split('-');
    const dayLabel = formatDayLabel(datePart);
    const fmtTime = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const ampm = h < 12 ? 'AM' : 'PM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    };
    const startMins = timeToMinutes(startStr);
    let durMins = timeToMinutes(endStr) - startMins;
    if (durMins <= 0) durMins += 24 * 60;
    return `${dayLabel} • ${fmtTime(startStr)} – ${fmtTime(endStr)} (${formatDurationLabel(durMins)})`;
  } catch {
    return slot;
  }
}

/** Default time window used when no neighbouring day yields a usable slot. */
export const DEFAULT_TIME_WINDOW = { min: '08:00', max: '17:00' } as const;

/** Return true if two intra-day windows share any minute of the day. Both
 *  inputs are assumed non-cross-midnight (max > min). */
function windowsIntersect(
  a: { min: string; max: string },
  b: { min: string; max: string },
): boolean {
  return a.min < b.max && b.min < a.max;
}

/** Try to pick the latest-starting window from `candidates` that doesn't
 *  intersect any window in `existing`. Returns a fresh copy or null. */
function pickNonIntersectingLatest(
  candidates: { min: string; max: string }[],
  existing: { min: string; max: string }[],
): { min: string; max: string } | null {
  const sorted = [...candidates].sort((a, b) => b.min.localeCompare(a.min));
  for (const w of sorted) {
    if (!existing.some(e => windowsIntersect(w, e))) {
      return { min: w.min, max: w.max };
    }
  }
  return null;
}

/** Smart-pick the next time window to add to `targetDay`:
 *    1. Walk previous days (chronologically reverse) — for each, copy its
 *       latest slot that doesn't overlap any existing slot on `targetDay`.
 *    2. If no previous day yields a usable slot, walk following days
 *       (chronologically forward) and apply the same rule.
 *    3. Fall back to {@link DEFAULT_TIME_WINDOW} when neither side has
 *       anything that fits.
 *  Used by the day-time-windows + button so it can add a slot directly
 *  without opening the time-grid modal. */
export function pickNextTimeWindow(
  targetDay: string,
  allDays: { day: string; windows: { min: string; max: string }[] }[],
): { min: string; max: string } {
  const sortedDays = [...allDays].sort((a, b) => a.day.localeCompare(b.day));
  const idx = sortedDays.findIndex(d => d.day === targetDay);
  const existing = idx >= 0 ? sortedDays[idx].windows : [];
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = pickNonIntersectingLatest(sortedDays[i].windows, existing);
    if (candidate) return candidate;
  }
  for (let i = idx + 1; i < sortedDays.length; i++) {
    const candidate = pickNonIntersectingLatest(sortedDays[i].windows, existing);
    if (candidate) return candidate;
  }
  return { ...DEFAULT_TIME_WINDOW };
}

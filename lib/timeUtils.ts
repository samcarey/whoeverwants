/** Format a "YYYY-MM-DD" date string as a short day label, e.g. "Mon, Jan 15" */
export function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

/** Single-unit compact countdown — promotes to the next larger unit only when
 *  that unit's count would be >= 2 (so 0s–119s show in seconds, 2m–119m in
 *  minutes, 2h–47h in hours, etc.). Mirrors `compactDurationSince` in shape
 *  but for a remaining-time delta. */
export function formatCompactCountdown(diffMs: number): string {
  if (diffMs <= 0) return 'Expired';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(seconds / 86400);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
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
 *  First bubble of day / period change: "1 PM"
 *  Same AM/PM, different hour:          "2"
 *  Same hour, different minute:         ":15"
 */
export function getBubbleLabel(slot: string, prevSlot: string | null): string {
  const { h, m } = parseSlotStart(slot);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;

  if (prevSlot) {
    const prev = parseSlotStart(prevSlot);
    const prevPeriod = prev.h < 12 ? 'AM' : 'PM';
    const prevH12 = prev.h % 12 === 0 ? 12 : prev.h % 12;

    if (h12 === prevH12 && period === prevPeriod) {
      return `:${String(m).padStart(2, '0')}`;
    }
    if (period === prevPeriod) {
      return String(h12);
    }
  }

  return `${h12} ${period}`;
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

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

/** Format "label (clock time)" showing the absolute time `minutes` from now.
 *  Returns just the label on the server or when minutes <= 0. */
export function formatDeadlineLabel(minutes: number, label: string): string {
  if (typeof window === 'undefined' || minutes <= 0) return label;
  const deadline = new Date(Date.now() + minutes * 60 * 1000);
  const timeString = deadline.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${label} (${timeString})`;
}

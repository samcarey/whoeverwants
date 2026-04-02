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
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

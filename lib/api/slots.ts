/**
 * Playlist slot API helpers: create a slot + fetch ranked activity
 * suggestions for the create-slot sheet.
 *
 * Identity is implicit (the server resolves the caller's account from the
 * bearer / X-Browser-Id header, minting a browser-tied auto-account at
 * save time if needed — same as poll authorship).
 */

import type { DayTimeWindow } from "@/lib/types";
import { slotFetch } from "./_internal";

export interface ActivitySuggestions {
  /** Others' activities for an OVERLAPPING time period (highest priority). */
  overlapping: string[];
  /** Activities this account has used before. */
  yours: string[];
  /** Other users' activities, any time. */
  others: string[];
}

export async function apiCreateSlot(
  dayTimeWindows: DayTimeWindow[],
  activities: string[],
): Promise<{ id: string }> {
  return slotFetch<{ id: string }>("", {
    method: "POST",
    body: JSON.stringify({
      day_time_windows: dayTimeWindows,
      activities,
    }),
  });
}

export async function apiGetActivitySuggestions(
  dayTimeWindows: DayTimeWindow[],
): Promise<ActivitySuggestions> {
  return slotFetch<ActivitySuggestions>("/suggestions", {
    method: "POST",
    body: JSON.stringify({ day_time_windows: dayTimeWindows }),
  });
}

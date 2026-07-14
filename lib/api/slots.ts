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

/** A suggested (or typed) activity + its optional emoji. */
export interface ActivitySuggestion {
  name: string;
  emoji: string | null;
}

export interface ActivitySuggestions {
  /** Others' activities for an OVERLAPPING time period (highest priority). */
  overlapping: ActivitySuggestion[];
  /** Activities this account has used before. */
  yours: ActivitySuggestion[];
  /** Other users' activities, any time. */
  others: ActivitySuggestion[];
}

/** A saved slot: availability windows + activities, as returned by the list
 *  endpoint. `created_at` is a stable secondary sort key. */
export interface Slot {
  id: string;
  day_time_windows: DayTimeWindow[];
  activities: ActivitySuggestion[];
  created_at: string | null;
}

export async function apiCreateSlot(
  dayTimeWindows: DayTimeWindow[],
  activities: ActivitySuggestion[],
): Promise<{ id: string }> {
  return slotFetch<{ id: string }>("", {
    method: "POST",
    body: JSON.stringify({
      day_time_windows: dayTimeWindows,
      activities,
    }),
  });
}

/** The caller's saved slots (server order: newest first; the FE re-sorts by
 *  soonest availability start for the playlist). */
export async function apiListSlots(): Promise<Slot[]> {
  const res = await slotFetch<{ slots: Slot[] }>("", { method: "GET" });
  return res.slots ?? [];
}

/** Replace a slot's windows + activities (owner-gated; 404 if not owned). */
export async function apiUpdateSlot(
  slotId: string,
  dayTimeWindows: DayTimeWindow[],
  activities: ActivitySuggestion[],
): Promise<{ id: string }> {
  return slotFetch<{ id: string }>(`/${slotId}`, {
    method: "PUT",
    body: JSON.stringify({
      day_time_windows: dayTimeWindows,
      activities,
    }),
  });
}

/** Delete a slot (owner-gated; 404 if not owned). */
export async function apiDeleteSlot(slotId: string): Promise<void> {
  await slotFetch<void>(`/${slotId}`, { method: "DELETE" });
}

export async function apiGetActivitySuggestions(
  dayTimeWindows: DayTimeWindow[],
): Promise<ActivitySuggestions> {
  return slotFetch<ActivitySuggestions>("/suggestions", {
    method: "POST",
    body: JSON.stringify({ day_time_windows: dayTimeWindows }),
  });
}

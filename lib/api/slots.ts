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

/** A suggested (or typed) activity + its optional emoji. Suggestions never
 *  carry a participant range — that's a per-slot property (see SlotActivity). */
export interface ActivitySuggestion {
  name: string;
  emoji: string | null;
}

/** A saved slot activity: a suggestion PLUS its optional participant range
 *  (min/max people, "2–5"). Only saved activities carry the range; the
 *  suggestion endpoint returns bare {name, emoji}. Mirrors the server's
 *  separate ActivityInput / SlotActivity models. */
/** One "who with" entry on an activity: a participant range with its own set
 *  of groups and/or specific people (display names). */
export interface WhoWithEntry {
  min_people?: number | null;
  max_people?: number | null;
  groups?: string[] | null;
  people?: string[] | null;
}

export interface SlotActivity extends ActivitySuggestion {
  min_people?: number | null;
  max_people?: number | null;
  /** Multiple participant ranges, each with its own groups/people. Empty =
   *  the activity-level range with "Anyone". */
  who_with?: WhoWithEntry[] | null;
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
  activities: SlotActivity[];
  created_at: string | null;
}

export async function apiCreateSlot(
  dayTimeWindows: DayTimeWindow[],
  activities: SlotActivity[],
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
  activities: SlotActivity[],
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

/** A pickable person for the slot form's "Who With → Pick" list: an account
 *  the caller has shared a group with (their contacts address book). Same
 *  shape as the group invite-members candidate, without a group scope. */
export interface Contact {
  user_id: string;
  name: string | null;
  shared_group_count: number;
  last_seen_at: string;
}

/** The caller's contacts (people they've shared any group with), newest-shared
 *  first. Empty for a fresh anonymous browser with no account yet. */
export async function apiListContacts(): Promise<Contact[]> {
  return slotFetch<Contact[]>("/contacts", { method: "GET" });
}

export async function apiGetActivitySuggestions(
  dayTimeWindows: DayTimeWindow[],
): Promise<ActivitySuggestions> {
  return slotFetch<ActivitySuggestions>("/suggestions", {
    method: "POST",
    body: JSON.stringify({ day_time_windows: dayTimeWindows }),
  });
}

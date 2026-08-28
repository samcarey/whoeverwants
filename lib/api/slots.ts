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
/** One group or person a who-with points at. `id` is the real identity (a
 *  group id / account id) and `name` the display snapshot taken when it was
 *  picked, so it still renders after a rename or a deleted account. `id` is
 *  null for a name-only reference — the server nulls any id that doesn't
 *  resolve to a group the owner is in or a person in their address book. */
export interface WhoWithRef {
  id: string | null;
  name: string;
}

/** One "who with" entry on an activity: a participant range with its own set
 *  of groups and/or specific people. */
export interface WhoWithEntry {
  min_people?: number | null;
  max_people?: number | null;
  groups?: WhoWithRef[] | null;
  people?: WhoWithRef[] | null;
  /** Groups / people the owner would NOT do this activity with. */
  exclude_groups?: WhoWithRef[] | null;
  exclude_people?: WhoWithRef[] | null;
}

/** Preferred / avoided start times within the slot's window, as HH:MM start
 *  marks (day-agnostic — a slot is one day). The events engine picks a
 *  party's "@ time" by fewest dislikes → most likes → earliest, so an event
 *  lands on a preferred time rather than always the earliest viable one. */
export interface TimePrefs {
  liked: string[];
  disliked: string[];
}

export interface SlotActivity extends ActivitySuggestion {
  min_people?: number | null;
  max_people?: number | null;
  /** Multiple participant ranges, each with its own groups/people. Empty =
   *  the activity-level range with "Anyone". */
  who_with?: WhoWithEntry[] | null;
  /** Start-time preferences (see TimePrefs); null = no preference. */
  time_prefs?: TimePrefs | null;
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
/** Last-resolved slot list. Lets a surface that must paint on its FIRST
 *  commit — the playlist tab under a swipe-back backdrop — render the
 *  timeline synchronously instead of flashing a spinner while it refetches.
 *  Refreshed by every apiListSlots; never cleared (a stale list is corrected
 *  by the refetch that always follows). */
let cachedSlots: Slot[] | null = null;

export function getCachedSlots(): Slot[] | null {
  return cachedSlots;
}

export async function apiListSlots(): Promise<Slot[]> {
  const res = await slotFetch<{ slots: Slot[] }>("", { method: "GET" });
  cachedSlots = res.slots ?? [];
  return cachedSlots;
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

/** A pickable group or person for an activity's "who with": the same {id, name}
 *  a saved who-with stores, plus the who-with field the pick belongs in. */
export interface WhoWithCandidate extends WhoWithRef {
  kind: "groups" | "people";
}

/** The who-with picker's single source: the caller's groups and their address
 *  book in ONE list, most-recently-referenced first (by their own past picks)
 *  with groups and people interleaved — what you reached for last doesn't care
 *  which kind it was. Deliberately the same population the server validates
 *  saves against, so anything offered here can actually be saved. Empty for a
 *  fresh anonymous browser with no account yet. */
export async function apiGetWhoWithCandidates(): Promise<WhoWithCandidate[]> {
  const res = await slotFetch<{ candidates: WhoWithCandidate[] }>("/who-with-candidates", {
    method: "GET",
  });
  return res.candidates ?? [];
}

/** One system-proposed event as THIS viewer sees it. Derived server-side on
 *  every read from the current slots + confirmations (see
 *  services/slot_events.py) — none of this is stored, so it can flip under
 *  the viewer as others confirm/cancel, which is why the Playlist tab polls. */
export interface SlotEvent {
  /** The party's anchor row; null for the FRESH (not yet minted) party card —
   *  several parties of the same (day, activity) can coexist, and when one is
   *  full the fresh card reappears for whoever got left out. */
  id: string | null;
  day: string;
  activity: string;
  emoji: string | null;
  /** "@ time" on the card's first line: the earliest start that lets every
   *  member's minimum be met (HH:MM; the confirmed set's own start once the
   *  event is met). */
  time: string | null;
  /** The time the (confirmed + viewer) set still shares — anchors the card to
   *  a slot row. HH:MM bounds, cross-midnight convention (max <= min). */
  window: { min: string; max: string } | null;
  /** Total confirmed INCLUDING the viewer... */
  confirmed_count: number;
  /** ...but the names EXCLUDE them — the viewer's own membership renders as
   *  "you" (the "You're going!" pill, the event page's "You" row), never as
   *  their own disc. */
  confirmed_names: string[];
  viewer_confirmed: boolean;
  /** False + not confirmed = the button reads "Full" (joining would break an
   *  already-confirmed person's who-with condition). */
  can_confirm: boolean;
  /** The confirmed set satisfies everyone in it, minimums included — the
   *  event is on; the card goes bold. */
  met: boolean;
}

/** Last-resolved events list — the same first-commit-paint role cachedSlots
 *  plays for the timeline. */
let cachedEvents: SlotEvent[] | null = null;

export function getCachedSlotEvents(): SlotEvent[] | null {
  return cachedEvents;
}

export async function apiGetSlotEvents(): Promise<SlotEvent[]> {
  const res = await slotFetch<{ events: SlotEvent[] }>("/events", { method: "GET" });
  cachedEvents = res.events ?? [];
  return cachedEvents;
}

/** Toggle the caller's confirmation on (day, activity). The server re-checks
 *  the join against the CURRENT confirmed set — a race with someone else's
 *  confirm surfaces as an ApiError 409 ("Full"); refetch and the button flips
 *  to Full on its own. Returns the refreshed event as this caller sees it. */
export async function apiSetEventConfirmation(
  day: string,
  activity: string,
  confirmed: boolean,
  eventId: string | null,
): Promise<SlotEvent> {
  return slotFetch<SlotEvent>("/events/confirmation", {
    method: "POST",
    body: JSON.stringify({ day, activity, confirmed, event_id: eventId }),
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

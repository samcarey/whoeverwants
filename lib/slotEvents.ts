/**
 * Cross-component channel for the Playlist "New Slot" sheet.
 *
 * The sheet is mounted once at layout level (inside CreateGroupButtonHost), so
 * the "+ Slot" FAB and the Playlist timeline open it by dispatching an event
 * rather than threading props through the tree. Three modes:
 *   - 'create'      — the FAB: calendar + a single time slot, no activities.
 *   - 'time'        — tap a slot's time text: edit just its date/time
 *                     (delete lives here too).
 *   - 'activities'  — tap a slot's activity cards / "+ Add activities": edit
 *                     just its activities.
 * On a successful save / delete the sheet fires SLOTS_CHANGED so the Playlist
 * tab re-fetches.
 */

import type { Slot } from "@/lib/api/slots";

export const SLOT_SHEET_OPEN_EVENT = "whoeverwants:slot-sheet-open";
export const SLOTS_CHANGED_EVENT = "whoeverwants:slots-changed";

export type SlotSheetMode = "create" | "time" | "activities";

export interface SlotSheetOpenDetail {
  slot: Slot | null;
  mode: SlotSheetMode;
}

/** Open the slot sheet. Omit the slot for a new one ('create'); pass a slot +
 *  which facet to edit ('time' | 'activities'). */
export function openSlotSheet(slot?: Slot, mode?: SlotSheetMode): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SlotSheetOpenDetail>(SLOT_SHEET_OPEN_EVENT, {
      detail: { slot: slot ?? null, mode: mode ?? (slot ? "time" : "create") },
    }),
  );
}

/** Tell the Playlist tab a slot was created / edited / deleted. */
export function notifySlotsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SLOTS_CHANGED_EVENT));
}

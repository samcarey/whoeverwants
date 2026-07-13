/**
 * Cross-component channel for the Playlist "New Slot" sheet.
 *
 * The sheet is mounted once at layout level (inside CreateGroupButtonHost), so
 * both the "+ Slot" FAB (new) and a Playlist card tap (edit) open it by
 * dispatching an event rather than threading props through the tree. On a
 * successful save / delete the sheet fires SLOTS_CHANGED so the Playlist tab
 * re-fetches.
 */

import type { Slot } from "@/lib/api/slots";

export const SLOT_SHEET_OPEN_EVENT = "whoeverwants:slot-sheet-open";
export const SLOTS_CHANGED_EVENT = "whoeverwants:slots-changed";

/** Open the create-slot sheet. Pass a slot to edit it; omit for a new slot. */
export function openSlotSheet(slot?: Slot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ slot: Slot | null }>(SLOT_SHEET_OPEN_EVENT, {
      detail: { slot: slot ?? null },
    }),
  );
}

/** Tell the Playlist tab a slot was created / edited / deleted. */
export function notifySlotsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SLOTS_CHANGED_EVENT));
}

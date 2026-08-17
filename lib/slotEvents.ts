/**
 * Cross-component channel for the Playlist slot sheet.
 *
 * The sheet is mounted once at layout level (inside CreateGroupButtonHost), so
 * the "+ Slot" FAB and the Playlist timeline open it by dispatching an event
 * rather than threading props through the tree. Three modes:
 *   - 'create'    — the FAB: calendar + a single time slot, no activities.
 *   - 'time'      — tap a slot's time text: edit just its date/time
 *                   (delete-the-slot lives here too).
 *   - 'activity'  — tap one of a slot's activity circles (or its "+"): edit
 *                   THAT ONE activity — name, emoji, who-with — with a delete
 *                   button when it already exists. `activityIndex` names which
 *                   one; omit (or null) to add a new one.
 * On a successful save / delete the sheet fires SLOTS_CHANGED so the Playlist
 * tab re-fetches.
 */

import type { Slot } from "@/lib/api/slots";

export const SLOT_SHEET_OPEN_EVENT = "whoeverwants:slot-sheet-open";
export const SLOTS_CHANGED_EVENT = "whoeverwants:slots-changed";

export type SlotSheetMode = "create" | "time" | "activity";

export interface SlotSheetOpenDetail {
  slot: Slot | null;
  mode: SlotSheetMode;
  /** 'activity' mode only: which of the slot's activities to edit. null = add
   *  a new one. */
  activityIndex: number | null;
}

/** Open the slot sheet. Omit the slot for a new one ('create'); pass a slot +
 *  which facet to edit ('time' | 'activity'). In 'activity' mode pass the
 *  activity's index to edit it, or omit it to add a new activity. */
export function openSlotSheet(
  slot?: Slot,
  mode?: SlotSheetMode,
  activityIndex?: number | null,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SlotSheetOpenDetail>(SLOT_SHEET_OPEN_EVENT, {
      detail: {
        slot: slot ?? null,
        mode: mode ?? (slot ? "time" : "create"),
        activityIndex: activityIndex ?? null,
      },
    }),
  );
}

/** Tell the Playlist tab a slot was created / edited / deleted. */
export function notifySlotsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SLOTS_CHANGED_EVENT));
}

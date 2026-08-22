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
/** The add-activity panel opened / closed — the timeline hides its column
 *  headers while it's up so the tapped row's day + time sit at the very top.
 *  detail: boolean (active). */
export const SLOT_ADD_PANEL_EVENT = "whoeverwants:slot-add-panel";

/** CSS var holding the column headers' sticky height. The day divider parks at
 *  it and each row's time parks under that, so zeroing it (while the add panel
 *  is up, with the headers hidden) slides both tiers to the top of the screen
 *  without touching the document's height. */
export const PLAYLIST_HEADER_H_VAR = "--playlist-header-h";

export function setAddPanelActive(active: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<boolean>(SLOT_ADD_PANEL_EVENT, { detail: active }));
}

export type SlotSheetMode = "create" | "time" | "activity";

export interface SlotSheetOpenDetail {
  slot: Slot | null;
  mode: SlotSheetMode;
  /** 'activity' mode only: which of the slot's activities to edit. null = add
   *  a new one. */
  activityIndex: number | null;
  /** Viewport y the ADD panel should hang from — the bottom of the "+" that
   *  opened it, measured AFTER `scrollAnchorToTop` put it at the top of the
   *  screen. Absent → the panel pins to the top of the viewport. */
  anchorBottom: number | null;
}

/** Open the slot sheet. Omit the slot for a new one ('create'); pass a slot +
 *  which facet to edit ('time' | 'activity'). In 'activity' mode pass the
 *  activity's index to edit it, or omit it to add a new activity. */
export function openSlotSheet(
  slot?: Slot,
  mode?: SlotSheetMode,
  activityIndex?: number | null,
  anchorBottom?: number | null,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SlotSheetOpenDetail>(SLOT_SHEET_OPEN_EVENT, {
      detail: {
        slot: slot ?? null,
        mode: mode ?? (slot ? "time" : "create"),
        activityIndex: activityIndex ?? null,
        anchorBottom: anchorBottom ?? null,
      },
    }),
  );
}

/** Smooth-scroll the tapped row so its day divider + time land at the top of
 *  the screen — the column headers drop out of the flow, pulling everything up
 *  by their height and shifting both sticky tiers to the top — and return the
 *  viewport y the add panel should hang from: just under that row's time.
 *
 *  Everything is computed from the row's NORMAL-FLOW position, before the
 *  scroll starts — the time chip may already be stuck, so its current rect
 *  isn't a reliable input, and a smooth scroll can't be measured after the
 *  fact. When the page can't scroll far enough (the row is near the document
 *  end) the shortfall is added back, so the panel still lands under the row's
 *  real resting place rather than an assumed one.
 */
export function anchorRowForAddPanel(plusEl: HTMLElement): number | null {
  const card = plusEl.closest<HTMLElement>("[data-slot-card]");
  const chip = card?.querySelector<HTMLElement>("[data-slot-time]");
  if (!card || !chip) return null;

  const headerH = document.querySelector<HTMLElement>("[data-playlist-headers]")?.offsetHeight ?? 0;
  // Where the chip parks once the headers are hidden.
  const chipTop = (parseFloat(getComputedStyle(chip).top) || 0) - headerH;
  const cardPadTop = parseFloat(getComputedStyle(card).paddingTop) || 0;
  const chipH = chip.getBoundingClientRect().height;

  // The headers are about to leave the flow, pulling every row up by their
  // height — so the page needs that much LESS scroll, and has that much less
  // to give. (They sit above every row, so the shift is uniform.)
  const want =
    window.scrollY + card.getBoundingClientRect().top - (chipTop - cardPadTop) - headerH;
  const maxScroll = Math.max(
    0,
    document.documentElement.scrollHeight - headerH - window.innerHeight,
  );
  const target = Math.min(Math.max(0, want), maxScroll);
  window.scrollTo({ top: target, behavior: "smooth" });

  // The chip's settled BOTTOM — the panel adds its own gap under it.
  return chipTop + Math.max(0, want - target) + chipH;
}

/** Tell the Playlist tab a slot was created / edited / deleted. */
export function notifySlotsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SLOTS_CHANGED_EVENT));
}

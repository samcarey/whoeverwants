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
  /** DOCUMENT y the ADD panel is pinned at — just under the "+" that opened
   *  it (see anchorRowForAddPanel). Absent → the panel pins to the top of the
   *  viewport instead. */
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

/** Pin the add panel just under the tapped "+" IN THE DOCUMENT (not the
 *  viewport) and smooth-scroll until that lands at the top of the screen —
 *  so the whole page slides up and the text box ends up at the top, clear of
 *  the keyboard. Returns the panel's document y.
 *
 *  Two adjustments make the target reachable and correct:
 *   - the column headers leave the flow when the panel opens, pulling every
 *     row (and so the anchor) up by their height;
 *   - the timeline grows a viewport of bottom padding while the panel is up
 *     (see PlaylistTab), so even the LAST row can reach the top instead of
 *     stopping at the document's end — the "page hardly moves" case.
 */
export function anchorRowForAddPanel(plusEl: HTMLElement): number {
  const headerH = document.querySelector<HTMLElement>("[data-playlist-headers]")?.offsetHeight ?? 0;
  return window.scrollY + plusEl.getBoundingClientRect().bottom + 8 - headerH;
}

/** Smooth-scroll so the panel pinned at `docY` sits at the top of the screen.
 *  Called from the panel's own mount effect, NOT the tap: the scroll room it
 *  needs (the timeline's extra bottom padding) and the header collapse both
 *  land with that render, a commit or two after the tap. */
export function scrollAddPanelToTop(docY: number): void {
  window.scrollTo({ top: Math.max(0, docY - safeAreaTop()), behavior: "smooth" });
}

/** env(safe-area-inset-top) in px, via a throwaway probe — the notch band the
 *  panel has to clear. 0 on every non-notched surface. */
function safeAreaTop(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top,0px);pointer-events:none;opacity:0;";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/** Tell the Playlist tab a slot was created / edited / deleted. */
export function notifySlotsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SLOTS_CHANGED_EVENT));
}

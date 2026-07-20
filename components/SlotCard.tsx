"use client";

/**
 * One availability WINDOW of a Playlist slot, borderless — vertical spacing
 * alone separates rows. A slot with several windows explodes into several of
 * these rows (each its own vertical space); see slotWindowEntries.
 *   - LEFT column, starting level with the circles' top: this window's
 *     start–end time (left-justified, with an end date only when the window
 *     crosses midnight), a decimal-hour duration note ("2.25h"), and the
 *     events placeholder beneath. The day + relative specifier ("Tomorrow") is
 *     NOT here — it's a per-day divider header rendered above each group of
 *     same-day rows in PlaylistTab.
 *   - RIGHT (remaining space): one faded CARD per activity, tinted with that
 *     activity's color (consistent per activity across the timeline). The
 *     activity's emoji hangs off the card's upper-left corner (outside it);
 *     inside, the participant range renders in the activity's color followed
 *     by the groups + people the owner is willing to do it with ("Anyone"
 *     when none are set).
 *
 * Tapping the row opens the create-slot sheet in edit mode (for the whole slot).
 */

import { memo } from "react";
import type { Slot } from "@/lib/api/slots";
import {
  activityColor,
  formatPeopleRange,
  type ActivityColor,
  type SlotWindowLine,
} from "@/lib/slotUtils";
import { openSlotSheet } from "@/lib/slotEvents";

interface SlotCardProps {
  slot: Slot;
  /** The single availability window this row represents. */
  line: SlotWindowLine;
  colors: Map<string, ActivityColor>;
}

function SlotCardImpl({ slot, line, colors }: SlotCardProps) {
  // Resolve each activity's color + participant range once.
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
    range: formatPeopleRange(a.min_people, a.max_people),
  }));

  return (
    <button
      type="button"
      onClick={() => openSlotSheet(slot)}
      aria-label="Edit slot"
      className="w-full text-left py-2 pr-3 pl-1 active:opacity-70 transition-opacity"
    >
      {/* One row: the time span + events placeholder in the LEFT column
          (sized to the one-line time text), activity CARDS filling the
          remaining RIGHT space. Each card: emoji hanging off the upper-left
          corner (outside the card), then the participant range (activity
          color) followed by the groups + people. The cards START at the same
          horizontal level as the time text (items-start on the row). */}
      <div className="flex items-start">
        <div className="shrink-0">
          {/* This window's time span on ONE line (nowrap — the column sizes to
              it, so the duration never wraps), left-justified flush with the
              day header text (pl-1 matches the divider's px-1). Font is bumped
              ~20% over the timeline's baseline. */}
          <div className="text-[14.4px] text-gray-500 dark:text-gray-400 flex items-baseline gap-x-1 whitespace-nowrap">
            <span>{line.startTime}</span>
            <span>–</span>
            {line.endDate && <span>{line.endDate} ·</span>}
            <span>{line.endTime}</span>
            <span className="text-gray-400 dark:text-gray-500">· {line.duration}</span>
          </div>
          <div className="mt-2 text-sm text-gray-400 dark:text-gray-500">
            No events yet…
          </div>
        </div>
        {activities.length > 0 && (
          <div className="flex-1 min-w-0 flex flex-wrap justify-end gap-x-2 gap-y-2 pl-2">
            {activities.map((a, i) => {
              const groups = a.with_groups ?? [];
              const people = a.with_people ?? [];
              return (
                // pl reserves room for the emoji's out-hanging half. The
                // emoji sits just below the card's top edge (top-0.5), still
                // overlapping the card's left edge; the card's extra left
                // padding keeps the text clear of it.
                <div key={`${a.name}#${i}`} title={a.name} className="relative pl-2.5 max-w-full">
                  <span
                    className="emoji-outline absolute top-0.5 left-0 text-[22px] leading-none z-10 pointer-events-none"
                    aria-hidden="true"
                  >
                    {a.emoji || a.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className={`rounded-xl pl-[18px] pr-3 py-1.5 ${a.color.faded}`}>
                    <span className="text-xs leading-tight">
                      {a.range && (
                        <span className={`text-[13.5px] font-semibold tabular-nums ${a.color.text}`}>
                          {a.range}
                        </span>
                      )}
                      {(groups.length > 0 || people.length > 0) ? (
                        <>
                          {a.range && " "}
                          {groups.length > 0 && (
                            <span className="font-medium text-gray-600 dark:text-gray-300">
                              {groups.join(", ")}
                            </span>
                          )}
                          {groups.length > 0 && people.length > 0 && (
                            <span className="text-gray-400 dark:text-gray-500"> · </span>
                          )}
                          {people.length > 0 && (
                            <span className="text-gray-600 dark:text-gray-300">{people.join(", ")}</span>
                          )}
                        </>
                      ) : (
                        <>
                          {a.range && " "}
                          <span className="text-gray-500 dark:text-gray-400">Anyone</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </button>
  );
}

export default memo(SlotCardImpl);

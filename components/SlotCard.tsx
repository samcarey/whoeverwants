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
 *     inside, ONE LINE PER who-with entry — that entry's participant range in
 *     the activity's color followed by its own groups + people ("Anyone" when
 *     none are set; no entries → a single line with the activity-level range).
 *
 * Tap targets (each opens the slot sheet on ONE facet):
 *   - the time text → edit just the date/time ('time' mode);
 *   - the activity cards (or the "+ Add activities" button shown while the
 *     slot has none) → edit just the activities ('activities' mode).
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
  // Resolve each activity's color + who-with entries once. No entries → one
  // fallback line carrying the activity-level range (with "Anyone").
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
    entries:
      a.who_with && a.who_with.length > 0
        ? a.who_with
        : [{ min_people: a.min_people, max_people: a.max_people, groups: null, people: null }],
  }));

  return (
    <div className="w-full py-2 pr-3 pl-1">
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
              ~20% over the timeline's baseline. Tapping it edits the slot's
              date/time. */}
          <button
            type="button"
            onClick={() => openSlotSheet(slot, "time")}
            aria-label="Edit slot time"
            className="text-[14.4px] text-gray-500 dark:text-gray-400 flex items-baseline gap-x-1 whitespace-nowrap active:opacity-70"
          >
            <span>{line.startTime}</span>
            <span>–</span>
            {line.endDate && <span>{line.endDate} ·</span>}
            <span>{line.endTime}</span>
            <span className="text-gray-400 dark:text-gray-500">· {line.duration}</span>
          </button>
          <div className="mt-2 text-sm text-gray-400 dark:text-gray-500">
            No events yet…
          </div>
        </div>
        {activities.length === 0 ? (
          /* Blank slot: button to start adding activities. */
          <div className="flex-1 min-w-0 flex justify-end pl-2">
            <button
              type="button"
              onClick={() => openSlotSheet(slot, "activities")}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 active:scale-95 transition"
            >
              + Add activities
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openSlotSheet(slot, "activities")}
            aria-label="Edit slot activities"
            className="flex-1 min-w-0 flex flex-wrap justify-end gap-x-2 gap-y-2 pl-2 text-left active:opacity-70"
          >
            {activities.map((a, i) => (
              // pl reserves room for the emoji's out-hanging half. The emoji
              // is centered on the card's FIRST text line (card py-1.5 6px +
              // half the ~17px line box − half the 22px emoji ≈ 3px down) —
              // which centers it on the whole card for the common one-line
              // case, and keeps it at the first line when the card has more
              // who-with lines. Still overlaps the card's left edge; the
              // card's extra left padding keeps the text clear of it.
              <div key={`${a.name}#${i}`} title={a.name} className="relative pl-2.5 max-w-full">
                <span
                  className="emoji-outline absolute top-[3px] left-0 text-[22px] leading-none z-10 pointer-events-none"
                  aria-hidden="true"
                >
                  {a.emoji || a.name.trim().charAt(0).toUpperCase()}
                </span>
                {/* One line per who-with entry: its range (activity color)
                    then that entry's groups + people (or "Anyone"). */}
                <div className={`rounded-xl pl-[18px] pr-3 py-1.5 space-y-0.5 ${a.color.faded}`}>
                  {a.entries.map((w, j) => {
                    const range = formatPeopleRange(w.min_people, w.max_people);
                    const groups = w.groups ?? [];
                    const people = w.people ?? [];
                    return (
                      // Range in its own fixed column (shrink-0) with the
                      // names wrapping in theirs — so a 2nd+ line of
                      // groups/people hang-indents under the first name,
                      // not under the range.
                      <div key={j} className="text-xs leading-tight flex items-baseline gap-1">
                        {range && (
                          <span className={`shrink-0 text-[13.5px] font-semibold tabular-nums ${a.color.text}`}>
                            {range}
                          </span>
                        )}
                        {groups.length > 0 || people.length > 0 ? (
                          <span className="min-w-0">
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
                          </span>
                        ) : (
                          <span className="min-w-0 text-gray-500 dark:text-gray-400">Anyone</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(SlotCardImpl);

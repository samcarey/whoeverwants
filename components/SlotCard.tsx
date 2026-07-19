"use client";

/**
 * One availability WINDOW of a Playlist slot, borderless — vertical spacing
 * alone separates rows. A slot with several windows explodes into several of
 * these rows (each its own vertical space); see slotWindowEntries.
 *   - At the TOP, centered: this window's start–end time (with an end date only
 *     when the window crosses midnight) and a decimal-hour duration note
 *     ("2.25h"). The day + relative specifier ("Tomorrow") is NOT here — it's a
 *     per-day divider header rendered above each group of same-day rows in
 *     PlaylistTab.
 *   - Below the time, filling the LEFT 60% of the row: one faded circle per
 *     activity, tinted with that activity's color (consistent per activity
 *     across the timeline). Each circle holds a large emoji and, when a
 *     participant range is set, a small "2–5" bubble directly beneath it.
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
      className="w-full text-left py-2 px-3 active:opacity-70 transition-opacity"
    >
      {/* This window's time span, left-justified at the top of the slot area.
          Font is bumped ~20% over the timeline's baseline for legibility. */}
      <div className="text-[14.4px] text-gray-500 dark:text-gray-400 flex flex-wrap items-baseline gap-x-1">
        <span>{line.startTime}</span>
        <span>–</span>
        {line.endDate && <span>{line.endDate} ·</span>}
        <span>{line.endTime}</span>
        <span className="text-gray-400 dark:text-gray-500">· {line.duration}</span>
      </div>

      {/* Below the time: activities in the LEFT 60% (a faded circle per
          activity, big emoji atop, participant bubble directly beneath), and an
          events placeholder in the remaining right space. */}
      <div className="mt-2 flex items-start">
        {activities.length > 0 && (
          <div className="flex flex-wrap gap-2" style={{ width: "60%" }}>
            {activities.map((a, i) => (
              <div
                key={`${a.name}#${i}`}
                title={a.name}
                className={`flex flex-col items-center justify-center shrink-0 rounded-full w-16 h-16 ${a.color.faded}`}
              >
                <span className="text-[30px] leading-none" aria-hidden="true">
                  {a.emoji || a.name.trim().charAt(0).toUpperCase()}
                </span>
                {a.range && (
                  <span
                    className={`mt-0.5 text-[13.5px] leading-none font-semibold tabular-nums ${a.color.text}`}
                  >
                    {a.range}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 min-w-0 self-center text-center text-sm text-gray-400 dark:text-gray-500">
          No events yet…
        </div>
      </div>
    </button>
  );
}

export default memo(SlotCardImpl);

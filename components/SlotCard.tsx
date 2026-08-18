"use client";

/**
 * One availability WINDOW of a Playlist slot, borderless — vertical spacing
 * alone separates rows. A slot with several windows explodes into several of
 * these rows (each its own vertical space); see slotWindowEntries.
 *   - LEFT column, top-aligned: this window's start–end time (left-justified
 *     and underlined, with an end date only when the window crosses midnight),
 *     a decimal-hour duration note ("2.25h") trailing it undecorated, and the
 *     events placeholder beneath. The day +
 *     relative specifier ("Tomorrow") is NOT here — it's a per-day divider
 *     header rendered above each group of same-day rows in PlaylistTab.
 *   - RIGHT (remaining space): a CLUSTER of tinted circles, one per activity,
 *     each showing just that activity's symbol (its emoji, or the first letter
 *     of its name) centered inside. The circle carries the activity's hue at
 *     low opacity behind a hairline border of the same hue, consistent for that
 *     activity across the whole timeline.
 *     The circles are hex-packed into balanced, half-pitch-offset rows (see
 *     clusterLayout) with the "+" as the last circle of the pattern, and the
 *     whole cluster is centered both ways in the row. Details (participant
 *     ranges, who-with) live in the per-activity sheet, not on the circle.
 *
 * Tap targets (each opens the slot sheet on ONE facet):
 *   - the time text → edit just the date/time ('time' mode);
 *   - an activity circle → edit just THAT activity ('activity' mode, its index);
 *   - the "+" circle → add a new activity ('activity' mode, no index).
 */

import { memo, useMemo } from "react";
import type { Slot } from "@/lib/api/slots";
import {
  activityColor,
  clusterLayout,
  CLUSTER_CIRCLE_PX,
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

/** The glyph shown inside an activity's circle: its emoji, else the first
 *  letter of its name (uppercased). */
function activitySymbol(name: string, emoji: string | null): string {
  return emoji || name.trim().charAt(0).toUpperCase() || "?";
}

function SlotCardImpl({ slot, line, colors }: SlotCardProps) {
  // Resolve each activity's color once (stable per activity name across the
  // whole timeline — see buildActivityColorMap).
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
  }));

  // One slot per activity plus a trailing one for the "+", so the add button
  // is the last circle of the pattern rather than an outlier beside it.
  const layout = useMemo(() => clusterLayout(activities.length + 1), [activities.length]);
  const plusPosition = layout.positions[activities.length];

  return (
    <div className="w-full py-1.5 pr-3 pl-1">
      {/* One row: the time span + events placeholder in the LEFT column (sized
          to the one-line time text), the activity cluster filling the
          remaining RIGHT space with the "+" pinned to its right edge. The row
          stretches so the right side can center its cluster against the full
          height of the left column. */}
      <div className="flex items-stretch">
        {/* The time is this row's header, so it sticks under the day divider
            (82.8px = the column headers' 39.6px + the divider's 29.2px + the
            14px that separates them at rest, so nothing shifts when it locks)
            while this row's activities scroll past it, and rides out as the
            row ends and the next row's time takes its place.
            self-start is load-bearing: a stretched box has no room to slide
            inside itself, so sticky would be a no-op without it.
            Sticking is scoped to this row, so nothing ever passes underneath —
            hence no background or fade of its own. z sits between the circles
            (z-10) and the day divider (z-20): a time being pushed out by the
            end of its row rides up UNDER the divider rather than over its
            date. */}
        <div className="sticky top-[82.8px] z-[15] shrink-0 self-start">
          {/* This window's time span on ONE line (nowrap — the column sizes to
              it, so the duration never wraps), left-justified flush with the
              day header text (the row's pl-1 matches the divider's px-1).
              Font is bumped ~20% over the timeline's baseline. Tapping it
              edits the slot's date/time.
              The range is ONE inline run rather than flex items so its
              underline stays unbroken across the spaces; the duration note
              trails it undecorated. */}
          <button
            type="button"
            onClick={() => openSlotSheet(slot, "time")}
            aria-label="Edit slot time"
            className="text-[14.4px] text-gray-500 dark:text-gray-400 whitespace-nowrap active:opacity-70"
          >
            <span className="underline underline-offset-2 decoration-gray-300 dark:decoration-gray-600">
              {line.startTime} – {line.endDate ? `${line.endDate} · ` : ""}
              {line.endTime}
            </span>{" "}
            <span className="text-gray-400 dark:text-gray-500">· {line.duration}</span>
          </button>
          <div className="mt-2 text-sm text-gray-400 dark:text-gray-500">
            No events yet…
          </div>
        </div>
        {/* pl-3 is the gutter between the two columns — the circles pack out
            to the cluster's edge, so the time text needs the room. */}
        <div className="flex-1 min-w-0 flex items-center justify-center pl-3 py-1">
          {/* Every circle is absolutely placed from the hex layout, so the box
              only has to reserve the cluster's measured size. */}
          <div
            className="relative shrink-0"
            style={{ width: layout.width, height: layout.height }}
          >
            {activities.map((a, i) => (
              <button
                key={`${a.name}#${i}`}
                type="button"
                onClick={() => openSlotSheet(slot, "activity", i)}
                title={a.name}
                aria-label={`Edit ${a.name}`}
                style={{
                  left: layout.positions[i].x,
                  top: layout.positions[i].y,
                  width: CLUSTER_CIRCLE_PX,
                  height: CLUSTER_CIRCLE_PX,
                }}
                className={`absolute rounded-full border-[0.5px] flex items-center justify-center text-[21px] leading-none active:scale-95 transition ${a.color.faded} ${a.color.border} ${a.color.text}`}
              >
                <span aria-hidden="true">{activitySymbol(a.name, a.emoji)}</span>
              </button>
            ))}
            {/* Last circle of the pattern — the only way to add an activity. */}
            <button
              type="button"
              onClick={() => openSlotSheet(slot, "activity")}
              aria-label="Add an activity"
              style={{
                left: plusPosition.x,
                top: plusPosition.y,
                width: CLUSTER_CIRCLE_PX,
                height: CLUSTER_CIRCLE_PX,
              }}
              className="absolute rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 flex items-center justify-center hover:border-gray-400 dark:hover:border-gray-500 active:scale-95 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(SlotCardImpl);

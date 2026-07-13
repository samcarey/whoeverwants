"use client";

/**
 * One Playlist slot rendered as a full-width card:
 *   - Across the top: the availability span in small text — the START date
 *     with its relative specifier ("Tomorrow", in blue) and time, a dash, the
 *     END date (only when the span crosses days) and time, then the total
 *     availability as a decimal-hour note ("2.25h").
 *   - Down the left: one vertical colored bar per activity (side by side with
 *     a small gap), each with its emoji at the top. Colors come from the
 *     timeline-wide activity map (consistent per activity, contrasting, pretty
 *     in both themes).
 *   - To the right of the bars: the activity names, color-matched.
 *
 * Tapping the card opens the create-slot sheet in edit mode.
 */

import { memo } from "react";
import type { Slot } from "@/lib/api/slots";
import { slotHeader, activityColor, type ActivityColor } from "@/lib/slotUtils";
import { openSlotSheet } from "@/lib/slotEvents";

interface SlotCardProps {
  slot: Slot;
  colors: Map<string, ActivityColor>;
}

function SlotCardImpl({ slot, colors }: SlotCardProps) {
  const header = slotHeader(slot.day_time_windows);
  // Resolve each activity's color once; both the bars column and the name
  // list read it.
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
  }));

  return (
    <button
      type="button"
      onClick={() => openSlotSheet(slot)}
      aria-label="Edit slot"
      className="w-full text-left rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 active:scale-[0.99] transition-transform"
    >
      {/* Availability span across the top. */}
      {header && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 flex flex-wrap items-baseline gap-x-1">
          <span className="text-blue-600 dark:text-blue-400 font-medium">
            {header.relative}
          </span>
          <span>{header.startDate}</span>
          <span>· {header.startTime}</span>
          <span>–</span>
          {header.endDate && <span>{header.endDate} ·</span>}
          <span>{header.endTime}</span>
          <span className="text-gray-400 dark:text-gray-500">· {header.duration}</span>
        </div>
      )}

      {/* Vertical activity bars (emoji atop) + color-matched names. */}
      {activities.length > 0 && (
        <div className="flex items-stretch gap-3">
          <div className="flex items-end gap-1.5 shrink-0">
            {activities.map((a, i) => (
              <div key={`${a.name}#${i}`} className="flex flex-col items-center gap-1">
                <span className="text-base leading-none h-5 flex items-center justify-center" aria-hidden="true">
                  {a.emoji || ""}
                </span>
                <div
                  className={`w-1.5 rounded-full ${a.color.bar}`}
                  style={{ height: "3.25rem" }}
                  title={a.name}
                />
              </div>
            ))}
          </div>
          <ul className="min-w-0 flex-1 self-center space-y-0.5">
            {activities.map((a, i) => (
              <li
                key={`${a.name}#${i}`}
                className={`truncate text-sm font-medium ${a.color.text}`}
              >
                {a.emoji ? `${a.emoji} ` : ""}
                {a.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </button>
  );
}

export default memo(SlotCardImpl);

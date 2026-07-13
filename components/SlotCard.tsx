"use client";

/**
 * One Playlist slot, borderless — vertical spacing alone separates cards:
 *   - Down the left: one thin vertical colored bar per activity (side by side
 *     with a small gap), each with its emoji at the top. The emoji is absolutely
 *     centered over its bar and allowed to overflow/overlap its neighbors a
 *     little. Colors come from the timeline-wide activity map (consistent per
 *     activity, contrasting, pretty in both themes; darker in light mode and
 *     lighter in dark mode).
 *   - To the RIGHT of the bars: the availability span in small text — the START
 *     date with its relative specifier ("Tomorrow", in blue) and time, a dash,
 *     the END date (only when the span crosses days) and time, then the total
 *     availability as a decimal-hour note ("2.25h").
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
  // Resolve each activity's color once.
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
  }));

  return (
    <button
      type="button"
      onClick={() => openSlotSheet(slot)}
      aria-label="Edit slot"
      className="w-full text-left py-1.5 pl-3 flex items-start gap-[19.2px] active:opacity-70 transition-opacity"
    >
      {/* Vertical activity bars with the emoji centered atop each (overflowing
          into neighbors a little by design). */}
      {activities.length > 0 && (
        <div className="flex items-end gap-3 shrink-0 pt-6">
          {activities.map((a, i) => (
            <div key={`${a.name}#${i}`} className="relative flex flex-col items-center">
              {a.emoji && (
                <span
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 text-[18.4px] leading-none pointer-events-none"
                  aria-hidden="true"
                >
                  {a.emoji}
                </span>
              )}
              <div
                className={`w-[3px] rounded-full ${a.color.bar}`}
                style={{ height: "3.25rem" }}
                title={a.name}
              />
            </div>
          ))}
        </div>
      )}

      {/* Availability span, to the right of the bars — vertically centered
          with the emoji row atop the bars (min-h-6 = the pt-6 emoji band). */}
      {header && (
        <div className="min-w-0 min-h-6 flex items-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-baseline gap-x-1">
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
        </div>
      )}
    </button>
  );
}

export default memo(SlotCardImpl);

"use client";

/**
 * One Playlist slot, borderless — vertical spacing alone separates cards:
 *   - Down the left: one thin vertical colored bar per activity (side by side
 *     with a small gap), each with its emoji at the top. The emoji is absolutely
 *     centered over its bar and allowed to overflow/overlap its neighbors a
 *     little. Colors come from the timeline-wide activity map (consistent per
 *     activity, contrasting, pretty in both themes; darker in light mode and
 *     lighter in dark mode).
 *   - To the RIGHT of the bars: ONE line per availability window (chronological)
 *     — each with its own date + relative specifier ("Tomorrow", in blue), the
 *     start–end time (with an end date only when that window crosses midnight),
 *     and a decimal-hour duration note ("2.25h"). Disjoint windows render as
 *     separate lines, not a single collapsed span.
 *
 * Tapping the card opens the create-slot sheet in edit mode.
 */

import { memo } from "react";
import type { Slot } from "@/lib/api/slots";
import { slotWindowLines, activityColor, type ActivityColor } from "@/lib/slotUtils";
import { openSlotSheet } from "@/lib/slotEvents";

// The activity-bars column is a FIXED width — the space 4 bars occupy at the
// comfortable "emojis just barely not touching" pitch — so every card's text
// starts at the same x regardless of activity count. ≤4 activities center in it
// at that pitch (empty margins for fewer); >4 compress (gap shrinks so they
// still fit, emojis overlapping more and more).
const BAR_WIDTH_PX = 3;
// Center-to-center gap between bars for ≤4 activities (gap = pitch − bar width).
// Sized so 4 emojis sit close but readable within the fixed column.
const COMFORTABLE_GAP_PX = 14;
// Width of exactly 4 bars at the comfortable gap: 4·bar + 3·gap.
const BAR_AREA_WIDTH_PX = 4 * BAR_WIDTH_PX + 3 * COMFORTABLE_GAP_PX; // 54
// Target min center-to-center distance between emoji glyphs before they read as
// overlapping (the emoji box renders ~23px at text-[18.4px]; the visible glyph
// is a hair smaller, so a slightly-under target avoids over-staggering).
const EMOJI_CLEAR_PX = 21;

interface SlotCardProps {
  slot: Slot;
  colors: Map<string, ActivityColor>;
}

function SlotCardImpl({ slot, colors }: SlotCardProps) {
  // One line per availability window (chronological) — disjoint windows show
  // as separate lines, not one collapsed span.
  const lines = slotWindowLines(slot.day_time_windows);
  // Resolve each activity's color once.
  const activities = slot.activities.map((a) => ({
    ...a,
    color: activityColor(a.name, colors),
  }));

  // Bars fill the fixed column: ≤4 keep the comfortable gap (centered, margins
  // for fewer); >4 shrink the gap to pack N bars into BAR_AREA_WIDTH_PX.
  const n = activities.length;
  const barGap =
    n <= 4
      ? COMFORTABLE_GAP_PX
      : Math.max(0, (BAR_AREA_WIDTH_PX - n * BAR_WIDTH_PX) / (n - 1));

  // As bars pack tighter the ~23px emojis start to overlap. Stagger every other
  // emoji vertically (symmetric ±) by just enough that adjacent ones clear —
  // growing as the pitch shrinks, zero once they'd already fit horizontally.
  const pitch = BAR_WIDTH_PX + barGap;
  const emojiStagger =
    n < 2 || pitch >= EMOJI_CLEAR_PX
      ? 0
      : Math.sqrt(EMOJI_CLEAR_PX ** 2 - pitch ** 2) / 2;

  return (
    <button
      type="button"
      onClick={() => openSlotSheet(slot)}
      aria-label="Edit slot"
      className="w-full text-left py-1.5 pl-3 flex items-start gap-[19.2px] active:opacity-70 transition-opacity"
    >
      {/* Vertical activity bars with the emoji centered atop each (overflowing
          into neighbors a little by design), in a fixed-width column so the
          text always starts at the same x. */}
      {activities.length > 0 && (
        <div
          className="flex items-end justify-center shrink-0 pt-6"
          style={{ width: `${BAR_AREA_WIDTH_PX}px`, columnGap: `${barGap}px` }}
        >
          {activities.map((a, i) => {
            // Every other emoji shifts up / down so overlapping neighbors clear.
            const dy = emojiStagger === 0 ? 0 : i % 2 === 0 ? -emojiStagger : emojiStagger;
            return (
              <div key={`${a.name}#${i}`} className="relative flex flex-col items-center">
                {a.emoji && (
                  <span
                    className="absolute bottom-full left-1/2 mb-0.5 text-[18.4px] leading-none pointer-events-none"
                    style={{ transform: `translate(-50%, ${dy}px)` }}
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
            );
          })}
        </div>
      )}

      {/* One line per availability window, to the right of the bars. A single
          window sits centered against the emoji row atop the bars (min-h-6 =
          the pt-6 emoji band); multiple windows stack downward from there. */}
      {lines.length > 0 && (
        <div className="min-w-0 min-h-6 flex flex-col justify-center gap-1">
          {lines.map((line, i) => (
            <div
              key={`${line.key}#${i}`}
              className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-baseline gap-x-1"
            >
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                {line.relative}
              </span>
              <span>{line.date}</span>
              <span>· {line.startTime}</span>
              <span>–</span>
              {line.endDate && <span>{line.endDate} ·</span>}
              <span>{line.endTime}</span>
              <span className="text-gray-400 dark:text-gray-500">· {line.duration}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

export default memo(SlotCardImpl);

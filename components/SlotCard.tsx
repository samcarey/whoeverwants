"use client";

/**
 * One availability WINDOW of a Playlist slot, borderless — vertical spacing
 * alone separates rows. A slot with several windows explodes into several of
 * these rows (each its own set of bars + its own vertical space); see
 * slotWindowEntries.
 *   - Down the left: one thin vertical colored bar per activity (side by side
 *     with a small gap), each with its emoji at the top and, when set, a tiny
 *     participant-range bubble ("2–5") at the bottom. Every-other bar is shifted
 *     up/down as they compress, so BOTH the emojis (top) and the range bubbles
 *     (bottom) clear their overlapping neighbors — the bar ends alternate too.
 *     Colors come from the timeline-wide activity map (consistent per activity,
 *     contrasting, pretty in both themes; darker in light mode, lighter in dark).
 *   - To the RIGHT of the bars: this window's start–end time (with an end date
 *     only when the window crosses midnight) and a decimal-hour duration note
 *     ("2.25h"). The day + relative specifier ("Tomorrow") is NOT here — it's a
 *     per-day divider header rendered above each group of same-day rows in
 *     PlaylistTab.
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
  /** The single availability window this row represents. */
  line: SlotWindowLine;
  colors: Map<string, ActivityColor>;
}

function SlotCardImpl({ slot, line, colors }: SlotCardProps) {
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

  // Each bar is a FIXED height; the whole bar (emoji at top, range bubble at
  // bottom) is shifted vertically per-activity by the same stagger as the
  // emojis, so BOTH ends alternate up/down. The emoji rides the bar's top; the
  // participant-range bubble rides its bottom. The column reserves top room for
  // the highest emoji and bottom room for the lowest range bubble.
  const hasRange = activities.some(
    (a) => formatPeopleRange(a.min_people, a.max_people) !== null,
  );
  const EMOJI_BAND_PX = 24; // baseline emoji clearance above the bar tops
  const RANGE_BAND_PX = 18; // baseline range-bubble clearance below the bar ends
  const barsPadTopPx = EMOJI_BAND_PX + emojiStagger;
  const barsPadBottomPx = hasRange ? RANGE_BAND_PX + emojiStagger : 0;
  // Keep the date column level with the emoji band at the TOP of the bars (not
  // centered on them) — its center sits in the emoji band above the bar tops.
  const dateShiftPx = barsPadTopPx - EMOJI_BAND_PX;

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
          className="flex items-start justify-center shrink-0"
          style={{
            width: `${BAR_AREA_WIDTH_PX}px`,
            columnGap: `${barGap}px`,
            paddingTop: `${barsPadTopPx}px`,
            paddingBottom: `${barsPadBottomPx}px`,
          }}
        >
          {activities.map((a, i) => {
            // Every other bar is shifted up / down by the same amount the emojis
            // stagger, so overlapping emojis (top) AND range bubbles (bottom)
            // both clear their neighbors. The bar keeps its fixed height; the
            // whole group (bar + emoji + bubble) rides the shift.
            const dy = emojiStagger === 0 ? 0 : i % 2 === 0 ? -emojiStagger : emojiStagger;
            const range = formatPeopleRange(a.min_people, a.max_people);
            return (
              <div
                key={`${a.name}#${i}`}
                className="relative flex flex-col items-center"
                style={{ transform: `translateY(${dy}px)` }}
              >
                {/* Emoji glued to the top of its own (staggered) bar. */}
                {a.emoji && (
                  <span
                    className="emoji-outline absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[18.4px] leading-none pointer-events-none"
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
                {/* Participant range — a readable bubble at the BOTTOM of this
                    bar, riding the same stagger so it stays under its own bar. */}
                {range && (
                  <span
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1 py-[1px] rounded-full bg-gray-100 dark:bg-gray-700 ring-1 ring-gray-300 dark:ring-gray-600 text-[8px] leading-none font-semibold tabular-nums text-gray-600 dark:text-gray-200 pointer-events-none whitespace-nowrap"
                    aria-hidden="true"
                  >
                    {range}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* This window's time span, level with the emoji band at the bar tops.
          The day/date lives in the group's divider header above, not here. */}
      <div className="min-w-0 min-h-6 flex items-center" style={{ marginTop: `${dateShiftPx}px` }}>
        <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-baseline gap-x-1">
          <span>{line.startTime}</span>
          <span>–</span>
          {line.endDate && <span>{line.endDate} ·</span>}
          <span>{line.endTime}</span>
          <span className="text-gray-400 dark:text-gray-500">· {line.duration}</span>
        </div>
      </div>
    </button>
  );
}

export default memo(SlotCardImpl);

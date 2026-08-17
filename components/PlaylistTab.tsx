"use client";

/**
 * The home page's Playlist tab: the caller's saved availability slots, soonest
 * first, each rendered as a <SlotCard>. Refreshes when a slot is created /
 * edited / deleted (SLOTS_CHANGED_EVENT, fired by the New Slot sheet) and when
 * the tab regains visibility. Tapping the "+ Slot" FAB or a card opens the
 * sheet (handled by CreateGroupButtonHost via the slot-sheet event channel).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiListSlots, type Slot } from "@/lib/api/slots";
import {
  buildActivityColorMap,
  sortSlotsChronological,
  slotWindowEntries,
  type SlotWindowEntry,
} from "@/lib/slotUtils";
import { SLOTS_CHANGED_EVENT } from "@/lib/slotEvents";
import SlotCard from "@/components/SlotCard";

export default function PlaylistTab() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await apiListSlots();
      setSlots(next);
      setError(false);
    } catch {
      setSlots((prev) => prev ?? []);
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener(SLOTS_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(SLOTS_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // One row PER availability window across all slots, soonest first; a stable
  // per-activity color map keyed to chronological first-appearance.
  const sorted = useMemo(() => (slots ? sortSlotsChronological(slots) : []), [slots]);
  const colors = useMemo(() => buildActivityColorMap(sorted), [sorted]);
  const entries = useMemo(() => (slots ? slotWindowEntries(slots) : []), [slots]);

  // Group consecutive entries by their start day (entries are already sorted
  // soonest-first, so all of a day's windows are contiguous). Each day gets one
  // divider header (its first entry's relative + date); its windows render as
  // bare-time rows under it. A day appears exactly once, so `day` is a unique
  // React key.
  const dayGroups = useMemo(() => {
    const out: { day: string; entries: SlotWindowEntry[] }[] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last.day === e.day) last.entries.push(e);
      else out.push({ day: e.day, entries: [e] });
    }
    return out;
  }, [entries]);

  if (slots === null) {
    return (
      <div className="flex justify-center items-center py-8">
        <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500 dark:text-gray-400">
          No slots yet. Tap <span className="font-medium">+ Slot</span> to add your availability.
        </p>
        {error && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400">
            Couldn&apos;t load your slots — check your connection.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="pt-2">
      {/* Column headers naming the two halves of each row: the time span on
          the left, the activity cards on the right. They stick to the top of
          the viewport once scrolled to, with the rows passing underneath — the
          opaque bar keeps the label legible and the gradient strip below it
          fades that background out so there's no hard edge against content. */}
      {/* z-30 clears the day headers (z-20) and the activity emoji (z-10
          inside each card) so both slide UNDER this bar + its fade instead of
          painting over it. */}
      <div className="sticky top-0 z-30">
        {/* Each label is centered over its own column. The rows' left column
            is content-sized (it hugs its own time text), so there's no single
            shared boundary to align to — 45% is where the widest time span
            ends, i.e. the visual split between the two halves. */}
        {/* Spacing is tuned against the measured gaps: pt gives 15.6px above
            the labels at rest (8px from the wrapper + 7.6px here) and 7.6px
            once stuck to the screen top; pb + the 12px gradient below give
            21.6px down to the first row. */}
        <div className="flex items-baseline bg-background pl-1 pr-3 pt-[7.6px] pb-[9.6px]">
          <span className="w-[45%] shrink-0 text-center text-lg font-semibold tracking-wide underline underline-offset-[3px] text-gray-900 dark:text-gray-100">
            Time Slots
          </span>
          <span className="flex-1 text-center text-lg font-semibold tracking-wide underline underline-offset-[3px] text-gray-900 dark:text-gray-100">
            My Interests
          </span>
        </div>
        <div className="h-3 bg-gradient-to-b from-background to-transparent" />
      </div>
      {dayGroups.map((g) => (
        <div key={g.day} className="mb-1.5">
          {/* Per-day divider: left-justified date (font +20% over the old
              text-sm), hairline rule filling the rest of the row on the right.
              It sticks just below the column headers (57.2px = that bar's
              measured height plus its fade) so the day you're looking at stays named while its rows
              scroll under it. Sticking is scoped to this day's block, so the
              header rides up and out exactly as the next day's header arrives
              and takes its place — that one paints over it, being later in the
              DOM at the same z. z-20 sits above the cards' emoji (z-10) and
              below the column headers (z-30). */}
          <div className="sticky top-[57.2px] z-20">
            <div className="flex items-center gap-3 bg-background px-1 pt-0.5">
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-[16.8px] font-semibold text-blue-600 dark:text-blue-400">
                  {g.entries[0].line.relative}
                </span>
                <span className="text-[16.8px] text-gray-500 dark:text-gray-400">{g.entries[0].line.date}</span>
              </div>
              <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
            </div>
            {/* Same trick as the column headers: fade the opaque background out
                rather than cutting rows off at a hard edge. Doubles as the 4px
                gap the old mb-1 gave. */}
            <div className="h-2 bg-gradient-to-b from-background to-transparent" />
          </div>
          <div>
            {g.entries.map((e) => (
              <SlotCard key={e.key} slot={e.slot} line={e.line} colors={colors} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

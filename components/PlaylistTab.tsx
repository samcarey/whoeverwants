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
  edgeToEdgeStyle,
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
          the viewport once scrolled to, with the rows passing underneath.
          Three sticky tiers stack here — these headers, then each day's
          divider, then each row's time (in SlotCard) — and every tier's offset
          is the bottom edge of the one above it, so the stack is opaque all
          the way down and no half-scrolled row can show through between them.
          No tier fades out at its bottom edge — the rows underneath are
          edge-to-edge, so a gradient would just be a strip of half-visible
          content; every tier cuts cleanly instead.
          The bar's background runs to both screen edges (edgeToEdgeStyle) so
          a row scrolling underneath can't peek through the page's safe-area
          padding at the sides. */}
      {/* z-30 clears the day dividers (z-20) and the activity emoji (z-10
          inside each card) so both slide UNDER this bar instead of over it. */}
      {/* Heights are load-bearing — the tiers below offset off them:
          7.6px + 28px line + 4px = 39.6px. */}
      <div
        className="sticky top-0 z-30 flex items-baseline bg-background pt-[7.6px] pb-1"
        style={edgeToEdgeStyle("0.25rem", "0.75rem")}
      >
        {/* Each label is centered over its own column. The rows' left column
            is content-sized (it hugs its own time text), so there's no single
            shared boundary to align to — 45% is where the widest time span
            ends, i.e. the visual split between the two halves. */}
        <span className="w-[45%] shrink-0 text-center text-lg font-semibold tracking-wide underline underline-offset-[3px] text-gray-900 dark:text-gray-100">
          Time Slots
        </span>
        <span className="flex-1 text-center text-lg font-semibold tracking-wide underline underline-offset-[3px] text-gray-900 dark:text-gray-100">
          My Interests
        </span>
      </div>
      {dayGroups.map((g) => (
        <div key={g.day} className="mb-1.5">
          {/* Per-day divider: left-justified date (font +20% over the old
              text-sm), hairline rule filling the rest of the row on the right.
              It sticks flush against the bottom of the column headers
              (39.6px) so the day you're looking at stays named while its rows
              scroll under it. Sticking is scoped to this day's block, so the
              divider rides up and out exactly as the next day's arrives and
              takes its place — that one paints over it, being later in the
              DOM at the same z. z-20 sits above the cards' emoji (z-10) and
              below the column headers (z-30). */}
          <div className="sticky top-[39.6px] z-20">
            {/* 25.2px line + 4px = 29.2px, so this bar ends at 68.8px — the
                offset each row's sticky time stacks against. */}
            <div
              className="flex items-center gap-3 bg-background pb-1"
              style={edgeToEdgeStyle("0.25rem", "0.25rem")}
            >
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-[16.8px] font-semibold text-blue-600 dark:text-blue-400">
                  {g.entries[0].line.relative}
                </span>
                <span className="text-[16.8px] text-gray-500 dark:text-gray-400">{g.entries[0].line.date}</span>
              </div>
              <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
            </div>
          </div>
          {/* Cards are edge-to-edge (each SlotCard cancels the page's
              safe-area padding itself), so the only gap here is the thin
              vertical one between them. */}
          <div className="space-y-1">
            {g.entries.map((e) => (
              <SlotCard key={e.key} slot={e.slot} line={e.line} colors={colors} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

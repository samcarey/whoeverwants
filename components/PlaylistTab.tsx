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
      {dayGroups.map((g) => (
        <div key={g.day} className="mb-1.5">
          {/* Per-day divider: left-justified date, its hairline rule extending
              from the text across to the right edge. */}
          <div className="flex items-center gap-3 px-1 mb-1">
            <div className="flex items-baseline gap-1.5 shrink-0">
              <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                {g.entries[0].line.relative}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">{g.entries[0].line.date}</span>
            </div>
            <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
          </div>
          <div className="space-y-3">
            {g.entries.map((e) => (
              <SlotCard key={e.key} slot={e.slot} line={e.line} colors={colors} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

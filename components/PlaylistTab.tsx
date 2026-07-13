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
import { buildActivityColorMap, sortSlotsChronological } from "@/lib/slotUtils";
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

  // Chronological (soonest first) + a stable per-activity color map computed
  // over that order (first-appearance = chronological).
  const sorted = useMemo(() => (slots ? sortSlotsChronological(slots) : []), [slots]);
  const colors = useMemo(() => buildActivityColorMap(sorted), [sorted]);

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

  if (sorted.length === 0) {
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
    <div className="space-y-3 pt-2">
      {sorted.map((slot) => (
        <SlotCard key={slot.id} slot={slot} colors={colors} />
      ))}
    </div>
  );
}

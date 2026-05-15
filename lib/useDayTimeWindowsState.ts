"use client";

import { useCallback, useRef } from "react";
import type { DayTimeWindow, TimeWindow } from "@/lib/types";

// Shared add/remove/edit logic for a controlled day-time-windows list,
// including the "removed-day window cache" — when a day is taken out of
// the selection and later re-added, its previous windows are restored.
// Used by TimeQuestionFields' embedded section and by the create-poll
// form's lifted Time Windows card. Call `reset()` when transitioning to
// a fresh draft (e.g. discard-and-close) so stale entries don't leak
// across modal sessions.
export function useDayTimeWindowsState(
  value: DayTimeWindow[],
  onChange?: (next: DayTimeWindow[]) => void,
) {
  const cacheRef = useRef<Record<string, TimeWindow[]>>({});

  const onDaysSelected = (newDays: string[]) => {
    if (!onChange) return;
    const existingDays = value.map(dtw => dtw.day);
    const removedDays = existingDays.filter(d => !newDays.includes(d));
    for (const d of removedDays) {
      const dtw = value.find(x => x.day === d);
      if (dtw && dtw.windows.length > 0) cacheRef.current[d] = dtw.windows;
    }
    const addedDays = newDays.filter(d => !existingDays.includes(d));

    // Iteratively place each new day into the working list so later
    // additions can inherit from earlier ones we just placed.
    const working: DayTimeWindow[] = value.filter(dtw => !removedDays.includes(dtw.day));
    const sortedAddedDays = [...addedDays].sort();
    for (const d of sortedAddedDays) {
      const cached = cacheRef.current[d];
      if (cached) {
        delete cacheRef.current[d];
        working.push({ day: d, windows: cached });
        continue;
      }
      // Inherit windows from the chronologically previous day in the
      // working list; fall back to 8am–5pm when there is no prior day.
      const prev = working
        .filter(x => x.day < d && x.windows.length > 0)
        .sort((a, b) => a.day.localeCompare(b.day))
        .pop();
      const inheritedWindows: TimeWindow[] = prev
        ? prev.windows.map(w => ({ min: w.min, max: w.max }))
        : [{ min: "08:00", max: "17:00" }];
      working.push({ day: d, windows: inheritedWindows });
    }
    working.sort((a, b) => a.day.localeCompare(b.day));
    onChange(working);
  };

  const onWindowsChange = (day: string, windows: TimeWindow[]) => {
    if (!onChange) return;
    onChange(value.map(dtw => dtw.day === day ? { ...dtw, windows } : dtw));
  };

  const onDeleteDay = (day: string) => {
    if (!onChange) return;
    onChange(value.filter(dtw => dtw.day !== day));
  };

  const reset = useCallback(() => {
    cacheRef.current = {};
  }, []);

  return { onDaysSelected, onWindowsChange, onDeleteDay, reset };
}

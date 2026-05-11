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
    const newEntries: DayTimeWindow[] = addedDays.map(d => {
      const cached = cacheRef.current[d];
      if (cached) delete cacheRef.current[d];
      return { day: d, windows: cached || [] };
    });
    const updated = [
      ...value.filter(dtw => !removedDays.includes(dtw.day)),
      ...newEntries,
    ];
    updated.sort((a, b) => a.day.localeCompare(b.day));
    onChange(updated);
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

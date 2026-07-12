"use client";

/**
 * "New Slot" bottom sheet for the home Playlist tab.
 *
 * Mirrors the create-poll sheet chrome (stationary dim backdrop at z-[59],
 * bottom-anchored opaque sheet at z-[60], fixed full height with the same
 * small top gap, ✕ / title / ✓ header) so the two sheets read as one
 * family. The body stacks three create-poll-style cards:
 *   1. Calendar picker — the create-poll Days card (month-label header
 *      row with the +/− expand toggle, compact 3-week grid ↔ full month
 *      with prev/next arrows, over an inline <DaysSelector>).
 *   2. Time Windows — per-day time-slot pills via <DayTimeWindowsList>
 *      (+ button, tap-to-edit TimeGridModal), fed by
 *      useDayTimeWindowsState so newly-picked days inherit windows.
 *   3. Activities — a CHECKBOX list of suggested activities in three
 *      labeled, priority-ordered groups (others planning this period /
 *      your past picks / others' past picks), each row with an ✕ to
 *      blacklist it (account-synced, never suggested again). An
 *      "Add your own" free-text card below lets the user introduce new
 *      activities (which then seed suggestions for everyone).
 *
 * The ✓ saves the slot (selected windows + checked/typed activities) via
 * apiCreateSlot, then closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DaysSelector from "@/components/DaysSelector";
import DayTimeWindowsList from "@/components/DayTimeWindowsList";
import ModalPortal from "@/components/ModalPortal";
import OptionsInput from "@/components/OptionsInput";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { useDayTimeWindowsState } from "@/lib/useDayTimeWindowsState";
import { formatMonthYearLabel, shiftMonth } from "@/lib/timeUtils";
import { haptic } from "@/lib/haptics";
import { apiCreateSlot, apiGetActivitySuggestions, type ActivitySuggestions } from "@/lib/api/slots";
import { apiAddActivityBlacklist } from "@/lib/api/users";
import type { DayTimeWindow } from "@/lib/types";

const EMPTY_SUGGESTIONS: ActivitySuggestions = { overlapping: [], yours: [], others: [] };

const SUGGESTION_GROUPS: { key: keyof ActivitySuggestions; label: string }[] = [
  { key: "overlapping", label: "Others planning this time" },
  { key: "yours", label: "You've picked before" },
  { key: "others", label: "Others have picked" },
];

// Same top gap as the create-poll sheets (SHEET_TOP_GAP there).
const SHEET_HEIGHT = "calc(100dvh - env(safe-area-inset-top, 0px) - 1.25rem)";

interface NewSlotSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const monthOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

export default function NewSlotSheet({ isOpen, onClose }: NewSlotSheetProps) {
  const [dayTimeWindows, setDayTimeWindows] = useState<DayTimeWindow[]>([]);
  const [customActivities, setCustomActivities] = useState<string[]>([""]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(monthOfToday);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [suggestions, setSuggestions] = useState<ActivitySuggestions>(EMPTY_SUGGESTIONS);
  // Checked suggestions (display strings). Lowercase-compared on toggle so a
  // suggestion + a typed custom with the same text don't double-save.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Day selection is derived from the windows list (one entry per picked
  // day); the hook seeds newly-added days with inherited/default windows
  // and caches removed days' windows for re-add — same as create-poll.
  const selectedDays = dayTimeWindows.map((dtw) => dtw.day);
  const { onDaysSelected, reset: resetDayWindowCache } = useDayTimeWindowsState(
    dayTimeWindows,
    setDayTimeWindows,
  );

  useBodyScrollLock(isOpen);

  // Fresh state on every open (the host keeps this component mounted).
  useEffect(() => {
    if (!isOpen) return;
    setDayTimeWindows([]);
    setCustomActivities([""]);
    setCalendarMonth(monthOfToday());
    setCalendarExpanded(false);
    setSuggestions(EMPTY_SUGGESTIONS);
    setSelected(new Set());
    setSaving(false);
    resetDayWindowCache();
  }, [isOpen, resetDayWindowCache]);

  // Fetch ranked activity suggestions, debounced on the selected period
  // (group 1 depends on which windows overlap other users' slots). A
  // request token guards against a stale response landing after a newer one.
  const dtwKey = JSON.stringify(dayTimeWindows);
  const reqTokenRef = useRef(0);
  useEffect(() => {
    if (!isOpen) return;
    const token = ++reqTokenRef.current;
    const t = setTimeout(() => {
      apiGetActivitySuggestions(dayTimeWindows)
        .then((res) => {
          if (reqTokenRef.current === token) setSuggestions(res);
        })
        .catch(() => {
          if (reqTokenRef.current === token) setSuggestions(EMPTY_SUGGESTIONS);
        });
    }, 350);
    return () => clearTimeout(t);
    // dtwKey is the stable content signature of dayTimeWindows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dtwKey]);

  const toggleSelected = useCallback((activity: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(activity)) next.delete(activity);
      else next.add(activity);
      return next;
    });
  }, []);

  // ✕ on a suggestion: remove it from every group + selection immediately and
  // add it to the account's blacklist so it's never suggested again.
  const blacklistActivity = useCallback((activity: string) => {
    haptic.light();
    setSuggestions((prev) => {
      const drop = (list: string[]) => list.filter((a) => a.toLowerCase() !== activity.toLowerCase());
      return {
        overlapping: drop(prev.overlapping),
        yours: drop(prev.yours),
        others: drop(prev.others),
      };
    });
    setSelected((prev) => {
      if (!prev.has(activity)) return prev;
      const next = new Set(prev);
      next.delete(activity);
      return next;
    });
    void apiAddActivityBlacklist(activity).catch(() => {});
  }, []);

  const handleSave = useCallback(() => {
    if (saving || dayTimeWindows.length === 0) return;
    // Merge checked suggestions + typed customs, deduped case-insensitively.
    const seen = new Set<string>();
    const activities: string[] = [];
    for (const a of [...selected, ...customActivities]) {
      const t = a.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      activities.push(t);
    }
    setSaving(true);
    haptic.success();
    apiCreateSlot(dayTimeWindows, activities)
      .then(() => onClose())
      .catch(() => setSaving(false));
  }, [saving, dayTimeWindows, selected, customActivities, onClose]);

  // Any suggestion group has items?
  const hasSuggestions = useMemo(
    () => SUGGESTION_GROUPS.some((g) => suggestions[g.key].length > 0),
    [suggestions],
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // Collapsing snaps the month back to today's (the compact grid is
  // today-anchored, so a navigated-away month would disagree with it) —
  // same rule as the create-poll Days card.
  useEffect(() => {
    if (calendarExpanded) return;
    setCalendarMonth((prev) => {
      const next = monthOfToday();
      return prev.getFullYear() === next.getFullYear() && prev.getMonth() === next.getMonth()
        ? prev
        : next;
    });
  }, [calendarExpanded]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[59] bg-black/40 dark:bg-black/60 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-[60] flex items-end justify-center pointer-events-none">
        <div
          className="relative w-full sm:max-w-md bg-gray-100 dark:bg-gray-900 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up pointer-events-auto"
          style={{ height: SHEET_HEIGHT }}
          role="dialog"
          aria-modal="true"
          aria-label="New slot"
        >
          <div className="shrink-0 relative flex items-center justify-center px-4 py-2 min-h-[3.75rem]">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close slot form"
              className="absolute left-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="text-lg font-semibold select-none">New Slot</span>
            <button
              type="button"
              onClick={handleSave}
              disabled={selectedDays.length === 0 || saving}
              aria-label="Confirm slot"
              className="absolute right-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-none px-3 pb-6 space-y-[14.4px]">
            <div>
              <div className="relative flex items-center justify-center mb-1 px-1 h-8">
                {calendarExpanded && (
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}
                    aria-label="Previous month"
                    className="absolute left-1 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                {/* Month label stays centered; the +/− toggle anchors to its
                    right edge so it doesn't shift across expand/collapse. */}
                <div className="relative">
                  <span className="text-[17.5px] font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                    {formatMonthYearLabel(calendarMonth)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCalendarExpanded((e) => !e)}
                    aria-label={calendarExpanded ? "Show fewer weeks" : "Show full month"}
                    aria-expanded={calendarExpanded}
                    className="group absolute left-full top-1/2 -translate-y-1/2 ml-2 w-6 h-6 flex items-center justify-center"
                  >
                    <span className="w-[19.2px] h-[19.2px] flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-gray-700">
                      <svg className="w-[12.8px] h-[12.8px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {calendarExpanded ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        )}
                      </svg>
                    </span>
                  </button>
                </div>
                {calendarExpanded && (
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}
                    aria-label="Next month"
                    className="absolute right-1 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
              <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3">
                <DaysSelector
                  selectedDays={selectedDays}
                  onChange={onDaysSelected}
                  inline
                  currentMonth={calendarMonth}
                  compact={!calendarExpanded}
                />
              </section>
            </div>
            {dayTimeWindows.length > 0 && (
              <div>
                <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                  Time Windows
                </label>
                <section className="rounded-3xl bg-white dark:bg-gray-800 pl-4 pr-3">
                  <DayTimeWindowsList
                    dayTimeWindows={dayTimeWindows}
                    onChange={setDayTimeWindows}
                  />
                </section>
              </div>
            )}
            <div>
              <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                Activities
              </label>
              {/* Suggested activities, grouped + labeled by priority. Each row:
                  round checkbox (select → saved on the slot) + text + ✕
                  (blacklist). */}
              {hasSuggestions && (
                <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-2 divide-y divide-gray-200 dark:divide-gray-700">
                  {SUGGESTION_GROUPS.map((group) => {
                    const items = suggestions[group.key];
                    if (items.length === 0) return null;
                    return (
                      <div key={group.key} className="py-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                          {group.label}
                        </p>
                        <ul>
                          {items.map((activity) => {
                            const checked = selected.has(activity);
                            return (
                              <li key={activity} className="flex items-center gap-3 h-11">
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={checked}
                                  onClick={() => toggleSelected(activity)}
                                  className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                    checked
                                      ? "bg-blue-500 border-blue-500 dark:bg-blue-500 dark:border-blue-500"
                                      : "border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900"
                                  }`}
                                >
                                  {checked && (
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSelected(activity)}
                                  className="flex-1 min-w-0 truncate text-left text-base"
                                >
                                  {activity}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => blacklistActivity(activity)}
                                  aria-label={`Never suggest "${activity}"`}
                                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              )}
              {/* Introduce a new activity (seeds suggestions for others). */}
              <label className="block text-xs font-medium text-gray-400 dark:text-gray-500 mt-2 mb-1 px-1">
                Add your own
              </label>
              <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-1">
                <OptionsInput
                  options={customActivities}
                  setOptions={setCustomActivities}
                  category="custom"
                  variant="compact"
                />
              </section>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

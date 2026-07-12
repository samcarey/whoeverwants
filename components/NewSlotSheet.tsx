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
 *   3. Activities — a "+" in the header inserts a typed activity row; below
 *      it, a CHECKBOX list of suggested activities in three labeled,
 *      priority-ordered groups (others planning this period / your past
 *      picks / others' past picks), each row with an ✕ to blacklist it
 *      (account-synced, never suggested again). Typed rows seed suggestions
 *      for everyone once saved.
 *
 * The ✓ saves the slot (selected windows + checked/typed activities) via
 * apiCreateSlot, then closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DaysSelector from "@/components/DaysSelector";
import DayTimeWindowsList from "@/components/DayTimeWindowsList";
import ModalPortal from "@/components/ModalPortal";
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

// Swipe-down-to-dismiss tuning (mirrors the create-poll sheet).
const SHEET_SWIPE_RECOGNIZE_PX = 8;
const SHEET_SWIPE_COMMIT_RATIO = 0.5;
const SHEET_SWIPE_COMMIT_VELOCITY = 0.5; // px/ms
const SHEET_SWIPE_CLOSE_MS = 250;
const SHEET_SWIPE_SNAP_BACK_MS = 220;
const SHEET_SWIPE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

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
  // User-typed activities (added via the "+" next to the Activities header).
  const [customActivities, setCustomActivities] = useState<string[]>([]);
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
    setCustomActivities([]);
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

  // Custom activity rows (added via the "+" in the Activities header). The
  // newly appended row auto-focuses so the user can type immediately.
  const lastCustomRef = useRef<HTMLInputElement | null>(null);
  const focusLastCustomRef = useRef(false);
  const addCustom = useCallback(() => {
    focusLastCustomRef.current = true;
    setCustomActivities((prev) => [...prev, ""]);
  }, []);
  useEffect(() => {
    if (focusLastCustomRef.current) {
      focusLastCustomRef.current = false;
      lastCustomRef.current?.focus();
    }
  }, [customActivities.length]);
  const updateCustom = useCallback((i: number, value: string) => {
    setCustomActivities((prev) => prev.map((a, j) => (j === i ? value : a)));
  }, []);
  const removeCustom = useCallback((i: number) => {
    setCustomActivities((prev) => prev.filter((_, j) => j !== i));
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

  // Swipe-down-to-dismiss (native iOS sheet behavior; ported from the
  // create-poll sheet). The handlers are on the OUTER sheet div; the per-frame
  // transform is applied imperatively to that same node (sheetRef) so the whole
  // sheet moves rigidly (no re-render). The gesture engages only when the body
  // is scrolled to the top AND the drag is downward-dominant, so a mid-content
  // downward drag still scrolls the body. No sub-panel / discard-confirm here —
  // there's nothing to lose, so a committed swipe just closes.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetBackdropRef = useRef<HTMLDivElement | null>(null);
  const sheetScrollerNodeRef = useRef<HTMLDivElement | null>(null);
  const sheetSwipeRef = useRef<{
    startY: number;
    startX: number;
    startTime: number;
    atTop: boolean;
    swiping: boolean;
    ignored: boolean;
  } | null>(null);

  const resetSheetTransform = useCallback((el: HTMLDivElement) => {
    el.style.transition = "";
    el.style.transform = "";
  }, []);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      sheetSwipeRef.current = null;
      return;
    }
    const scroller = sheetScrollerNodeRef.current;
    sheetSwipeRef.current = {
      startY: e.touches[0].clientY,
      startX: e.touches[0].clientX,
      startTime: Date.now(),
      atTop: !scroller || scroller.scrollTop <= 0,
      swiping: false,
      ignored: false,
    };
  }, []);

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    const st = sheetSwipeRef.current;
    if (!st || st.ignored) return;
    if (e.touches.length !== 1) {
      st.ignored = true;
      return;
    }
    const dy = e.touches[0].clientY - st.startY;
    const dx = e.touches[0].clientX - st.startX;
    if (!st.swiping) {
      if (Math.abs(dy) < SHEET_SWIPE_RECOGNIZE_PX && Math.abs(dx) < SHEET_SWIPE_RECOGNIZE_PX) return;
      // Engage only for a downward, vertical-dominant drag that began at the
      // top of the body. Anything else (upward, horizontal, or started
      // mid-scroll) is left to the native scroll for this touch sequence.
      if (!st.atTop || dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
        st.ignored = true;
        return;
      }
      st.swiping = true;
    }
    const el = sheetRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }
  }, []);

  const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
    const st = sheetSwipeRef.current;
    sheetSwipeRef.current = null;
    if (!st || !st.swiping || st.ignored) return;
    const endY = e.changedTouches[0]?.clientY ?? st.startY;
    const dy = Math.max(0, endY - st.startY);
    const dt = Date.now() - st.startTime;
    const velocity = (endY - st.startY) / Math.max(1, dt);
    const el = sheetRef.current;
    const height = el?.offsetHeight ?? window.innerHeight;
    const shouldClose = dy >= height * SHEET_SWIPE_COMMIT_RATIO || velocity >= SHEET_SWIPE_COMMIT_VELOCITY;

    if (!shouldClose) {
      if (el) {
        el.style.transition = `transform ${SHEET_SWIPE_SNAP_BACK_MS}ms ${SHEET_SWIPE_EASING}`;
        el.style.transform = "translateY(0)";
        window.setTimeout(() => {
          if (sheetRef.current === el) resetSheetTransform(el);
        }, SHEET_SWIPE_SNAP_BACK_MS + 20);
      }
      return;
    }
    // Slide the sheet the rest of the way down + fade the backdrop, then close.
    if (el) {
      el.style.transition = `transform ${SHEET_SWIPE_CLOSE_MS}ms ${SHEET_SWIPE_EASING}`;
      el.style.transform = "translateY(100%)";
    }
    if (sheetBackdropRef.current) {
      sheetBackdropRef.current.style.transition = `opacity ${SHEET_SWIPE_CLOSE_MS}ms ease`;
      sheetBackdropRef.current.style.opacity = "0";
    }
    window.setTimeout(() => onClose(), SHEET_SWIPE_CLOSE_MS);
  }, [onClose, resetSheetTransform]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        ref={sheetBackdropRef}
        className="fixed inset-0 z-[59] bg-black/40 dark:bg-black/60 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-[60] flex items-end justify-center pointer-events-none">
        <div
          ref={sheetRef}
          onTouchStart={handleSheetTouchStart}
          onTouchMove={handleSheetTouchMove}
          onTouchEnd={handleSheetTouchEnd}
          onTouchCancel={handleSheetTouchEnd}
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
          <div
            ref={sheetScrollerNodeRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-none px-3 pb-6 space-y-[14.4px]"
          >
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
              {/* Header + "+" (aligned right) to insert a new activity row. */}
              <div className="flex items-center justify-between mb-1 px-1">
                <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                  Activities
                </label>
                <button
                  type="button"
                  onClick={addCustom}
                  aria-label="Add an activity"
                  className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              {(customActivities.length > 0 || hasSuggestions) && (
                <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-2 divide-y divide-gray-200 dark:divide-gray-700">
                  {/* User-typed activity rows (always saved). */}
                  {customActivities.length > 0 && (
                    <ul className="py-1">
                      {customActivities.map((val, i) => (
                        <li key={i} className="flex items-center gap-3 h-11">
                          <input
                            ref={i === customActivities.length - 1 ? lastCustomRef : undefined}
                            value={val}
                            onChange={(e) => updateCustom(i, e.target.value)}
                            onBlur={(e) => updateCustom(i, e.target.value.trim())}
                            placeholder="Activity"
                            aria-label="Activity"
                            className="flex-1 min-w-0 bg-transparent text-base outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                          />
                          <button
                            type="button"
                            onClick={() => removeCustom(i)}
                            aria-label="Remove activity"
                            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Suggested activities, grouped + labeled by priority. Each
                      row: round checkbox (select → saved) + text + ✕
                      (blacklist). */}
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
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

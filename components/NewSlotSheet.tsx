"use client";

/**
 * "New Slot" bottom sheet for the home Playlist tab.
 *
 * Mirrors the create-poll sheet chrome (stationary dim backdrop at z-[59],
 * bottom-anchored opaque sheet at z-[60], fixed full height with the same
 * small top gap, ✕ / title / ✓ header) so the two sheets read as one
 * family. The body holds a calendar picker built from the same pieces as
 * the create-poll Days card: the month-label header row with the +/−
 * expand toggle (compact 3-week grid ↔ full month with prev/next arrows)
 * over an inline <DaysSelector>.
 *
 * The ✓ is a placeholder for now — slots don't persist anywhere yet; it
 * just dismisses the sheet. Wire the real create call here when the slot
 * backend lands.
 */

import { useEffect, useState } from "react";
import DaysSelector from "@/components/DaysSelector";
import ModalPortal from "@/components/ModalPortal";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { formatMonthYearLabel, shiftMonth } from "@/lib/timeUtils";

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
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(monthOfToday);
  const [calendarExpanded, setCalendarExpanded] = useState(false);

  useBodyScrollLock(isOpen);

  // Fresh state on every open (the host keeps this component mounted).
  useEffect(() => {
    if (!isOpen) return;
    setSelectedDays([]);
    setCalendarMonth(monthOfToday());
    setCalendarExpanded(false);
  }, [isOpen]);

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
              onClick={onClose}
              disabled={selectedDays.length === 0}
              aria-label="Confirm slot"
              className="absolute right-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
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
                  onChange={setSelectedDays}
                  inline
                  currentMonth={calendarMonth}
                  compact={!calendarExpanded}
                />
              </section>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

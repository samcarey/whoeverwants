'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { formatLocalDateISO, formatMonthYearLabel, shiftMonth } from '@/lib/timeUtils';
import { useMeasuredHeight } from '@/lib/useMeasuredHeight';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface DaysSelectorProps {
  selectedDays: string[];
  onChange: (days: string[]) => void;
  disabled?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  allowedDays?: string[];
  hideButton?: boolean;
  inline?: boolean;
  // When provided, the internal month-nav row is omitted so the caller
  // can render its own controls.
  currentMonth?: Date;
  // Compact mode (inline only): render just three weeks starting with the
  // week that contains today, instead of the full month grid.
  compact?: boolean;
}

export default function DaysSelector({ selectedDays, onChange, disabled = false, isOpen = false, onOpenChange, allowedDays, hideButton = false, inline = false, currentMonth, compact = false }: DaysSelectorProps) {
  const [tempSelectedDays, setTempSelectedDays] = useState<string[]>(selectedDays);
  const [internalCurrentMonth, setInternalCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const modalContentRef = useRef<HTMLDivElement>(null);
  const effectiveSelectedDays = inline ? selectedDays : tempSelectedDays;
  const effectiveCurrentMonth = currentMonth ?? internalCurrentMonth;
  const isMonthControlled = currentMonth !== undefined;

  // Measure the inline days grid so the outer wrapper can animate its
  // height when toggling between compact (3-week) and full-month layouts.
  const [daysGridRef, daysGridHeight] = useMeasuredHeight<HTMLDivElement>([compact]);
  const [heightAnimReady, setHeightAnimReady] = useState(false);
  useEffect(() => {
    // Enable the height transition only after the first measurement lands,
    // so opening the form doesn't animate the grid in from 0.
    if (daysGridHeight > 0 && !heightAnimReady) {
      const id = requestAnimationFrame(() => setHeightAnimReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [daysGridHeight, heightAnimReady]);

  const handleToggleDay = (date: string) => {
    if (inline) {
      const next = selectedDays.includes(date)
        ? selectedDays.filter(d => d !== date)
        : [...selectedDays, date].sort();
      onChange(next);
      return;
    }
    setTempSelectedDays(prev => {
      if (prev.includes(date)) {
        return prev.filter(d => d !== date);
      } else {
        return [...prev, date].sort();
      }
    });
  };

  const handleApply = () => {
    onChange(tempSelectedDays);
    onOpenChange?.(false);
  };

  const handleCancel = () => {
    setTempSelectedDays(selectedDays);
    onOpenChange?.(false);
  };

  const removePastDates = (dates: string[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = formatLocalDateISO(today);
    return dates.filter(dateStr => dateStr >= todayStr);
  };

  // Validate and clean up selected days on mount
  useEffect(() => {
    const validDays = removePastDates(selectedDays);
    if (validDays.length !== selectedDays.length) {
      onChange(validDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When opening, validate days and set temp state
  useEffect(() => {
    if (inline || !isOpen) return;

    const validDays = removePastDates(selectedDays);
    if (validDays.length !== selectedDays.length) {
      onChange(validDays);
    }
    setTempSelectedDays(validDays);
    if (!isMonthControlled) {
      const now = new Date();
      setInternalCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    }

    const body = document.body;
    const html = document.documentElement;

    // Store current scroll position
    const scrollY = window.scrollY;

    // Prevent background scrolling
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overscrollBehavior = 'none';
    html.style.overscrollBehavior = 'none';

    return () => {
      // Restore scroll position
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      body.style.overscrollBehavior = '';
      html.style.overscrollBehavior = '';
      window.scrollTo(0, scrollY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Format selected days for display - returns {label, dayNumber}
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const oneWeekFromNow = new Date(today);
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

    const twoWeeksFromNow = new Date(today);
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNumber = date.getDate();

    let label = '';
    if (dateStr === formatLocalDateISO(today)) {
      label = 'Today';
    } else if (dateStr === formatLocalDateISO(tomorrow)) {
      label = 'Tomorrow';
    } else if (date <= oneWeekFromNow) {
      label = dayOfWeek;
    } else if (date <= twoWeeksFromNow) {
      label = `Next ${dayOfWeek}`;
    } else {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    return { label, dayNumber };
  };

  const goToPreviousMonth = () => {
    setInternalCurrentMonth(prev => shiftMonth(prev, -1));
  };

  const goToNextMonth = () => {
    setInternalCurrentMonth(prev => shiftMonth(prev, 1));
  };

  const calendarDays = useMemo(() => {
    if (compact) {
      // Three weeks (21 days) starting with the Sunday of the week that
      // contains today. Days that spill into an adjacent month stay
      // selectable (no month-relative graying) so the compact view reads
      // as a rolling "next few weeks" picker.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
      const days: { dateStr: string; isCurrentMonth: boolean; day: number }[] = [];
      for (let i = 0; i < 21; i++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        days.push({ dateStr: formatLocalDateISO(date), isCurrentMonth: true, day: date.getDate() });
      }
      return days;
    }

    const year = effectiveCurrentMonth.getFullYear();
    const month = effectiveCurrentMonth.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: { dateStr: string; isCurrentMonth: boolean; day: number }[] = [];

    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({ dateStr: formatLocalDateISO(date), isCurrentMonth: false, day: date.getDate() });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      days.push({ dateStr: formatLocalDateISO(date), isCurrentMonth: true, day });
    }
    // Round up to a full week of trailing days. 28-day months starting
    // Sunday produce 4 rows; long months that wrap a 6th week produce 6.
    const totalCells = Math.ceil(days.length / 7) * 7;
    let nextDay = 1;
    while (days.length < totalCells) {
      const date = new Date(year, month + 1, nextDay++);
      days.push({ dateStr: formatLocalDateISO(date), isCurrentMonth: false, day: nextDay - 1 });
    }

    return days;
  }, [effectiveCurrentMonth, compact]);

  const monthName = formatMonthYearLabel(effectiveCurrentMonth);

  const monthNavRow = (
    <div className="flex items-center justify-between mb-4">
      <button
        type="button"
        onClick={goToPreviousMonth}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <span className="font-medium">{monthName}</span>

      <button
        type="button"
        onClick={goToNextMonth}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );

  const weekdayHeader = (
    <div className="grid grid-cols-7 mb-2">
      {WEEK_DAYS.map(day => (
        <div key={day} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
          {day}
        </div>
      ))}
    </div>
  );

  const daysGrid = (
    <div className="grid grid-cols-7">
      {(() => {
        const todayStr = formatLocalDateISO(new Date());
        return calendarDays.map(({ dateStr, isCurrentMonth, day }, index) => {
            const isPast = dateStr < todayStr;
            const isAllowed = !allowedDays || allowedDays.includes(dateStr);
            const isDisabled = isPast || !isAllowed;
            const isSelected = effectiveSelectedDays.includes(dateStr);
            const isToday = dateStr === todayStr;

            return (
              <button
                key={`${dateStr}-${index}`}
                type="button"
                onClick={() => !isDisabled && handleToggleDay(dateStr)}
                disabled={isDisabled || disabled}
                data-date={dateStr}
                data-testid={`calendar-day-${dateStr}`}
                className={`
                  aspect-[5/4] text-sm flex items-center justify-center
                  ${isDisabled
                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                    : !isCurrentMonth
                      ? 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                  }
                  ${isSelected
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : ''
                  }
                  ${isToday && !isSelected && !isDisabled
                    ? 'border-2 border-blue-500'
                    : ''
                  }
                `}
              >
                {day}
              </button>
            );
          });
        })()}
    </div>
  );

  // Non-animated combined grid for the modal (non-inline) path.
  const calendarGrid = (
    <div>
      {weekdayHeader}
      {daysGrid}
    </div>
  );

  if (inline) {
    return (
      <div>
        {!isMonthControlled && monthNavRow}
        {weekdayHeader}
        {/* Animate the days grid height between the compact (3-week) and
            full-month layouts. The inner div is measured at its natural
            height; the outer overflow-hidden div transitions to it. */}
        <div
          className="overflow-hidden"
          style={{
            height: daysGridHeight ? `${daysGridHeight}px` : undefined,
            transition: heightAnimReady ? 'height 300ms ease-in-out' : undefined,
          }}
        >
          <div ref={daysGridRef}>{daysGrid}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Clickable selected days list */}
      {!hideButton && (
        <button
          type="button"
          onClick={() => onOpenChange?.(true)}
          disabled={disabled}
          className="w-full text-left p-2 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-gray-700 disabled:hover:bg-transparent"
        >
          {selectedDays.length > 0 ? (
            <div className="flex flex-wrap gap-2 items-start">
              {selectedDays.map(date => {
                const { label, dayNumber } = formatDate(date);
                return (
                  <div
                    key={date}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 rounded-full text-sm border border-blue-200 dark:border-blue-800"
                  >
                    <span className="text-gray-700 dark:text-gray-200">{label}</span>
                    <span className="w-px h-3 bg-blue-300 dark:bg-blue-700"></span>
                    <span className="font-semibold text-blue-700 dark:text-blue-300 min-w-[1.25rem] text-center">{dayNumber}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Click to select days
            </div>
          )}
        </button>
      )}

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={handleCancel}
            style={{ touchAction: 'none' }}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ touchAction: 'none' }}>
            <div
              ref={modalContentRef}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full modal-scrollable overflow-auto"
              style={{
                maxHeight: 'calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 120px)'
              }}
            >
              <div className="p-4 modal-scrollable">
                {monthNavRow}
                <div className="mb-4">{calendarGrid}</div>

                {/* Selected count */}
                <div className="my-2 text-sm text-center text-gray-600 dark:text-gray-400">
                  {tempSelectedDays.length > 0
                    ? `${tempSelectedDays.length} day${tempSelectedDays.length !== 1 ? 's' : ''} selected`
                    : 'No days selected'}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

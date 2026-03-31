'use client';

import { useState, useEffect, useRef } from 'react';

interface DaysSelectorProps {
  selectedDays: string[];
  onChange: (days: string[]) => void;
  disabled?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  allowedDays?: string[];  // If provided, only these days are selectable (others greyed out)
  hideButton?: boolean;  // If true, only show modal (no clickable button with day list)
}

export default function DaysSelector({ selectedDays, onChange, disabled = false, isOpen, onOpenChange, allowedDays, hideButton = false }: DaysSelectorProps) {
  const [tempSelectedDays, setTempSelectedDays] = useState<string[]>(selectedDays);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const modalContentRef = useRef<HTMLDivElement>(null);

  const handleToggleDay = (date: string) => {
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
    onOpenChange(false);
  };

  const handleCancel = () => {
    setTempSelectedDays(selectedDays);
    onOpenChange(false);
  };

  // Remove past dates from selection
  const removePastDates = (dates: string[]) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = dateToString(today);

    return dates.filter(dateStr => {
      return dateStr >= todayStr;
    });
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
    if (!isOpen) return;

    const validDays = removePastDates(selectedDays);
    if (validDays.length !== selectedDays.length) {
      onChange(validDays);
    }
    setTempSelectedDays(validDays);
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));

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

    // Check if it's today
    if (dateStr === dateToString(today)) {
      label = 'Today';
    }
    // Check if it's tomorrow
    else if (dateStr === dateToString(tomorrow)) {
      label = 'Tomorrow';
    }
    // Check if it's within the next week (2-7 days away)
    else if (date <= oneWeekFromNow) {
      label = dayOfWeek;
    }
    // Check if it's within the second week (8-14 days away)
    else if (date <= twoWeeksFromNow) {
      label = `Next ${dayOfWeek}`;
    }
    // Beyond 2 weeks: use month abbreviation + day number
    else {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    return { label, dayNumber };
  };

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    return dateToString(today);
  };

  const dateToString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isPastDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev);
      newMonth.setMonth(newMonth.getMonth() - 1);
      return newMonth;
    });
  };

  const goToNextMonth = () => {
    setCurrentMonth(prev => {
      const newMonth = new Date(prev);
      newMonth.setMonth(newMonth.getMonth() + 1);
      return newMonth;
    });
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();

    const days: { dateStr: string; isCurrentMonth: boolean }[] = [];
    const TOTAL_CELLS = 35; // 5 rows × 7 cols

    // Fill leading days from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({ dateStr: dateToString(date), isCurrentMonth: false });
    }

    // Add all days of the current month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      days.push({ dateStr: dateToString(date), isCurrentMonth: true });
    }

    // Fill trailing days from next month
    let nextDay = 1;
    while (days.length < TOTAL_CELLS) {
      const date = new Date(year, month + 1, nextDay++);
      days.push({ dateStr: dateToString(date), isCurrentMonth: false });
    }

    // If we have more than 35 (month spans 6 rows), truncate to 35
    return days.slice(0, TOTAL_CELLS);
  };

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calendarDays = renderCalendar();
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Clickable selected days list */}
      {!hideButton && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
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
                {/* Month navigation */}
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

                {/* Calendar */}
                <div className="mb-4">
                  {/* Week day headers */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {weekDays.map(day => (
                      <div key={day} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar days */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map(({ dateStr, isCurrentMonth }, index) => {
                      const isPast = isPastDate(dateStr);
                      const isAllowed = !allowedDays || allowedDays.includes(dateStr);
                      const isDisabled = isPast || !isAllowed;
                      const isSelected = tempSelectedDays.includes(dateStr);
                      const isToday = dateStr === getTodayDate();

                      return (
                        <button
                          key={`${dateStr}-${index}`}
                          type="button"
                          onClick={() => !isDisabled && handleToggleDay(dateStr)}
                          disabled={isDisabled}
                          data-date={dateStr}
                          data-testid={`calendar-day-${dateStr}`}
                          className={`
                            aspect-square rounded-md text-sm flex items-center justify-center
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
                          {new Date(dateStr + 'T00:00:00').getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

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

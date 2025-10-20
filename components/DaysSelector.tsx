'use client';

import { useState, useEffect } from 'react';

interface DaysSelectorProps {
  selectedDays: string[];
  onChange: (days: string[]) => void;
  disabled?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  allowedDays?: string[];  // If provided, only these days are selectable (others greyed out)
}

export default function DaysSelector({ selectedDays, onChange, disabled = false, isOpen, onOpenChange, allowedDays }: DaysSelectorProps) {
  const [tempSelectedDays, setTempSelectedDays] = useState<string[]>(selectedDays);
  const [currentMonth, setCurrentMonth] = useState(new Date());

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
    if (isOpen) {
      const validDays = removePastDates(selectedDays);
      if (validDays.length !== selectedDays.length) {
        onChange(validDays);
      }
      setTempSelectedDays(validDays);
      setCurrentMonth(new Date());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Format selected days for display
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

    // Check if it's today
    if (dateStr === dateToString(today)) {
      return 'Today';
    }

    // Check if it's tomorrow
    if (dateStr === dateToString(tomorrow)) {
      return `Tomorrow (${dayOfWeek})`;
    }

    // Check if it's within the next week (2-7 days away)
    if (date <= oneWeekFromNow) {
      return dayOfWeek;
    }

    // Check if it's within the second week (8-14 days away)
    if (date <= twoWeeksFromNow) {
      return `Next ${dayOfWeek}`;
    }

    // Beyond 2 weeks: use month abbreviation + day number
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    setCurrentMonth(new Date());
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // Get first day of month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Get day of week for first day (0 = Sunday)
    const firstDayOfWeek = firstDay.getDay();

    // Get total days in month
    const daysInMonth = lastDay.getDate();

    // Create array of all days
    const days: (string | null)[] = [];

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }

    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      days.push(dateToString(date));
    }

    return days;
  };

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calendarDays = renderCalendar();
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Selected days list */}
      {selectedDays.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedDays.map(date => (
            <div
              key={date}
              className="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-md text-sm"
            >
              {formatDate(date)}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          No days selected
        </div>
      )}

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={handleCancel}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="p-4">
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
                    {calendarDays.map((dateStr, index) => {
                      if (dateStr === null) {
                        return <div key={`empty-${index}`} className="aspect-square" />;
                      }

                      const isPast = isPastDate(dateStr);
                      const isAllowed = !allowedDays || allowedDays.includes(dateStr);
                      const isDisabled = isPast || !isAllowed;
                      const isSelected = tempSelectedDays.includes(dateStr);
                      const isToday = dateStr === getTodayDate();

                      return (
                        <button
                          key={dateStr}
                          type="button"
                          onClick={() => !isDisabled && handleToggleDay(dateStr)}
                          disabled={isDisabled}
                          className={`
                            aspect-square rounded-md text-sm flex items-center justify-center
                            ${isDisabled
                              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
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

                {/* Selected count or warning */}
                <div className="my-2 text-sm text-center">
                  {tempSelectedDays.length > 0 ? (
                    <div className="text-gray-600 dark:text-gray-400">
                      {tempSelectedDays.length} day{tempSelectedDays.length !== 1 ? 's' : ''} selected
                    </div>
                  ) : (
                    <div className="text-orange-600 dark:text-orange-400">
                      Please select at least one day
                    </div>
                  )}
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
                    disabled={tempSelectedDays.length === 0}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
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

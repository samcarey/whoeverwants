'use client';

import { useState } from 'react';
import TimeGridModal from './TimeGridModal';
import { windowDurationMinutes, formatDayLabel, pickNextTimeWindow } from '@/lib/timeUtils';

interface TimeWindow {
  min: string; // HH:MM format
  max: string; // HH:MM format
  enabled?: boolean; // For voter form: whether this window is active (default true)
}

interface DayTimeWindowsInputProps {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
  onChange: (windows: TimeWindow[]) => void;
  onDelete: () => void; // Delete entire day
  disabled?: boolean;
  questionWindows?: TimeWindow[]; // Creator's windows for this day (constrains voter edits)
  minDurationMinutes?: number | null; // Minimum duration in minutes for validation
  // Full day list across the form. The + button reads this to copy the
  // latest non-intersecting slot from a neighbouring day instead of
  // opening the time-grid modal. Pass `dayTimeWindows` from the parent.
  allDays?: { day: string; windows: TimeWindow[] }[];
  // When true, omit the outer bg/border/padding chrome so the row composes
  // cleanly inside a parent card's `divide-y` layout. Used by the create-poll
  // "Time Windows" card; default usage keeps the standalone-strip look.
  borderless?: boolean;
}

// Format time in 12-hour format (compact) - returns {time, period}
function formatTime12Hour(time: string): { time: string; period: string } {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return {
    time: `${displayHours}:${minutes.toString().padStart(2, '0')}`,
    period
  };
}



function getRelativeDay(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 14) return `${diffDays} days away`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 8) return `${weeks} week${weeks === 1 ? '' : 's'} away`;
  const months = Math.floor(diffDays / 30.44);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'} away`;
  const years = Math.floor(diffDays / 365.25);
  return `${years} year${years === 1 ? '' : 's'} away`;
}

export default function DayTimeWindowsInput({
  day,
  windows,
  onChange,
  onDelete,
  disabled = false,
  questionWindows,
  minDurationMinutes,
  allDays,
  borderless = false,
}: DayTimeWindowsInputProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Add a slot directly without opening the modal: copy the latest
  // non-intersecting slot from the immediately previous day in the list,
  // falling back to following days then a default 8 AM – 5 PM range.
  const handleAddWindow = () => {
    const days = allDays ?? [{ day, windows }];
    const next = pickNextTimeWindow(day, days);
    onChange([...windows, next]);
  };

  const handleEditWindow = (index: number) => {
    setEditingIndex(index);
    setIsModalOpen(true);
  };

  const handleModalApply = (min: string | null, max: string | null) => {
    if (min && max && editingIndex !== null) {
      const updated = windows.map((w, i) =>
        i === editingIndex ? { min, max } : w
      );
      onChange(updated);
    }
  };

  const handleDeleteWindow = (index: number) => {
    onChange(windows.filter((_, i) => i !== index));
    // Reset editing index if we deleted the window being edited
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      // Adjust editing index if we deleted a window before the one being edited
      setEditingIndex(editingIndex - 1);
    }
  };

  const handleToggleWindow = (index: number) => {
    const updated = windows.map((w, i) =>
      i === index ? { ...w, enabled: w.enabled === false } : w
    );
    onChange(updated);
  };

  const isVoterForm = !!questionWindows;

  return (
    <div
      className={
        borderless
          ? 'flex items-center gap-3 min-h-12 py-2'
          : 'flex items-center gap-3 p-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'
      }
    >
      {/* Day display. Natural width with `shrink-0` so the date never
          collapses under flex pressure; the gap to the + button is the
          outer flex's `gap-3` (12 px) — small and identical on every row. */}
      <div className="shrink-0 self-start">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {formatDayLabel(day)}
        </div>
        <div className="text-xs text-blue-500 dark:text-blue-400">
          {getRelativeDay(day)}
        </div>
      </div>

      {/* Dedicated + button column (creator form only), positioned just to
          the right of the date. `shrink-0` keeps it a perfect circle even
          when trashcans appear in the slots column and pressure the row.
          Diameter matches the time-pill height (34 px); `self-start`
          aligns the circle's center with the topmost time pill. */}
      {!isVoterForm && (
        <button
          type="button"
          onClick={handleAddWindow}
          disabled={disabled}
          className="shrink-0 self-start w-[34px] h-[34px] flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Add time window"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {/* Right: Time windows stacked vertically. Trash sits on the LEFT of
          each pill (matches voter-form checkbox placement). The last
          remaining slot in a day omits its trash so the day can never
          drop to zero windows. */}
      <div className="flex-1 flex flex-col gap-2 items-end">
        {windows.map((window, index) => {
          const isEnabled = window.enabled !== false;
          const duration = windowDurationMinutes(window);
          const isTooShort = isEnabled && minDurationMinutes != null && minDurationMinutes > 0 && duration < minDurationMinutes;
          const showTrash = !isVoterForm && windows.length > 1;
          return (
            <div
              key={index}
              className="flex items-center gap-2"
            >
              {isVoterForm ? (
                <label className="flex items-center p-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggleWindow(index)}
                    disabled={disabled}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                  />
                </label>
              ) : showTrash ? (
                <button
                  type="button"
                  onClick={() => handleDeleteWindow(index)}
                  disabled={disabled}
                  className="p-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Delete time window"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => isEnabled && handleEditWindow(index)}
                disabled={disabled || !isEnabled}
                className={`w-[168px] py-1.5 rounded-full text-sm font-medium border transition-colors text-center ${
                  !isEnabled
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-default opacity-50'
                    : isTooShort
                      ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-400 dark:border-red-500 hover:bg-red-100 dark:hover:bg-red-900/50'
                      : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-650'
                } disabled:cursor-not-allowed`}
              >
                {(() => {
                  const minFormatted = formatTime12Hour(window.min);
                  const maxFormatted = formatTime12Hour(window.max);
                  const isCrossMidnight = window.max <= window.min;
                  return (
                    <>
                      {minFormatted.time}
                      <span className={`ml-0.5 ${!isEnabled ? '' : minFormatted.period === 'AM' ? 'text-orange-500 dark:text-orange-400' : 'text-purple-600 dark:text-purple-400'}`}>
                        {minFormatted.period}
                      </span>
                      {' - '}
                      {maxFormatted.time}
                      <span className={`ml-0.5 ${!isEnabled ? '' : maxFormatted.period === 'AM' ? 'text-orange-500 dark:text-orange-400' : 'text-purple-600 dark:text-purple-400'}`}>
                        {maxFormatted.period}
                      </span>
                      {isCrossMidnight && isEnabled && (
                        <span className="ml-0.5 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                          +1
                        </span>
                      )}
                    </>
                  );
                })()}
              </button>
            </div>
          );
        })}
      </div>

      {/* Time Grid Modal */}
      <TimeGridModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingIndex(null);
        }}
        minValue={editingIndex !== null && windows[editingIndex] ? windows[editingIndex].min : "09:00"}
        maxValue={editingIndex !== null && windows[editingIndex] ? windows[editingIndex].max : "17:00"}
        onApply={handleModalApply}
        constraintMin={questionWindows && editingIndex !== null && questionWindows[editingIndex] ? questionWindows[editingIndex].min : undefined}
        constraintMax={questionWindows && editingIndex !== null && questionWindows[editingIndex] ? questionWindows[editingIndex].max : undefined}
        minDurationMinutes={minDurationMinutes}
      />
    </div>
  );
}

'use client';

import { useState } from 'react';
import TimeGridModal from './TimeGridModal';

interface TimeWindow {
  min: string; // HH:MM format
  max: string; // HH:MM format
}

interface DayTimeWindowsInputProps {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
  onChange: (windows: TimeWindow[]) => void;
  onDelete: () => void; // Delete entire day
  disabled?: boolean;
  pollWindows?: TimeWindow[]; // Creator's windows for this day (constrains voter edits)
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

// Format day display (e.g., "Mon, Jan 15")
function formatDayDisplay(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00'); // Add time to avoid timezone issues
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${weekday}, ${month} ${day}`;
}

export default function DayTimeWindowsInput({
  day,
  windows,
  onChange,
  onDelete,
  disabled = false,
  pollWindows,
}: DayTimeWindowsInputProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleAddWindow = () => {
    setEditingIndex(null);
    setIsModalOpen(true);
  };

  const handleEditWindow = (index: number) => {
    setEditingIndex(index);
    setIsModalOpen(true);
  };

  const handleModalApply = (min: string | null, max: string | null) => {
    if (min && max) {
      if (editingIndex !== null) {
        // Update existing window
        const updated = windows.map((w, i) =>
          i === editingIndex ? { min, max } : w
        );
        onChange(updated);
      } else {
        // Add new window
        onChange([...windows, { min, max }]);
      }
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

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Left: Day display */}
      <div className="min-w-[100px]">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {formatDayDisplay(day)}
        </div>
      </div>

      {/* Right: Time windows */}
      <div className="flex-1 flex flex-wrap gap-2 items-center justify-end">
        {windows.map((window, index) => (
          <div
            key={index}
            className="flex items-center gap-2"
          >
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
            <button
              type="button"
              onClick={() => handleEditWindow(index)}
              disabled={disabled}
              className="w-[168px] py-1.5 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-full text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-650 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-center"
            >
              {(() => {
                const minFormatted = formatTime12Hour(window.min);
                const maxFormatted = formatTime12Hour(window.max);
                // Cross-midnight: end time is earlier than start time (e.g., 10 PM - 2 AM)
                const isCrossMidnight = window.max < window.min;
                return (
                  <>
                    {minFormatted.time}
                    <span className={`ml-0.5 ${minFormatted.period === 'AM' ? 'text-orange-500 dark:text-orange-400' : 'text-purple-600 dark:text-purple-400'}`}>
                      {minFormatted.period}
                    </span>
                    {' - '}
                    {maxFormatted.time}
                    <span className={`ml-0.5 ${maxFormatted.period === 'AM' ? 'text-orange-500 dark:text-orange-400' : 'text-purple-600 dark:text-purple-400'}`}>
                      {maxFormatted.period}
                    </span>
                    {isCrossMidnight && (
                      <span className="ml-0.5 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                        +1
                      </span>
                    )}
                  </>
                );
              })()}
            </button>
          </div>
        ))}

        {/* Add button - hidden on voter ballots */}
        {!pollWindows && (
          <button
            type="button"
            onClick={handleAddWindow}
            disabled={disabled}
            className="w-[168px] py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-center"
          >
            + Time
          </button>
        )}
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
      />
    </div>
  );
}

"use client";

import { useState, useEffect } from 'react';

interface TimeCounterInputProps {
  value: string | null; // HH:MM format (24-hour)
  onChange: (value: string | null) => void;
  increment?: number; // minutes
  min?: string; // HH:MM format
  max?: string; // HH:MM format
  disabled?: boolean;
  arrowPosition?: 'left' | 'right';
}

// Convert HH:MM to minutes since midnight
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Convert minutes since midnight to HH:MM
function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Format time in 12-hour format
function formatTime12Hour(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// Parse user input (supports various formats)
function parseTimeInput(input: string): string | null {
  // Remove spaces
  input = input.trim().toUpperCase();

  // Try to match various formats
  // 9:30 PM, 9:30PM, 930PM, 9PM, etc.
  const match = input.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/);

  if (!match) return null;

  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const period = match[3];

  // Validate
  if (hours < 1 || hours > 12) {
    if (hours > 23) return null;
    // 24-hour format
    if (minutes > 59) return null;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  if (minutes > 59) return null;

  // Convert 12-hour to 24-hour
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  } else if (!period) {
    // No AM/PM specified - assume based on current value or reasonable defaults
    // For now, just use as-is
  }

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export default function TimeCounterInput({
  value,
  onChange,
  increment = 15,
  min,
  max,
  disabled = false,
  arrowPosition = 'left'
}: TimeCounterInputProps) {
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setEditingValue(null);
    }
  }, [value, isFocused]);

  const handleIncrement = () => {
    setEditingValue(null);
    if (!value) return;

    const currentMinutes = timeToMinutes(value);
    const newMinutes = currentMinutes + increment;
    const newTime = minutesToTime(newMinutes);

    if (!max || timeToMinutes(newTime) <= timeToMinutes(max)) {
      onChange(newTime);
    }
  };

  const handleDecrement = () => {
    setEditingValue(null);
    if (!value) return;

    const currentMinutes = timeToMinutes(value);
    const newMinutes = currentMinutes - increment;
    const newTime = minutesToTime(newMinutes);

    if (!min || timeToMinutes(newTime) >= timeToMinutes(min)) {
      onChange(newTime);
    }
  };

  const handleInputChange = (inputValue: string) => {
    setEditingValue(inputValue);
  };

  const handleBlur = () => {
    setIsFocused(false);

    if (editingValue) {
      const parsed = parseTimeInput(editingValue);
      if (parsed) {
        // Validate against min/max
        const parsedMinutes = timeToMinutes(parsed);

        if (min && parsedMinutes < timeToMinutes(min)) {
          onChange(min);
        } else if (max && parsedMinutes > timeToMinutes(max)) {
          onChange(max);
        } else {
          onChange(parsed);
        }
      }
    }

    setEditingValue(null);
  };

  const handleFocus = () => {
    setIsFocused(true);
    if (value) {
      setEditingValue(formatTime12Hour(value));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const minMinutes = min ? timeToMinutes(min) : 0;
  const maxMinutes = max ? timeToMinutes(max) : 24 * 60 - 1;
  const currentMinutes = value ? timeToMinutes(value) : minMinutes;

  const isDecrementDisabled = disabled || currentMinutes <= minMinutes;
  const isIncrementDisabled = disabled || currentMinutes >= maxMinutes;

  const arrows = (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleIncrement}
        disabled={isIncrementDisabled}
        className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={isDecrementDisabled}
        className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );

  const displayValue = isFocused && editingValue !== null
    ? editingValue
    : (value ? formatTime12Hour(value) : '');

  const input = (
    <input
      type="text"
      value={displayValue}
      onChange={(e) => handleInputChange(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className="w-32 px-0 py-1.5 text-center text-xl font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
    />
  );

  return (
    <div className="flex items-center gap-2">
      {arrowPosition === 'left' ? (
        <>
          {arrows}
          {input}
        </>
      ) : (
        <>
          {input}
          {arrows}
        </>
      )}
    </div>
  );
}

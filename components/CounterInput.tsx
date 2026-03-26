"use client";

import { useState, useEffect } from 'react';

interface CounterInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  increment?: number;
  min: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  arrowPosition?: 'left' | 'right';
  formatValue?: (value: number) => string;
}

export default function CounterInput({
  value,
  onChange,
  increment = 1,
  min,
  max,
  disabled = false,
  placeholder = '',
  className = '',
  arrowPosition = 'left',
  formatValue
}: CounterInputProps) {
  // Track what the user is actually typing
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Reset editing state when value changes externally (from arrows or props)
  useEffect(() => {
    if (!isFocused) {
      setEditingValue(null);
    }
  }, [value, isFocused]);
  const handleIncrement = () => {
    setEditingValue(null); // Clear editing state when using arrows
    const currentValue = value ?? min;

    // Check if current value is already on an increment boundary
    const remainder = currentValue % increment;
    const isOnIncrement = Math.abs(remainder) < 0.0001; // floating point tolerance

    let newValue;
    if (isOnIncrement) {
      // Already on increment, move to next
      newValue = currentValue + increment;
    } else {
      // Not on increment, snap to next increment
      newValue = Math.ceil(currentValue / increment) * increment;
    }

    // Round to avoid floating point precision issues
    newValue = Math.round(newValue / increment) * increment;

    if (max === undefined || newValue <= max) {
      onChange(newValue);
    }
  };

  const handleDecrement = () => {
    setEditingValue(null); // Clear editing state when using arrows
    const currentValue = value ?? min;

    // Check if current value is already on an increment boundary
    const remainder = currentValue % increment;
    const isOnIncrement = Math.abs(remainder) < 0.0001; // floating point tolerance

    let newValue;
    if (isOnIncrement) {
      // Already on increment, move to previous
      newValue = currentValue - increment;
    } else {
      // Not on increment, snap to previous increment
      newValue = Math.floor(currentValue / increment) * increment;
    }

    // Round to avoid floating point precision issues
    newValue = Math.round(newValue / increment) * increment;

    if (newValue >= min) {
      onChange(newValue);
    }
  };

  const handleInputChange = (inputValue: string) => {
    setEditingValue(inputValue);

    if (inputValue === '') {
      onChange(null);
    } else if (/^\d*\.?\d*$/.test(inputValue)) {
      const newValue = parseFloat(inputValue);
      if (!isNaN(newValue)) {
        // Only update if within bounds
        if ((max === undefined || newValue <= max) && newValue >= min) {
          onChange(newValue);
        }
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    setEditingValue(null);

    // Reset to min if empty or invalid on blur
    if (value === null || value < min) {
      onChange(min);
    } else if (max !== undefined && value > max) {
      onChange(max);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    // Initialize editing value with current formatted value
    if (value !== null) {
      setEditingValue(formatValue ? formatValue(value) : value.toString());
    }
  };

  const isDecrementDisabled = disabled || (value ?? min) <= min;
  const isIncrementDisabled = disabled || (max !== undefined && (value ?? min) >= max);

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

  // Use editing value if focused, otherwise use formatted value
  const displayValue = isFocused && editingValue !== null
    ? editingValue
    : (value !== null && formatValue ? formatValue(value) : (value ?? ''));

  const input = (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={(e) => handleInputChange(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className="w-16 px-0.5 py-1.5 text-center text-xl font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
    />
  );

  return (
    <div className={`flex items-center gap-2 ${className}`}>
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

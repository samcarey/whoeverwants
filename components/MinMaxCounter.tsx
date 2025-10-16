"use client";

import CounterInput from './CounterInput';

interface MinMaxCounterProps {
  minValue: number | null;
  maxValue: number | null;
  maxEnabled: boolean;
  onMinChange: (value: number | null) => void;
  onMaxChange: (value: number | null) => void;
  onMaxEnabledChange: (enabled: boolean) => void;
  increment?: number;
  minLimit: number;
  disabled?: boolean;
}

export default function MinMaxCounter({
  minValue,
  maxValue,
  maxEnabled,
  onMinChange,
  onMaxChange,
  onMaxEnabledChange,
  increment = 1,
  minLimit,
  disabled = false
}: MinMaxCounterProps) {
  const handleMinChange = (newMin: number | null) => {
    onMinChange(newMin);
    // If max is enabled and new min is greater than max, update max
    if (maxEnabled && maxValue !== null && newMin !== null && newMin > maxValue) {
      onMaxChange(newMin);
    }
  };

  const handleMaxChange = (newMax: number | null) => {
    const minVal = minValue ?? minLimit;
    // Ensure max is never less than min
    if (newMax !== null && newMax >= minVal) {
      if (!maxEnabled) {
        onMaxEnabledChange(true);
      }
      onMaxChange(newMax);
    } else if (newMax === null) {
      onMaxChange(null);
    }
  };

  const handleMaxEnabledChange = (enabled: boolean) => {
    if (enabled) {
      onMaxEnabledChange(true);
      const minVal = minValue ?? minLimit;
      // Set to min if not already set, or if previous value is less than min
      if (maxValue === null || maxValue < minVal) {
        onMaxChange(minVal);
      }
    } else {
      onMaxEnabledChange(false);
    }
  };

  return (
    <div className="relative flex justify-center items-center">
      <div className="flex items-center gap-3">
        {/* Min counter */}
        <CounterInput
          value={minValue}
          onChange={handleMinChange}
          increment={increment}
          min={minLimit}
          disabled={disabled}
        />

        {/* Hyphen separator */}
        <span className="text-xl text-gray-500 dark:text-gray-400">—</span>

        {/* Max counter */}
        <div className={!maxEnabled ? 'opacity-40' : ''}>
          <CounterInput
            value={maxEnabled ? maxValue : null}
            onChange={handleMaxChange}
            increment={increment}
            min={minValue ?? minLimit}
            disabled={disabled || !maxEnabled}
          />
        </div>
      </div>

      {/* Checkbox to enable/disable max - positioned absolutely to not affect centering */}
      <input
        type="checkbox"
        checked={maxEnabled}
        onChange={(e) => handleMaxEnabledChange(e.target.checked)}
        disabled={disabled}
        className="absolute right-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
      />
    </div>
  );
}

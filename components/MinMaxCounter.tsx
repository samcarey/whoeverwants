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
  maxLimit?: number;
  minRequired?: boolean;
  maxRequired?: boolean;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  unitLabel?: string;
  minCheckboxEnabled?: boolean;
  onMinCheckboxChange?: (enabled: boolean) => void;
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
  maxLimit,
  minRequired = false,
  maxRequired = false,
  disabled = false,
  formatValue,
  unitLabel,
  minCheckboxEnabled = false,
  onMinCheckboxChange
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
    // Ensure max is never less than min and never greater than maxLimit
    if (newMax !== null && newMax >= minVal) {
      // Enforce maxLimit if it exists
      if (maxLimit !== undefined && newMax > maxLimit) {
        newMax = maxLimit;
      }
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
    <div>
      <div className="relative flex justify-center items-center">
        {/* Min checkbox - positioned absolutely on the left */}
        {onMinCheckboxChange && (
          <input
            type="checkbox"
            checked={minCheckboxEnabled}
            onChange={(e) => onMinCheckboxChange(e.target.checked)}
            disabled={disabled || minRequired}
            className="absolute left-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
          />
        )}

        <div className="flex items-center gap-3">
          {/* Min counter - arrows on left */}
          <div className={onMinCheckboxChange && !minCheckboxEnabled ? 'opacity-40' : ''}>
            <CounterInput
              value={onMinCheckboxChange && !minCheckboxEnabled ? null : minValue}
              onChange={handleMinChange}
              increment={increment}
              min={minLimit}
              max={maxLimit}
              disabled={disabled || (onMinCheckboxChange !== undefined && !minCheckboxEnabled)}
              arrowPosition="left"
              formatValue={formatValue}
            />
          </div>

          {/* Hyphen separator */}
          <span className="text-xl text-gray-500 dark:text-gray-400">—</span>

          {/* Max counter - arrows on right */}
          <div className={!maxEnabled ? 'opacity-40' : ''}>
            <CounterInput
              value={maxEnabled ? maxValue : null}
              onChange={handleMaxChange}
              increment={increment}
              min={minValue ?? minLimit}
              max={maxLimit}
              disabled={disabled || !maxEnabled}
              arrowPosition="right"
              formatValue={formatValue}
            />
          </div>
        </div>

        {/* Checkbox to enable/disable max - positioned absolutely to not affect centering */}
        <input
          type="checkbox"
          checked={maxEnabled}
          onChange={(e) => handleMaxEnabledChange(e.target.checked)}
          disabled={disabled || maxRequired}
          className="absolute right-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
        />
      </div>

      {/* Unit label */}
      {unitLabel && (
        <div className="text-center text-sm text-gray-600 dark:text-gray-400 mt-1">
          {unitLabel}
        </div>
      )}
    </div>
  );
}

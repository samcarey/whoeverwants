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
  minCheckboxEnabled?: boolean;
  onMinCheckboxChange?: (enabled: boolean) => void;
  deferValidation?: boolean;
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
  minCheckboxEnabled = false,
  onMinCheckboxChange,
  deferValidation = false,
}: MinMaxCounterProps) {
  const handleMinChange = (newMin: number | null) => {
    onMinChange(newMin);
    if (!deferValidation && maxEnabled && maxValue !== null && newMin !== null && newMin > maxValue) {
      onMaxChange(newMin);
    }
  };

  const handleMaxChange = (newMax: number | null) => {
    const minVal = minValue ?? minLimit;
    if (deferValidation) {
      if (!maxEnabled && newMax !== null) {
        onMaxEnabledChange(true);
      }
      onMaxChange(newMax);
      return;
    }
    if (newMax !== null && newMax >= minVal) {
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
        {/* Min checkbox */}
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
          {/* Min counter */}
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

          <span className="text-xl text-gray-500 dark:text-gray-400">—</span>

          {/* Max counter */}
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

        {/* Max checkbox */}
        <input
          type="checkbox"
          checked={maxEnabled}
          onChange={(e) => handleMaxEnabledChange(e.target.checked)}
          disabled={disabled || maxRequired}
          className="absolute right-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
        />
      </div>
    </div>
  );
}

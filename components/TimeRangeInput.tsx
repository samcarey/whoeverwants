"use client";

interface TimeRangeInputProps {
  minValue: string | null;
  maxValue: string | null;
  minEnabled: boolean;
  maxEnabled: boolean;
  onMinChange: (value: string | null) => void;
  onMaxChange: (value: string | null) => void;
  onMinEnabledChange: (enabled: boolean) => void;
  onMaxEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export default function TimeRangeInput({
  minValue,
  maxValue,
  minEnabled,
  maxEnabled,
  onMinChange,
  onMaxChange,
  onMinEnabledChange,
  onMaxEnabledChange,
  disabled = false
}: TimeRangeInputProps) {
  const handleMinChange = (value: string) => {
    onMinChange(value || null);
    // If max is enabled and new min is later than max, update max
    if (maxEnabled && maxValue && value && value > maxValue) {
      onMaxChange(value);
    }
  };

  const handleMaxChange = (value: string) => {
    // Ensure max is never earlier than min
    if (minEnabled && minValue && value && value < minValue) {
      return;
    }
    onMaxChange(value || null);
  };

  return (
    <div>
      <div className="relative flex justify-center items-center">
        {/* Min checkbox - positioned absolutely on the left */}
        <input
          type="checkbox"
          checked={minEnabled}
          onChange={(e) => onMinEnabledChange(e.target.checked)}
          disabled={disabled}
          className="absolute left-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
        />

        <div className="flex items-center gap-3">
          {/* Min time input */}
          <div className={!minEnabled ? 'opacity-40' : ''}>
            <input
              type="time"
              value={minEnabled ? (minValue || '') : ''}
              onChange={(e) => handleMinChange(e.target.value)}
              disabled={disabled || !minEnabled}
              className="w-28 px-2 py-2 text-center text-lg font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Hyphen separator */}
          <span className="text-xl text-gray-500 dark:text-gray-400">—</span>

          {/* Max time input */}
          <div className={!maxEnabled ? 'opacity-40' : ''}>
            <input
              type="time"
              value={maxEnabled ? (maxValue || '') : ''}
              onChange={(e) => handleMaxChange(e.target.value)}
              disabled={disabled || !maxEnabled}
              className="w-28 px-2 py-2 text-center text-lg font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Max checkbox - positioned absolutely on the right */}
        <input
          type="checkbox"
          checked={maxEnabled}
          onChange={(e) => onMaxEnabledChange(e.target.checked)}
          disabled={disabled}
          className="absolute right-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
        />
      </div>
    </div>
  );
}

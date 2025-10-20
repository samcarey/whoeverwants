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
  minLimit?: string;  // Earliest allowed time (e.g., "09:00")
  maxLimit?: string;  // Latest allowed time (e.g., "17:00")
  minRequired?: boolean;  // Force min checkbox to be enabled
  maxRequired?: boolean;  // Force max checkbox to be enabled
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
  disabled = false,
  minLimit,
  maxLimit,
  minRequired = false,
  maxRequired = false
}: TimeRangeInputProps) {
  // Helper: Add minutes to a time string
  const addMinutes = (timeStr: string, minutes: number): string => {
    const [hours, mins] = timeStr.split(':').map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
  };

  // Helper: Calculate time difference in minutes (time2 - time1)
  const getMinutesDifference = (time1: string, time2: string): number => {
    const [h1, m1] = time1.split(':').map(Number);
    const [h2, m2] = time2.split(':').map(Number);
    return (h2 * 60 + m2) - (h1 * 60 + m1);
  };

  const MINIMUM_DURATION_MINUTES = 15; // Minimum time span of 15 minutes

  const handleMinChange = (value: string) => {
    if (!value) {
      onMinChange(null);
      return;
    }

    // Clamp to minLimit/maxLimit range (for iOS and other browsers that don't respect min/max)
    let clampedValue = value;
    if (minLimit && value < minLimit) {
      clampedValue = minLimit;
    }
    if (maxLimit && value > maxLimit) {
      clampedValue = maxLimit;
    }

    onMinChange(clampedValue);

    // If max is enabled, ensure max is at least MINIMUM_DURATION_MINUTES after min
    if (maxEnabled && maxValue && clampedValue) {
      const gapMinutes = getMinutesDifference(clampedValue, maxValue);
      if (gapMinutes < MINIMUM_DURATION_MINUTES) {
        // Gap is too small - push max forward
        let newMax = addMinutes(clampedValue, MINIMUM_DURATION_MINUTES);
        // Also respect maxLimit
        if (maxLimit && newMax > maxLimit) {
          newMax = maxLimit;
        }
        onMaxChange(newMax);
      }
    }
  };

  const handleMaxChange = (value: string) => {
    if (!value) {
      onMaxChange(null);
      return;
    }

    // Clamp to minLimit/maxLimit range (for iOS and other browsers that don't respect min/max)
    let clampedValue = value;
    if (minLimit && value < minLimit) {
      clampedValue = minLimit;
    }
    if (maxLimit && value > maxLimit) {
      clampedValue = maxLimit;
    }

    // Ensure max is at least MINIMUM_DURATION_MINUTES after min
    if (minEnabled && minValue) {
      const gapMinutes = getMinutesDifference(minValue, clampedValue);
      if (gapMinutes < MINIMUM_DURATION_MINUTES) {
        clampedValue = addMinutes(minValue, MINIMUM_DURATION_MINUTES);
        // Also respect maxLimit
        if (maxLimit && clampedValue > maxLimit) {
          clampedValue = maxLimit;
        }
      }
    }

    onMaxChange(clampedValue);
  };

  return (
    <div>
      <div className="relative flex justify-center items-center">
        {/* Min checkbox - positioned absolutely on the left */}
        <input
          type="checkbox"
          checked={minEnabled}
          onChange={(e) => onMinEnabledChange(e.target.checked)}
          disabled={disabled || minRequired}
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
              min={minLimit}
              max={maxLimit}
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
              min={minLimit}
              max={maxLimit}
              className="w-28 px-2 py-2 text-center text-lg font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Max checkbox - positioned absolutely on the right */}
        <input
          type="checkbox"
          checked={maxEnabled}
          onChange={(e) => onMaxEnabledChange(e.target.checked)}
          disabled={disabled || maxRequired}
          className="absolute right-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
        />
      </div>
    </div>
  );
}

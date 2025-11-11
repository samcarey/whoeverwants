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
  hideCheckboxes?: boolean;  // Hide checkboxes entirely (for mandatory fields)
  testId?: string;  // For test automation
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
  maxRequired = false,
  hideCheckboxes = false,
  testId
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

  // Helper: Validate and format time string (HH:MM)
  const validateTimeFormat = (value: string): string | null => {
    if (!value) return null;

    // Remove any non-digit characters except colon
    const cleaned = value.replace(/[^\d:]/g, '');

    // Try to parse as HH:MM
    const match = cleaned.match(/^(\d{1,2}):?(\d{0,2})$/);
    if (!match) return null;

    const hours = parseInt(match[1], 10);
    const mins = match[2] ? parseInt(match[2], 10) : 0;

    // Validate ranges
    if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;

    // Format as HH:MM
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const handleMinChange = (value: string) => {
    if (!value) {
      onMinChange(null);
      return;
    }

    // Validate format first
    const formatted = validateTimeFormat(value);
    if (!formatted) return; // Invalid format, ignore

    // Clamp to minLimit/maxLimit range (for iOS and other browsers that don't respect min/max)
    let clampedValue = formatted;
    if (minLimit && formatted < minLimit) {
      clampedValue = minLimit;
    }
    if (maxLimit && formatted > maxLimit) {
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

    // Validate format first
    const formatted = validateTimeFormat(value);
    if (!formatted) return; // Invalid format, ignore

    // Clamp to minLimit/maxLimit range (for iOS and other browsers that don't respect min/max)
    let clampedValue = formatted;
    if (minLimit && formatted < minLimit) {
      clampedValue = minLimit;
    }
    if (maxLimit && formatted > maxLimit) {
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
    <div data-testid={testId}>
      <div className={hideCheckboxes ? "flex justify-center items-center" : "relative flex justify-center items-center"}>
        {/* Min checkbox - positioned absolutely on the left */}
        {!hideCheckboxes && (
          <input
            type="checkbox"
            checked={minEnabled}
            onChange={(e) => onMinEnabledChange(e.target.checked)}
            disabled={disabled || minRequired}
            className="absolute left-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
          />
        )}

        <div className="flex items-center gap-3">
          {/* Min time input */}
          <div className={!minEnabled ? 'opacity-40' : ''}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{2}:[0-9]{2}"
              placeholder="HH:MM"
              value={minEnabled ? (minValue || '') : ''}
              onChange={(e) => handleMinChange(e.target.value)}
              onBlur={(e) => {
                // Format on blur if valid
                const formatted = validateTimeFormat(e.target.value);
                if (formatted && minEnabled) {
                  onMinChange(formatted);
                }
              }}
              disabled={disabled || !minEnabled}
              className="w-28 px-2 py-2 text-center text-lg font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Hyphen separator */}
          <span className="text-xl text-gray-500 dark:text-gray-400">—</span>

          {/* Max time input */}
          <div className={!maxEnabled ? 'opacity-40' : ''}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{2}:[0-9]{2}"
              placeholder="HH:MM"
              value={maxEnabled ? (maxValue || '') : ''}
              onChange={(e) => handleMaxChange(e.target.value)}
              onBlur={(e) => {
                // Format on blur if valid
                const formatted = validateTimeFormat(e.target.value);
                if (formatted && maxEnabled) {
                  onMaxChange(formatted);
                }
              }}
              disabled={disabled || !maxEnabled}
              className="w-28 px-2 py-2 text-center text-lg font-medium border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Max checkbox - positioned absolutely on the right */}
        {!hideCheckboxes && (
          <input
            type="checkbox"
            checked={maxEnabled}
            onChange={(e) => onMaxEnabledChange(e.target.checked)}
            disabled={disabled || maxRequired}
            className="absolute right-0 w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:border-gray-600 dark:focus:ring-blue-600 cursor-pointer disabled:opacity-50"
          />
        )}
      </div>
    </div>
  );
}

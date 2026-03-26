"use client";

import TimeWindowButton from './TimeWindowButton';

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
  const handleUpdate = (
    min: string | null,
    max: string | null,
    minEn: boolean,
    maxEn: boolean
  ) => {
    // Apply limits if specified
    let finalMin = min;
    let finalMax = max;

    if (minLimit && min && min < minLimit) {
      finalMin = minLimit;
    }
    if (maxLimit && min && min > maxLimit) {
      finalMin = maxLimit;
    }
    if (minLimit && max && max < minLimit) {
      finalMax = minLimit;
    }
    if (maxLimit && max && max > maxLimit) {
      finalMax = maxLimit;
    }

    // Update all values
    onMinChange(finalMin);
    onMaxChange(finalMax);

    // Respect required flags
    onMinEnabledChange(minRequired ? true : minEn);
    onMaxEnabledChange(maxRequired ? true : maxEn);
  };

  return (
    <div data-testid={testId}>
      <TimeWindowButton
        minValue={minValue}
        maxValue={maxValue}
        minEnabled={minEnabled}
        maxEnabled={maxEnabled}
        onUpdate={handleUpdate}
        label="" // No label, parent components add their own
        disabled={disabled}
      />
    </div>
  );
}

import { useState } from 'react';
import MinMaxCounter from './MinMaxCounter';
import TimeRangeInput from './TimeRangeInput';
import DaysSelector from './DaysSelector';

interface ParticipationConditionsProps {
  minValue: number | null;
  maxValue: number | null;
  maxEnabled: boolean;
  onMinChange: (value: number | null) => void;
  onMaxChange: (value: number | null) => void;
  onMaxEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  pollMinParticipants?: number | null;
  pollMaxParticipants?: number | null;
  // Duration props
  durationMinValue?: number | null;
  durationMaxValue?: number | null;
  durationMinEnabled?: boolean;
  durationMaxEnabled?: boolean;
  onDurationMinChange?: (value: number | null) => void;
  onDurationMaxChange?: (value: number | null) => void;
  onDurationMinEnabledChange?: (enabled: boolean) => void;
  onDurationMaxEnabledChange?: (enabled: boolean) => void;
  // Time props
  timeMinValue?: string | null;
  timeMaxValue?: string | null;
  timeMinEnabled?: boolean;
  timeMaxEnabled?: boolean;
  onTimeMinChange?: (value: string | null) => void;
  onTimeMaxChange?: (value: string | null) => void;
  onTimeMinEnabledChange?: (enabled: boolean) => void;
  onTimeMaxEnabledChange?: (enabled: boolean) => void;
  // Days props
  selectedDays?: string[];
  onDaysChange?: (days: string[]) => void;
  // Poll-level condition restrictions (for voting form)
  pollPossibleDays?: string[];
  pollDurationWindow?: {
    minValue: number | null;
    maxValue: number | null;
    minEnabled: boolean;
    maxEnabled: boolean;
  };
  pollTimeWindow?: {
    minValue: string | null;
    maxValue: string | null;
    minEnabled: boolean;
    maxEnabled: boolean;
  };
  // Control flags
  isCreationForm?: boolean;  // True when creating poll (hides time checkboxes)
}

export default function ParticipationConditions({
  minValue,
  maxValue,
  maxEnabled,
  onMinChange,
  onMaxChange,
  onMaxEnabledChange,
  disabled = false,
  pollMinParticipants = null,
  pollMaxParticipants = null,
  durationMinValue = null,
  durationMaxValue = null,
  durationMinEnabled = false,
  durationMaxEnabled = false,
  onDurationMinChange,
  onDurationMaxChange,
  onDurationMinEnabledChange,
  onDurationMaxEnabledChange,
  timeMinValue = null,
  timeMaxValue = null,
  timeMinEnabled = false,
  timeMaxEnabled = false,
  onTimeMinChange,
  onTimeMaxChange,
  onTimeMinEnabledChange,
  onTimeMaxEnabledChange,
  selectedDays = [],
  onDaysChange,
  pollPossibleDays,
  pollDurationWindow,
  pollTimeWindow,
  isCreationForm = false,
}: ParticipationConditionsProps) {
  const [isDaysPickerOpen, setIsDaysPickerOpen] = useState(false);
  // Calculate enforced limits based on poll constraints
  // Voter's min must be >= poll's min
  const enforcedMinLimit = pollMinParticipants ?? 1;

  // Voter's max must be <= poll's max (if poll has a max)
  const enforcedMaxLimit = pollMaxParticipants ?? undefined;

  // If poll requires a max, voter cannot disable it
  const maxRequired = pollMaxParticipants !== null && pollMaxParticipants !== undefined;

  // Format duration values to show decimals nicely (remove trailing zeros)
  const formatDurationValue = (value: number) => {
    // Use toFixed for precision, then parse to remove trailing zeros
    return parseFloat(value.toFixed(2)).toString();
  };

  // Helper: Parse time string to decimal hours
  const timeToHours = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours + minutes / 60;
  };

  // Helper: Convert decimal hours to time string
  const hoursToTime = (hours: number): string => {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Calculate time window span in hours (always positive, wraps to next day if needed)
  const calculateTimeSpan = (minTime: string | null, maxTime: string | null): number | null => {
    if (!minTime || !maxTime) return null;

    const minHours = timeToHours(minTime);
    const maxHours = timeToHours(maxTime);

    // If max < min, it wraps to next day
    if (maxHours >= minHours) {
      return maxHours - minHours;
    } else {
      return (24 - minHours) + maxHours;
    }
  };

  // Handle duration changes with time window validation
  const handleDurationMinChange = (newDurationMin: number | null) => {
    if (!onDurationMinChange || !onTimeMaxChange) return;

    onDurationMinChange(newDurationMin);

    // If both time bounds are enabled and duration exceeds window, expand time max
    if (timeMinEnabled && timeMaxEnabled && timeMinValue && timeMaxValue && newDurationMin) {
      const currentSpan = calculateTimeSpan(timeMinValue, timeMaxValue);
      if (currentSpan !== null && newDurationMin > currentSpan) {
        // Expand time max to accommodate duration min
        const minHours = timeToHours(timeMinValue);
        const newMaxHours = (minHours + newDurationMin) % 24;
        onTimeMaxChange(hoursToTime(newMaxHours));
      }
    }
  };

  const handleDurationMaxChange = (newDurationMax: number | null) => {
    if (!onDurationMaxChange || !onTimeMaxChange) return;

    onDurationMaxChange(newDurationMax);

    // If both time bounds are enabled and duration exceeds window, expand time max
    if (timeMinEnabled && timeMaxEnabled && timeMinValue && timeMaxValue && newDurationMax) {
      const currentSpan = calculateTimeSpan(timeMinValue, timeMaxValue);
      if (currentSpan !== null && newDurationMax > currentSpan) {
        // Expand time max to accommodate duration max
        const minHours = timeToHours(timeMinValue);
        const newMaxHours = (minHours + newDurationMax) % 24;
        onTimeMaxChange(hoursToTime(newMaxHours));
      }
    }
  };

  // Handle time changes with duration validation
  const handleTimeMinChange = (newTimeMin: string | null) => {
    if (!onTimeMinChange) return;

    onTimeMinChange(newTimeMin);

    // If both time bounds are enabled, check if duration needs adjustment
    if (timeMinEnabled && timeMaxEnabled && newTimeMin && timeMaxValue && onDurationMinChange && onDurationMaxChange) {
      const newSpan = calculateTimeSpan(newTimeMin, timeMaxValue);
      if (newSpan !== null) {
        // Reduce duration min if it exceeds new span
        if (durationMinEnabled && durationMinValue && durationMinValue > newSpan) {
          onDurationMinChange(newSpan);
        }
        // Reduce duration max if it exceeds new span
        if (durationMaxEnabled && durationMaxValue && durationMaxValue > newSpan) {
          onDurationMaxChange(newSpan);
        }
      }
    }
  };

  const handleTimeMaxChange = (newTimeMax: string | null) => {
    if (!onTimeMaxChange) return;

    onTimeMaxChange(newTimeMax);

    // If both time bounds are enabled, check if duration needs adjustment
    if (timeMinEnabled && timeMaxEnabled && timeMinValue && newTimeMax && onDurationMinChange && onDurationMaxChange) {
      const newSpan = calculateTimeSpan(timeMinValue, newTimeMax);
      if (newSpan !== null) {
        // Reduce duration min if it exceeds new span
        if (durationMinEnabled && durationMinValue && durationMinValue > newSpan) {
          onDurationMinChange(newSpan);
        }
        // Reduce duration max if it exceeds new span
        if (durationMaxEnabled && durationMaxValue && durationMaxValue > newSpan) {
          onDurationMaxChange(newSpan);
        }
      }
    }
  };

  // Handle duration checkbox changes with time window validation
  const handleDurationMinEnabledChange = (enabled: boolean) => {
    if (!onDurationMinEnabledChange) return;

    onDurationMinEnabledChange(enabled);

    // If duration is now enabled and exceeds time window, expand time max
    if (enabled && timeMinEnabled && timeMaxEnabled && timeMinValue && timeMaxValue && durationMinValue && onTimeMaxChange) {
      const currentSpan = calculateTimeSpan(timeMinValue, timeMaxValue);
      if (currentSpan !== null && durationMinValue > currentSpan) {
        const minHours = timeToHours(timeMinValue);
        const newMaxHours = (minHours + durationMinValue) % 24;
        onTimeMaxChange(hoursToTime(newMaxHours));
      }
    }
  };

  const handleDurationMaxEnabledChange = (enabled: boolean) => {
    if (!onDurationMaxEnabledChange) return;

    onDurationMaxEnabledChange(enabled);

    // If duration is now enabled and exceeds time window, expand time max
    if (enabled && timeMinEnabled && timeMaxEnabled && timeMinValue && timeMaxValue && durationMaxValue && onTimeMaxChange) {
      const currentSpan = calculateTimeSpan(timeMinValue, timeMaxValue);
      if (currentSpan !== null && durationMaxValue > currentSpan) {
        const minHours = timeToHours(timeMinValue);
        const newMaxHours = (minHours + durationMaxValue) % 24;
        onTimeMaxChange(hoursToTime(newMaxHours));
      }
    }
  };

  // Handle time checkbox changes with duration validation
  const handleTimeMinEnabledChange = (enabled: boolean) => {
    if (!onTimeMinEnabledChange) return;

    onTimeMinEnabledChange(enabled);

    // If both time bounds are now enabled, check if duration needs adjustment
    if (enabled && timeMaxEnabled && timeMinValue && timeMaxValue && onDurationMinChange && onDurationMaxChange) {
      const newSpan = calculateTimeSpan(timeMinValue, timeMaxValue);
      if (newSpan !== null) {
        // Reduce duration min if it exceeds new span
        if (durationMinEnabled && durationMinValue && durationMinValue > newSpan) {
          onDurationMinChange(newSpan);
        }
        // Reduce duration max if it exceeds new span
        if (durationMaxEnabled && durationMaxValue && durationMaxValue > newSpan) {
          onDurationMaxChange(newSpan);
        }
      }
    }
  };

  const handleTimeMaxEnabledChange = (enabled: boolean) => {
    if (!onTimeMaxEnabledChange) return;

    onTimeMaxEnabledChange(enabled);

    // If both time bounds are now enabled, check if duration needs adjustment
    if (enabled && timeMinEnabled && timeMinValue && timeMaxValue && onDurationMinChange && onDurationMaxChange) {
      const newSpan = calculateTimeSpan(timeMinValue, timeMaxValue);
      if (newSpan !== null) {
        // Reduce duration min if it exceeds new span
        if (durationMinEnabled && durationMinValue && durationMinValue > newSpan) {
          onDurationMinChange(newSpan);
        }
        // Reduce duration max if it exceeds new span
        if (durationMaxEnabled && durationMaxValue && durationMaxValue > newSpan) {
          onDurationMaxChange(newSpan);
        }
      }
    }
  };

  // Calculate current time window for display
  const timeWindow = timeMinEnabled && timeMaxEnabled && timeMinValue && timeMaxValue
    ? calculateTimeSpan(timeMinValue, timeMaxValue)
    : null;

  return (
    <div className="space-y-3" data-testid="participation-conditions">
      <div className="-mt-2 mb-1">
        <label className="block text-sm font-medium mb-1">
          Participants
        </label>
        <div className="-my-1">
          <MinMaxCounter
            minValue={minValue}
            maxValue={maxValue}
            maxEnabled={maxEnabled}
            onMinChange={onMinChange}
            onMaxChange={onMaxChange}
            onMaxEnabledChange={onMaxEnabledChange}
            increment={1}
            minLimit={enforcedMinLimit}
            maxLimit={enforcedMaxLimit}
            maxRequired={maxRequired}
            disabled={disabled}
            deferValidation={true}
            testId="participants-counter"
          />
        </div>
      </div>

      {onDaysChange && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Possible Days
          </label>
          <DaysSelector
            selectedDays={selectedDays}
            onChange={onDaysChange}
            disabled={disabled}
            isOpen={isDaysPickerOpen}
            onOpenChange={setIsDaysPickerOpen}
            allowedDays={pollPossibleDays}
          />
        </div>
      )}

      {onTimeMinChange && onTimeMaxChange && onTimeMinEnabledChange && onTimeMaxEnabledChange && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Time Window{timeWindow !== null ? ` (${formatDurationValue(timeWindow)} hours)` : ''}
          </label>
          <TimeRangeInput
            minValue={timeMinValue}
            maxValue={timeMaxValue}
            minEnabled={timeMinEnabled}
            maxEnabled={timeMaxEnabled}
            onMinChange={handleTimeMinChange}
            onMaxChange={handleTimeMaxChange}
            onMinEnabledChange={handleTimeMinEnabledChange}
            onMaxEnabledChange={handleTimeMaxEnabledChange}
            disabled={disabled}
            minLimit={pollTimeWindow?.minEnabled ? pollTimeWindow.minValue ?? undefined : undefined}
            maxLimit={pollTimeWindow?.maxEnabled ? pollTimeWindow.maxValue ?? undefined : undefined}
            minRequired={pollTimeWindow?.minEnabled ?? isCreationForm}
            maxRequired={pollTimeWindow?.maxEnabled ?? isCreationForm}
            hideCheckboxes={isCreationForm}
            testId="time-range-input"
          />
        </div>
      )}

      {onDurationMinChange && onDurationMaxChange && onDurationMinEnabledChange && onDurationMaxEnabledChange && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Duration (hours)
          </label>
          <MinMaxCounter
            minValue={durationMinValue}
            maxValue={durationMaxValue}
            maxEnabled={durationMaxEnabled}
            onMinChange={handleDurationMinChange}
            onMaxChange={handleDurationMaxChange}
            onMaxEnabledChange={handleDurationMaxEnabledChange}
            increment={0.25}
            minLimit={pollDurationWindow?.minEnabled ? pollDurationWindow.minValue ?? 0.25 : 0.25}
            maxLimit={pollDurationWindow?.maxEnabled ? pollDurationWindow.maxValue : undefined}
            minRequired={pollDurationWindow?.minEnabled ?? false}
            maxRequired={pollDurationWindow?.maxEnabled ?? false}
            disabled={disabled}
            formatValue={formatDurationValue}
            minCheckboxEnabled={durationMinEnabled}
            onMinCheckboxChange={handleDurationMinEnabledChange}
            deferValidation={true}
            testId="duration-counter"
          />
        </div>
      )}
    </div>
  );
}

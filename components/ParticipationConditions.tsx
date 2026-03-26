import { useState } from 'react';
import MinMaxCounter from './MinMaxCounter';
import DaysSelector from './DaysSelector';
import DayTimeWindowsInput from './DayTimeWindowsInput';

export interface TimeWindow {
  min: string;
  max: string;
}

export interface DayTimeWindow {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
}

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
  // Day time windows props (replaces separate days + time window)
  dayTimeWindows?: DayTimeWindow[];
  onDayTimeWindowsChange?: (dayTimeWindows: DayTimeWindow[]) => void;
  // Poll-level condition restrictions (for voting form)
  pollDayTimeWindows?: DayTimeWindow[];
  pollDurationWindow?: {
    minValue: number | null;
    maxValue: number | null;
    minEnabled: boolean;
    maxEnabled: boolean;
  };
  // Control flags
  isCreationForm?: boolean;  // True when creating poll
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
  dayTimeWindows = [],
  onDayTimeWindowsChange,
  pollDayTimeWindows,
  pollDurationWindow,
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

  // Handle adding days from the days selector
  const handleDaysSelected = (newDays: string[]) => {
    if (!onDayTimeWindowsChange) return;

    // Find which days were added
    const existingDays = dayTimeWindows.map(dtw => dtw.day);
    const addedDays = newDays.filter(day => !existingDays.includes(day));

    // Create new DayTimeWindow entries for added days (with empty windows)
    const newEntries: DayTimeWindow[] = addedDays.map(day => ({
      day,
      windows: []
    }));

    // Find which days were removed
    const removedDays = existingDays.filter(day => !newDays.includes(day));

    // Filter out removed days and add new entries
    const updated = [
      ...dayTimeWindows.filter(dtw => !removedDays.includes(dtw.day)),
      ...newEntries
    ];

    // Sort by date
    updated.sort((a, b) => a.day.localeCompare(b.day));

    onDayTimeWindowsChange(updated);
  };

  // Handle updating windows for a specific day
  const handleDayWindowsChange = (day: string, windows: TimeWindow[]) => {
    if (!onDayTimeWindowsChange) return;

    const updated = dayTimeWindows.map(dtw =>
      dtw.day === day ? { ...dtw, windows } : dtw
    );

    onDayTimeWindowsChange(updated);
  };

  // Handle deleting an entire day
  const handleDeleteDay = (day: string) => {
    if (!onDayTimeWindowsChange) return;

    const updated = dayTimeWindows.filter(dtw => dtw.day !== day);
    onDayTimeWindowsChange(updated);
  };

  // Get currently selected days for the DaysSelector
  const selectedDays = dayTimeWindows.map(dtw => dtw.day);

  // Get allowed days from poll constraints (for voting form)
  const allowedDays = pollDayTimeWindows?.map(dtw => dtw.day);

  return (
    <div className="space-y-3" data-testid="participation-conditions">
      {/* Participants */}
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

      {/* Duration */}
      {onDurationMinChange && onDurationMaxChange && onDurationMinEnabledChange && onDurationMaxEnabledChange && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Duration (hours)
          </label>
          <MinMaxCounter
            minValue={durationMinValue}
            maxValue={durationMaxValue}
            maxEnabled={durationMaxEnabled}
            onMinChange={onDurationMinChange}
            onMaxChange={onDurationMaxChange}
            onMaxEnabledChange={onDurationMaxEnabledChange}
            increment={0.25}
            minLimit={pollDurationWindow?.minEnabled ? pollDurationWindow.minValue ?? 0.25 : 0.25}
            maxLimit={pollDurationWindow?.maxEnabled ? pollDurationWindow.maxValue : undefined}
            minRequired={pollDurationWindow?.minEnabled ?? false}
            maxRequired={pollDurationWindow?.maxEnabled ?? false}
            disabled={disabled}
            formatValue={formatDurationValue}
            minCheckboxEnabled={durationMinEnabled}
            onMinCheckboxChange={onDurationMinEnabledChange}
            deferValidation={true}
            testId="duration-counter"
          />
        </div>
      )}

      {/* Day Time Windows (list of days with their time windows) */}
      {onDayTimeWindowsChange && (
        <div className="space-y-2">
          {dayTimeWindows.length > 0 && (
            <label className="block text-sm font-medium mb-2">
              Time Windows
            </label>
          )}

          {dayTimeWindows.map((dayTimeWindow) => (
            <DayTimeWindowsInput
              key={dayTimeWindow.day}
              day={dayTimeWindow.day}
              windows={dayTimeWindow.windows}
              onChange={(windows) => handleDayWindowsChange(dayTimeWindow.day, windows)}
              onDelete={() => handleDeleteDay(dayTimeWindow.day)}
              disabled={disabled}
            />
          ))}

          {/* Select Days Button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsDaysPickerOpen(true)}
              disabled={disabled}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {dayTimeWindows.length === 0 ? 'Select Days' : 'Add/Remove Days'}
            </button>
          </div>

          {/* Days Selector Modal */}
          <DaysSelector
            selectedDays={selectedDays}
            onChange={handleDaysSelected}
            disabled={disabled}
            isOpen={isDaysPickerOpen}
            onOpenChange={setIsDaysPickerOpen}
            allowedDays={allowedDays}
            hideButton={true}
          />
        </div>
      )}
    </div>
  );
}

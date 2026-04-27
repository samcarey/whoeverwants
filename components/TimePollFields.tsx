import { useState, useRef } from 'react';
import MinMaxCounter from './MinMaxCounter';
import DaysSelector from './DaysSelector';
import DayTimeWindowsInput from './DayTimeWindowsInput';

export interface TimeWindow {
  min: string;
  max: string;
  enabled?: boolean; // For voter form: whether this window is active (default true)
}

export interface DayTimeWindow {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
}

interface TimePollFieldsProps {
  disabled?: boolean;
  // Duration props
  durationMinValue?: number | null;
  durationMaxValue?: number | null;
  durationMinEnabled?: boolean;
  durationMaxEnabled?: boolean;
  onDurationMinChange?: (value: number | null) => void;
  onDurationMaxChange?: (value: number | null) => void;
  onDurationMinEnabledChange?: (enabled: boolean) => void;
  onDurationMaxEnabledChange?: (enabled: boolean) => void;
  // Day time windows props
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
  highlightDaysButton?: boolean;
}

// Time-poll creation/voting form section: duration + per-day time windows.
// Replaces the broader ParticipationConditions component that died with the
// participation poll type (migration 094).
export default function TimePollFields({
  disabled = false,
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
  highlightDaysButton = false,
}: TimePollFieldsProps) {
  const [isDaysPickerOpen, setIsDaysPickerOpen] = useState(false);
  // Cache windows for removed days so they can be restored on re-add
  const removedDaysCache = useRef<Record<string, TimeWindow[]>>({});

  const formatDurationValue = (value: number) => {
    return parseFloat(value.toFixed(2)).toString();
  };

  const handleDaysSelected = (newDays: string[]) => {
    if (!onDayTimeWindowsChange) return;

    const existingDays = dayTimeWindows.map(dtw => dtw.day);
    const removedDays = existingDays.filter(day => !newDays.includes(day));

    // Cache windows for removed days before discarding them
    for (const day of removedDays) {
      const dtw = dayTimeWindows.find(d => d.day === day);
      if (dtw && dtw.windows.length > 0) {
        removedDaysCache.current[day] = dtw.windows;
      }
    }

    const addedDays = newDays.filter(day => !existingDays.includes(day));
    const newEntries: DayTimeWindow[] = addedDays.map(day => {
      const cached = removedDaysCache.current[day];
      if (cached) delete removedDaysCache.current[day];
      return { day, windows: cached || [] };
    });

    const updated = [
      ...dayTimeWindows.filter(dtw => !removedDays.includes(dtw.day)),
      ...newEntries
    ];
    updated.sort((a, b) => a.day.localeCompare(b.day));
    onDayTimeWindowsChange(updated);
  };

  const handleDayWindowsChange = (day: string, windows: TimeWindow[]) => {
    if (!onDayTimeWindowsChange) return;
    const updated = dayTimeWindows.map(dtw =>
      dtw.day === day ? { ...dtw, windows } : dtw
    );
    onDayTimeWindowsChange(updated);
  };

  const handleDeleteDay = (day: string) => {
    if (!onDayTimeWindowsChange) return;
    const updated = dayTimeWindows.filter(dtw => dtw.day !== day);
    onDayTimeWindowsChange(updated);
  };

  const selectedDays = dayTimeWindows.map(dtw => dtw.day);
  const allowedDays = pollDayTimeWindows?.map(dtw => dtw.day);

  // Convert minimum duration from hours to minutes for time window validation
  const minDurationMinutes = durationMinEnabled && durationMinValue != null
    ? Math.round(durationMinValue * 60)
    : null;

  return (
    <div className="space-y-3" data-testid="time-poll-fields">
      {/* Duration */}
      {onDurationMinChange && onDurationMaxChange && onDurationMinEnabledChange && onDurationMaxEnabledChange && (
        <div>
          <label className="block text-sm font-medium mb-1">
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
            maxLimit={pollDurationWindow?.maxEnabled ? pollDurationWindow.maxValue ?? undefined : undefined}
            minRequired={pollDurationWindow?.minEnabled ?? false}
            maxRequired={pollDurationWindow?.maxEnabled ?? false}
            disabled={disabled}
            formatValue={formatDurationValue}
            minCheckboxEnabled={durationMinEnabled}
            onMinCheckboxChange={onDurationMinEnabledChange}
          />
        </div>
      )}

      {/* Day Time Windows */}
      {onDayTimeWindowsChange && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              Time Windows
            </label>
            <button
              type="button"
              onClick={() => setIsDaysPickerOpen(true)}
              disabled={disabled}
              className={`px-3 py-1 text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                highlightDaysButton
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-500 hover:bg-amber-200 dark:hover:bg-amber-900/60'
                  : 'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {dayTimeWindows.length === 0 ? 'Select Days' : 'Add/Remove Days'}
            </button>
          </div>

          {dayTimeWindows.map((dayTimeWindow) => (
            <DayTimeWindowsInput
              key={dayTimeWindow.day}
              day={dayTimeWindow.day}
              windows={dayTimeWindow.windows}
              onChange={(windows) => handleDayWindowsChange(dayTimeWindow.day, windows)}
              onDelete={() => handleDeleteDay(dayTimeWindow.day)}
              disabled={disabled}
              pollWindows={pollDayTimeWindows?.find(p => p.day === dayTimeWindow.day)?.windows}
              minDurationMinutes={minDurationMinutes}
            />
          ))}

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

import { useState } from 'react';
import MinMaxCounter from './MinMaxCounter';
import DaysSelector from './DaysSelector';
import DayTimeWindowsInput from './DayTimeWindowsInput';
import { useDayTimeWindowsState } from '@/lib/useDayTimeWindowsState';

export interface TimeWindow {
  min: string;
  max: string;
  enabled?: boolean; // For voter form: whether this window is active (default true)
}

export interface DayTimeWindow {
  day: string; // YYYY-MM-DD format
  windows: TimeWindow[];
}

interface TimeQuestionFieldsProps {
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
  // Question-level condition restrictions (for voting form)
  questionDayTimeWindows?: DayTimeWindow[];
  questionDurationWindow?: {
    minValue: number | null;
    maxValue: number | null;
    minEnabled: boolean;
    maxEnabled: boolean;
  };
  highlightDaysButton?: boolean;
  // When false, the embedded Day Time Windows block (label + button + day
  // list + DaysSelector) is omitted so the caller can render its own copy
  // (e.g. the create-poll form lifts it into a dedicated card).
  renderDaysSection?: boolean;
}

// Time-question creation/voting form section: duration + per-day time windows.
// Replaces the broader ParticipationConditions component that died with the
// participation question type (migration 094).
export default function TimeQuestionFields({
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
  questionDayTimeWindows,
  questionDurationWindow,
  highlightDaysButton = false,
  renderDaysSection = true,
}: TimeQuestionFieldsProps) {
  const [isDaysPickerOpen, setIsDaysPickerOpen] = useState(false);
  const {
    onDaysSelected: handleDaysSelected,
    onWindowsChange: handleDayWindowsChange,
    onDeleteDay: handleDeleteDay,
  } = useDayTimeWindowsState(dayTimeWindows, onDayTimeWindowsChange);

  const formatDurationValue = (value: number) => {
    return parseFloat(value.toFixed(2)).toString();
  };

  const selectedDays = dayTimeWindows.map(dtw => dtw.day);
  const allowedDays = questionDayTimeWindows?.map(dtw => dtw.day);

  // Convert minimum duration from hours to minutes for time window validation
  const minDurationMinutes = durationMinEnabled && durationMinValue != null
    ? Math.round(durationMinValue * 60)
    : null;

  return (
    <div className="space-y-3" data-testid="time-question-fields">
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
            minLimit={questionDurationWindow?.minEnabled ? questionDurationWindow.minValue ?? 0.25 : 0.25}
            maxLimit={questionDurationWindow?.maxEnabled ? questionDurationWindow.maxValue ?? undefined : undefined}
            minRequired={questionDurationWindow?.minEnabled ?? false}
            maxRequired={questionDurationWindow?.maxEnabled ?? false}
            disabled={disabled}
            formatValue={formatDurationValue}
            minCheckboxEnabled={durationMinEnabled}
            onMinCheckboxChange={onDurationMinEnabledChange}
          />
        </div>
      )}

      {/* Day Time Windows */}
      {renderDaysSection && onDayTimeWindowsChange && (
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
              questionWindows={questionDayTimeWindows?.find(p => p.day === dayTimeWindow.day)?.windows}
              minDurationMinutes={minDurationMinutes}
              allDays={dayTimeWindows}
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

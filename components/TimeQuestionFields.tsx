import MinMaxCounter from './MinMaxCounter';
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
  // When false, the embedded Day Time Windows block (label + day list) is
  // omitted so the caller can render its own copy (e.g. the create-poll form
  // lifts it into a dedicated card).
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
  renderDaysSection = true,
}: TimeQuestionFieldsProps) {
  const {
    onWindowsChange: handleDayWindowsChange,
    onDeleteDay: handleDeleteDay,
  } = useDayTimeWindowsState(dayTimeWindows, onDayTimeWindowsChange);

  const formatDurationValue = (value: number) => {
    return parseFloat(value.toFixed(2)).toString();
  };

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

      {/* Day Time Windows. Voters can toggle availability within the
          creator-defined days/windows but cannot add or remove days, so
          there is no day-picker button here. */}
      {renderDaysSection && onDayTimeWindowsChange && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">
            Time Windows
          </label>

          {dayTimeWindows.length > 0 && (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
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
                  borderless
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

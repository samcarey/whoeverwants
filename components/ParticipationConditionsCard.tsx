interface DayTimeWindow {
  day: string;
  windows: { min: string; max: string }[];
}

interface ParticipationConditionsCardProps {
  // Voter's vote
  voterChoice: 'yes' | 'no' | null;
  isAbstaining: boolean;

  // Voter's conditions (from vote data)
  voterMinParticipants: number | null;
  voterMaxParticipants: number | null;
  voterDayTimeWindows?: DayTimeWindow[];
  voterDuration?: { minValue: number | null; maxValue: number | null; minEnabled: boolean; maxEnabled: boolean };

  // Poll's requirements
  pollMinParticipants: number | null;
  pollMaxParticipants: number | null;
  pollDayTimeWindows?: DayTimeWindow[];
  pollDurationWindow?: { minValue: number | null; maxValue: number | null; minEnabled: boolean; maxEnabled: boolean };

  // Results (when poll is closed)
  isPollClosed: boolean;
  isEventHappening?: boolean;
  isUserParticipating?: boolean;
}

export default function ParticipationConditionsCard({
  voterChoice,
  isAbstaining,
  voterMinParticipants,
  voterMaxParticipants,
  voterDayTimeWindows,
  voterDuration,
  pollMinParticipants,
  pollMaxParticipants,
  pollDayTimeWindows,
  pollDurationWindow,
  isPollClosed,
  isEventHappening,
  isUserParticipating,
}: ParticipationConditionsCardProps) {
  if (isAbstaining) {
    return null;
  }

  if (voterChoice !== 'yes') {
    return null;
  }

  // Format participants range
  const formatParticipantsRange = (min: number | null, max: number | null) => {
    if (min === null && max === null) return 'Any';
    if (min !== null && max !== null) {
      if (min === max) return `Exactly ${min}`;
      return `${min}-${max}`;
    }
    if (min !== null) return `${min}+`;
    if (max !== null) return `Up to ${max}`;
    return 'Any';
  };

  // Format duration range
  const formatDuration = (duration?: { minValue: number | null; maxValue: number | null; minEnabled: boolean; maxEnabled: boolean }) => {
    if (!duration) return null;

    const formatHours = (hours: number) => {
      return hours === 1 ? '1 hr' : `${hours} hrs`;
    };

    if (!duration.minEnabled && !duration.maxEnabled) return null;
    if (duration.minEnabled && duration.maxEnabled && duration.minValue !== null && duration.maxValue !== null) {
      if (duration.minValue === duration.maxValue) return formatHours(duration.minValue);
      return `${formatHours(duration.minValue)}-${formatHours(duration.maxValue)}`;
    }
    if (duration.minEnabled && duration.minValue !== null) return `${formatHours(duration.minValue)}+`;
    if (duration.maxEnabled && duration.maxValue !== null) return `Up to ${formatHours(duration.maxValue)}`;
    return null;
  };

  // Format time (12-hour format, compact)
  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return minutes === '00' ? `${displayHour}${ampm}` : `${displayHour}:${minutes}${ampm}`;
  };

  // Format day-time-windows
  const formatDayTimeWindows = (dayTimeWindows?: DayTimeWindow[]) => {
    if (!dayTimeWindows || dayTimeWindows.length === 0) return null;

    // Format day (short date format)
    const formatDay = (dayStr: string) => {
      const date = new Date(dayStr + 'T00:00:00');
      const month = date.toLocaleDateString('en-US', { month: 'short' });
      const day = date.getDate();
      return `${month} ${day}`;
    };

    return dayTimeWindows.map(dtw => {
      const dayStr = formatDay(dtw.day);
      if (dtw.windows.length === 0) {
        return dayStr; // Just the day, no time windows
      }
      const windowsStr = dtw.windows.map(w => `${formatTime(w.min)}-${formatTime(w.max)}`).join(', ');
      return `${dayStr} (${windowsStr})`;
    }).join('; ');
  };

  const voterParticipants = formatParticipantsRange(voterMinParticipants, voterMaxParticipants);
  const pollParticipants = formatParticipantsRange(pollMinParticipants, pollMaxParticipants);

  const voterDurationStr = formatDuration(voterDuration);
  const pollDurationStr = formatDuration(pollDurationWindow);

  const voterDayTimeWindowsStr = formatDayTimeWindows(voterDayTimeWindows);
  const pollDayTimeWindowsStr = formatDayTimeWindows(pollDayTimeWindows);

  return (
    <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <h5 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-200">Your Conditions</h5>

      <div className="space-y-1.5 text-sm">
        {/* Participants */}
        <div className="flex items-start">
          <span className="mr-2 text-blue-600 dark:text-blue-400">✓</span>
          <div className="flex-1">
            <span className="text-gray-700 dark:text-gray-300">
              <strong className="text-blue-700 dark:text-blue-300">{voterParticipants}</strong>
              {pollParticipants !== voterParticipants && (
                <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
                  (poll: {pollParticipants})
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Days & Time Windows */}
        {voterDayTimeWindowsStr && (
          <div className="flex items-start">
            <span className="mr-2 text-blue-600 dark:text-blue-400">✓</span>
            <div className="flex-1">
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-blue-700 dark:text-blue-300">{voterDayTimeWindowsStr}</strong>
                {pollDayTimeWindowsStr && pollDayTimeWindowsStr !== voterDayTimeWindowsStr && (
                  <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
                    (poll: {pollDayTimeWindowsStr})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Duration */}
        {voterDurationStr && (
          <div className="flex items-start">
            <span className="mr-2 text-blue-600 dark:text-blue-400">✓</span>
            <div className="flex-1">
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-blue-700 dark:text-blue-300">{voterDurationStr}</strong>
                {pollDurationStr && pollDurationStr !== voterDurationStr && (
                  <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
                    (poll: {pollDurationStr})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Poll closed status */}
        {isPollClosed && (
          <>
            <div className="border-t border-blue-200 dark:border-blue-700 my-2 pt-2">
              <div className="flex items-start">
                <span className={`mr-2 ${isEventHappening ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {isEventHappening ? '✓' : '✗'}
                </span>
                <div className="flex-1">
                  <span className={`font-medium ${isEventHappening ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                    {isEventHappening ? 'Event is happening' : 'Event is not happening'}
                  </span>
                </div>
              </div>
            </div>

            {isEventHappening && (
              <div className="flex items-start">
                <span className={`mr-2 ${isUserParticipating ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                  {isUserParticipating ? '✓' : '○'}
                </span>
                <div className="flex-1">
                  <span className={`font-medium ${isUserParticipating ? 'text-green-700 dark:text-green-300' : 'text-orange-700 dark:text-orange-300'}`}>
                    {isUserParticipating ? 'You are participating' : 'You are not participating'}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

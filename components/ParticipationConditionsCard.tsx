interface ParticipationConditionsCardProps {
  // Voter's vote
  voterChoice: 'yes' | 'no' | null;
  isAbstaining: boolean;

  // Voter's conditions (from vote data)
  voterMinParticipants: number | null;
  voterMaxParticipants: number | null;
  voterDays?: string[];
  voterDuration?: { minValue: number | null; maxValue: number | null; minEnabled: boolean; maxEnabled: boolean };
  voterTime?: { minValue: string | null; maxValue: string | null; minEnabled: boolean; maxEnabled: boolean };

  // Poll's requirements
  pollMinParticipants: number | null;
  pollMaxParticipants: number | null;
  pollPossibleDays?: string[];
  pollDurationWindow?: { minValue: number | null; maxValue: number | null; minEnabled: boolean; maxEnabled: boolean };
  pollTimeWindow?: { minValue: string | null; maxValue: string | null; minEnabled: boolean; maxEnabled: boolean };

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
  voterDays,
  voterDuration,
  voterTime,
  pollMinParticipants,
  pollMaxParticipants,
  pollPossibleDays,
  pollDurationWindow,
  pollTimeWindow,
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

  // Format time window
  const formatTimeWindow = (time?: { minValue: string | null; maxValue: string | null; minEnabled: boolean; maxEnabled: boolean }) => {
    if (!time) return null;

    const formatTime = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return minutes === '00' ? `${displayHour}${ampm}` : `${displayHour}:${minutes}${ampm}`;
    };

    if (!time.minEnabled && !time.maxEnabled) return null;
    if (time.minEnabled && time.maxEnabled && time.minValue && time.maxValue) {
      return `${formatTime(time.minValue)}-${formatTime(time.maxValue)}`;
    }
    if (time.minEnabled && time.minValue) return `After ${formatTime(time.minValue)}`;
    if (time.maxEnabled && time.maxValue) return `Before ${formatTime(time.maxValue)}`;
    return null;
  };

  // Format days
  const formatDays = (days?: string[]) => {
    if (!days || days.length === 0) return null;
    if (days.length === 7) return 'Any day';

    const dayAbbr: Record<string, string> = {
      'Monday': 'Mon',
      'Tuesday': 'Tue',
      'Wednesday': 'Wed',
      'Thursday': 'Thu',
      'Friday': 'Fri',
      'Saturday': 'Sat',
      'Sunday': 'Sun'
    };

    return days.map(d => dayAbbr[d] || d).join(', ');
  };

  const voterParticipants = formatParticipantsRange(voterMinParticipants, voterMaxParticipants);
  const pollParticipants = formatParticipantsRange(pollMinParticipants, pollMaxParticipants);

  const voterDurationStr = formatDuration(voterDuration);
  const pollDurationStr = formatDuration(pollDurationWindow);

  const voterTimeStr = formatTimeWindow(voterTime);
  const pollTimeStr = formatTimeWindow(pollTimeWindow);

  const voterDaysStr = formatDays(voterDays);
  const pollDaysStr = formatDays(pollPossibleDays);

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

        {/* Days */}
        {voterDaysStr && (
          <div className="flex items-start">
            <span className="mr-2 text-blue-600 dark:text-blue-400">✓</span>
            <div className="flex-1">
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-blue-700 dark:text-blue-300">{voterDaysStr}</strong>
                {pollDaysStr && pollDaysStr !== voterDaysStr && (
                  <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
                    (poll: {pollDaysStr})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Time Window */}
        {voterTimeStr && (
          <div className="flex items-start">
            <span className="mr-2 text-blue-600 dark:text-blue-400">✓</span>
            <div className="flex-1">
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-blue-700 dark:text-blue-300">{voterTimeStr}</strong>
                {pollTimeStr && pollTimeStr !== voterTimeStr && (
                  <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">
                    (poll: {pollTimeStr})
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

'use client';

import { VOTING_CUTOFF_OPTIONS } from '@/components/VotingCutoffConditionsModal';
import { formatDeadlineLabel } from '@/lib/timeUtils';

interface VotingCutoffFieldProps {
  deadlineOption: string;
  setDeadlineOption: (value: string) => void;
  customDate: string;
  setCustomDate: (value: string) => void;
  customTime: string;
  setCustomTime: (value: string) => void;
  isLoading: boolean;
  isClient: boolean;
}

function getTodayDate(): string {
  if (typeof window === 'undefined') return '';
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export default function VotingCutoffField({
  deadlineOption,
  setDeadlineOption,
  customDate,
  setCustomDate,
  customTime,
  setCustomTime,
  isLoading,
  isClient,
}: VotingCutoffFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium cursor-pointer">
        <span>Voting Cutoff: </span>
        <span className="relative inline-flex">
          <span className="font-normal text-blue-600 dark:text-blue-400">
            {(() => {
              if (deadlineOption === 'none') return 'None';
              if (deadlineOption === 'custom') {
                if (customDate && customTime) {
                  const dt = new Date(`${customDate}T${customTime}`);
                  return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                }
                return 'Custom';
              }
              const opt = VOTING_CUTOFF_OPTIONS.find(o => o.value === deadlineOption);
              if (!opt) return deadlineOption;
              return formatDeadlineLabel(opt.minutes, opt.label);
            })()}
          </span>
          <select
            value={deadlineOption}
            onChange={(e) => setDeadlineOption(e.target.value)}
            disabled={isLoading}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Voting cutoff duration"
          >
            <option value="none">None</option>
            {VOTING_CUTOFF_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {formatDeadlineLabel(opt.minutes, opt.label)}
              </option>
            ))}
          </select>
        </span>
      </label>
      {deadlineOption === 'custom' && (
        <div className="mt-2 flex justify-between gap-2">
          <div className="w-auto">
            <label htmlFor="customDate" className="block text-xs text-gray-500 mb-1">Date</label>
            <input
              type="date"
              id="customDate"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              disabled={isLoading}
              min={isClient ? getTodayDate() : ''}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs text-center"
              style={{ fontSize: '14px' }}
              required
            />
          </div>
          <div className="w-auto">
            <label htmlFor="customTime" className="block text-xs text-gray-500 mb-1 text-right">Time</label>
            <input
              type="time"
              id="customTime"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              disabled={isLoading}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs text-center"
              style={{ fontSize: '14px' }}
              required
            />
          </div>
        </div>
      )}
    </div>
  );
}

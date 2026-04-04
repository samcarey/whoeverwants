'use client';

import { useState, useEffect, useCallback } from 'react';
import ModalPortal from '@/components/ModalPortal';

// Deadline options starting small and scaling up to 1 month
const EXPIRATION_DEADLINE_OPTIONS = [
  { value: "5min", label: "5 min", minutes: 5 },
  { value: "10min", label: "10 min", minutes: 10 },
  { value: "15min", label: "15 min", minutes: 15 },
  { value: "30min", label: "30 min", minutes: 30 },
  { value: "1hr", label: "1 hr", minutes: 60 },
  { value: "2hr", label: "2 hr", minutes: 120 },
  { value: "4hr", label: "4 hr", minutes: 240 },
  { value: "1day", label: "1 day", minutes: 1440 },
  { value: "3days", label: "3 days", minutes: 4320 },
  { value: "1week", label: "1 week", minutes: 10080 },
  { value: "2weeks", label: "2 weeks", minutes: 20160 },
  { value: "1month", label: "1 month", minutes: 43200 },
  { value: "custom", label: "Custom", minutes: 0 },
];

export { EXPIRATION_DEADLINE_OPTIONS };

interface ExpirationConditionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  deadlineOption: string;
  setDeadlineOption: (value: string) => void;
  customDate: string;
  setCustomDate: (value: string) => void;
  customTime: string;
  setCustomTime: (value: string) => void;
  autoCloseAfter: number | null;
  setAutoCloseAfter: (value: number | null) => void;
  isClient: boolean;
  disabled?: boolean;
}

function getTodayDate(): string {
  if (typeof window === 'undefined') return '';
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export default function ExpirationConditionsModal({
  isOpen,
  onClose,
  deadlineOption,
  setDeadlineOption,
  customDate,
  setCustomDate,
  customTime,
  setCustomTime,
  autoCloseAfter,
  setAutoCloseAfter,
  isClient,
  disabled = false,
}: ExpirationConditionsModalProps) {
  const [deadlineEnabled, setDeadlineEnabled] = useState(true);
  const [voteCountEnabled, setVoteCountEnabled] = useState(autoCloseAfter !== null);

  // Sync local state with props
  useEffect(() => {
    setVoteCountEnabled(autoCloseAfter !== null);
  }, [autoCloseAfter]);

  const getDeadlineLabel = useCallback((optionValue: string): string => {
    if (optionValue === 'custom') return 'Custom';
    const opt = EXPIRATION_DEADLINE_OPTIONS.find(o => o.value === optionValue);
    if (!opt) return optionValue;
    if (!isClient) return opt.label;
    const now = new Date();
    const deadline = new Date(now.getTime() + opt.minutes * 60 * 1000);
    return `${opt.label} (${deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
  }, [isClient]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 mx-4 max-w-sm w-full shadow-xl">
          <h3 className="text-lg font-semibold mb-4">Expiration Conditions</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            The poll will close when any of these conditions are met.
          </p>

          {/* Deadline condition */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={deadlineEnabled}
                onChange={(e) => {
                  setDeadlineEnabled(e.target.checked);
                  if (!e.target.checked) {
                    // Clear deadline - set to a sentinel value
                    setDeadlineOption('none');
                  } else {
                    setDeadlineOption('1week');
                  }
                }}
                disabled={disabled}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium">Time limit</span>
            </label>
            {deadlineEnabled && (
              <div className="ml-6 space-y-2">
                <select
                  value={deadlineOption}
                  onChange={(e) => setDeadlineOption(e.target.value)}
                  disabled={disabled}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 text-sm"
                >
                  {EXPIRATION_DEADLINE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {getDeadlineLabel(option.value)}
                    </option>
                  ))}
                </select>
                {deadlineOption === 'custom' && (
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      disabled={disabled}
                      min={isClient ? getTodayDate() : ''}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white text-sm"
                    />
                    <input
                      type="time"
                      value={customTime}
                      onChange={(e) => setCustomTime(e.target.value)}
                      disabled={disabled}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white text-sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Vote count condition */}
          <div className="mb-6">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={voteCountEnabled}
                onChange={(e) => {
                  setVoteCountEnabled(e.target.checked);
                  if (e.target.checked) {
                    setAutoCloseAfter(autoCloseAfter ?? 10);
                  } else {
                    setAutoCloseAfter(null);
                  }
                }}
                disabled={disabled}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium">Close after N responses</span>
            </label>
            {voteCountEnabled && (
              <div className="ml-6">
                <input
                  type="number"
                  min={1}
                  value={autoCloseAfter ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAutoCloseAfter(val === '' ? null : Math.max(1, parseInt(val, 10) || 1));
                  }}
                  disabled={disabled}
                  placeholder="Number of responses"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 text-sm"
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-lg bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

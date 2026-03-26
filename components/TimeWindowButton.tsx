'use client';

import { useState } from 'react';
import TimeGridModal from './TimeGridModal';

interface TimeWindowButtonProps {
  minValue: string | null;
  maxValue: string | null;
  minEnabled: boolean;
  maxEnabled: boolean;
  onUpdate: (min: string | null, max: string | null, minEnabled: boolean, maxEnabled: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export default function TimeWindowButton({
  minValue,
  maxValue,
  minEnabled,
  maxEnabled,
  onUpdate,
  label = 'Time Window',
  disabled = false,
}: TimeWindowButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const getDisplayText = () => {
    if (!minEnabled && !maxEnabled) {
      return 'No time restriction';
    }

    const start = minEnabled && minValue ? minValue : '00:00';
    const end = maxEnabled && maxValue ? maxValue : '23:59';

    if (!minEnabled) {
      return `Until ${end}`;
    }
    if (!maxEnabled) {
      return `From ${start}`;
    }

    return `${start} - ${end}`;
  };

  const handleApply = (
    min: string | null,
    max: string | null,
    minEn: boolean,
    maxEn: boolean
  ) => {
    onUpdate(min, max, minEn, maxEn);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
        )}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          disabled={disabled}
          className="
            flex items-center gap-2 px-4 py-2
            border border-gray-300 dark:border-gray-600
            rounded-lg
            bg-white dark:bg-gray-800
            hover:bg-gray-50 dark:hover:bg-gray-700
            transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed
            text-left
          "
        >
          <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {getDisplayText()}
          </span>
        </button>
      </div>

      <TimeGridModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        minValue={minValue}
        maxValue={maxValue}
        minEnabled={minEnabled}
        maxEnabled={maxEnabled}
        onApply={handleApply}
      />
    </>
  );
}

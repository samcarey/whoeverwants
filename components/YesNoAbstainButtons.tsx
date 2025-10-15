import React from 'react';

interface YesNoAbstainButtonsProps {
  yesNoChoice: 'yes' | 'no' | null;
  isAbstaining?: boolean;
  onYesClick: () => void;
  onNoClick: () => void;
  onAbstainClick?: () => void;
  disabled?: boolean;
  showAbstain?: boolean;
}

export default function YesNoAbstainButtons({
  yesNoChoice,
  isAbstaining = false,
  onYesClick,
  onNoClick,
  onAbstainClick,
  disabled = false,
  showAbstain = true
}: YesNoAbstainButtonsProps) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onYesClick}
        disabled={disabled}
        className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          yesNoChoice === 'yes'
            ? 'bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100 border-2 border-green-400 dark:border-green-600 active:bg-green-300 dark:active:bg-green-700'
            : 'bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200 border-2 border-transparent active:bg-green-300 dark:active:bg-green-700'
        }`}
      >
        Yes
      </button>
      <button
        onClick={onNoClick}
        disabled={disabled}
        className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          yesNoChoice === 'no'
            ? 'bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100 border-2 border-red-400 dark:border-red-600 active:bg-red-300 dark:active:bg-red-700'
            : 'bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800 text-red-800 dark:text-red-200 border-2 border-transparent active:bg-red-300 dark:active:bg-red-700'
        }`}
      >
        No
      </button>
      {showAbstain && (
        <button
          onClick={onAbstainClick}
          disabled={disabled}
          className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isAbstaining
              ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 border-2 border-yellow-400 dark:border-yellow-600 active:bg-yellow-300 dark:active:bg-yellow-700'
              : 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 text-yellow-800 dark:text-yellow-200 border-2 border-transparent active:bg-yellow-300 dark:active:bg-yellow-700'
          }`}
        >
          Abstain
        </button>
      )}
    </div>
  );
}

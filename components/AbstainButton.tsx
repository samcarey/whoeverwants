import React from 'react';

interface AbstainButtonProps {
  isAbstaining: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export default function AbstainButton({
  isAbstaining,
  onClick,
  disabled = false,
}: AbstainButtonProps) {
  return (
    <div className="mt-4">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isAbstaining
            ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 border-2 border-yellow-400 dark:border-yellow-600 active:bg-yellow-300 dark:active:bg-yellow-700'
            : 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 text-yellow-800 dark:text-yellow-200 border-2 border-transparent active:bg-yellow-300 dark:active:bg-yellow-700'
        }`}
      >
        Abstain
      </button>
    </div>
  );
}

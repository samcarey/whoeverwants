"use client";

interface PollManagementButtonsProps {
  showCloseButton: boolean;
  showReopenButton: boolean;
  showForgetButton: boolean;
  onCloseClick: () => void;
  onReopenClick?: () => void;
  onForgetClick?: () => void;
  isClosingPoll: boolean;
  isReopeningPoll?: boolean;
}

export default function PollManagementButtons({
  showCloseButton,
  showReopenButton,
  showForgetButton,
  onCloseClick,
  onReopenClick,
  onForgetClick,
  isClosingPoll,
  isReopeningPoll = false
}: PollManagementButtonsProps) {
  // Don't render anything if no buttons should be shown
  if (!showCloseButton && !showReopenButton && !showForgetButton) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2">
      {showCloseButton && (
        <button
          onClick={onCloseClick}
          disabled={isClosingPoll}
          className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
        >
          {isClosingPoll ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Closing Poll...
            </>
          ) : (
            'Close Poll'
          )}
        </button>
      )}

      {showReopenButton && onReopenClick && (
        <button
          onClick={onReopenClick}
          disabled={isReopeningPoll}
          className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
        >
          {isReopeningPoll ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Reopening Poll...
            </>
          ) : (
            'Reopen Poll (Dev)'
          )}
        </button>
      )}

      {showForgetButton && onForgetClick && (
        <button
          onClick={onForgetClick}
          className="inline-flex py-2 px-4 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:border-red-300 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:border-red-600 dark:hover:text-red-400 transition-all duration-200"
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Forget this poll</span>
          </div>
        </button>
      )}
    </div>
  );
}

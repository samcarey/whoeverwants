"use client";

interface Nomination {
  option: string;
  count: number;
}

interface NominationsListProps {
  nominations: Nomination[];
  userNominations?: string[];
  showVoteCounts?: boolean;
  showUserIndicator?: boolean;
  className?: string;
  showEditButton?: boolean;
  onEditClick?: () => void;
  isEditDisabled?: boolean;
}

export default function NominationsList({
  nominations,
  userNominations = [],
  showVoteCounts = true,
  showUserIndicator = true,
  className = "",
  showEditButton = false,
  onEditClick,
  isEditDisabled = false
}: NominationsListProps) {
  if (nominations.length === 0) {
    return (
      <div className={`text-center py-4 ${className}`}>
        <p className="text-gray-600 dark:text-gray-400">No suggestions yet</p>
      </div>
    );
  }

  const uniqueCount = nominations.length;

  // Sort nominations alphabetically
  const sortedNominations = [...nominations].sort((a, b) =>
    a.option.localeCompare(b.option)
  );

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-lg text-gray-900 dark:text-white">
          Suggestions {uniqueCount > 0 && `(${uniqueCount})`}
        </h4>
        <div className="flex items-center gap-2">
          {userNominations.length > 0 && showUserIndicator && (
            <>
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Yours
              </span>
            </>
          )}
          {showEditButton && (
            <button
              onClick={onEditClick}
              disabled={isEditDisabled}
              className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 active:bg-yellow-600 active:scale-95 text-yellow-900 font-medium text-sm rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {sortedNominations.map((nomination, index) => {
          const isUserNomination = userNominations.includes(nomination.option);

          return (
            <div
              key={index}
              className={`inline-flex items-center rounded-full overflow-hidden ${
                isUserNomination
                  ? 'bg-blue-100 dark:bg-blue-900/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}
            >
              <span className={`px-3 py-1 text-sm font-medium ${
                isUserNomination
                  ? 'text-blue-900 dark:text-blue-100'
                  : 'text-gray-900 dark:text-gray-100'
              }`}>
                {nomination.option}
              </span>
              {showVoteCounts && (
                <span className={`px-2.5 py-1 text-sm font-bold ${
                  isUserNomination
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
                }`}>
                  {nomination.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
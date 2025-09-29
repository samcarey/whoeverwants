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
        <p className="text-gray-600 dark:text-gray-400">No nominations yet</p>
      </div>
    );
  }

  const uniqueCount = nominations.length;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-lg text-gray-900 dark:text-white">
          Nominations {uniqueCount > 0 && `(${uniqueCount})`}
        </h4>
        {showEditButton && onEditClick && (
          <button
            onClick={onEditClick}
            disabled={isEditDisabled}
            className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 disabled:bg-yellow-300 text-yellow-900 font-medium text-sm rounded-md transition-colors disabled:cursor-not-allowed"
          >
            Edit
          </button>
        )}
      </div>
      <div className="grid gap-2">
        {nominations.map((nomination, index) => {
          const isUserNomination = userNominations.includes(nomination.option);
          const voteText = showVoteCounts 
            ? `${nomination.count} vote${nomination.count !== 1 ? 's' : ''}`
            : '';
          
          return (
            <div 
              key={index}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
            >
              <span className="text-gray-900 dark:text-white">
                {nomination.option}
              </span>
              <div className="flex items-center gap-2">
                {showVoteCounts && (
                  <span className={`inline-flex items-center justify-center px-3 py-1 text-sm font-medium rounded-full min-w-[4.5rem] text-center ${
                    isUserNomination 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}>
                    {voteText}
                  </span>
                )}
                {!showVoteCounts && isUserNomination && showUserIndicator && (
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 bg-white rounded-full"></div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {userNominations.length > 0 && showUserIndicator && (
        <div className="mt-3 flex justify-end items-center gap-2">
          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            Includes your nominations
          </span>
        </div>
      )}
    </div>
  );
}
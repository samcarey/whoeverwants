"use client";

import type { OptionsMetadata } from "@/lib/types";
import OptionLabel from "./OptionLabel";

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
  optionsMetadata?: OptionsMetadata | null;
}

export default function NominationsList({
  nominations,
  userNominations = [],
  showVoteCounts = true,
  showUserIndicator = true,
  className = "",
  showEditButton = false,
  onEditClick,
  isEditDisabled = false,
  optionsMetadata,
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

  // Check if any nomination has location metadata for layout switching
  const isLocationPoll = nominations.some(n => {
    const meta = optionsMetadata?.[n.option];
    return meta?.name || meta?.infoUrl?.includes("openstreetmap.org");
  });

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

      <div className={`flex flex-wrap justify-center gap-2 ${isLocationPoll ? 'flex-col items-stretch' : ''}`}>
        {sortedNominations.map((nomination, index) => {
          const isUserNomination = userNominations.includes(nomination.option);
          const meta = optionsMetadata?.[nomination.option];
          const isLocation = !!(meta?.name || meta?.infoUrl?.includes("openstreetmap.org"));

          return (
            <div
              key={index}
              className={`inline-flex items-center overflow-hidden ${
                isLocation ? 'rounded-xl' : 'rounded-full'
              } ${
                isUserNomination
                  ? 'bg-blue-100 dark:bg-blue-900/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}
            >
              <span className={`px-3 py-1.5 text-sm font-medium min-w-0 flex-1 ${
                isUserNomination
                  ? 'text-blue-900 dark:text-blue-100'
                  : 'text-gray-900 dark:text-gray-100'
              }`}>
                <OptionLabel text={nomination.option} metadata={meta} />
              </span>
              {showVoteCounts && (
                <span className={`px-2.5 self-stretch flex items-center text-sm font-bold ${
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
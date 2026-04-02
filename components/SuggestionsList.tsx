"use client";

import type { OptionsMetadata } from "@/lib/types";
import OptionLabel, { isLocationEntry } from "./OptionLabel";

interface Suggestion {
  option: string;
  count: number;
}

interface SuggestionsListProps {
  suggestions: Suggestion[];
  userSuggestions?: string[];
  showVoteCounts?: boolean;
  showUserIndicator?: boolean;
  className?: string;
  showEditButton?: boolean;
  onEditClick?: () => void;
  isEditDisabled?: boolean;
  optionsMetadata?: OptionsMetadata | null;
}

export default function SuggestionsList({
  suggestions,
  userSuggestions = [],
  showVoteCounts = true,
  showUserIndicator = true,
  className = "",
  showEditButton = false,
  onEditClick,
  isEditDisabled = false,
  optionsMetadata,
}: SuggestionsListProps) {
  if (suggestions.length === 0) {
    return (
      <div className={`text-center py-4 ${className}`}>
        <p className="text-gray-600 dark:text-gray-400">No suggestions yet</p>
      </div>
    );
  }

  const uniqueCount = suggestions.length;

  // Sort suggestions alphabetically
  const sortedSuggestions = [...suggestions].sort((a, b) =>
    a.option.localeCompare(b.option)
  );

  const isLocationPoll = suggestions.some(n => isLocationEntry(optionsMetadata?.[n.option]));

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-lg text-gray-900 dark:text-white">
          Suggestions {uniqueCount > 0 && `(${uniqueCount})`}
        </h4>
        <div className="flex items-center gap-2">
          {userSuggestions.length > 0 && showUserIndicator && (
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

      {isLocationPoll ? (
        <div className="space-y-2 overflow-hidden">
          {sortedSuggestions.map((suggestion, index) => {
            const isUserSuggestion = userSuggestions.includes(suggestion.option);
            const meta = optionsMetadata?.[suggestion.option];

            return (
              <div
                key={index}
                className={`flex items-center rounded-xl overflow-hidden ${
                  isUserSuggestion
                    ? 'bg-blue-100 dark:bg-blue-900/30'
                    : 'bg-gray-100 dark:bg-gray-700'
                }`}
              >
                <div className={`min-w-0 flex-1 px-3 py-1.5 text-sm font-medium overflow-hidden ${
                  isUserSuggestion
                    ? 'text-blue-900 dark:text-blue-100'
                    : 'text-gray-900 dark:text-gray-100'
                }`}>
                  <OptionLabel text={suggestion.option} metadata={meta} />
                </div>
                {showVoteCounts && (
                  <span className={`px-2.5 self-stretch flex items-center text-sm font-bold flex-shrink-0 ${
                    isUserSuggestion
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
                  }`}>
                    {suggestion.count}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          {sortedSuggestions.map((suggestion, index) => {
            const isUserSuggestion = userSuggestions.includes(suggestion.option);
            const meta = optionsMetadata?.[suggestion.option];

            return (
              <div
                key={index}
                className={`inline-flex items-center rounded-full overflow-hidden ${
                  isUserSuggestion
                    ? 'bg-blue-100 dark:bg-blue-900/30'
                    : 'bg-gray-100 dark:bg-gray-700'
                }`}
              >
                <div className={`px-3 py-1 text-sm font-medium ${
                  isUserSuggestion
                    ? 'text-blue-900 dark:text-blue-100'
                    : 'text-gray-900 dark:text-gray-100'
                }`}>
                  <OptionLabel text={suggestion.option} metadata={meta} />
                </div>
                {showVoteCounts && (
                  <span className={`px-2.5 self-stretch flex items-center text-sm font-bold ${
                    isUserSuggestion
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
                  }`}>
                    {suggestion.count}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
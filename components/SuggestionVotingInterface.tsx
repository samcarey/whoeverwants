"use client";

import { useState, useRef, useEffect, Dispatch, SetStateAction } from "react";
import PollResultsDisplay from "@/components/PollResults";
import OptionsInput, { type OptionsMetadata } from "@/components/OptionsInput";
import { isLocationLikeCategory } from "@/components/TypeFieldInput";
import type { ApiVote } from "@/lib/api";
import SuggestionsList from "@/components/SuggestionsList";
import CompactNameField from "@/components/CompactNameField";
import OptionLabel from "@/components/OptionLabel";
import PollManagementButtons from "@/components/PollManagementButtons";
import VoterList from "@/components/VoterList";
import FollowUpHeader from "@/components/FollowUpHeader";
import PollSubmitButton from "@/components/PollSubmitButton";

const hasSuggestions = (v: ApiVote) => !!(v.suggestions && v.suggestions.length > 0);
import ForkHeader from "@/components/ForkHeader";

interface SuggestionVotingInterfaceProps {
  poll: any;
  existingSuggestions: string[];
  suggestionChoices: string[];
  setSuggestionChoices: Dispatch<SetStateAction<string[]>>;
  isAbstaining: boolean;
  handleAbstain: () => void;
  voteError: string | null;
  voterName: string;
  setVoterName: (name: string) => void;
  handleVoteClick: () => void;
  isSubmitting: boolean;
  isPollClosed: boolean;
  isCreator: boolean;
  handleCloseClick: () => void;
  isClosingPoll: boolean;
  hasVoted: boolean;
  isEditingVote: boolean;
  setIsEditingVote: (editing: boolean) => void;
  userVoteData: any;
  isLoadingVoteData: boolean;
  pollResults: any;
  loadingResults: boolean;
  loadExistingSuggestions: () => void;
  suggestionMetadata?: OptionsMetadata;
  onSuggestionMetadataChange?: (metadata: OptionsMetadata) => void;
  optionsMetadata?: OptionsMetadata | null;
  showCutoffButton?: boolean;
  onCutoffClick?: () => void;
  isCuttingOff?: boolean;
}

export default function SuggestionVotingInterface({
  poll,
  existingSuggestions,
  suggestionChoices,
  setSuggestionChoices,
  isAbstaining,
  handleAbstain,
  voteError,
  voterName,
  setVoterName,
  handleVoteClick,
  isSubmitting,
  isPollClosed,
  isCreator,
  handleCloseClick,
  isClosingPoll,
  hasVoted,
  isEditingVote,
  setIsEditingVote,
  userVoteData,
  isLoadingVoteData,
  pollResults,
  loadingResults,
  loadExistingSuggestions,
  suggestionMetadata,
  onSuggestionMetadataChange,
  optionsMetadata,
  showCutoffButton = false,
  onCutoffClick,
  isCuttingOff = false,
}: SuggestionVotingInterfaceProps) {
  const [newSuggestions, setNewSuggestions] = useState<string[]>([""]);
  const [filteredExistingSuggestions, setFilteredExistingSuggestions] = useState<string[]>([]);
  const [searchRadius, setSearchRadius] = useState(25);

  // Helper function to convert existingSuggestions to format expected by SuggestionsList
  const getSuggestionsWithCounts = () => {
    if (pollResults?.suggestion_counts && pollResults.suggestion_counts.length > 0) {
      // Use server-side suggestion counts when available
      return pollResults.suggestion_counts;
    } else {
      // Fallback to existingSuggestions without counts
      return existingSuggestions.map(suggestion => ({
        option: suggestion,
        count: 0
      }));
    }
  };

  // Initialize edit mode - show ALL suggestions as selectable buttons, empty text fields for new ones
  useEffect(() => {
    if (isEditingVote && userVoteData?.suggestions && Array.isArray(userVoteData.suggestions)) {
      // In edit mode, show ALL existing suggestions (user's + others') as toggle buttons
      setFilteredExistingSuggestions(existingSuggestions);

      // Pre-select the user's existing suggestions
      setSuggestionChoices([...userVoteData.suggestions]);

      // Start with one empty text field for adding new suggestions
      setNewSuggestions(['']);
    } else {
      // Not in edit mode, show all existing suggestions as secondable buttons
      setFilteredExistingSuggestions(existingSuggestions);
    }
  }, [isEditingVote, userVoteData, existingSuggestions, setSuggestionChoices]);

  // Add existing suggestion to choices
  const addExistingSuggestion = (suggestion: string) => {
    if (!suggestionChoices.includes(suggestion)) {
      setSuggestionChoices([...suggestionChoices, suggestion]);
    }
  };

  // Remove suggestion from choices
  const removeSuggestion = (suggestion: string) => {
    setSuggestionChoices(suggestionChoices.filter(n => n !== suggestion));
  };

  // Update suggestion choices when new suggestions change
  useEffect(() => {
    const filledSuggestions = newSuggestions.filter(n => n.trim() !== '');
    // Filter out duplicates
    const uniqueNewSugs = filledSuggestions.filter((sug, index, self) =>
      self.indexOf(sug) === index
    );

    // Update choices with new suggestions
    setSuggestionChoices((prevChoices: string[]) => {
      if (isEditingVote) {
        // In edit mode: Combine manually selected existing buttons + new suggestions from text fields
        // Get manually selected existing suggestions (anything from the existing list)
        const manuallySelectedExisting = prevChoices.filter(n =>
          existingSuggestions.includes(n) && !uniqueNewSugs.includes(n)
        );

        // Combine selected existing + new suggestions from text fields
        return [...manuallySelectedExisting, ...uniqueNewSugs];
      } else {
        // Normal mode - don't include suggestions that are already in existingSuggestions
        const newSugsNotInExisting = uniqueNewSugs.filter(sug => !existingSuggestions.includes(sug));
        // Keep existing selections + new suggestions
        const selectedExisting = prevChoices.filter(n => existingSuggestions.includes(n));
        const newChoices = [...selectedExisting, ...newSugsNotInExisting];
        return newChoices;
      }
    });
  }, [newSuggestions, existingSuggestions, setSuggestionChoices, isEditingVote]);

  // Clear abstain flag when user adds suggestions while editing
  useEffect(() => {
    if (isEditingVote && isAbstaining && suggestionChoices.length > 0) {
      handleAbstain(); // This will toggle isAbstaining to false
    }
  }, [suggestionChoices, isEditingVote, isAbstaining, handleAbstain]);

  // Poll is closed
  if (isPollClosed) {
    return (
      <div className="text-center py-3">
        {loadingResults ? (
          <div className="flex justify-center">
            <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : pollResults ? (
          <>
            {userVoteData?.is_abstain && (
              <div className="mt-4 flex justify-center">
                <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                  <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    You Abstained
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
          </div>
        )}
      </div>
    );
  }

  if (hasVoted && !isEditingVote) {
    return (
      <div className="text-center py-3">
        <div className="text-left">
          {isLoadingVoteData ? (
            <div className="space-y-2">
              {[1, 2, 3].map((num) => (
                <div key={num} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded animate-pulse">
                  <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
                  <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : existingSuggestions.length > 0 ? (
            <SuggestionsList
              suggestions={getSuggestionsWithCounts()}
              userSuggestions={userVoteData?.is_abstain ? [] : (userVoteData?.suggestions || [])}
              showVoteCounts={pollResults?.options && Array.isArray(pollResults.options)}
              showUserIndicator={true}
              showEditButton={!isPollClosed}
              onEditClick={() => setIsEditingVote(true)}
              isEditDisabled={isLoadingVoteData}
              optionsMetadata={optionsMetadata}
            />
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-gray-600 dark:text-gray-400">No suggestions available</p>
              {!isPollClosed && (
                <button
                  onClick={() => setIsEditingVote(true)}
                  disabled={isLoadingVoteData}
                  className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 active:bg-yellow-600 active:scale-95 text-yellow-900 font-medium text-sm rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>

        {/* Suggestion respondents */}
        {!isPollClosed && !isLoadingVoteData && (
          <div className="mt-5">
            <VoterList pollId={poll.id} refreshTrigger={0} label="Suggested" filter={hasSuggestions} />
          </div>
        )}

        {/* Cutoff suggestions button - shown to creator after suggestions exist */}
        {showCutoffButton && onCutoffClick && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={onCutoffClick}
              disabled={isCuttingOff}
              className="inline-flex items-center px-4 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 active:scale-95 disabled:bg-amber-300 text-white text-sm font-medium rounded-lg transition-all disabled:cursor-not-allowed"
            >
              {isCuttingOff ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Cutting off...
                </>
              ) : (
                'Cutoff Suggestions Now'
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
        {/* Existing suggestions - all can be toggled in edit mode */}
        {filteredExistingSuggestions.length > 0 && (
          <div className="mb-3">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {isEditingVote ? 'All suggestions (select to second/unsecond):' : 'Existing suggestions (select to second):'}
            </h5>
            <div className="space-y-2">
              {filteredExistingSuggestions.map((suggestion, index) => {
                const isSelected = suggestionChoices.includes(suggestion);
                return (
                  <div
                    key={index}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                      isSelected
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100 font-medium border border-green-300 dark:border-green-700'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <OptionLabel text={suggestion} metadata={optionsMetadata?.[suggestion]} />
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isSubmitting}
                      onChange={() => {
                        if (isSelected) {
                          removeSuggestion(suggestion);
                        } else {
                          addExistingSuggestion(suggestion);
                        }
                      }}
                      className="w-5 h-5 flex-shrink-0 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Add new suggestions using shared component */}
        <div className={filteredExistingSuggestions.length > 0 ? "mt-3 pt-3 border-t border-gray-200 dark:border-gray-600" : ""}>
          {isLocationLikeCategory(poll.category || '') && poll.reference_latitude && (
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Search within</span>
              <select
                value={searchRadius}
                onChange={(e) => setSearchRadius(Number(e.target.value))}
                className="px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800"
              >
                {[5, 10, 25, 50, 100, 250].map((r) => (
                  <option key={r} value={r}>{r} mi</option>
                ))}
              </select>
            </div>
          )}
          <OptionsInput
            options={newSuggestions}
            setOptions={setNewSuggestions}
            isLoading={isSubmitting}
            label={isEditingVote ? "Add new suggestions:" : "Add new suggestions:"}
            category={poll.category || 'custom'}
            optionsMetadata={suggestionMetadata}
            onMetadataChange={onSuggestionMetadataChange}
            referenceLatitude={poll.reference_latitude}
            referenceLongitude={poll.reference_longitude}
            searchRadius={searchRadius}
          />
        </div>


        {voteError && (
          <div className="mt-3 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
            {voteError}
          </div>
        )}
      </div>

      {/* Voter Name Input */}
      <div className="mb-3">
        <CompactNameField name={voterName} setName={setVoterName} disabled={isSubmitting} />
      </div>

      {/* Submit Button */}
      <PollSubmitButton
        onClick={handleVoteClick}
        disabled={isSubmitting}
        className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100 ${
          suggestionChoices.length === 0 && !isSubmitting
            ? 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 active:bg-yellow-300 dark:active:bg-yellow-700 text-yellow-800 dark:text-yellow-200 border-2 border-yellow-300 dark:border-yellow-700'
            : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-400 text-white'
        }`}
      >
        {isSubmitting
          ? 'Submitting...'
          : suggestionChoices.length === 0
            ? 'Submit (Abstain)'
            : 'Submit Vote'
        }
      </PollSubmitButton>

      {/* Show follow-up/fork header after submit button */}
      <div className="mt-4">
        {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
        {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
      </div>
    </>
  );
}
"use client";

import { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import OptionsInput, { type OptionsMetadata } from "@/components/OptionsInput";
import { loadQuestionDraft, saveQuestionDraft } from "@/lib/ballotDraft";
import SuggestionsList from "@/components/SuggestionsList";
import OptionLabel from "@/components/OptionLabel";

interface SuggestionVotingInterfaceProps {
  question: any;
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
  isQuestionClosed: boolean;
  isCreator: boolean;
  hasVoted: boolean;
  isEditingVote: boolean;
  setIsEditingVote: (editing: boolean) => void;
  userVoteData: any;
  isLoadingVoteData: boolean;
  questionResults: any;
  loadingResults: boolean;
  loadExistingSuggestions: () => void;
  suggestionMetadata?: OptionsMetadata;
  onSuggestionMetadataChange?: (metadata: OptionsMetadata) => void;
  optionsMetadata?: OptionsMetadata | null;
  searchRadius?: number;
  // Phase 3.4 follow-up B: when the parent poll wrapper renders the
  // Submit button + voter name input externally, suppress the per-question
  // Submit/voter-name UI here.
  wrapperHandlesSubmit?: boolean;
}

export default function SuggestionVotingInterface({
  question,
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
  isQuestionClosed,
  isCreator,
  hasVoted,
  isEditingVote,
  setIsEditingVote,
  userVoteData,
  isLoadingVoteData,
  questionResults,
  loadingResults,
  loadExistingSuggestions,
  suggestionMetadata,
  onSuggestionMetadataChange,
  optionsMetadata,
  searchRadius = 25,
  wrapperHandlesSubmit = false,
}: SuggestionVotingInterfaceProps) {
  const [newSuggestions, setNewSuggestions] = useState<string[]>([""]);
  const [filteredExistingSuggestions, setFilteredExistingSuggestions] = useState<string[]>([]);

  // Helper function to convert existingSuggestions to format expected by SuggestionsList
  const getSuggestionsWithCounts = () => {
    if (questionResults?.suggestion_counts && questionResults.suggestion_counts.length > 0) {
      // Use server-side suggestion counts when available
      return questionResults.suggestion_counts;
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

  // Persist typed-but-unsubmitted suggestions per poll so a half-typed list
  // survives a refresh or navigating away. Only for a fresh voter (the entry
  // form is shown and nothing on the server/edit path clobbers it): once
  // submitted, committed suggestions live on the server and entering edit mode
  // resets newSuggestions from there (the isEditingVote effect above). The
  // draft slot is cleared on submit by the parent's clearQuestionDraft.
  const pollId: string | null = question?.poll_id ?? null;
  const questionId: string | null = question?.id ?? null;
  const suggestionDraftRestoredRef = useRef(false);
  useEffect(() => {
    if (suggestionDraftRestoredRef.current) return;
    suggestionDraftRestoredRef.current = true;
    if (hasVoted || !questionId) return;
    const draft = loadQuestionDraft(pollId, questionId);
    if (!draft) return;
    if (draft.suggestionTexts && draft.suggestionTexts.length > 0) {
      setNewSuggestions(draft.suggestionTexts);
    }
    if (draft.suggestionMetadata && onSuggestionMetadataChange) {
      onSuggestionMetadataChange(draft.suggestionMetadata);
    }
  }, [hasVoted, pollId, questionId, onSuggestionMetadataChange]);

  // Save edits after the initial mount/restore so we don't immediately rewrite
  // the draft; debounced so each keystroke during typing doesn't thrash storage.
  const suggestionSaveMountRef = useRef(true);
  const suggestionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hasVoted || !questionId) return;
    if (suggestionSaveMountRef.current) {
      suggestionSaveMountRef.current = false;
      return;
    }
    if (suggestionSaveTimerRef.current) clearTimeout(suggestionSaveTimerRef.current);
    suggestionSaveTimerRef.current = setTimeout(() => {
      saveQuestionDraft(pollId, questionId, {
        suggestionTexts: newSuggestions,
        suggestionMetadata,
      });
    }, 300);
    return () => {
      if (suggestionSaveTimerRef.current) clearTimeout(suggestionSaveTimerRef.current);
    };
  }, [newSuggestions, suggestionMetadata, hasVoted, pollId, questionId]);

  // Question is closed
  if (isQuestionClosed) {
    return (
      <div className="text-center py-3">
        {loadingResults ? (
          <div className="flex justify-center">
            <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : questionResults ? (
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
      <div className="text-center pb-3">
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
              showVoteCounts={questionResults?.options && Array.isArray(questionResults.options)}
              showUserIndicator={true}
              showEditButton={!isQuestionClosed}
              onEditClick={() => setIsEditingVote(true)}
              isEditDisabled={isLoadingVoteData}
              optionsMetadata={optionsMetadata}
            />
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-gray-600 dark:text-gray-400">No suggestions available</p>
              {!isQuestionClosed && (
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

      </div>
    );
  }

  return (
    <>
      <div className="mb-2">
        {/* Empty-brainstorm cold start: a suggestion poll with zero ideas is a
            dead-end until someone breaks the ice. Nudge the first contributor
            (the input is right below). */}
        {!isQuestionClosed && existingSuggestions.length === 0 && (
          <p className="mb-3 text-sm text-blue-600 dark:text-blue-400 text-center">
            No suggestions yet. Add the first idea below!
          </p>
        )}

        {/* Existing suggestions - all can be toggled in edit mode */}
        {filteredExistingSuggestions.length > 0 && (
          <div className="mb-3">
            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {isEditingVote ? 'All suggestions:' : 'Existing suggestions:'}
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
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      disabled={isSubmitting}
                      onClick={() => {
                        if (isSelected) {
                          removeSuggestion(suggestion);
                        } else {
                          addExistingSuggestion(suggestion);
                        }
                      }}
                      aria-label={isSelected ? `Remove ${suggestion}` : `Add ${suggestion}`}
                      className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors disabled:opacity-50 ${
                        isSelected
                          ? 'bg-green-600 border-green-600 dark:bg-green-500 dark:border-green-500'
                          : 'border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900'
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="w-4 h-4 text-white"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3}
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Mirrors the options card on the create-poll form. Card shade
            is bg-gray-50 (not bg-white as in create-poll) because the
            ballot context sits on the page bg, not a sheet backdrop —
            see CLAUDE.md's "Always-Visible Name Field" section. */}
        <div className={filteredExistingSuggestions.length > 0 ? "mt-3" : ""}>
          <h5 className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
            Suggestions
          </h5>
          <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
            <OptionsInput
              options={newSuggestions}
              setOptions={setNewSuggestions}
              isLoading={isSubmitting}
              category={question.category || 'custom'}
              optionsMetadata={suggestionMetadata}
              onMetadataChange={onSuggestionMetadataChange}
              referenceLatitude={question.reference_latitude}
              referenceLongitude={question.reference_longitude}
              searchRadius={searchRadius}
              variant="compact"
              hideReferenceLocationWarning
            />
          </section>
        </div>

        {voteError && (
          <div className="mt-3 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
            {voteError}
          </div>
        )}
      </div>

      {!wrapperHandlesSubmit && (
        <>
          {/* Submit Button */}
          <button
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
          </button>
        </>
      )}
    </>
  );
}
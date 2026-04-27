"use client";

import Countdown from "@/components/Countdown";
import RankableOptions from "@/components/RankableOptions";
import AbstainButton from "@/components/AbstainButton";
import CompactNameField from "@/components/CompactNameField";
import OptionLabel from "@/components/OptionLabel";
import ReadOnlyTierCards from "@/components/ReadOnlyTierCards";
import VoterList from "@/components/VoterList";
import type { OptionsMetadata } from "@/lib/types";
import type { ApiVote } from "@/lib/api";

interface RankingSectionProps {
  question: any;
  // Phase 5b: wrapper-level fields (response_deadline, prephase_deadline /
  // legacy suggestion_deadline) come in as separate props since they live on
  // the parent poll, not the question. QuestionBallot sources them from its
  // `poll` prop and forwards them here.
  suggestionDeadline?: string | null;
  responseDeadline?: string | null;
  questionId: string;
  questionOptions: string[];
  rankedChoices: string[];
  handleRankingChange: (choices: string[], tiers: string[][]) => void;
  isAbstaining: boolean;
  setIsAbstaining: (val: boolean) => void;
  handleAbstain: () => void;
  isSubmitting: boolean;
  isQuestionClosed: boolean;
  hasVoted: boolean;
  isEditingRanking: boolean;
  setIsEditingRanking: (val: boolean) => void;
  userVoteData: any;
  isLoadingVoteData: boolean;
  voterName: string;
  setVoterName: (name: string) => void;
  handleVoteClick: () => void;
  voteError: string | null;
  optionsMetadata: OptionsMetadata | null;
  canSubmitSuggestions: boolean;
  canSubmitRankings: boolean;
  hasSuggestionPhase: boolean;
  suggestionChoices: string[];
  justCancelledAbstain: boolean;
  twoOptionDisplayOrder: string[];
  isEditingSuggestions: boolean;
  newOptions?: string[];
  // Phase 3.4 follow-up B: when the parent poll wrapper renders the
  // Submit button + voter name input externally, suppress the per-question
  // Submit/voter-name UI here. The wrapper calls QuestionBallot's
  // imperative `submit()` ref method, which routes through the same
  // submitVote flow this Submit button used to trigger.
  wrapperHandlesSubmit?: boolean;
}

const rankingsVoterFilter = (v: ApiVote) => !!(v.ranked_choices && v.ranked_choices.length > 0);

export default function RankingSection({
  question,
  suggestionDeadline,
  responseDeadline,
  questionId,
  questionOptions,
  rankedChoices,
  handleRankingChange,
  isAbstaining,
  setIsAbstaining,
  handleAbstain,
  isSubmitting,
  isQuestionClosed,
  hasVoted,
  isEditingRanking,
  setIsEditingRanking,
  userVoteData,
  isLoadingVoteData,
  voterName,
  setVoterName,
  handleVoteClick,
  voteError,
  optionsMetadata,
  canSubmitSuggestions,
  canSubmitRankings,
  hasSuggestionPhase,
  suggestionChoices,
  justCancelledAbstain,
  twoOptionDisplayOrder,
  isEditingSuggestions,
  newOptions,
  wrapperHandlesSubmit = false,
}: RankingSectionProps) {
  const hasSubmittedRankings = hasVoted && userVoteData?.ranked_choices?.length > 0;
  // For suggestion questions, is_abstain means "abstained from suggestions" not "abstained from ranking".
  // Only is_ranking_abstain explicitly means ranking abstain.
  // For non-suggestion questions, is_abstain means full abstain (including ranking).
  const abstainedNoRanking = hasVoted && !userVoteData?.ranked_choices?.length && (
    userVoteData?.is_ranking_abstain || (userVoteData?.is_abstain && !hasSuggestionPhase) || isAbstaining
  );

  // During suggestion phase: show summary when user has voted and isn't editing rankings
  const showSummary = canSubmitSuggestions && hasVoted && !isEditingRanking && (hasSubmittedRankings || abstainedNoRanking);
  const showBallot = !showSummary;

  const editButton = !isQuestionClosed && !isLoadingVoteData ? (
    <button
      onClick={() => {
        // Restore abstain state if user previously abstained from ranking
        if (abstainedNoRanking && !hasSubmittedRankings) {
          setIsAbstaining(true);
        }
        setIsEditingRanking(true);
      }}
      className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors flex-shrink-0"
    >
      Edit
    </button>
  ) : null;

  if (!canSubmitRankings || questionOptions.length === 0) {
    if (canSubmitSuggestions && hasVoted && !isEditingSuggestions) {
      return (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-center">
          <div className="text-blue-800 dark:text-blue-200 text-sm">
            {suggestionDeadline ? (
              <>Ranking will open after suggestions cutoff in{' '}<Countdown deadline={suggestionDeadline} /></>
            ) : (
              <>Ranking will open after suggestions cutoff</>
            )}
          </div>
        </div>
      );
    }
    if (hasSuggestionPhase && !canSubmitSuggestions && questionOptions.length === 0) {
      return (
        <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-center">
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            No suggestions were submitted. There are no options to rank.
          </p>
        </div>
      );
    }
    return null;
  }

  // During suggestion phase, only show after user has submitted suggestions
  if (canSubmitSuggestions && !hasVoted) return null;

  const hasNewOptions = !!(newOptions && newOptions.length > 0);

  return (
    <>
      {canSubmitSuggestions && !isEditingRanking && (
        <>
          <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-white mt-4 mb-1">Early Voting</h3>
          <Countdown deadline={responseDeadline ?? null} label="Preferences closing" />
          <p className="text-center text-xs text-amber-700 dark:text-amber-300 mb-3">
            Options may change until suggestions cutoff!
          </p>
        </>
      )}

      {hasNewOptions && (
        <div className="mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="text-sm text-amber-800 dark:text-amber-200 font-medium">
            New option{newOptions && newOptions.length > 1 ? 's' : ''} available since you last ranked
          </span>
        </div>
      )}

      <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
        {showSummary && hasSubmittedRankings && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-base font-medium text-gray-900 dark:text-white">Your ranking:</h4>
              {editButton}
            </div>
            <div className="space-y-2">
              <ReadOnlyTierCards
                tiers={userVoteData.ranked_choice_tiers?.length > 0 ? userVoteData.ranked_choice_tiers : userVoteData.ranked_choices.map((c: string) => [c])}
                optionsMetadata={optionsMetadata}
              />
            </div>
          </>
        )}

        {showSummary && abstainedNoRanking && !hasSubmittedRankings && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-medium text-gray-900 dark:text-white">Ranking:</h4>
              <span className="inline-flex items-center px-3 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-sm font-medium">
                Abstained
              </span>
            </div>
            {editButton}
          </div>
        )}

        {showBallot && (
          <>
            {questionOptions.length === 2 && !canSubmitSuggestions ? (
              <>
                <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                  Select your preference
                </h4>
                <div className={`flex gap-2 transition-opacity ${isAbstaining ? 'opacity-40 pointer-events-none' : ''}`}>
                  {twoOptionDisplayOrder.map((option: string) => (
                    <button
                      key={option}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest?.('[data-place-name]')) return;
                        // Two-option questions: a single tap picks one. Pass
                        // the flat list and a singleton tier (no ties).
                        handleRankingChange([option], [[option]]);
                        setIsAbstaining(false);
                      }}
                      disabled={isSubmitting || isAbstaining}
                      className={`flex-1 min-w-0 py-3 px-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        rankedChoices[0] === option
                          ? 'bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 border-2 border-blue-400 dark:border-blue-600 active:bg-blue-300 dark:active:bg-blue-700'
                          : 'bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-800 dark:text-blue-200 border-2 border-transparent active:bg-blue-300 dark:active:bg-blue-700'
                      }`}
                    >
                      <OptionLabel text={option} metadata={optionsMetadata?.[option]} layout="stacked" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h4 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                  Reorder from most to least preferred
                </h4>
                {questionOptions.length > 0 && (
                  <RankableOptions
                    key={isEditingRanking ? 'editing' : 'new'}
                    options={questionOptions}
                    onRankingChange={handleRankingChange}
                    disabled={isSubmitting || isAbstaining}
                    storageKey={questionId ? `question-ranking-${questionId}` : undefined}
                    initialRanking={isEditingRanking && userVoteData?.ranked_choices ? userVoteData.ranked_choices : undefined}
                    initialTiers={isEditingRanking && userVoteData?.ranked_choice_tiers ? userVoteData.ranked_choice_tiers : undefined}
                    optionsMetadata={optionsMetadata}
                    newOptions={newOptions}
                  />
                )}
              </>
            )}

            <AbstainButton
              isAbstaining={isAbstaining}
              onClick={handleAbstain}
            />

            {voteError && (
              <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                {voteError}
              </div>
            )}
          </>
        )}
      </div>

      {hasSuggestionPhase && hasVoted && !isEditingRanking && !isLoadingVoteData && (
        <div className="mt-2 mb-3">
          <VoterList questionId={question.id} label="Ranked" filter={rankingsVoterFilter} />
        </div>
      )}

      {showBallot && !wrapperHandlesSubmit && (
        <>
          <div className="mt-4">
            <CompactNameField name={voterName} setName={setVoterName} />
          </div>
          <button
            onClick={handleVoteClick}
            disabled={isSubmitting || (!isAbstaining && !justCancelledAbstain && rankedChoices.filter(choice => choice && choice.trim().length > 0).length === 0 && suggestionChoices.filter(c => c && c.trim().length > 0).length === 0)}
            className="w-full mt-4 py-3 px-4 rounded-lg bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] active:bg-[#2a2a2a] dark:active:bg-[#e0e0e0] font-medium text-base transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Vote'}
          </button>
        </>
      )}
    </>
  );
}

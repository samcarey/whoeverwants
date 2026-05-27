"use client";

import type { ReactNode } from "react";
import Countdown from "@/components/Countdown";
import RankableOptions from "@/components/RankableOptions";
import ReadOnlyTierCards from "@/components/ReadOnlyTierCards";
import BinaryRankedChoiceBallot from "@/components/QuestionBallot/BinaryRankedChoiceBallot";
import NewOptionsBanner from "@/components/NewOptionsBanner";
import type { OptionsMetadata, QuestionResults } from "@/lib/types";

interface RankingSectionProps {
  question: any;
  // Phase 5b: wrapper-level fields (response_deadline) come in as separate
  // props since they live on the parent poll, not the question. QuestionBallot
  // sources them from its `poll` prop and forwards them here.
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
  // Live results — the 2-option branch reads first-round counts + winner
  // to color the winner card and show the % + count row below the cards.
  questionResults?: QuestionResults | null;
  // Tap-to-submit handler for the binary 2-option card pair. When provided,
  // overrides the inline onChoose so a single tap stages + auto-submits
  // (matches yes/no tap UX). Called only on the BinaryRankedChoiceBallot
  // path; the multi-option drag-to-rank list keeps the explicit Submit flow.
  onBinaryRankedChoiceTap?: (option: string) => void;
  // Early-voting split: when set, the ranking ballot body is wrapped in this
  // card chrome while the "Early Voting" header/countdown/warning is rendered
  // outside (above) the card. Undefined keeps the legacy single-card layout
  // where the caller owns the card.
  cardClass?: string;
}

export default function RankingSection({
  question,
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
  questionResults,
  onBinaryRankedChoiceTap,
  cardClass,
}: RankingSectionProps) {
  // Wrap visible ballot content in card chrome when the early-voting split is
  // active; pass through unchanged otherwise. Returning null still produces no
  // card, so an empty ballot never leaves a stray empty box.
  const card = (content: ReactNode) =>
    cardClass ? <div className={cardClass}>{content}</div> : <>{content}</>;
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

  const enterRankingEdit = () => {
    // Restore abstain state if user previously abstained from ranking
    if (abstainedNoRanking && !hasSubmittedRankings) {
      setIsAbstaining(true);
    }
    setIsEditingRanking(true);
  };

  const editButton = !isQuestionClosed && !isLoadingVoteData ? (
    <button
      onClick={enterRankingEdit}
      className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors flex-shrink-0"
    >
      Edit
    </button>
  ) : null;

  if (!canSubmitRankings || questionOptions.length === 0) {
    if (canSubmitSuggestions && hasVoted && !isEditingSuggestions) {
      return card(
        <div className="text-center text-sm text-gray-600 dark:text-gray-400">
          Voting will open when suggestions close
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

  return (
    <>
      {/* "Early Voting" header/countdown/warning stays OUTSIDE the ballot
          card (the "extra stuff") in split mode. */}
      {canSubmitSuggestions && !isEditingRanking && (
        <>
          <div className="flex items-baseline justify-between gap-2 mt-[27.2px] mb-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Early Voting</h3>
            <Countdown deadline={responseDeadline ?? null} label="Closes" inline />
          </div>
          <p className="text-center text-xs text-amber-700 dark:text-amber-300 mb-3">
            Options may change until suggestions cutoff!
          </p>
        </>
      )}

      {/* Informational note ABOVE the ranking card (not inside it). Editing is
          reached via the "Edit" button in the card's summary. mt-3 gives space
          above it in edit mode (where the Early Voting header is hidden) and
          collapses with the warning's mb-3 in the summary view. */}
      <NewOptionsBanner count={newOptions?.length ?? 0} className="mt-3 mb-2" />

      {card(
      <>

      <div className="mb-2">
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
              <BinaryRankedChoiceBallot
                displayOrder={twoOptionDisplayOrder}
                currentChoice={isAbstaining ? "abstain" : rankedChoices[0] ?? null}
                results={questionResults}
                onChoose={(option) => {
                  if (onBinaryRankedChoiceTap) {
                    onBinaryRankedChoiceTap(option);
                  } else {
                    handleRankingChange([option], [[option]]);
                    setIsAbstaining(false);
                  }
                }}
                onAbstain={handleAbstain}
                disabled={isSubmitting}
                optionsMetadata={optionsMetadata}
              />
            ) : (
              <>
                <h4 className="text-[12.8px] font-medium text-center text-gray-900 dark:text-white mb-3">
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
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={handleAbstain}
                    disabled={isSubmitting}
                    className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70 disabled:opacity-50"
                  >
                    {isAbstaining ? 'Abstaining' : 'Abstain'}
                  </button>
                </div>
              </>
            )}

            {voteError && (
              <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                {voteError}
              </div>
            )}
          </>
        )}
      </div>

      {showBallot && !wrapperHandlesSubmit && (
        <>
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
      )}
    </>
  );
}

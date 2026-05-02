"use client";

import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { Question, QuestionResults } from "@/lib/types";
import AbstainButton from "@/components/AbstainButton";
import CompactNameField from "@/components/CompactNameField";
import TimeQuestionFields from "@/components/TimeQuestionFields";
import TimeSlotBubbles from "@/components/TimeSlotBubbles";
import { formatTimeSlot } from "@/lib/timeUtils";

export interface TimeBallotSectionProps {
  question: Question;
  isQuestionClosed: boolean;
  loadingResults: boolean;
  questionResults: QuestionResults | null;
  userVoteData: any;
  isLoadingVoteData: boolean;
  hasVoted: boolean;
  isEditingVote: boolean;
  editVoteButton: ReactNode;
  inAvailabilityPhase: boolean;
  isSubmitting: boolean;
  voteError: string | null;
  isAbstaining: boolean;
  handleAbstain: () => void;
  durationMinValue: number | null;
  durationMaxValue: number | null;
  durationMinEnabled: boolean;
  durationMaxEnabled: boolean;
  setDurationMinValue: (n: number | null) => void;
  setDurationMaxValue: (n: number | null) => void;
  setDurationMinEnabled: (b: boolean) => void;
  setDurationMaxEnabled: (b: boolean) => void;
  voterDayTimeWindows: any[];
  setVoterDayTimeWindows: (v: any[]) => void;
  preferenceSlotsForVoter: string[];
  likedSlots: string[] | null;
  setLikedSlots: Dispatch<SetStateAction<string[] | null>>;
  dislikedSlots: string[] | null;
  setDislikedSlots: Dispatch<SetStateAction<string[] | null>>;
  voterName: string;
  setVoterName: (n: string) => void;
  wrapperHandlesSubmit: boolean;
  handleVoteClick: () => void;
}

/**
 * Time-question ballot UI: closed-results badge / "Your availability/preferences"
 * summary / availability-phase form / preferences-phase form. Extracted from
 * QuestionBallot.tsx so the parent component stays focused on cross-type ballot
 * orchestration.
 */
export default function TimeBallotSection({
  question,
  isQuestionClosed,
  loadingResults,
  questionResults,
  userVoteData,
  isLoadingVoteData,
  hasVoted,
  isEditingVote,
  editVoteButton,
  inAvailabilityPhase,
  isSubmitting,
  voteError,
  isAbstaining,
  handleAbstain,
  durationMinValue,
  durationMaxValue,
  durationMinEnabled,
  durationMaxEnabled,
  setDurationMinValue,
  setDurationMaxValue,
  setDurationMinEnabled,
  setDurationMaxEnabled,
  voterDayTimeWindows,
  setVoterDayTimeWindows,
  preferenceSlotsForVoter,
  likedSlots,
  setLikedSlots,
  dislikedSlots,
  setDislikedSlots,
  voterName,
  setVoterName,
  wrapperHandlesSubmit,
  handleVoteClick,
}: TimeBallotSectionProps) {
  if (isQuestionClosed) {
    return (
      <div>
        <div className="py-6">
          {loadingResults ? (
            <div className="flex justify-center items-center py-8">
              <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : questionResults ? (
            <>
              {userVoteData?.is_abstain && (
                <div className="mt-4 flex justify-center">
                  <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                    <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">You Abstained</span>
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
      </div>
    );
  }

  if (hasVoted && !isEditingVote) {
    return (
      <div>
        <div className="py-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">{inAvailabilityPhase ? 'Your availability:' : 'Your preferences:'}</h4>
            {editVoteButton}
          </div>
          {isLoadingVoteData ? (
            <div className="flex items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <svg className="animate-spin h-4 w-4 text-gray-600 dark:text-gray-400 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="font-medium text-gray-600 dark:text-gray-400">Loading your response...</span>
            </div>
          ) : userVoteData?.is_abstain ? (
            <div className="flex items-center p-3 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg">
              <span className="font-medium text-yellow-800 dark:text-yellow-200">Abstained</span>
            </div>
          ) : inAvailabilityPhase && userVoteData?.voter_day_time_windows ? (
            <div className="p-3 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg">
              <p className="text-sm text-green-800 dark:text-green-200">Availability submitted for {userVoteData.voter_day_time_windows.length} day(s).</p>
            </div>
          ) : !inAvailabilityPhase && (userVoteData?.liked_slots !== null || userVoteData?.disliked_slots !== null) ? (
            <div className="p-3 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg text-sm text-green-800 dark:text-green-200">
              {(userVoteData?.liked_slots?.length ?? 0) > 0 && (
                <p>Liked: {userVoteData!.liked_slots!.map(formatTimeSlot).join(', ')}</p>
              )}
              {(userVoteData?.disliked_slots?.length ?? 0) > 0 && (
                <p>Disliked: {userVoteData!.disliked_slots!.map(formatTimeSlot).join(', ')}</p>
              )}
              {(userVoteData?.liked_slots?.length ?? 0) === 0 && (userVoteData?.disliked_slots?.length ?? 0) === 0 && (
                <p>Preferences submitted (all neutral).</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {inAvailabilityPhase ? (
          <>
            {/* Availability phase: show time window picker */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-3 text-center">Your Availability</h3>
              <TimeQuestionFields
                disabled={isSubmitting}
                durationMinValue={durationMinValue}
                durationMaxValue={durationMaxValue}
                durationMinEnabled={durationMinEnabled}
                durationMaxEnabled={durationMaxEnabled}
                onDurationMinChange={setDurationMinValue}
                onDurationMaxChange={setDurationMaxValue}
                onDurationMinEnabledChange={setDurationMinEnabled}
                onDurationMaxEnabledChange={setDurationMaxEnabled}
                dayTimeWindows={voterDayTimeWindows}
                onDayTimeWindowsChange={setVoterDayTimeWindows}
                questionDayTimeWindows={question.day_time_windows || undefined}
                questionDurationWindow={question.duration_window || undefined}
              />
            </div>

            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400 text-center">
              Select time slots to fine-tune
            </p>
            <div className="mb-6">
              <AbstainButton isAbstaining={isAbstaining} onClick={handleAbstain} />
            </div>

            {voteError && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
              </div>
            )}

            {!wrapperHandlesSubmit && (
              <>
                <div className="mb-4 empty:hidden">
                  <CompactNameField name={voterName} setName={setVoterName} disabled={isSubmitting} maxLength={30} />
                </div>

                <button
                  type="button"
                  onClick={handleVoteClick}
                  disabled={isSubmitting || (!isAbstaining && voterDayTimeWindows.filter(d => d.windows.length > 0).length === 0)}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Availability'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Preferences phase: tap bubbles to like/dislike time slots */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-3 text-center">Mark Your Preferences</h3>
              <TimeSlotBubbles
                options={preferenceSlotsForVoter}
                likedSlots={likedSlots ?? []}
                dislikedSlots={dislikedSlots ?? []}
                onToggle={(slot, nextState) => {
                  setLikedSlots(prev => {
                    const s = new Set(prev ?? []);
                    if (nextState === 'liked') s.add(slot); else s.delete(slot);
                    return Array.from(s);
                  });
                  setDislikedSlots(prev => {
                    const s = new Set(prev ?? []);
                    if (nextState === 'disliked') s.add(slot); else s.delete(slot);
                    return Array.from(s);
                  });
                }}
                availabilityCounts={questionResults?.availability_counts}
                maxAvailability={questionResults?.max_availability}
                disabled={isSubmitting}
              />
            </div>

            <div className="mb-6">
              <AbstainButton isAbstaining={isAbstaining} onClick={handleAbstain} />
            </div>

            {voteError && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
              </div>
            )}

            {!wrapperHandlesSubmit && (
              <>
                <div className="mb-4 empty:hidden">
                  <CompactNameField name={voterName} setName={setVoterName} disabled={isSubmitting} maxLength={30} />
                </div>

                <button
                  type="button"
                  onClick={handleVoteClick}
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Preferences'}
                </button>
              </>
            )}
          </>
        )}
    </div>
  );
}

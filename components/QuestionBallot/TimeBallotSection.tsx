"use client";

import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { Question, QuestionResults, DayTimeWindow } from "@/lib/types";
import AbstainButton from "@/components/AbstainButton";
import TimeQuestionFields from "@/components/TimeQuestionFields";
import TimeSlotBubbles from "@/components/TimeSlotBubbles";
import { formatTimeSlot, hasInvalidVoterWindows } from "@/lib/timeUtils";

export interface TimeBallotSectionProps {
  question: Question;
  isQuestionClosed: boolean;
  questionResults: QuestionResults | null;
  userVoteData: any;
  isLoadingVoteData: boolean;
  hasVoted: boolean;
  isEditingVote: boolean;
  editVoteButton: ReactNode;
  // Wrapper-level: the question's slots haven't been finalized yet (pre-cutoff).
  // Drives the "Your availability" / "Your preferences" header label only.
  inAvailabilityPhase: boolean;
  // Active-form gate: true while this voter is filling in availability inputs.
  // False once the voter has submitted availability AND tentative slots are
  // available under pre-ranking — at that point the bubble UI takes over so the
  // voter can react to currently-viable slots before the cutoff.
  isAvailabilitySubmission: boolean;
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
  voterDayTimeWindows: DayTimeWindow[];
  setVoterDayTimeWindows: (v: DayTimeWindow[]) => void;
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
  questionResults,
  userVoteData,
  isLoadingVoteData,
  hasVoted,
  isEditingVote,
  editVoteButton,
  inAvailabilityPhase,
  isAvailabilitySubmission,
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
  // Loading + results + "unable to load" are rendered by the parent's
  // closed-state block (QuestionBallot.tsx). The only thing left for
  // TimeBallotSection to add when closed is the "You Abstained" badge.
  if (isQuestionClosed) {
    if (!questionResults || !userVoteData?.is_abstain) return null;
    return (
      <div className="mt-4 flex justify-center">
        <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">You Abstained</span>
        </div>
      </div>
    );
  }

  // In the preferences phase (or pre-ranking tentative-slots sub-phase), a voter
  // who already submitted availability but hasn't reacted yet has hasVoted=true
  // with both liked/disliked still null. The post-submit summary has nothing to
  // render in that case, so skip it and fall through to the active preferences form.
  const hasNotReactedYet = !isAvailabilitySubmission && hasVoted
    && userVoteData?.liked_slots === null
    && userVoteData?.disliked_slots === null
    && !userVoteData?.is_abstain;

  if (hasVoted && !isEditingVote && !hasNotReactedYet) {
    return (
      <div>
        <div className="py-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">{isAvailabilitySubmission ? 'Your availability:' : 'Your preferences:'}</h4>
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
          ) : isAvailabilitySubmission && userVoteData?.voter_day_time_windows ? (
            <TimeQuestionFields
              disabled={true}
              dayTimeWindows={userVoteData.voter_day_time_windows}
              onDayTimeWindowsChange={() => {}}
              questionDayTimeWindows={question.day_time_windows || undefined}
              questionDurationWindow={question.duration_window || undefined}
              {...(userVoteData.voter_duration ? {
                durationMinValue: userVoteData.voter_duration.minValue,
                durationMaxValue: userVoteData.voter_duration.maxValue,
                durationMinEnabled: userVoteData.voter_duration.minEnabled,
                durationMaxEnabled: userVoteData.voter_duration.maxEnabled,
                onDurationMinChange: () => {},
                onDurationMaxChange: () => {},
                onDurationMinEnabledChange: () => {},
                onDurationMaxEnabledChange: () => {},
              } : {})}
            />
          ) : !isAvailabilitySubmission && (userVoteData?.liked_slots !== null || userVoteData?.disliked_slots !== null) ? (
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

  // Block submitting availability when any split slot escapes the creator's
  // allowed windows or touches/overlaps a sibling (the orange-outlined pills).
  const availabilityWindowsInvalid = isAvailabilitySubmission && !isAbstaining
    && hasInvalidVoterWindows(voterDayTimeWindows, question.day_time_windows ?? null);

  return (
    <div>
      {isAvailabilitySubmission ? (
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
            <div className="mb-6 text-center">
              <button
                type="button"
                onClick={handleAbstain}
                disabled={isSubmitting}
                className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70 disabled:opacity-50"
              >
                {isAbstaining ? 'Abstaining' : 'Abstain'}
              </button>
            </div>

            {availabilityWindowsInvalid && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-400 dark:border-amber-500 rounded-md">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Some slots fall outside the allowed times or overlap another slot. Adjust the highlighted slots to continue.
                </p>
              </div>
            )}

            {voteError && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
              </div>
            )}

            {!wrapperHandlesSubmit && (
              <>
                <button
                  type="button"
                  onClick={handleVoteClick}
                  disabled={isSubmitting || availabilityWindowsInvalid || (!isAbstaining && voterDayTimeWindows.filter(d => (d.windows ?? []).some(w => w.enabled !== false)).length === 0)}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Availability'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Preferences phase (or pre-ranking tentative-slots sub-phase): tap
                bubbles to like/dislike time slots. Header copy differs so voters
                know the candidate list may still shift before the cutoff. */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-3 text-center">Mark Your Preferences</h3>
              {inAvailabilityPhase && (
                <p className="mb-3 text-xs text-amber-600 dark:text-amber-400 text-center">
                  Tentative slots — list may shift as more voters submit availability.
                </p>
              )}
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

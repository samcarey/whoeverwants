/**
 * Shared builders for QuestionBallot vote submission.
 *
 * `handleVoteClick` / `submitVote` (immediate per-question submit) and
 * `prepareBatchVoteItem` (multi-question wrapper Submit) both build the same
 * `voteData` payload and `PollVoteItem` from the same per-question state.
 * Centralising the construction keeps the two paths in lockstep — when a new
 * field lands on `PollVoteItem` it's added in exactly one place.
 */
import type { DayTimeWindow, DurationWindow, OptionsMetadata } from "@/lib/types";
import type { PollVoteItem, QuestionType } from "@/lib/api";
import { hasInvalidVoterWindows } from "@/lib/timeUtils";

export interface BallotInputs {
  questionId: string;
  questionType: QuestionType;
  isAbstaining: boolean;
  yesNoChoice: 'yes' | 'no' | null;
  rankedChoices: string[];
  rankedChoiceTiers: string[][];
  suggestionChoices: string[];
  suggestionMetadata: OptionsMetadata;
  hasSuggestionPhase: boolean;
  canSubmitSuggestions: boolean;
  // For time questions: true iff THIS submission carries availability fields
  // (voter_day_time_windows + voter_duration). False during the preferences
  // phase AND during the pre-ranking "tentative slots" sub-phase, where the
  // submission carries liked_slots/disliked_slots and re-sends existing
  // availability data via COALESCE on the server.
  isAvailabilitySubmission: boolean;
  voterDayTimeWindows: DayTimeWindow[];
  // The creator's allowed windows per day — voter split slots must stay inside
  // one of them (and not touch/overlap a sibling), else the submit is blocked.
  questionDayTimeWindows: DayTimeWindow[] | null;
  durationMinValue: number | null;
  durationMaxValue: number | null;
  durationMinEnabled: boolean;
  durationMaxEnabled: boolean;
  likedSlots: string[] | null;
  dislikedSlots: string[] | null;
  voterName: string;
  questionOptions: string[];
  userVoteData: {
    suggestions?: string[];
    voter_day_time_windows?: DayTimeWindow[] | null;
    voter_duration?: DurationWindow | null;
  } | null;
}

type BuildVoteDataResult =
  | { ok: true; voteData: any; effectiveIsAbstaining: boolean }
  | { ok: false; error: string };

/**
 * Validate ballot state and build the per-question-type `voteData` payload that
 * `PollVoteItem` is derived from.
 *
 * The "empty ranked_choice ballot during the suggestion phase counts as an
 * implicit abstain" rule means the effective abstain flag can differ from the
 * input — callers should surface `result.effectiveIsAbstaining` back to local
 * state when they want the change to stick.
 */
export function buildVoteData(state: BallotInputs): BuildVoteDataResult {
  let effectiveIsAbstaining = state.isAbstaining;

  if (state.questionType === 'yes_no') {
    if (!state.yesNoChoice && !state.isAbstaining) {
      return { ok: false, error: "Please select Yes, No, or Abstain" };
    }
    return {
      ok: true,
      effectiveIsAbstaining,
      voteData: {
        question_id: state.questionId,
        vote_type: 'yes_no' as const,
        yes_no_choice: state.isAbstaining ? null : state.yesNoChoice,
        is_abstain: state.isAbstaining,
        voter_name: state.voterName.trim() || null,
      },
    };
  }

  if (state.questionType === 'ranked_choice') {
    const filteredRankedChoices = state.rankedChoices.filter(c => c && c.trim().length > 0);
    const filteredSuggestionsForValidation = state.suggestionChoices.filter(c => c && c.trim().length > 0);
    const filteredTiers: string[][] = state.rankedChoiceTiers
      .map(tier => tier.filter(c => c && c.trim().length > 0))
      .filter(tier => tier.length > 0);
    // Only persist tiers when they actually encode ties — singleton tiers are
    // redundant with the flat ranked_choices list.
    const hasTies = filteredTiers.some(tier => tier.length > 1);

    if (filteredRankedChoices.length === 0 && !state.isAbstaining
        && (!state.canSubmitSuggestions || filteredSuggestionsForValidation.length === 0)) {
      if (state.canSubmitSuggestions) {
        // During the suggestion phase, an empty submit is an implicit abstain.
        effectiveIsAbstaining = true;
      } else {
        return { ok: false, error: "Please rank at least one option or select Abstain" };
      }
    }

    const invalidChoices = filteredRankedChoices.filter(c => !state.questionOptions.includes(c));
    if (invalidChoices.length > 0) {
      return { ok: false, error: "Invalid options detected. Please refresh and try again." };
    }

    const filteredSuggestions = state.hasSuggestionPhase
      ? state.suggestionChoices.filter(c => c && c.trim().length > 0)
      : null;
    const filteredMetadata = state.hasSuggestionPhase
        && filteredSuggestions && filteredSuggestions.length > 0
        && Object.keys(state.suggestionMetadata).length > 0
      ? Object.fromEntries(
          Object.entries(state.suggestionMetadata).filter(([key]) => filteredSuggestions.includes(key))
        )
      : null;

    const hasRankings = filteredRankedChoices.length > 0;
    const hasSuggestions = !!(filteredSuggestions && filteredSuggestions.length > 0);
    const previousSuggestions: string[] | undefined = state.userVoteData?.suggestions;
    const hasPreviousSuggestions = !!(previousSuggestions && previousSuggestions.length > 0);
    const hasAnyContent = hasRankings || hasSuggestions || hasPreviousSuggestions;
    const finalAbstain = !hasAnyContent;
    const rankingAbstain = effectiveIsAbstaining && !hasRankings && (hasSuggestions || hasPreviousSuggestions);

    return {
      ok: true,
      effectiveIsAbstaining,
      voteData: {
        question_id: state.questionId,
        vote_type: 'ranked_choice' as const,
        ranked_choices: effectiveIsAbstaining || !hasRankings ? null : filteredRankedChoices,
        ranked_choice_tiers: effectiveIsAbstaining || !hasRankings || !hasTies ? null : filteredTiers,
        suggestions: hasSuggestions ? filteredSuggestions : (hasPreviousSuggestions ? previousSuggestions : null),
        is_abstain: finalAbstain,
        is_ranking_abstain: rankingAbstain,
        voter_name: state.voterName.trim() || null,
        options_metadata: filteredMetadata && Object.keys(filteredMetadata).length > 0 ? filteredMetadata : null,
      },
    };
  }

  if (state.questionType === 'time') {
    if (state.isAvailabilitySubmission) {
      // Block submission when any enabled slot escapes the creator's allowed
      // windows or touches/overlaps a sibling (the orange-outlined pills). Same
      // predicate the per-pill flags use, so the highlight and the block agree.
      if (!effectiveIsAbstaining
          && hasInvalidVoterWindows(state.voterDayTimeWindows, state.questionDayTimeWindows)) {
        return {
          ok: false,
          error: "Some availability slots fall outside the allowed times or overlap another slot. Fix the highlighted slots to continue.",
        };
      }
      // Strip windows the voter unchecked in the form (`enabled === false` —
      // the toggle's UI state, not server-side data) and drop days that wind
      // up with zero enabled windows. The availability algorithms (FE
      // `isVoterAvailableForSlot`, server `_voter_available_at`) don't read
      // the enabled flag, AND an empty `windows` array on a day means "all
      // day available" — leaving a disabled window in place would cover the
      // whole day with the voter's "I'm NOT available here" intent inverted.
      const cleanedDays = state.voterDayTimeWindows
        .map(d => ({
          ...d,
          windows: (d.windows ?? []).filter(w => w.enabled !== false).map(({ min, max }) => ({ min, max })),
        }))
        .filter(d => d.windows.length > 0);
      return {
        ok: true,
        effectiveIsAbstaining,
        voteData: {
          vote_type: 'time' as const,
          voter_day_time_windows: cleanedDays.length > 0 ? cleanedDays : null,
          voter_duration: (state.durationMinEnabled || state.durationMaxEnabled) ? {
            minValue: state.durationMinValue,
            maxValue: state.durationMaxValue,
            minEnabled: state.durationMinEnabled,
            maxEnabled: state.durationMaxEnabled,
          } : null,
          is_abstain: effectiveIsAbstaining,
          voter_name: state.voterName.trim() || null,
        },
      };
    }
    // Preferences phase: re-send the voter's existing availability so the
    // server's UPDATE doesn't overwrite voter_day_time_windows / voter_duration
    // with NULL. The fields are intentionally left out of the UI for this
    // phase (availability is locked once finalization runs); the SQL writes
    // them directly, so omitting them would clear what's already stored.
    return {
      ok: true,
      effectiveIsAbstaining,
      voteData: {
        vote_type: 'time' as const,
        voter_day_time_windows: state.userVoteData?.voter_day_time_windows ?? null,
        voter_duration: state.userVoteData?.voter_duration ?? null,
        liked_slots: effectiveIsAbstaining ? null : (state.likedSlots ?? []),
        disliked_slots: effectiveIsAbstaining ? null : (state.dislikedSlots ?? []),
        is_abstain: effectiveIsAbstaining,
        voter_name: state.voterName.trim() || null,
      },
    };
  }

  return { ok: true, effectiveIsAbstaining, voteData: {} };
}

/**
 * Convert a built voteData payload into a PollVoteItem for the batched
 * `POST /api/polls/{id}/votes` endpoint.
 *
 * `suggestions` is omitted on ranked_choice edits past the suggestion-phase
 * deadline so the server's COALESCE leaves the existing column alone.
 */
export function buildPollVoteItem(
  voteData: any,
  questionId: string,
  voteId: string | null,
  options: { questionType: QuestionType; canSubmitSuggestions: boolean; isEditing: boolean },
): PollVoteItem {
  const item: PollVoteItem = {
    question_id: questionId,
    vote_id: options.isEditing ? voteId : null,
    vote_type: voteData.vote_type,
    yes_no_choice: voteData.yes_no_choice ?? null,
    ranked_choices: voteData.ranked_choices ?? null,
    ranked_choice_tiers: voteData.ranked_choice_tiers ?? null,
    is_abstain: voteData.is_abstain ?? false,
    is_ranking_abstain: voteData.is_ranking_abstain ?? false,
    options_metadata: voteData.options_metadata ?? null,
    voter_day_time_windows: voteData.voter_day_time_windows ?? null,
    voter_duration: voteData.voter_duration ?? null,
    liked_slots: voteData.liked_slots ?? null,
    disliked_slots: voteData.disliked_slots ?? null,
  };
  if (!(options.isEditing && options.questionType === 'ranked_choice' && !options.canSubmitSuggestions)) {
    item.suggestions = voteData.suggestions ?? null;
  }
  return item;
}

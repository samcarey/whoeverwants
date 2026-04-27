/**
 * Shared builders for SubPollBallot vote submission.
 *
 * `handleVoteClick` / `submitVote` (immediate per-sub-poll submit) and
 * `prepareBatchVoteItem` (multi-sub-poll wrapper Submit) both build the same
 * `voteData` payload and `MultipollVoteItem` from the same per-sub-poll state.
 * Centralising the construction keeps the two paths in lockstep — when a new
 * field lands on `MultipollVoteItem` it's added in exactly one place.
 */
import type { OptionsMetadata } from "@/lib/types";
import type { MultipollVoteItem } from "@/lib/api";

export interface BallotInputs {
  pollId: string;
  pollType: 'yes_no' | 'ranked_choice' | 'time' | string;
  isAbstaining: boolean;
  yesNoChoice: 'yes' | 'no' | null;
  rankedChoices: string[];
  rankedChoiceTiers: string[][];
  suggestionChoices: string[];
  suggestionMetadata: OptionsMetadata;
  hasSuggestionPhase: boolean;
  canSubmitSuggestions: boolean;
  inAvailabilityPhase: boolean;
  voterDayTimeWindows: any[];
  durationMinValue: number | null;
  durationMaxValue: number | null;
  durationMinEnabled: boolean;
  durationMaxEnabled: boolean;
  likedSlots: string[] | null;
  dislikedSlots: string[] | null;
  voterName: string;
  pollOptions: string[];
  userVoteData: any;
}

export type BuildVoteDataResult =
  | { ok: true; voteData: any; effectiveIsAbstaining: boolean }
  | { ok: false; error: string };

/**
 * Validate ballot state and build the per-poll-type `voteData` payload that
 * `MultipollVoteItem` is derived from.
 *
 * The "empty ranked_choice ballot during the suggestion phase counts as an
 * implicit abstain" rule means the effective abstain flag can differ from the
 * input — callers should surface `result.effectiveIsAbstaining` back to local
 * state when they want the change to stick.
 */
export function buildVoteData(state: BallotInputs): BuildVoteDataResult {
  let effectiveIsAbstaining = state.isAbstaining;

  if (state.pollType === 'yes_no') {
    if (!state.yesNoChoice && !state.isAbstaining) {
      return { ok: false, error: "Please select Yes, No, or Abstain" };
    }
    return {
      ok: true,
      effectiveIsAbstaining,
      voteData: {
        poll_id: state.pollId,
        vote_type: 'yes_no' as const,
        yes_no_choice: state.isAbstaining ? null : state.yesNoChoice,
        is_abstain: state.isAbstaining,
        voter_name: state.voterName.trim() || null,
      },
    };
  }

  if (state.pollType === 'ranked_choice') {
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

    const invalidChoices = filteredRankedChoices.filter(c => !state.pollOptions.includes(c));
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
        poll_id: state.pollId,
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

  if (state.pollType === 'time') {
    if (state.inAvailabilityPhase) {
      return {
        ok: true,
        effectiveIsAbstaining,
        voteData: {
          vote_type: 'time' as const,
          voter_day_time_windows: state.voterDayTimeWindows.length > 0 ? state.voterDayTimeWindows : null,
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
    return {
      ok: true,
      effectiveIsAbstaining,
      voteData: {
        vote_type: 'time' as const,
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
 * Convert a built voteData payload into a MultipollVoteItem for the batched
 * `POST /api/multipolls/{id}/votes` endpoint.
 *
 * `suggestions` is omitted on ranked_choice edits past the suggestion-phase
 * deadline so the server's COALESCE leaves the existing column alone.
 */
export function buildMultipollVoteItem(
  voteData: any,
  pollId: string,
  voteId: string | null,
  options: { pollType: string; canSubmitSuggestions: boolean; isEditing: boolean },
): MultipollVoteItem {
  const item: MultipollVoteItem = {
    sub_poll_id: pollId,
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
  if (!(options.isEditing && options.pollType === 'ranked_choice' && !options.canSubmitSuggestions)) {
    item.suggestions = voteData.suggestions ?? null;
  }
  return item;
}

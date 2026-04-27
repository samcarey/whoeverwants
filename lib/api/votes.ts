import type { OptionsMetadata } from "@/lib/types";
import { cacheVotes, getCachedVotes, invalidatePoll } from "@/lib/questionCache";
import { apiFetch, pollFetch, coalesced } from "./_internal";

// Dispatched on `window` with `{ detail: { questionId } }` after any vote mutation
// so VoterList instances refresh immediately instead of waiting for the question
// interval. Mirrors the existing `question:updated` channel for metadata changes.
export const QUESTION_VOTES_CHANGED_EVENT = 'question:votesChanged';

export interface ApiVote {
  id: string;
  question_id: string;
  vote_type: string;
  yes_no_choice: string | null;
  ranked_choices: string[] | null;
  ranked_choice_tiers: string[][] | null;
  suggestions: string[] | null;
  is_abstain: boolean;
  is_ranking_abstain: boolean;
  voter_name: string | null;
  voter_day_time_windows: any[] | null;
  voter_duration: any | null;
  liked_slots: string[] | null;
  disliked_slots: string[] | null;
  created_at: string;
  updated_at: string;
}

const votesInFlight = new Map<string, Promise<ApiVote[]>>();

export async function apiGetVotes(questionId: string): Promise<ApiVote[]> {
  return coalesced(votesInFlight, questionId, getCachedVotes(questionId), async () => {
    const votes: ApiVote[] = await apiFetch(`/${encodeURIComponent(questionId)}/votes`);
    cacheVotes(questionId, votes);
    return votes;
  });
}

// Phase 3.4: unified poll voting. One transaction, one voter_name, many
// question ballots. Each item either inserts (vote_id null) or updates
// (vote_id set) on its question_id; any item failure rolls back the whole
// batch. Caller is responsible for invalidating per-question caches via
// invalidatePoll() — done here so callers can't forget.
export interface PollVoteItem {
  question_id: string;
  vote_id?: string | null;
  vote_type: string;
  yes_no_choice?: string | null;
  ranked_choices?: string[] | null;
  ranked_choice_tiers?: string[][] | null;
  suggestions?: string[] | null;
  is_abstain?: boolean;
  is_ranking_abstain?: boolean;
  voter_day_time_windows?: any[] | null;
  voter_duration?: any | null;
  options_metadata?: OptionsMetadata | null;
  liked_slots?: string[] | null;
  disliked_slots?: string[] | null;
}

export async function apiSubmitPollVotes(
  pollId: string,
  params: { voter_name?: string | null; items: PollVoteItem[] },
): Promise<ApiVote[]> {
  const data = await pollFetch<ApiVote[]>(
    `/${encodeURIComponent(pollId)}/votes`,
    { method: 'POST', body: JSON.stringify(params) },
  );
  // Cascading invalidation: the poll cache entry's questions list drives
  // per-question cache eviction in invalidatePoll, so we don't need to
  // walk params.items here.
  invalidatePoll(pollId);
  return data;
}

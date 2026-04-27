import type { OptionsMetadata } from "@/lib/types";
import { cacheVotes, getCachedVotes, invalidateMultipoll } from "@/lib/pollCache";
import { apiFetch, multipollFetch, coalesced } from "./_internal";

// Dispatched on `window` with `{ detail: { pollId } }` after any vote mutation
// so VoterList instances refresh immediately instead of waiting for the poll
// interval. Mirrors the existing `poll:updated` channel for metadata changes.
export const POLL_VOTES_CHANGED_EVENT = 'poll:votesChanged';

export interface ApiVote {
  id: string;
  poll_id: string;
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

export async function apiGetVotes(pollId: string): Promise<ApiVote[]> {
  return coalesced(votesInFlight, pollId, getCachedVotes(pollId), async () => {
    const votes: ApiVote[] = await apiFetch(`/${encodeURIComponent(pollId)}/votes`);
    cacheVotes(pollId, votes);
    return votes;
  });
}

// Phase 3.4: unified multipoll voting. One transaction, one voter_name, many
// sub-poll ballots. Each item either inserts (vote_id null) or updates
// (vote_id set) on its sub_poll_id; any item failure rolls back the whole
// batch. Caller is responsible for invalidating per-sub-poll caches via
// invalidateMultipoll() — done here so callers can't forget.
export interface MultipollVoteItem {
  sub_poll_id: string;
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

export async function apiSubmitMultipollVotes(
  multipollId: string,
  params: { voter_name?: string | null; items: MultipollVoteItem[] },
): Promise<ApiVote[]> {
  const data = await multipollFetch<ApiVote[]>(
    `/${encodeURIComponent(multipollId)}/votes`,
    { method: 'POST', body: JSON.stringify(params) },
  );
  // Cascading invalidation: the multipoll cache entry's sub_polls list drives
  // per-sub-poll cache eviction in invalidateMultipoll, so we don't need to
  // walk params.items here.
  invalidateMultipoll(multipollId);
  return data;
}

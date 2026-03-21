/**
 * API client for the Python backend.
 * Replaces direct Supabase client calls with fetch()-based requests to the FastAPI server.
 */

import type { Poll, PollResults } from './types';
import { branchToSlug } from './slug';

// API URL resolution:
// - NEXT_PUBLIC_API_URL overrides everything
// - Server-side: absolute URLs (no browser privacy concerns in SSR)
// - Client-side: relative /api/polls path, proxied by Next.js rewrites
//   (keeps requests same-origin, avoiding Safari ITP warnings)
function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  // Server-side: use absolute URLs (no browser privacy concerns in SSR)
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV !== 'production') {
      return 'http://localhost:8000/api/polls';
    }
    const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF;
    if (branch && branch !== 'main' && branch !== 'master') {
      const slug = branchToSlug(branch);
      return `https://${slug}.api.whoeverwants.com/api/polls`;
    }
    return 'https://api.whoeverwants.com/api/polls';
  }
  // Client-side (all environments): relative path, proxied by Next.js rewrites
  return '/api/polls';
}

const API_BASE = getApiBase();

// --- Vote types matching the Python VoteResponse model ---

export interface ApiVote {
  id: string;
  poll_id: string;
  vote_type: string;
  yes_no_choice: string | null;
  ranked_choices: string[] | null;
  nominations: string[] | null;
  is_abstain: boolean;
  voter_name: string | null;
  min_participants: number | null;
  max_participants: number | null;
  created_at: string;
  updated_at: string;
}

// --- Helper ---

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, detail);
  }

  return res.json();
}

// --- Poll response → Poll type mapping ---

function toPoll(data: any): Poll {
  return {
    id: data.id,
    title: data.title,
    poll_type: data.poll_type,
    options: data.options ?? undefined,
    response_deadline: data.response_deadline ?? undefined,
    created_at: data.created_at,
    updated_at: data.updated_at,
    creator_secret: data.creator_secret ?? undefined,
    creator_name: data.creator_name ?? undefined,
    is_closed: data.is_closed ?? false,
    close_reason: data.close_reason ?? undefined,
    follow_up_to: data.follow_up_to ?? undefined,
    fork_of: data.fork_of ?? undefined,
    min_participants: data.min_participants ?? undefined,
    max_participants: data.max_participants ?? undefined,
    short_id: data.short_id ?? undefined,
  };
}

function toPollResults(data: any): PollResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string } {
  return {
    poll_id: data.poll_id,
    title: data.title,
    poll_type: data.poll_type,
    created_at: data.created_at,
    response_deadline: data.response_deadline ?? undefined,
    options: data.options ?? undefined,
    yes_count: data.yes_count ?? undefined,
    no_count: data.no_count ?? undefined,
    total_votes: data.total_votes,
    yes_percentage: data.yes_percentage ?? undefined,
    no_percentage: data.no_percentage ?? undefined,
    winner: data.winner ?? undefined,
    min_participants: data.min_participants ?? undefined,
    max_participants: data.max_participants ?? undefined,
    nomination_counts: data.nomination_counts ?? undefined,
    ranked_choice_rounds: data.ranked_choice_rounds ?? undefined,
    ranked_choice_winner: data.ranked_choice_winner ?? undefined,
  };
}

// --- Ranked choice round type from API ---

export interface ApiRankedChoiceRound {
  round_number: number;
  option_name: string;
  vote_count: number;
  is_eliminated: boolean;
  borda_score: number | null;
  tie_broken_by_borda: boolean;
}

// --- Poll CRUD ---

export async function apiCreatePoll(params: {
  title: string;
  poll_type?: string;
  options?: string[];
  response_deadline?: string;
  creator_secret: string;
  creator_name?: string;
  follow_up_to?: string;
  fork_of?: string;
  min_participants?: number;
  max_participants?: number;
}): Promise<Poll> {
  const data = await apiFetch('', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return toPoll(data);
}

export async function apiGetPollByShortId(shortId: string): Promise<Poll> {
  const data = await apiFetch(`/by-short-id/${encodeURIComponent(shortId)}`);
  return toPoll(data);
}

export async function apiGetPollById(pollId: string): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}`);
  return toPoll(data);
}

// --- Voting ---

export async function apiSubmitVote(pollId: string, params: {
  vote_type: string;
  yes_no_choice?: string | null;
  ranked_choices?: string[] | null;
  nominations?: string[] | null;
  is_abstain?: boolean;
  voter_name?: string | null;
  min_participants?: number | null;
  max_participants?: number | null;
}): Promise<ApiVote> {
  return apiFetch(`/${encodeURIComponent(pollId)}/votes`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function apiGetVotes(pollId: string): Promise<ApiVote[]> {
  return apiFetch(`/${encodeURIComponent(pollId)}/votes`);
}

export async function apiEditVote(pollId: string, voteId: string, params: {
  yes_no_choice?: string | null;
  ranked_choices?: string[] | null;
  nominations?: string[] | null;
  is_abstain?: boolean;
  voter_name?: string | null;
  min_participants?: number | null;
  max_participants?: number | null;
}): Promise<ApiVote> {
  return apiFetch(`/${encodeURIComponent(pollId)}/votes/${encodeURIComponent(voteId)}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

// --- Results ---

export async function apiGetPollResults(pollId: string): Promise<PollResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string }> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/results`);
  return toPollResults(data);
}

// --- Participants ---

export async function apiGetParticipants(pollId: string): Promise<{vote_id: string, voter_name: string | null}[]> {
  return apiFetch(`/${encodeURIComponent(pollId)}/participants`);
}

// --- Poll management ---

export async function apiClosePoll(pollId: string, creatorSecret: string, closeReason: string = 'manual'): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/close`, {
    method: 'POST',
    body: JSON.stringify({ creator_secret: creatorSecret, close_reason: closeReason }),
  });
  return toPoll(data);
}

export async function apiReopenPoll(pollId: string, creatorSecret: string): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ creator_secret: creatorSecret }),
  });
  return toPoll(data);
}

// --- Related polls ---

export async function apiGetRelatedPolls(pollIds: string[]): Promise<{
  allRelatedIds: string[];
  originalCount: number;
  discoveredCount: number;
}> {
  if (pollIds.length === 0) return { allRelatedIds: [], originalCount: 0, discoveredCount: 0 };
  const data = await apiFetch<{ all_related_ids: string[]; original_count: number; discovered_count: number }>('/related', {
    method: 'POST',
    body: JSON.stringify({ poll_ids: pollIds }),
  });
  return {
    allRelatedIds: data.all_related_ids,
    originalCount: data.original_count,
    discoveredCount: data.discovered_count,
  };
}

// --- Accessible polls ---

export async function apiGetAccessiblePolls(pollIds: string[]): Promise<Poll[]> {
  if (pollIds.length === 0) return [];
  const data: any[] = await apiFetch('/accessible', {
    method: 'POST',
    body: JSON.stringify({ poll_ids: pollIds }),
  });
  return data.map(toPoll);
}

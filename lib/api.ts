/**
 * API client for the Python backend.
 * Replaces direct Supabase client calls with fetch()-based requests to the FastAPI server.
 */

import type { Multipoll, Poll, PollResults, OptionsMetadata } from './types';
import { branchToSlug } from './slug';
import {
  cachePoll,
  cachePollResults, getCachedPollResults,
  cacheVotes, getCachedVotes,
  cacheParticipants, getCachedParticipants,
  cacheMultipoll, getCachedMultipollById, getCachedMultipollByShortId,
} from './pollCache';

// API URL resolution:
// - NEXT_PUBLIC_API_URL overrides everything
// - Server-side: absolute URLs (no browser privacy concerns in SSR)
// - Client-side: relative /api/polls path, proxied by Next.js rewrites
//   (keeps requests same-origin, avoiding Safari ITP warnings)
function getApiEndpoint(endpoint: string): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/polls\/?$/, `/api/${endpoint}`);
  }
  if (typeof window === 'undefined') {
    if (process.env.NODE_ENV !== 'production') {
      return `http://localhost:8000/api/${endpoint}`;
    }
    const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF;
    if (branch && branch !== 'main' && branch !== 'master') {
      const slug = branchToSlug(branch);
      return `https://${slug}.api.whoeverwants.com/api/${endpoint}`;
    }
    return `https://api.whoeverwants.com/api/${endpoint}`;
  }
  return `/api/${endpoint}`;
}

const API_BASE = getApiEndpoint('polls');
const MULTIPOLL_BASE = getApiEndpoint('multipolls');

// Dispatched on `window` with `{ detail: { pollId } }` after any vote mutation
// so VoterList instances refresh immediately instead of waiting for the poll
// interval. Mirrors the existing `poll:updated` channel for metadata changes.
export const POLL_VOTES_CHANGED_EVENT = 'poll:votesChanged';

// --- Vote types matching the Python VoteResponse model ---

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
  min_participants: number | null;
  max_participants: number | null;
  voter_day_time_windows: any[] | null;
  voter_duration: any | null;
  liked_slots: string[] | null;
  disliked_slots: string[] | null;
  created_at: string;
  updated_at: string;
}

// --- Helper ---

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithBase<T>(base: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${base}${path}`;
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

function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(API_BASE, path, options);
}

function multipollFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchWithBase<T>(MULTIPOLL_BASE, path, options);
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
    suggestion_deadline: data.suggestion_deadline ?? undefined,
    suggestion_deadline_minutes: data.suggestion_deadline_minutes ?? undefined,
    allow_pre_ranking: data.allow_pre_ranking ?? true,
    details: data.details ?? undefined,
    location_mode: data.location_mode ?? undefined,
    location_value: data.location_value ?? undefined,
    location_options: data.location_options ?? undefined,
    resolved_location: data.resolved_location ?? undefined,
    time_mode: data.time_mode ?? undefined,
    time_value: data.time_value ?? undefined,
    time_options: data.time_options ?? undefined,
    resolved_time: data.resolved_time ?? undefined,
    is_sub_poll: data.is_sub_poll ?? undefined,
    sub_poll_role: data.sub_poll_role ?? undefined,
    parent_participation_poll_id: data.parent_participation_poll_id ?? undefined,
    location_suggestions_deadline_minutes: data.location_suggestions_deadline_minutes ?? undefined,
    location_preferences_deadline_minutes: data.location_preferences_deadline_minutes ?? undefined,
    time_suggestions_deadline_minutes: data.time_suggestions_deadline_minutes ?? undefined,
    time_preferences_deadline_minutes: data.time_preferences_deadline_minutes ?? undefined,
    day_time_windows: data.day_time_windows ?? undefined,
    duration_window: data.duration_window ?? undefined,
    category: data.category ?? undefined,
    options_metadata: data.options_metadata ?? undefined,
    reference_latitude: data.reference_latitude ?? undefined,
    reference_longitude: data.reference_longitude ?? undefined,
    reference_location_label: data.reference_location_label ?? undefined,
    min_responses: data.min_responses ?? undefined,
    show_preliminary_results: data.show_preliminary_results ?? true,
    response_count: data.response_count ?? undefined,
    min_availability_percent: data.min_availability_percent ?? undefined,
    thread_title: data.thread_title ?? null,
    multipoll_id: data.multipoll_id ?? null,
    sub_poll_index: data.sub_poll_index ?? null,
    voter_names: data.voter_names ?? undefined,
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
    abstain_count: data.abstain_count ?? undefined,
    total_yes_votes: data.total_yes_votes ?? undefined,
    total_votes: data.total_votes,
    yes_percentage: data.yes_percentage ?? undefined,
    no_percentage: data.no_percentage ?? undefined,
    winner: data.winner ?? undefined,
    min_participants: data.min_participants ?? undefined,
    max_participants: data.max_participants ?? undefined,
    suggestion_counts: data.suggestion_counts ?? undefined,
    ranked_choice_rounds: data.ranked_choice_rounds ?? undefined,
    ranked_choice_winner: data.ranked_choice_winner ?? undefined,
    time_slot_rounds: data.time_slot_rounds ?? undefined,
    participating_vote_ids: data.participating_vote_ids ?? undefined,
    participating_voter_names: data.participating_voter_names ?? undefined,
    availability_counts: data.availability_counts ?? undefined,
    max_availability: data.max_availability ?? undefined,
    included_slots: data.included_slots ?? undefined,
    like_counts: data.like_counts ?? undefined,
    dislike_counts: data.dislike_counts ?? undefined,
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
  suggestion_deadline?: string;
  allow_pre_ranking?: boolean;
  auto_close_after?: number;
  details?: string;
  location_mode?: string;
  location_value?: string;
  location_options?: string[];
  time_mode?: string;
  time_value?: string;
  time_options?: string[];
  location_suggestions_deadline_minutes?: number;
  location_preferences_deadline_minutes?: number;
  time_suggestions_deadline_minutes?: number;
  time_preferences_deadline_minutes?: number;
  day_time_windows?: any[];
  duration_window?: any;
  category?: string;
  options_metadata?: OptionsMetadata;
  reference_latitude?: number;
  reference_longitude?: number;
  reference_location_label?: string;
  min_responses?: number;
  show_preliminary_results?: boolean;
  min_availability_percent?: number;
  suggestion_deadline_minutes?: number;
  is_auto_title?: boolean;
  thread_title?: string | null;
}): Promise<Poll> {
  const data = await apiFetch('', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return toPoll(data);
}

export async function apiGetSubPolls(pollId: string): Promise<Poll[]> {
  const data: any[] = await apiFetch(`/${encodeURIComponent(pollId)}/sub-polls`);
  return data.map(toPoll);
}

/**
 * Deduplicate concurrent identical fetches using an in-flight Map.
 * Returns the cached value if present, otherwise starts (or joins) a fetch
 * and stores the result. Needed because React StrictMode double-mounts
 * effects in dev, causing two simultaneous calls to the same endpoint.
 */
async function coalesced<T>(
  map: Map<string, Promise<T>>,
  key: string,
  cached: T | null,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (cached !== null) return cached;
  const existing = map.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      map.delete(key);
    }
  })();
  map.set(key, promise);
  return promise;
}

const pollInFlight = new Map<string, Promise<Poll>>();

export async function apiGetPollByShortId(shortId: string): Promise<Poll> {
  return coalesced(pollInFlight, `short:${shortId}`, null, async () => {
    const data = await apiFetch(`/by-short-id/${encodeURIComponent(shortId)}`);
    const poll = toPoll(data);
    cachePoll(poll);
    return poll;
  });
}

export async function apiGetPollById(pollId: string): Promise<Poll> {
  return coalesced(pollInFlight, `id:${pollId}`, null, async () => {
    const data = await apiFetch(`/${encodeURIComponent(pollId)}`);
    const poll = toPoll(data);
    cachePoll(poll);
    return poll;
  });
}

// --- Multipoll CRUD (Phase 2.1) ---
//
// Mirrors server/routers/multipolls.py. Multipolls wrap one or more sub-polls;
// a 1-sub-poll multipoll renders identically to today's single poll. See
// docs/multipoll-phasing.md.

// Participation polls are excluded from the multipoll system — see
// CLAUDE.md → "Participation Polls (Deprecated)" and the server validator
// in server/routers/multipolls.py.
export type SubPollType = 'yes_no' | 'ranked_choice' | 'time';

export interface CreateSubPollParams {
  poll_type?: SubPollType;
  category?: string | null;
  options?: string[] | null;
  options_metadata?: OptionsMetadata | null;
  context?: string | null;
  suggestion_deadline_minutes?: number | null;
  allow_pre_ranking?: boolean;
  min_responses?: number | null;
  show_preliminary_results?: boolean;
  min_availability_percent?: number;
  day_time_windows?: any[] | null;
  duration_window?: any | null;
  reference_latitude?: number | null;
  reference_longitude?: number | null;
  reference_location_label?: string | null;
  is_auto_title?: boolean;
}

export interface CreateMultipollParams {
  creator_secret: string;
  creator_name?: string | null;
  response_deadline?: string | null;
  prephase_deadline?: string | null;
  prephase_deadline_minutes?: number | null;
  follow_up_to?: string | null;
  fork_of?: string | null;
  thread_title?: string | null;
  context?: string | null;
  title?: string | null;
  sub_polls: CreateSubPollParams[];
}

function toMultipoll(data: any): Multipoll {
  return {
    id: data.id,
    short_id: data.short_id ?? null,
    creator_secret: data.creator_secret ?? null,
    creator_name: data.creator_name ?? null,
    response_deadline: data.response_deadline ?? null,
    prephase_deadline: data.prephase_deadline ?? null,
    prephase_deadline_minutes: data.prephase_deadline_minutes ?? null,
    is_closed: data.is_closed ?? false,
    close_reason: data.close_reason ?? null,
    follow_up_to: data.follow_up_to ?? null,
    fork_of: data.fork_of ?? null,
    thread_title: data.thread_title ?? null,
    context: data.context ?? null,
    title: data.title,
    created_at: data.created_at,
    updated_at: data.updated_at,
    sub_polls: Array.isArray(data.sub_polls) ? data.sub_polls.map(toPoll) : [],
  };
}

export async function apiCreateMultipoll(params: CreateMultipollParams): Promise<Multipoll> {
  const data = await multipollFetch('', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const multipoll = toMultipoll(data);
  cacheMultipoll(multipoll);
  return multipoll;
}

const multipollInFlight = new Map<string, Promise<Multipoll>>();

export async function apiGetMultipollByShortId(shortId: string): Promise<Multipoll> {
  return coalesced(
    multipollInFlight,
    `short:${shortId}`,
    getCachedMultipollByShortId(shortId),
    async () => {
      const data = await multipollFetch(`/${encodeURIComponent(shortId)}`);
      const multipoll = toMultipoll(data);
      cacheMultipoll(multipoll);
      return multipoll;
    },
  );
}

export async function apiGetMultipollById(multipollId: string): Promise<Multipoll> {
  return coalesced(
    multipollInFlight,
    `id:${multipollId}`,
    getCachedMultipollById(multipollId),
    async () => {
      const data = await multipollFetch(`/by-id/${encodeURIComponent(multipollId)}`);
      const multipoll = toMultipoll(data);
      cacheMultipoll(multipoll);
      return multipoll;
    },
  );
}

export async function apiFindDuplicatePoll(title: string, followUpTo: string): Promise<Poll | null> {
  try {
    const params = new URLSearchParams({ title, follow_up_to: followUpTo });
    const data = await apiFetch(`/find-duplicate?${params}`);
    return toPoll(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

// --- Voting ---

export async function apiSubmitVote(pollId: string, params: {
  vote_type: string;
  yes_no_choice?: string | null;
  ranked_choices?: string[] | null;
  ranked_choice_tiers?: string[][] | null;
  suggestions?: string[] | null;
  is_abstain?: boolean;
  is_ranking_abstain?: boolean;
  voter_name?: string | null;
  min_participants?: number | null;
  max_participants?: number | null;
  voter_day_time_windows?: any[] | null;
  voter_duration?: any | null;
  options_metadata?: OptionsMetadata | null;
  liked_slots?: string[] | null;
  disliked_slots?: string[] | null;
}): Promise<ApiVote> {
  return apiFetch(`/${encodeURIComponent(pollId)}/votes`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

const votesInFlight = new Map<string, Promise<ApiVote[]>>();

export async function apiGetVotes(pollId: string): Promise<ApiVote[]> {
  return coalesced(votesInFlight, pollId, getCachedVotes(pollId), async () => {
    const votes: ApiVote[] = await apiFetch(`/${encodeURIComponent(pollId)}/votes`);
    cacheVotes(pollId, votes);
    return votes;
  });
}

export async function apiEditVote(pollId: string, voteId: string, params: {
  yes_no_choice?: string | null;
  ranked_choices?: string[] | null;
  ranked_choice_tiers?: string[][] | null;
  suggestions?: string[] | null;
  is_abstain?: boolean;
  is_ranking_abstain?: boolean;
  voter_name?: string | null;
  min_participants?: number | null;
  max_participants?: number | null;
  voter_day_time_windows?: any[] | null;
  voter_duration?: any | null;
  liked_slots?: string[] | null;
  disliked_slots?: string[] | null;
}): Promise<ApiVote> {
  return apiFetch(`/${encodeURIComponent(pollId)}/votes/${encodeURIComponent(voteId)}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

// --- Results ---

type Results = PollResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string };
const resultsInFlight = new Map<string, Promise<Results>>();

export async function apiGetPollResults(pollId: string): Promise<Results> {
  return coalesced(resultsInFlight, pollId, getCachedPollResults(pollId), async () => {
    const data = await apiFetch(`/${encodeURIComponent(pollId)}/results`);
    const results = toPollResults(data);
    cachePollResults(pollId, results);
    return results;
  });
}

// --- Participants ---

type Participant = { vote_id: string; voter_name: string | null };
const participantsInFlight = new Map<string, Promise<Participant[]>>();

export async function apiGetParticipants(pollId: string): Promise<Participant[]> {
  return coalesced(participantsInFlight, pollId, getCachedParticipants(pollId), async () => {
    const participants: Participant[] = await apiFetch(`/${encodeURIComponent(pollId)}/participants`);
    cacheParticipants(pollId, participants);
    return participants;
  });
}

// --- Poll management ---

export async function apiClosePoll(pollId: string, creatorSecret: string, closeReason: string = 'manual'): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/close`, {
    method: 'POST',
    body: JSON.stringify({ creator_secret: creatorSecret, close_reason: closeReason }),
  });
  return toPoll(data);
}

export async function apiCutoffSuggestions(pollId: string, creatorSecret: string): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/cutoff-suggestions`, {
    method: 'POST',
    body: JSON.stringify({ creator_secret: creatorSecret }),
  });
  return toPoll(data);
}

export async function apiCutoffAvailability(pollId: string, creatorSecret: string): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/cutoff-availability`, {
    method: 'POST',
    body: JSON.stringify({ creator_secret: creatorSecret }),
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

/** Update (or clear) a poll's thread_title override. Empty string clears it. */
export async function apiUpdateThreadTitle(pollId: string, threadTitle: string | null): Promise<Poll> {
  const data = await apiFetch(`/${encodeURIComponent(pollId)}/thread-title`, {
    method: 'POST',
    body: JSON.stringify({ thread_title: threadTitle }),
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
    body: JSON.stringify({ poll_ids: pollIds, include_results: true }),
  });
  return data.map(d => {
    const poll = toPoll(d);
    if (d.results) {
      const results = toPollResults(d.results);
      poll.results = results;
      // Mirror inline results into the per-poll cache so apiGetPollResults
      // hits it (avoids layout shift from a late per-card re-fetch). Cache
      // with the fuller Results type from toPollResults rather than the
      // narrowed Poll.results (PollResults) so the ranked_choice_rounds
      // augmentation is preserved.
      cachePollResults(poll.id, results);
    }
    return poll;
  });
}

// --- Dev: fetch all poll IDs (dev environments only) ---

export async function apiGetAllPollIds(): Promise<string[]> {
  try {
    const data: { poll_ids: string[] } = await apiFetch('/dev/all-ids');
    return data.poll_ids;
  } catch {
    return [];
  }
}

// --- Search/autocomplete ---

export interface SearchResult {
  label: string;
  name?: string;
  address?: string;
  description?: string;
  imageUrl?: string;
  infoUrl?: string;
  lat?: string;
  lon?: string;
  distance_miles?: number;
  rating?: number;
  reviewCount?: number;
  cuisine?: string;
  priceLevel?: string;
}

const SEARCH_BASE = getApiEndpoint('search');

async function searchWithLocation(endpoint: string, query: string, refLat?: number, refLon?: number, maxDistance?: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (refLat !== undefined && refLon !== undefined) {
    params.set('lat', String(refLat));
    params.set('lon', String(refLon));
  }
  if (maxDistance !== undefined) {
    params.set('max_distance', String(maxDistance));
  }
  const res = await fetch(`${SEARCH_BASE}/${endpoint}?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export function apiSearchLocations(query: string, refLat?: number, refLon?: number, maxDistance?: number): Promise<SearchResult[]> {
  return searchWithLocation('locations', query, refLat, refLon, maxDistance);
}

export function apiSearchRestaurants(query: string, refLat?: number, refLon?: number, maxDistance?: number): Promise<SearchResult[]> {
  return searchWithLocation('restaurants', query, refLat, refLon, maxDistance);
}

export async function apiGeocode(query: string): Promise<{ lat: string; lon: string; label: string } | null> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${SEARCH_BASE}/geocode?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function apiSearchMovies(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${SEARCH_BASE}/movies?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export async function apiSearchVideoGames(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${SEARCH_BASE}/video-games?${params}`);
  if (!res.ok) return [];
  return res.json();
}

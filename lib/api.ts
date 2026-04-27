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
  cacheMultipoll, getCachedMultipollById, getCachedMultipollByShortId,
  invalidateMultipoll,
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
  // Phase 5b: wrapper-level fields (response_deadline, creator_secret,
  // creator_name, is_closed, close_reason, short_id, thread_title,
  // suggestion_deadline) are sourced from the parent Multipoll. The FE
  // consumes them via getMultipollForPoll() / Multipoll-typed props.
  return {
    id: data.id,
    title: data.title,
    poll_type: data.poll_type,
    options: data.options ?? undefined,
    created_at: data.created_at,
    updated_at: data.updated_at,
    multipoll_follow_up_to: data.multipoll_follow_up_to ?? null,
    suggestion_deadline_minutes: data.suggestion_deadline_minutes ?? undefined,
    allow_pre_ranking: data.allow_pre_ranking ?? true,
    details: data.details ?? undefined,
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
    total_votes: data.total_votes,
    yes_percentage: data.yes_percentage ?? undefined,
    no_percentage: data.no_percentage ?? undefined,
    winner: data.winner ?? undefined,
    suggestion_counts: data.suggestion_counts ?? undefined,
    ranked_choice_rounds: data.ranked_choice_rounds ?? undefined,
    ranked_choice_winner: data.ranked_choice_winner ?? undefined,
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
// Phase 5: legacy `apiCreatePoll` (POST /api/polls) is gone — everything goes
// through `apiCreateMultipoll`. Same for the per-poll close/reopen/cutoff/
// thread-title/vote helpers — see the corresponding multipoll-level helpers
// below.

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

/** Resolve an "anchor poll" for a multipoll's short_id. Phase 5b: short_id
 *  lives on the multipoll wrapper, so we fetch the wrapper (warming the
 *  multipoll cache + its sub-polls in the per-poll cache) and return its
 *  first sub-poll. Callers use this to bootstrap thread building, where any
 *  sub-poll of the target multipoll is sufficient. */
export async function apiGetPollByShortId(shortId: string): Promise<Poll> {
  const mp = await apiGetMultipollByShortId(shortId);
  if (!mp.sub_polls.length) {
    throw new ApiError(404, 'Multipoll has no sub-polls');
  }
  return mp.sub_polls[0];
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
    thread_title: data.thread_title ?? null,
    context: data.context ?? null,
    title: data.title,
    created_at: data.created_at,
    updated_at: data.updated_at,
    sub_polls: Array.isArray(data.sub_polls) ? data.sub_polls.map(toPoll) : [],
    voter_names: Array.isArray(data.voter_names) ? data.voter_names : [],
    anonymous_count: typeof data.anonymous_count === 'number' ? data.anonymous_count : 0,
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

// --- Multipoll-level operations (Phase 3) ---
//
// These close/reopen/cutoff the wrapper + every sub-poll atomically. Each
// helper invalidates the multipoll cache (which cascades to every sub-poll)
// and the accessible-polls cache so the next read reflects the mutation.
async function multipollOperation(
  multipollId: string,
  path: 'close' | 'reopen' | 'cutoff-suggestions' | 'cutoff-availability',
  body: Record<string, unknown>,
): Promise<Multipoll> {
  const data = await multipollFetch(`/${encodeURIComponent(multipollId)}/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const multipoll = toMultipoll(data);
  invalidateMultipoll(multipollId);
  cacheMultipoll(multipoll);
  return multipoll;
}

export async function apiCloseMultipoll(
  multipollId: string,
  creatorSecret: string,
  closeReason: string = 'manual',
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'close', {
    creator_secret: creatorSecret,
    close_reason: closeReason,
  });
}

export async function apiReopenMultipoll(
  multipollId: string,
  creatorSecret: string,
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'reopen', { creator_secret: creatorSecret });
}

export async function apiCutoffMultipollSuggestions(
  multipollId: string,
  creatorSecret: string,
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'cutoff-suggestions', { creator_secret: creatorSecret });
}

export async function apiCutoffMultipollAvailability(
  multipollId: string,
  creatorSecret: string,
): Promise<Multipoll> {
  return multipollOperation(multipollId, 'cutoff-availability', { creator_secret: creatorSecret });
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
// Phase 5: per-poll `apiSubmitVote`/`apiEditVote` are gone. Every vote goes
// through `apiSubmitMultipollVotes` defined further down.

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

// --- Poll management ---
// Phase 5: per-poll close/reopen/cutoff/thread-title are gone. Use the
// multipoll-level helpers (apiCloseMultipoll, apiReopenMultipoll,
// apiCutoffMultipollSuggestions, apiCutoffMultipollAvailability,
// apiUpdateMultipollThreadTitle) instead.

/** Update (or clear) a multipoll's thread_title override. Empty string clears it. */
export async function apiUpdateMultipollThreadTitle(multipollId: string, threadTitle: string | null): Promise<Multipoll> {
  const data = await multipollFetch<any>(`/${encodeURIComponent(multipollId)}/thread-title`, {
    method: 'POST',
    body: JSON.stringify({ thread_title: threadTitle }),
  });
  const multipoll = toMultipoll(data);
  invalidateMultipoll(multipollId);
  cacheMultipoll(multipoll);
  return multipoll;
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

// Phase 5b: returns Multipoll[] instead of Poll[]. The multipoll is the unit
// of identity (per the addressability paradigm), so the FE consumes
// wrapper-level fields (response_deadline, is_closed, etc.) from each
// Multipoll directly. cacheMultipoll cascades each sub-poll into the per-poll
// cache so apiGetPollById hits warm cache. Inline `results` on each sub-poll
// are also mirrored into the per-poll results cache so apiGetPollResults
// avoids a late re-fetch.
export async function apiGetAccessiblePolls(pollIds: string[]): Promise<Multipoll[]> {
  if (pollIds.length === 0) return [];
  const data: any[] = await apiFetch('/accessible', {
    method: 'POST',
    body: JSON.stringify({ poll_ids: pollIds, include_results: true }),
  });
  return data.map(d => {
    const multipoll = toMultipoll(d);
    cacheMultipoll(multipoll);
    // Mirror inline per-sub-poll results into the per-poll results cache so
    // apiGetPollResults hits it without a late re-fetch (avoids layout shift
    // when the thread page warms results on viewport intersection).
    for (let i = 0; i < (Array.isArray(d.sub_polls) ? d.sub_polls.length : 0); i++) {
      const subData = d.sub_polls[i];
      if (subData?.results) {
        const results = toPollResults(subData.results);
        cachePollResults(subData.id, results);
        // toPoll() in toMultipoll consumed sub_polls already, but didn't
        // attach results to the Poll — mirror them here so consumers reading
        // multipoll.sub_polls[i].results see them.
        if (multipoll.sub_polls[i]) {
          multipoll.sub_polls[i].results = results;
        }
      }
    }
    return multipoll;
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

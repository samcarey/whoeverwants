/**
 * In-memory poll data cache.
 *
 * The home page fetches all accessible polls on mount. When navigating to a
 * thread or poll page, the same data would otherwise be re-fetched from the
 * API — adding 1-3 seconds of latency. This cache stores poll data in memory
 * so subsequent navigations can resolve instantly without waiting for the
 * network.
 *
 * Cache entries expire after CACHE_TTL_MS (60s for polls, 15s for frequently
 * changing results/votes). Any mutation (vote, close, reopen) should call
 * invalidatePoll() to remove stale entries.
 *
 * All maps are capped at MAX_ENTRIES (100) with simple LRU eviction — on
 * insert, if the map is full, the oldest entry is dropped. This bounds memory
 * for long-lived PWA sessions with many polls.
 */

import type { Multipoll, Poll, PollResults } from './types';
import type { ApiVote, ApiRankedChoiceRound } from './api';

const CACHE_TTL_MS = 60_000;
const RESULTS_TTL_MS = 15_000; // Results change more often — shorter TTL.
const MAX_ENTRIES = 100;

type Participant = { vote_id: string; voter_name: string | null };

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

type PollCache = CacheEntry<Poll>;
type ResultsValue = PollResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string };

// Keyed by poll.id AND poll.short_id for O(1) lookup by either.
const cacheById = new Map<string, PollCache>();
const cacheByShortId = new Map<string, PollCache>();

// Cached result of getAccessiblePolls
let accessiblePollsCache: CacheEntry<Poll[]> | null = null;

// Per-poll results, votes, participants caches
const resultsCache = new Map<string, CacheEntry<ResultsValue>>();
const votesCache = new Map<string, CacheEntry<ApiVote[]>>();
const participantsCache = new Map<string, CacheEntry<Participant[]>>();

// Multipoll wrapper cache. Sub-polls inside a Multipoll are also written to
// the per-poll cache via cachePolls(), so apiGetPollById hits warm cache after
// a multipoll fetch. See docs/multipoll-phasing.md (Phase 2.1).
const multipollById = new Map<string, CacheEntry<Multipoll>>();
const multipollByShortId = new Map<string, CacheEntry<Multipoll>>();

function isValid(entry: CacheEntry<unknown>, ttl = CACHE_TTL_MS): boolean {
  return Date.now() - entry.storedAt < ttl;
}

/** Insert with LRU eviction. Map iteration order is insertion order, so the
 *  first key is the oldest. Re-inserting an existing key moves it to the end. */
function setLru<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (map.has(key)) map.delete(key);
  else if (map.size >= MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { value, storedAt: Date.now() });
}

/** Store a single poll in the cache. */
export function cachePoll(poll: Poll): void {
  setLru(cacheById, poll.id, poll);
  if (poll.short_id) {
    setLru(cacheByShortId, poll.short_id, poll);
  }
}

/** Store multiple polls (e.g., from getAccessiblePolls). */
export function cachePolls(polls: Poll[]): void {
  for (const poll of polls) cachePoll(poll);
}

/** Store the full accessible polls list. */
export function cacheAccessiblePolls(polls: Poll[]): void {
  accessiblePollsCache = { value: polls, storedAt: Date.now() };
  cachePolls(polls);
}

/** Get a poll by ID if cached and fresh. */
export function getCachedPollById(id: string): Poll | null {
  const entry = cacheById.get(id);
  return entry && isValid(entry) ? entry.value : null;
}

/** Get a poll by short ID if cached and fresh. */
export function getCachedPollByShortId(shortId: string): Poll | null {
  const entry = cacheByShortId.get(shortId);
  return entry && isValid(entry) ? entry.value : null;
}

/** Get the cached accessible polls list if fresh. */
export function getCachedAccessiblePolls(): Poll[] | null {
  return accessiblePollsCache && isValid(accessiblePollsCache) ? accessiblePollsCache.value : null;
}

/** Cache poll results. */
export function cachePollResults(pollId: string, results: ResultsValue): void {
  setLru(resultsCache, pollId, results);
}

/** Get cached poll results if fresh. */
export function getCachedPollResults(pollId: string): ResultsValue | null {
  const entry = resultsCache.get(pollId);
  return entry && isValid(entry, RESULTS_TTL_MS) ? entry.value : null;
}

/** Cache votes for a poll. */
export function cacheVotes(pollId: string, votes: ApiVote[]): void {
  setLru(votesCache, pollId, votes);
}

/** Get cached votes if fresh. */
export function getCachedVotes(pollId: string): ApiVote[] | null {
  const entry = votesCache.get(pollId);
  return entry && isValid(entry, RESULTS_TTL_MS) ? entry.value : null;
}

/** Cache participants for a poll. */
export function cacheParticipants(pollId: string, participants: Participant[]): void {
  setLru(participantsCache, pollId, participants);
}

/** Get cached participants if fresh. */
export function getCachedParticipants(pollId: string): Participant[] | null {
  const entry = participantsCache.get(pollId);
  return entry && isValid(entry, RESULTS_TTL_MS) ? entry.value : null;
}

/** Invalidate a single poll (call after mutations). */
export function invalidatePoll(id: string): void {
  const entry = cacheById.get(id);
  if (entry) {
    cacheById.delete(id);
    if (entry.value.short_id) cacheByShortId.delete(entry.value.short_id);
  }
  resultsCache.delete(id);
  votesCache.delete(id);
  participantsCache.delete(id);
  accessiblePollsCache = null;
}

/** Invalidate the accessible polls list (e.g., after discovering new polls). */
export function invalidateAccessiblePolls(): void {
  accessiblePollsCache = null;
}

/** Cache a multipoll wrapper plus its sub-polls (sub-polls go into pollCache). */
export function cacheMultipoll(multipoll: Multipoll): void {
  setLru(multipollById, multipoll.id, multipoll);
  if (multipoll.short_id) {
    setLru(multipollByShortId, multipoll.short_id, multipoll);
  }
  cachePolls(multipoll.sub_polls);
}

export function getCachedMultipollById(id: string): Multipoll | null {
  const entry = multipollById.get(id);
  return entry && isValid(entry) ? entry.value : null;
}

export function getCachedMultipollByShortId(shortId: string): Multipoll | null {
  const entry = multipollByShortId.get(shortId);
  return entry && isValid(entry) ? entry.value : null;
}

/** Invalidate a multipoll wrapper plus all its sub-polls. */
export function invalidateMultipoll(id: string): void {
  const entry = multipollById.get(id);
  if (entry) {
    multipollById.delete(id);
    if (entry.value.short_id) multipollByShortId.delete(entry.value.short_id);
    for (const sub of entry.value.sub_polls) invalidatePoll(sub.id);
  }
  accessiblePollsCache = null;
}

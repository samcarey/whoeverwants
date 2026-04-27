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
 *
 * Phase 5b: short_id is a wrapper-level concept — we no longer maintain a
 * per-poll short_id index. `getCachedPollByShortId` resolves the multipoll
 * cache and returns its first sub-poll. Sub-poll lookup by short_id is
 * unambiguous because every multipoll's short_id maps to exactly one wrapper,
 * and the FE only needs an "anchor poll" for thread building.
 */

import type { Multipoll, Poll, PollResults } from './types';
import type { ApiVote, ApiRankedChoiceRound } from './api';

const CACHE_TTL_MS = 60_000;
const RESULTS_TTL_MS = 15_000; // Results change more often — shorter TTL.
const MAX_ENTRIES = 100;

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

type PollCache = CacheEntry<Poll>;
type ResultsValue = PollResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string };

const cacheById = new Map<string, PollCache>();

// Cached result of getAccessibleMultipolls. Phase 5b: the wrapper is the
// unit of identity, so accessibility is keyed on the multipoll wrappers
// rather than the flat Poll[] list.
let accessibleMultipollsCache: CacheEntry<Multipoll[]> | null = null;

// Per-poll results and votes caches
const resultsCache = new Map<string, CacheEntry<ResultsValue>>();
const votesCache = new Map<string, CacheEntry<ApiVote[]>>();

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
}

/** Store multiple polls (e.g., sub-polls from a multipoll fetch). */
export function cachePolls(polls: Poll[]): void {
  for (const poll of polls) cachePoll(poll);
}

/** Store the full accessible multipolls list. Cascades each multipoll into
 *  the multipoll cache (which in turn caches sub-polls in the per-poll cache).
 */
export function cacheAccessibleMultipolls(multipolls: Multipoll[]): void {
  accessibleMultipollsCache = { value: multipolls, storedAt: Date.now() };
  for (const mp of multipolls) cacheMultipoll(mp);
}

/** Get a poll by ID if cached and fresh. */
export function getCachedPollById(id: string): Poll | null {
  const entry = cacheById.get(id);
  return entry && isValid(entry) ? entry.value : null;
}

/** Get a poll by short ID if cached and fresh. Resolves through the multipoll
 *  cache and returns the wrapper's first sub-poll (sub-polls are sorted by
 *  sub_poll_index in cacheMultipoll). */
export function getCachedPollByShortId(shortId: string): Poll | null {
  const mp = getCachedMultipollByShortId(shortId);
  return mp?.sub_polls[0] ?? null;
}

/** Get the cached accessible multipolls list if fresh. */
export function getCachedAccessibleMultipolls(): Multipoll[] | null {
  return accessibleMultipollsCache && isValid(accessibleMultipollsCache)
    ? accessibleMultipollsCache.value
    : null;
}

/** Flat sub-polls accessor for callsites that just need every accessible poll
 *  (e.g. the prefetcher). Returns null when the multipoll cache is cold. */
export function getCachedAccessiblePolls(): Poll[] | null {
  const wrappers = getCachedAccessibleMultipolls();
  if (!wrappers) return null;
  const polls: Poll[] = [];
  for (const mp of wrappers) for (const sp of mp.sub_polls) polls.push(sp);
  return polls;
}

/** Resolve a poll's parent multipoll wrapper from the cache, or null on
 *  cache miss. Callers needing wrapper-level fields (is_closed,
 *  response_deadline, etc.) consume this to source those fields per the
 *  addressability paradigm. */
export function getMultipollForPoll(poll: Poll): Multipoll | null {
  if (!poll.multipoll_id) return null;
  return getCachedMultipollById(poll.multipoll_id);
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

/** Invalidate a single poll (call after mutations). */
export function invalidatePoll(id: string): void {
  cacheById.delete(id);
  resultsCache.delete(id);
  votesCache.delete(id);
  accessibleMultipollsCache = null;
}

/** Invalidate the accessible polls list (e.g., after discovering new polls). */
export function invalidateAccessiblePolls(): void {
  accessibleMultipollsCache = null;
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
  accessibleMultipollsCache = null;
}

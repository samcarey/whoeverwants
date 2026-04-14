/**
 * In-memory poll data cache.
 *
 * The home page fetches all accessible polls on mount. When navigating to a
 * thread or poll page, the same data is re-fetched from the API — adding
 * 1-3 seconds of latency. This cache stores poll data in memory so subsequent
 * navigations can resolve instantly without waiting for the network.
 *
 * Cache entries expire after CACHE_TTL_MS (60 seconds). Any mutation
 * (vote, close, reopen) should call invalidatePoll() to remove stale entries.
 */

import type { Poll, PollResults } from './types';
import type { ApiVote } from './api';

const CACHE_TTL_MS = 60_000;
const RESULTS_TTL_MS = 15_000; // Results change more often — shorter TTL.

interface CacheEntry {
  poll: Poll;
  storedAt: number;
}

interface ResultsEntry {
  results: PollResults & { ranked_choice_rounds?: unknown; ranked_choice_winner?: string };
  storedAt: number;
}

interface VotesEntry {
  votes: ApiVote[];
  storedAt: number;
}

// Keyed by poll.id AND poll.short_id for O(1) lookup by either.
const cacheById = new Map<string, CacheEntry>();
const cacheByShortId = new Map<string, CacheEntry>();

// Cached result of getAccessiblePolls
let accessiblePollsCache: { polls: Poll[]; storedAt: number } | null = null;

// Per-poll results, votes, participants caches
const resultsCache = new Map<string, ResultsEntry>();
const votesCache = new Map<string, VotesEntry>();
const participantsCache = new Map<string, { participants: unknown[]; storedAt: number }>();

function isValid(entry: { storedAt: number }, ttl = CACHE_TTL_MS): boolean {
  return Date.now() - entry.storedAt < ttl;
}

/** Store a single poll in the cache. */
export function cachePoll(poll: Poll): void {
  const entry: CacheEntry = { poll, storedAt: Date.now() };
  cacheById.set(poll.id, entry);
  if (poll.short_id) {
    cacheByShortId.set(poll.short_id, entry);
  }
}

/** Store multiple polls (e.g., from getAccessiblePolls). */
export function cachePolls(polls: Poll[]): void {
  for (const poll of polls) {
    cachePoll(poll);
  }
}

/** Store the full accessible polls list. */
export function cacheAccessiblePolls(polls: Poll[]): void {
  accessiblePollsCache = { polls, storedAt: Date.now() };
  cachePolls(polls);
}

/** Get a poll by ID if cached and fresh. */
export function getCachedPollById(id: string): Poll | null {
  const entry = cacheById.get(id);
  if (entry && isValid(entry)) return entry.poll;
  return null;
}

/** Get a poll by short ID if cached and fresh. */
export function getCachedPollByShortId(shortId: string): Poll | null {
  const entry = cacheByShortId.get(shortId);
  if (entry && isValid(entry)) return entry.poll;
  return null;
}

/** Get the cached accessible polls list if fresh. */
export function getCachedAccessiblePolls(): Poll[] | null {
  if (accessiblePollsCache && isValid(accessiblePollsCache)) {
    return accessiblePollsCache.polls;
  }
  return null;
}

/** Cache poll results. */
export function cachePollResults(pollId: string, results: ResultsEntry['results']): void {
  resultsCache.set(pollId, { results, storedAt: Date.now() });
}

/** Get cached poll results if fresh. */
export function getCachedPollResults(pollId: string): ResultsEntry['results'] | null {
  const entry = resultsCache.get(pollId);
  if (entry && isValid(entry, RESULTS_TTL_MS)) return entry.results;
  return null;
}

/** Cache votes for a poll. */
export function cacheVotes(pollId: string, votes: ApiVote[]): void {
  votesCache.set(pollId, { votes, storedAt: Date.now() });
}

/** Get cached votes if fresh. */
export function getCachedVotes(pollId: string): ApiVote[] | null {
  const entry = votesCache.get(pollId);
  if (entry && isValid(entry, RESULTS_TTL_MS)) return entry.votes;
  return null;
}

/** Cache participants for a poll. */
export function cacheParticipants(pollId: string, participants: unknown[]): void {
  participantsCache.set(pollId, { participants, storedAt: Date.now() });
}

/** Get cached participants if fresh. */
export function getCachedParticipants(pollId: string): unknown[] | null {
  const entry = participantsCache.get(pollId);
  if (entry && isValid(entry, RESULTS_TTL_MS)) return entry.participants;
  return null;
}

/** Invalidate a single poll (call after mutations). */
export function invalidatePoll(id: string): void {
  const entry = cacheById.get(id);
  if (entry) {
    cacheById.delete(id);
    if (entry.poll.short_id) {
      cacheByShortId.delete(entry.poll.short_id);
    }
  }
  resultsCache.delete(id);
  votesCache.delete(id);
  participantsCache.delete(id);
  // Also invalidate the accessible polls list since it may contain stale data
  accessiblePollsCache = null;
}

/** Invalidate the accessible polls list (e.g., after discovering new polls). */
export function invalidateAccessiblePolls(): void {
  accessiblePollsCache = null;
}

/**
 * In-memory question data cache.
 *
 * The home page fetches all accessible questions on mount. When navigating to a
 * group or question page, the same data would otherwise be re-fetched from the
 * API — adding 1-3 seconds of latency. This cache stores question data in memory
 * so subsequent navigations can resolve instantly without waiting for the
 * network.
 *
 * Cache entries expire after CACHE_TTL_MS (60s for questions, 15s for frequently
 * changing results/votes). Any mutation (vote, close, reopen) should call
 * invalidateQuestion() to remove stale entries.
 *
 * All maps are capped at MAX_ENTRIES (100) with simple LRU eviction — on
 * insert, if the map is full, the oldest entry is dropped. This bounds memory
 * for long-lived PWA sessions with many questions.
 *
 * Phase 5b: short_id is a wrapper-level concept — we no longer maintain a
 * per-question short_id index. `getCachedQuestionByShortId` resolves the poll
 * cache and returns its first question. Sub-question lookup by short_id is
 * unambiguous because every poll's short_id maps to exactly one wrapper,
 * and the FE only needs an "anchor question" for group building.
 */

import type { GroupSummary, Poll, Question, QuestionResults } from './types';
import type { ApiVote, ApiRankedChoiceRound } from './api';
import { isUuidLike } from './questionId';

const CACHE_TTL_MS = 60_000;
const RESULTS_TTL_MS = 15_000; // Results change more often — shorter TTL.
const MAX_ENTRIES = 100;

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

type QuestionCache = CacheEntry<Question>;
type ResultsValue = QuestionResults & { ranked_choice_rounds?: ApiRankedChoiceRound[]; ranked_choice_winner?: string };

const cacheById = new Map<string, QuestionCache>();

// Cached result of getAccessiblePolls. Phase 5b: the wrapper is the
// unit of identity, so accessibility is keyed on the poll wrappers
// rather than the flat Question[] list.
let accessiblePollsCache: CacheEntry<Poll[]> | null = null;

// Per-question results and votes caches
const resultsCache = new Map<string, CacheEntry<ResultsValue>>();
const votesCache = new Map<string, CacheEntry<ApiVote[]>>();

// Poll wrapper cache. Sub-questions inside a Poll are also written to
// the per-question cache via cacheQuestions(), so apiGetQuestionById hits warm cache after
// a poll fetch. See docs/poll-phasing.md (Phase 2.1).
const pollById = new Map<string, CacheEntry<Poll>>();
const pollByShortId = new Map<string, CacheEntry<Poll>>();

// Group summary cache. Keyed by both `groups.id` and `groups.short_id` so
// that route-id lookups in either form resolve. Used by the home new group button
// path: `apiCreateGroup` caches the just-minted summary so the destination
// route's synchronous cache-read paths can build an empty `Group` on first
// render — avoiding the loading-spinner flash between the slide-overlay
// unmount and the async fetch resolving.
const groupSummaryById = new Map<string, CacheEntry<GroupSummary>>();
const groupSummaryByShortId = new Map<string, CacheEntry<GroupSummary>>();

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

/** Store a single question in the cache. */
export function cacheQuestion(question: Question): void {
  setLru(cacheById, question.id, question);
}

/** Store multiple questions (e.g., questions from a poll fetch). */
export function cacheQuestions(questions: Question[]): void {
  for (const question of questions) cacheQuestion(question);
}

/** Store the full accessible polls list. Cascades each poll into
 *  the poll cache (which in turn caches questions in the per-question cache).
 */
export function cacheAccessiblePolls(polls: Poll[]): void {
  accessiblePollsCache = { value: polls, storedAt: Date.now() };
  for (const mp of polls) cachePoll(mp);
}

/** Update the accessible-polls cache only when it's already fresh.
 *  Skipping the write on a stale/null cache prevents callers like the
 *  create-poll submit handler from inadvertently overwriting the cache to
 *  contain only their just-cached poll — `[...getCached() ?? [], newPoll]`
 *  collapses to `[newPoll]` when the cache has expired, dropping every other
 *  poll from the accessible list. */
export function updateAccessiblePollsIfFresh(merge: (existing: Poll[]) => Poll[]): void {
  const cached = getCachedAccessiblePolls();
  if (cached) cacheAccessiblePolls(merge(cached));
}

/** Get a question by ID if cached and fresh. */
export function getCachedQuestionById(id: string): Question | null {
  const entry = cacheById.get(id);
  return entry && isValid(entry) ? entry.value : null;
}

/** Get a question by short ID if cached and fresh. Resolves through the poll
 *  cache and returns the wrapper's first question (questions are sorted by
 *  question_index in cachePoll). */
export function getCachedQuestionByShortId(shortId: string): Question | null {
  const mp = getCachedPollByShortId(shortId);
  return mp?.questions[0] ?? null;
}

/** Get the cached accessible polls list if fresh. */
export function getCachedAccessiblePolls(): Poll[] | null {
  return accessiblePollsCache && isValid(accessiblePollsCache)
    ? accessiblePollsCache.value
    : null;
}

/** Flat questions accessor for callsites that just need every accessible question
 *  (e.g. the prefetcher). Returns null when the poll cache is cold. */
export function getCachedAccessibleQuestions(): Question[] | null {
  const wrappers = getCachedAccessiblePolls();
  if (!wrappers) return null;
  const questions: Question[] = [];
  for (const mp of wrappers) for (const sp of mp.questions) questions.push(sp);
  return questions;
}

/** Resolve a question's parent poll wrapper from the cache, or null on
 *  cache miss. Callers needing wrapper-level fields (is_closed,
 *  response_deadline, etc.) consume this to source those fields per the
 *  addressability paradigm. */
export function getPollForQuestion(question: Question): Poll | null {
  if (!question.poll_id) return null;
  return getCachedPollById(question.poll_id);
}

/** Resolve a question id to its group_id via the in-memory caches.
 *  Returns null if the question or its poll isn't cached. Used by flows
 *  that receive a question id as input but need to reference the group
 *  (e.g. the create-poll duplicate / vote-on-it / FollowUpButton paths
 *  post Migration 105). */
export function getCachedGroupIdForQuestion(questionId: string): string | null {
  const accessible = getCachedAccessiblePolls() ?? [];
  const cachedQuestion = getCachedQuestionById(questionId);
  if (cachedQuestion?.poll_id) {
    const mp = accessible.find(p => p.id === cachedQuestion.poll_id);
    if (mp?.group_id) return mp.group_id;
  }
  const mp = accessible.find(p => p.questions.some(q => q.id === questionId));
  return mp?.group_id ?? null;
}

/** Cache question results. */
export function cacheQuestionResults(questionId: string, results: ResultsValue): void {
  setLru(resultsCache, questionId, results);
}

/** Get cached question results if fresh. */
export function getCachedQuestionResults(questionId: string): ResultsValue | null {
  const entry = resultsCache.get(questionId);
  return entry && isValid(entry, RESULTS_TTL_MS) ? entry.value : null;
}

/** Cache votes for a question. */
export function cacheVotes(questionId: string, votes: ApiVote[]): void {
  setLru(votesCache, questionId, votes);
}

/** Get cached votes if fresh. */
export function getCachedVotes(questionId: string): ApiVote[] | null {
  const entry = votesCache.get(questionId);
  return entry && isValid(entry, RESULTS_TTL_MS) ? entry.value : null;
}

/** Evict a single question's per-entity caches (entry, results, votes).
 *
 *  FIELD-LEVEL invalidation only — does NOT touch `accessiblePollsCache`.
 *  The accessible-polls list is the "which polls/questions exist in which
 *  group" shape, which a vote / close / reopen / cutoff / edit cannot
 *  change. Its embedded fields may go briefly stale; the 5s group-page
 *  refresh + the per-question results/votes refetch correct them within
 *  seconds, and the cache's 60s TTL bounds worst-case staleness.
 *
 *  If your mutation REMOVES the question (or its containing poll) from
 *  the group's list — i.e. forget, leave-group, failed-create
 *  placeholder cleanup — ALSO call `invalidateAccessibleQuestions()`.
 *  Without that call, `buildGroupSyncFromCache` will keep rebuilding the
 *  group with the dead entry until the TTL expires. */
export function invalidateQuestion(id: string): void {
  cacheById.delete(id);
  resultsCache.delete(id);
  votesCache.delete(id);
}

/** Drop the accessible-polls list ("which polls exist") cache.
 *
 *  SHAPE-LEVEL invalidation. Call when a poll is added/removed from the
 *  user's accessible set — forget, leave-group, discovery, failed
 *  optimistic create. Field changes (votes, results, deadlines) use
 *  `invalidateQuestion` / `invalidatePoll` and leave this cache alone;
 *  see the invariant in those helpers' doc comments. */
export function invalidateAccessibleQuestions(): void {
  accessiblePollsCache = null;
}

/** Cache a poll wrapper plus its questions (questions go into questionCache). */
export function cachePoll(poll: Poll): void {
  setLru(pollById, poll.id, poll);
  if (poll.short_id) {
    setLru(pollByShortId, poll.short_id, poll);
  }
  cacheQuestions(poll.questions);
}

export function getCachedPollById(id: string): Poll | null {
  const entry = pollById.get(id);
  return entry && isValid(entry) ? entry.value : null;
}

export function getCachedPollByShortId(shortId: string): Poll | null {
  const entry = pollByShortId.get(shortId);
  return entry && isValid(entry) ? entry.value : null;
}

/** Resolve an ambiguous id (poll uuid, poll short_id, OR question uuid) to
 *  a cached Poll. Used by legacy `/p/<id>` redirects and the legacy
 *  `?id=<question-uuid>` deep-link to translate any old URL form into a
 *  concrete poll without an API round-trip. Returns null on miss. */
export function getCachedPollForShortId(id: string): Poll | null {
  if (isUuidLike(id)) {
    const byPollId = getCachedPollById(id);
    if (byPollId) return byPollId;
    const cachedQuestion = getCachedQuestionById(id);
    return cachedQuestion?.poll_id ? getCachedPollById(cachedQuestion.poll_id) : null;
  }
  return getCachedPollByShortId(id);
}

/** Evict a poll wrapper plus its questions from the per-entity caches.
 *
 *  FIELD-LEVEL invalidation — see `invalidateQuestion` for the invariant.
 *  Does NOT touch `accessiblePollsCache`; field changes (votes, close,
 *  reopen, cutoff, edit) leave the group's shape intact. Pair with
 *  `invalidateAccessibleQuestions()` only when this operation also
 *  removes the poll from the user's accessible list. */
export function invalidatePoll(id: string): void {
  const entry = pollById.get(id);
  if (entry) {
    pollById.delete(id);
    if (entry.value.short_id) pollByShortId.delete(entry.value.short_id);
    for (const sub of entry.value.questions) invalidateQuestion(sub.id);
  }
}

/** Cache a group summary under both id and short_id (when set). */
export function cacheGroupSummary(summary: GroupSummary): void {
  setLru(groupSummaryById, summary.id, summary);
  if (summary.short_id) setLru(groupSummaryByShortId, summary.short_id, summary);
}

/** Resolve a route id (`groups.short_id` or `groups.id`) to a cached
 *  `GroupSummary`. Returns null on cache miss or expiration. */
export function getCachedGroupSummary(routeId: string): GroupSummary | null {
  const map = isUuidLike(routeId) ? groupSummaryById : groupSummaryByShortId;
  const entry = map.get(routeId);
  return entry && isValid(entry) ? entry.value : null;
}

/** Drop a group summary from the cache (by group id). */
export function invalidateGroupSummary(groupId: string): void {
  const entry = groupSummaryById.get(groupId);
  if (entry) {
    groupSummaryById.delete(groupId);
    if (entry.value.short_id) groupSummaryByShortId.delete(entry.value.short_id);
  }
}

/**
 * Thread grouping utilities for the messaging-style UI.
 *
 * A "thread" is a chain of polls linked by `polls.follow_up_to`.
 * Sub-questions of one poll are siblings inside the chain. Single-poll
 * threads (one wrapper, no parent or children) render as one card group.
 *
 * Phase 5b: this module consumes `Poll[]` as the primary input —
 * wrapper-level fields (response_deadline, is_closed, creator_name, ...) live
 * on each Poll. Sub-question-level fields (question_type, voter_names, ...)
 * still live on each `Question` inside `poll.questions`. Chain walking uses
 * `Poll.follow_up_to` (a poll_id, or null for thread roots).
 */

import type { Poll, Question } from './types';
import {
  getCachedQuestionById,
  getCachedAccessiblePolls,
  getCachedPollByShortId,
} from './questionCache';
import { isUuidLike } from './questionId';

/** Query-param key on `/t/<thread>` URLs that names a specific poll the page
 *  should expand and scroll to. Absent → no auto-expand, page scrolls to
 *  bottom (the draft form area). Replaced the old `?thread=1` /
 *  `suppressExpand` heuristic — the URL itself now encodes whether to expand
 *  any poll, with no client-side guessing. */
export const POLL_QUERY_PARAM = 'p';

/** True when `id` is a placeholder poll id synthesized by
 *  `synthesizePlaceholderPoll` (e.g. `pending-mosw8mkj-pp6476`). Their question
 *  ids (`<pollId>-q0`) aren't valid UUIDs, so per-question API calls 500 if
 *  fired against them — gate fetch sites with this check. */
export function isPendingPollId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('pending-');
}

/** Build a poll_id → Poll lookup Map. The first occurrence per
 *  poll wins, so callers can prepend a known-current wrapper to override
 *  an entry already in the cache. */
export function buildPollMap(polls: Iterable<Poll>): Map<string, Poll> {
  const map = new Map<string, Poll>();
  for (const mp of polls) {
    if (!map.has(mp.id)) map.set(mp.id, mp);
  }
  return map;
}

/** Pick the chain root of a thread from a list of its polls. Prefers the
 *  poll with no `follow_up_to`; falls back to the first poll when the
 *  true root is hidden by Phase C.3 visibility filtering. Returns null
 *  for empty input. */
export function findChainRoot(polls: Poll[]): Poll | null {
  if (polls.length === 0) return null;
  return polls.find(mp => !mp.follow_up_to) ?? polls[0];
}

export interface Thread {
  /** ID of the root question (first question of the chain's earliest poll). */
  rootQuestionId: string;
  /** ID of the root poll (chain's earliest wrapper). */
  rootPollId: string;
  /** Polls in the thread, sorted chronologically (oldest first). */
  polls: Poll[];
  /** Flat questions list in chronological + question_index order — kept for
   *  callsites that iterate every ballot card. */
  questions: Question[];
  /** Deduplicated participant names across the thread (creator + voters). */
  participantNames: string[];
  /** Display title: latestPoll.thread_title override if set, otherwise
   *  the comma-separated participant-names default. */
  title: string;
  /** The participant-names default (no thread_title override applied). */
  defaultTitle: string;
  /** Number of unvoted polls in the thread (one count per wrapper, since
   *  poll-level open/closed determines whether voting is possible). */
  unvotedCount: number;
  /** Earliest deadline among unvoted open polls (undefined if none). */
  soonestUnvotedDeadline?: string;
  /** Pre-computed ms timestamp of soonestUnvotedDeadline for sorting. */
  soonestUnvotedDeadlineMs?: number;
  /** Pre-computed ms timestamp of latest poll created_at for sorting. */
  latestActivityMs: number;
  /** The latest question in the thread (most recently created). */
  latestQuestion: Question;
  /** The latest poll in the thread (kept for callsites that need
   *  wrapper-level fields like is_closed / response_deadline). */
  latestPoll: Poll;
  /** The poll the thread URL should target — oldest open poll with at least
   *  one not-yet-responded question (matches the per-question gold-outline
   *  rule), falling back to the newest poll when nothing is awaiting. */
  targetedPoll: Poll;
  /** Estimated count of anonymous respondents (max across polls). */
  anonymousRespondentCount: number;
}

/** True iff the poll wrapper is open: not manually closed AND no
 *  response_deadline has passed. */
export function isPollOpen(poll: Poll, now: Date = new Date()): boolean {
  if (poll.is_closed) return false;
  if (!poll.response_deadline) return true;
  return new Date(poll.response_deadline) > now;
}

/** True iff the poll is open AND at least one of its sub-questions is
 *  un-responded by the viewer — the poll-level analogue of the per-question
 *  gold-outline rule. */
export function pollHasAwaitingQuestion(
  poll: Poll,
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
  now: Date = new Date(),
): boolean {
  if (!isPollOpen(poll, now)) return false;
  return poll.questions.some(
    sp => !votedQuestionIds.has(sp.id) && !abstainedQuestionIds.has(sp.id),
  );
}

/**
 * Pick the poll a thread's URL should target. Mirrors the per-question
 * gold-outline rule (open poll + at least one question the user hasn't
 * voted on or abstained from). Among those, picks the oldest by
 * created_at so the user lands on the question that's been waiting longest.
 * Falls back to the newest poll in the thread when nothing is awaiting.
 */
function pickTargetedPoll(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
  now: Date,
): Poll {
  let oldestAwaiting: Poll | null = null;
  let oldestAwaitingMs = Infinity;
  let newest: Poll = polls[0];
  let newestMs = -Infinity;
  for (const mp of polls) {
    const createdMs = new Date(mp.created_at).getTime();
    if (createdMs > newestMs) {
      newestMs = createdMs;
      newest = mp;
    }
    if (!pollHasAwaitingQuestion(mp, votedQuestionIds, abstainedQuestionIds, now)) continue;
    if (createdMs < oldestAwaitingMs) {
      oldestAwaitingMs = createdMs;
      oldestAwaiting = mp;
    }
  }
  return oldestAwaiting ?? newest;
}

/**
 * Build index maps and collect descendants via BFS from a set of start
 * poll ids. Shared by buildThreads (multiple roots) and
 * buildThreadFromPollDown (single anchor).
 *
 * Chain edges are poll-to-poll. Walking visits both directions:
 * every poll listed in any visited poll's `follow_up_to` chain
 * (ancestors) AND every child whose `follow_up_to` points at the current.
 */
function collectDescendants(
  startIds: string[],
  pollById: Map<string, Poll>,
  childrenByParentPoll: Map<string, string[]>,
  visited: Set<string>,
): Poll[] {
  const collected: Poll[] = [];
  const queue = [...startIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const mp = pollById.get(current);
    if (!mp) continue;
    collected.push(mp);

    // Children: any poll whose follow_up_to == current.
    for (const childId of childrenByParentPoll.get(mp.id) ?? []) {
      if (!visited.has(childId)) queue.push(childId);
    }
    // Ancestor: this poll's follow_up_to.
    if (mp.follow_up_to && !visited.has(mp.follow_up_to)) {
      queue.push(mp.follow_up_to);
    }
  }
  // Sort purely by creation date, oldest first (newest at the bottom).
  collected.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return collected;
}

/** Build poll_id → Poll + parent → children maps from a flat list. */
function buildPollMaps(polls: Poll[]): {
  pollById: Map<string, Poll>;
  childrenByParentPoll: Map<string, string[]>;
} {
  const pollById = new Map<string, Poll>();
  for (const mp of polls) pollById.set(mp.id, mp);

  const childrenByParentPoll = new Map<string, string[]>();
  for (const mp of polls) {
    if (!mp.follow_up_to) continue;
    const list = childrenByParentPoll.get(mp.follow_up_to) ?? [];
    list.push(mp.id);
    childrenByParentPoll.set(mp.follow_up_to, list);
  }
  return { pollById, childrenByParentPoll };
}

/**
 * Build threads from a flat list of polls. Each thread is a chain of
 * polls connected via `follow_up_to`.
 */
export function buildThreads(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
): Thread[] {
  const { pollById, childrenByParentPoll } = buildPollMaps(polls);

  // Find root polls: those with no follow_up_to OR whose follow_up_to
  // target is a poll we don't have access to.
  const roots = polls.filter(mp => !mp.follow_up_to || !pollById.has(mp.follow_up_to));

  const visited = new Set<string>();
  const threads: Thread[] = [];

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const threadPolls = collectDescendants(
      [root.id],
      pollById,
      childrenByParentPoll,
      visited,
    );
    threads.push(buildThreadFromPolls(threadPolls, votedQuestionIds, abstainedQuestionIds));
  }

  // Safety net for orphaned polls (e.g. a child whose parent fell out of
  // the accessible set).
  for (const mp of polls) {
    if (!visited.has(mp.id)) {
      threads.push(buildThreadFromPolls([mp], votedQuestionIds, abstainedQuestionIds));
    }
  }

  return sortThreads(threads);
}

function buildThreadFromPolls(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
): Thread {
  // Sub-questions flatten in (poll chronological, question_index) order.
  const questions: Question[] = [];
  for (const mp of polls) {
    const sorted = [...mp.questions].sort(
      (a, b) => (a.question_index ?? 0) - (b.question_index ?? 0),
    );
    for (const sp of sorted) questions.push(sp);
  }

  // Collect participant names from each poll's wrapper-level
  // creator_name + voter_names aggregate.
  const nameSet = new Set<string>();
  for (const mp of polls) {
    if (mp.creator_name) nameSet.add(mp.creator_name);
    for (const name of mp.voter_names) nameSet.add(name);
  }
  const participantNames = Array.from(nameSet).sort();

  // Default title uses participant names; override comes from the latest
  // poll's thread_title.
  const defaultTitle = participantNames.length > 0
    ? participantNames.join(', ')
    : 'New Thread';
  const latestPoll = polls[polls.length - 1];
  const latestThreadTitle = latestPoll.thread_title?.trim() ?? null;
  const title = latestThreadTitle || defaultTitle;

  // A poll is "open" iff !is_closed AND (response_deadline absent or in
  // future). Every question inherits this — close/reopen is poll-atomic.
  // We count an unvoted POLL as one toward unvotedCount when the
  // wrapper is open AND the user hasn't responded to ANY of its questions.
  const now = new Date();
  let unvotedCount = 0;
  let soonestUnvotedDeadline: string | undefined;

  for (const mp of polls) {
    const isOpen = mp.response_deadline
      ? new Date(mp.response_deadline) > now && !mp.is_closed
      : !mp.is_closed;
    if (!isOpen) continue;
    const hasRespondedToAnySub = mp.questions.some(
      sp => votedQuestionIds.has(sp.id) || abstainedQuestionIds.has(sp.id),
    );
    if (hasRespondedToAnySub) continue;
    unvotedCount++;
    if (mp.response_deadline) {
      if (!soonestUnvotedDeadline || mp.response_deadline < soonestUnvotedDeadline) {
        soonestUnvotedDeadline = mp.response_deadline;
      }
    }
  }

  // Anonymous respondent count: max across polls (each wrapper's
  // aggregate is the truthful per-poll count).
  const anonymousRespondentCount = polls.reduce(
    (max, mp) => Math.max(max, mp.anonymous_count),
    0,
  );

  // latestActivityMs measures cross-thread "most recent activity" for the
  // home page sort. With pure chronological in-thread ordering this matches
  // polls[polls.length - 1].created_at, but we compute the true max
  // explicitly to stay robust if the in-thread sort ever changes.
  const latestActivityMs = polls.reduce(
    (max, p) => Math.max(max, new Date(p.created_at).getTime()),
    0,
  );

  const targetedPoll = pickTargetedPoll(polls, votedQuestionIds, abstainedQuestionIds, now);

  return {
    rootQuestionId: questions[0].id,
    rootPollId: polls[0].id,
    polls,
    questions,
    participantNames,
    title,
    defaultTitle,
    unvotedCount,
    soonestUnvotedDeadline,
    soonestUnvotedDeadlineMs: soonestUnvotedDeadline
      ? new Date(soonestUnvotedDeadline).getTime()
      : undefined,
    latestActivityMs,
    latestQuestion: questions[questions.length - 1],
    latestPoll,
    targetedPoll,
    anonymousRespondentCount,
  };
}

/**
 * Sort threads:
 * 1. Threads with unvoted open polls first, sorted by soonest deadline
 * 2. Threads without unvoted polls, sorted by most recent activity
 */
function sortThreads(threads: Thread[]): Thread[] {
  return threads.sort((a, b) => {
    if (a.unvotedCount > 0 && b.unvotedCount === 0) return -1;
    if (a.unvotedCount === 0 && b.unvotedCount > 0) return 1;

    if (a.unvotedCount > 0 && b.unvotedCount > 0) {
      const aDeadline = a.soonestUnvotedDeadlineMs ?? Infinity;
      const bDeadline = b.soonestUnvotedDeadlineMs ?? Infinity;
      return aDeadline - bDeadline;
    }

    return b.latestActivityMs - a.latestActivityMs;
  });
}

/** Find the thread containing a specific question ID. */
export function findThreadByQuestionId(threads: Thread[], questionId: string): Thread | undefined {
  return threads.find(t => t.questions.some(p => p.id === questionId));
}

/** Route id for a thread — preferred form is `threads.short_id` (Phase B.4),
 *  with fallbacks to the root poll's short_id (legacy /t/<root-poll-short-id>
 *  URLs) and finally the root question id (synthesized placeholder polls
 *  before the API responds). Used as the path param in `/t/<threadRouteId>`. */
export function getThreadRouteId(thread: Thread): string {
  const rootPoll = thread.polls.find(p => p.id === thread.rootPollId) ?? thread.polls[0];
  return rootPoll?.thread_short_id || rootPoll?.short_id || thread.rootQuestionId;
}

/** Resolve a poll's thread route id (the path param of `/t/<routeId>`).
 *
 *  Phase B.4: every poll returned by the API carries `thread_short_id`, so the
 *  preferred path is a single field read with no cache traversal. The legacy
 *  walk-up-via-`follow_up_to` fallback exists only for synthesized placeholder
 *  polls (created optimistically on submit, pre-API-roundtrip) and any
 *  pre-Phase-B.4 cached poll left in memory across a deploy. */
export function resolveThreadRootRouteId(poll: Poll): string {
  if (poll.thread_short_id) return poll.thread_short_id;
  if (!poll.follow_up_to) return poll.short_id || poll.questions[0]?.id || poll.id;
  const accessible = getCachedAccessiblePolls() ?? [];
  const byPoll = buildPollMap([poll, ...accessible]);
  return findThreadRootRouteId(poll, (mid) => byPoll.get(mid) ?? null);
}

/** Build `/t/<root>?p=<pollShort>` for `poll` inside its thread — the
 *  canonical "navigate to this poll's thread with this poll expanded" URL. */
export function getThreadHrefForPoll(poll: Poll): string {
  const pollShortId = poll.short_id || poll.questions[0]?.id || poll.id;
  const rootRouteId = resolveThreadRootRouteId(poll);
  return `/t/${rootRouteId}?${POLL_QUERY_PARAM}=${pollShortId}`;
}

/** Build the URL for a thread.
 *
 * - `/t/<root>?p=<target>` when the user has awaiting work — the poll is
 *   auto-expanded and scrolled-to on landing.
 * - `/t/<root>` when nothing is awaiting — the page scrolls to bottom (draft
 *   form area), inviting the user to start a new poll.
 *
 * Replaces the old `/p/<target>?thread=1` URL form. */
export function getThreadHref(thread: Thread): string {
  const rootRouteId = getThreadRouteId(thread);
  if (thread.unvotedCount === 0) {
    return `/t/${rootRouteId}`;
  }
  const target = thread.targetedPoll;
  const targetRouteId = target.short_id || target.questions[0]?.id || thread.rootQuestionId;
  return `/t/${rootRouteId}?${POLL_QUERY_PARAM}=${targetRouteId}`;
}

/**
 * Walk up the poll-level follow_up chain starting from `poll` and
 * return the route ID of the furthest ancestor reachable. The chain is
 * poll-to-poll — at each step we follow `follow_up_to` to a parent poll.
 *
 * Phase B.4: a poll's `thread_short_id` (when present) short-circuits the
 * walk entirely — every poll in a thread shares the same thread_short_id,
 * so we don't need to find the root to construct a URL. The walk is kept
 * for placeholder/legacy polls without `thread_short_id`.
 *
 * `pollById` defaults to scanning `getCachedAccessiblePolls()`.
 * Pass a custom resolver when you have a faster lookup at hand.
 */
export function findThreadRootRouteId(
  poll: Poll,
  pollById?: (id: string) => Poll | null | undefined,
): string {
  if (poll.thread_short_id) return poll.thread_short_id;
  const resolve = pollById ?? defaultPollById;
  let root: Poll = poll;
  while (root.follow_up_to) {
    const parent = resolve(root.follow_up_to);
    if (!parent) break;
    root = parent;
  }
  return root.thread_short_id || root.short_id || root.questions[0]?.id || root.id;
}

function defaultPollById(id: string): Poll | null {
  if (typeof window === 'undefined') return null;
  const cached = getCachedAccessiblePolls();
  if (!cached) return null;
  return buildPollMap(cached).get(id) ?? null;
}

/**
 * Build a thread starting from a specific poll (anchor) and collecting
 * all descendants. Used by the thread page to show "this poll + its
 * children" rather than the full ancestor chain.
 */
export function buildThreadFromPollDown(
  anchorPollId: string,
  allPolls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
): Thread | null {
  const { pollById, childrenByParentPoll } = buildPollMaps(allPolls);
  if (!pollById.has(anchorPollId)) return null;

  const collected = collectDescendants(
    [anchorPollId],
    pollById,
    childrenByParentPoll,
    new Set(),
  );
  return buildThreadFromPolls(collected, votedQuestionIds, abstainedQuestionIds);
}

/** Build the thread for a route id synchronously from in-memory caches.
 *  Returns null if any required piece is missing — callers fall through to
 *  their async fetch path.
 *
 *  Phase B.4: routeId can be a `threads.short_id` (preferred form, prefixed
 *  with `~` for fresh threads, or a backfilled root-poll-short-id for
 *  pre-B.4 threads), a polls.short_id (legacy /t/<root-poll-short-id>
 *  fallback), or a UUID (poll/question). The accessible polls cache is
 *  walked once for thread_short_id matches before falling back to the
 *  short-id-keyed cache.
 */
export function buildThreadSyncFromCache(
  threadId: string,
  voted: Set<string>,
  abstained: Set<string>,
): Thread | null {
  if (typeof window === 'undefined') return null;
  const polls = getCachedAccessiblePolls();
  if (!polls) return null;
  let anchorPollId: string | null = null;
  if (isUuidLike(threadId)) {
    // threadId may be a question uuid OR a poll uuid. Try both.
    const direct = polls.find(mp => mp.id === threadId);
    if (direct) {
      anchorPollId = direct.id;
    } else {
      const question = getCachedQuestionById(threadId);
      anchorPollId = question?.poll_id ?? null;
    }
  } else {
    // Phase B.4 preferred path: routeId is a threads.short_id. Threads can
    // contain multiple polls all sharing the same thread_short_id; the
    // chain root is the one with `follow_up_to == null`. Find it directly
    // so buildThreadFromPollDown collects every descendant.
    const matches = polls.filter(mp => mp.thread_short_id === threadId);
    const root = findChainRoot(matches);
    if (root) {
      anchorPollId = root.id;
    } else {
      const mp = getCachedPollByShortId(threadId);
      anchorPollId = mp?.id ?? null;
    }
  }
  if (!anchorPollId) return null;
  return buildThreadFromPollDown(anchorPollId, polls, voted, abstained);
}

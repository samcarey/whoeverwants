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
    const isOpen = mp.response_deadline
      ? new Date(mp.response_deadline) > now && !mp.is_closed
      : !mp.is_closed;
    if (!isOpen) continue;
    const hasAwaiting = mp.questions.some(
      sp => !votedQuestionIds.has(sp.id) && !abstainedQuestionIds.has(sp.id),
    );
    if (!hasAwaiting) continue;
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
  // Closed/expired polls first, non-expired polls after — both groups
  // chronological (oldest first). Result: the most recently submitted
  // non-expired poll is always at the very bottom of the thread, just
  // above the always-present draft poll card.
  // Pre-compute expiry per poll so the sort comparator is O(1) per
  // compare instead of re-parsing response_deadline on every comparison.
  const now = Date.now();
  const expiredById = new Map<string, boolean>();
  for (const mp of collected) {
    expiredById.set(
      mp.id,
      mp.is_closed
        || (!!mp.response_deadline && new Date(mp.response_deadline).getTime() < now),
    );
  }
  collected.sort((a, b) => {
    const aExpired = expiredById.get(a.id) ?? false;
    const bExpired = expiredById.get(b.id) ?? false;
    if (aExpired !== bExpired) return aExpired ? -1 : 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
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
  // home page sort and must reflect the most recent created_at across all
  // polls — not just the post-sort tail. The collectDescendants sort puts
  // closed polls before open polls, so polls[polls.length - 1] is now the
  // most recent OPEN poll (or the most recent closed poll if every poll
  // is closed). Compute the true max separately so a thread whose latest
  // activity was closing a poll today doesn't sink behind a thread whose
  // open poll is older.
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

/** Get the route id for a thread. Targets the oldest open poll with at least
 *  one not-yet-responded question (matches the per-question gold-outline
 *  rule); falls back to the newest poll when nothing is awaiting. */
export function getThreadRouteId(thread: Thread): string {
  const target = thread.targetedPoll;
  return target.short_id || target.questions[0]?.id || thread.rootQuestionId;
}

/**
 * Walk up the poll-level follow_up chain starting from `poll` and
 * return the route ID (short_id or id) of the furthest ancestor reachable.
 * The chain is poll-to-poll — at each step we follow `follow_up_to`
 * to a parent poll.
 *
 * `pollById` defaults to scanning `getCachedAccessiblePolls()`.
 * Pass a custom resolver when you have a faster lookup at hand.
 */
export function findThreadRootRouteId(
  poll: Poll,
  pollById?: (id: string) => Poll | null | undefined,
): string {
  const resolve = pollById ?? defaultPollById;
  let root: Poll = poll;
  while (root.follow_up_to) {
    const parent = resolve(root.follow_up_to);
    if (!parent) break;
    root = parent;
  }
  return root.short_id || root.questions[0]?.id || root.id;
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

/** Build the thread for a route id (UUID or short_id) synchronously from
 *  in-memory caches. Returns null if any required piece is missing — callers
 *  fall through to their async fetch path. */
export function buildThreadSyncFromCache(
  threadId: string,
  voted: Set<string>,
  abstained: Set<string>,
): Thread | null {
  if (typeof window === 'undefined') return null;
  let anchorPollId: string | null = null;
  if (isUuidLike(threadId)) {
    // threadId may be a question uuid OR a poll uuid. Try both.
    const polls = getCachedAccessiblePolls() ?? [];
    const direct = polls.find(mp => mp.id === threadId);
    if (direct) {
      anchorPollId = direct.id;
    } else {
      const question = getCachedQuestionById(threadId);
      anchorPollId = question?.poll_id ?? null;
    }
  } else {
    const mp = getCachedPollByShortId(threadId);
    anchorPollId = mp?.id ?? null;
  }
  if (!anchorPollId) return null;
  const polls = getCachedAccessiblePolls();
  if (!polls) return null;
  return buildThreadFromPollDown(anchorPollId, polls, voted, abstained);
}

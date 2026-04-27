/**
 * Thread grouping utilities for the messaging-style UI.
 *
 * A "thread" is a chain of multipolls linked by `multipolls.follow_up_to`.
 * Sub-polls of one multipoll are siblings inside the chain. Single-multipoll
 * threads (one wrapper, no parent or children) render as one card group.
 *
 * Phase 5b: this module consumes `Multipoll[]` as the primary input —
 * wrapper-level fields (response_deadline, is_closed, creator_name, ...) live
 * on each Multipoll. Sub-poll-level fields (poll_type, voter_names, ...)
 * still live on each `Poll` inside `multipoll.sub_polls`. Chain walking uses
 * `Multipoll.follow_up_to` (a multipoll_id, or null for thread roots).
 */

import type { Multipoll, Poll } from './types';
import {
  getCachedPollById,
  getCachedAccessibleMultipolls,
  getCachedMultipollByShortId,
} from './pollCache';
import { isUuidLike } from './pollId';

/** Build a multipoll_id → Multipoll lookup Map. The first occurrence per
 *  multipoll wins, so callers can prepend a known-current wrapper to override
 *  an entry already in the cache. */
export function buildMultipollMap(multipolls: Iterable<Multipoll>): Map<string, Multipoll> {
  const map = new Map<string, Multipoll>();
  for (const mp of multipolls) {
    if (!map.has(mp.id)) map.set(mp.id, mp);
  }
  return map;
}

export interface Thread {
  /** ID of the root sub-poll (first sub-poll of the chain's earliest multipoll). */
  rootPollId: string;
  /** ID of the root multipoll (chain's earliest wrapper). */
  rootMultipollId: string;
  /** Multipolls in the thread, sorted chronologically (oldest first). */
  multipolls: Multipoll[];
  /** Flat sub-polls list in chronological + sub_poll_index order — kept for
   *  callsites that iterate every ballot card. */
  polls: Poll[];
  /** Deduplicated participant names across the thread (creator + voters). */
  participantNames: string[];
  /** Display title: latestMultipoll.thread_title override if set, otherwise
   *  the comma-separated participant-names default. */
  title: string;
  /** The participant-names default (no thread_title override applied). */
  defaultTitle: string;
  /** Number of unvoted multipolls in the thread (one count per wrapper, since
   *  multipoll-level open/closed determines whether voting is possible). */
  unvotedCount: number;
  /** Earliest deadline among unvoted open multipolls (undefined if none). */
  soonestUnvotedDeadline?: string;
  /** Pre-computed ms timestamp of soonestUnvotedDeadline for sorting. */
  soonestUnvotedDeadlineMs?: number;
  /** Pre-computed ms timestamp of latest multipoll created_at for sorting. */
  latestActivityMs: number;
  /** The latest sub-poll in the thread (most recently created). */
  latestPoll: Poll;
  /** The latest multipoll in the thread (kept for callsites that need
   *  wrapper-level fields like is_closed / response_deadline). */
  latestMultipoll: Multipoll;
  /** Estimated count of anonymous respondents (max across multipolls). */
  anonymousRespondentCount: number;
}

/**
 * Build index maps and collect descendants via BFS from a set of start
 * multipoll ids. Shared by buildThreads (multiple roots) and
 * buildThreadFromMultipollDown (single anchor).
 *
 * Chain edges are multipoll-to-multipoll. Walking visits both directions:
 * every multipoll listed in any visited multipoll's `follow_up_to` chain
 * (ancestors) AND every child whose `follow_up_to` points at the current.
 */
function collectDescendants(
  startIds: string[],
  multipollById: Map<string, Multipoll>,
  childrenByParentMultipoll: Map<string, string[]>,
  visited: Set<string>,
): Multipoll[] {
  const collected: Multipoll[] = [];
  const queue = [...startIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const mp = multipollById.get(current);
    if (!mp) continue;
    collected.push(mp);

    // Children: any multipoll whose follow_up_to == current.
    for (const childId of childrenByParentMultipoll.get(mp.id) ?? []) {
      if (!visited.has(childId)) queue.push(childId);
    }
    // Ancestor: this multipoll's follow_up_to.
    if (mp.follow_up_to && !visited.has(mp.follow_up_to)) {
      queue.push(mp.follow_up_to);
    }
  }
  collected.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return collected;
}

/** Build multipoll_id → Multipoll + parent → children maps from a flat list. */
function buildMultipollMaps(multipolls: Multipoll[]): {
  multipollById: Map<string, Multipoll>;
  childrenByParentMultipoll: Map<string, string[]>;
} {
  const multipollById = new Map<string, Multipoll>();
  for (const mp of multipolls) multipollById.set(mp.id, mp);

  const childrenByParentMultipoll = new Map<string, string[]>();
  for (const mp of multipolls) {
    if (!mp.follow_up_to) continue;
    const list = childrenByParentMultipoll.get(mp.follow_up_to) ?? [];
    list.push(mp.id);
    childrenByParentMultipoll.set(mp.follow_up_to, list);
  }
  return { multipollById, childrenByParentMultipoll };
}

/**
 * Build threads from a flat list of multipolls. Each thread is a chain of
 * multipolls connected via `follow_up_to`.
 */
export function buildThreads(
  multipolls: Multipoll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread[] {
  const { multipollById, childrenByParentMultipoll } = buildMultipollMaps(multipolls);

  // Find root multipolls: those with no follow_up_to OR whose follow_up_to
  // target is a multipoll we don't have access to.
  const roots = multipolls.filter(mp => !mp.follow_up_to || !multipollById.has(mp.follow_up_to));

  const visited = new Set<string>();
  const threads: Thread[] = [];

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const threadMultipolls = collectDescendants(
      [root.id],
      multipollById,
      childrenByParentMultipoll,
      visited,
    );
    threads.push(buildThreadFromMultipolls(threadMultipolls, votedPollIds, abstainedPollIds));
  }

  // Safety net for orphaned multipolls (e.g. a child whose parent fell out of
  // the accessible set).
  for (const mp of multipolls) {
    if (!visited.has(mp.id)) {
      threads.push(buildThreadFromMultipolls([mp], votedPollIds, abstainedPollIds));
    }
  }

  return sortThreads(threads);
}

function buildThreadFromMultipolls(
  multipolls: Multipoll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread {
  // Sub-polls flatten in (multipoll chronological, sub_poll_index) order.
  const polls: Poll[] = [];
  for (const mp of multipolls) {
    const sorted = [...mp.sub_polls].sort(
      (a, b) => (a.sub_poll_index ?? 0) - (b.sub_poll_index ?? 0),
    );
    for (const sp of sorted) polls.push(sp);
  }

  // Collect participant names from each multipoll's wrapper-level
  // creator_name + voter_names aggregate.
  const nameSet = new Set<string>();
  for (const mp of multipolls) {
    if (mp.creator_name) nameSet.add(mp.creator_name);
    for (const name of mp.voter_names) nameSet.add(name);
  }
  const participantNames = Array.from(nameSet).sort();

  // Default title uses participant names; override comes from the latest
  // multipoll's thread_title.
  const defaultTitle = participantNames.length > 0
    ? participantNames.join(', ')
    : 'New Thread';
  const latestMultipoll = multipolls[multipolls.length - 1];
  const latestThreadTitle = latestMultipoll.thread_title?.trim() ?? null;
  const title = latestThreadTitle || defaultTitle;

  // A multipoll is "open" iff !is_closed AND (response_deadline absent or in
  // future). Every sub-poll inherits this — close/reopen is multipoll-atomic.
  // We count an unvoted MULTIPOLL as one toward unvotedCount when the
  // wrapper is open AND the user hasn't responded to ANY of its sub-polls.
  const now = new Date();
  let unvotedCount = 0;
  let soonestUnvotedDeadline: string | undefined;

  for (const mp of multipolls) {
    const isOpen = mp.response_deadline
      ? new Date(mp.response_deadline) > now && !mp.is_closed
      : !mp.is_closed;
    if (!isOpen) continue;
    const hasRespondedToAnySub = mp.sub_polls.some(
      sp => votedPollIds.has(sp.id) || abstainedPollIds.has(sp.id),
    );
    if (hasRespondedToAnySub) continue;
    unvotedCount++;
    if (mp.response_deadline) {
      if (!soonestUnvotedDeadline || mp.response_deadline < soonestUnvotedDeadline) {
        soonestUnvotedDeadline = mp.response_deadline;
      }
    }
  }

  // Anonymous respondent count: max across multipolls (each wrapper's
  // aggregate is the truthful per-multipoll count).
  const anonymousRespondentCount = multipolls.reduce(
    (max, mp) => Math.max(max, mp.anonymous_count),
    0,
  );

  return {
    rootPollId: polls[0].id,
    rootMultipollId: multipolls[0].id,
    multipolls,
    polls,
    participantNames,
    title,
    defaultTitle,
    unvotedCount,
    soonestUnvotedDeadline,
    soonestUnvotedDeadlineMs: soonestUnvotedDeadline
      ? new Date(soonestUnvotedDeadline).getTime()
      : undefined,
    latestActivityMs: new Date(latestMultipoll.created_at).getTime(),
    latestPoll: polls[polls.length - 1],
    latestMultipoll,
    anonymousRespondentCount,
  };
}

/**
 * Sort threads:
 * 1. Threads with unvoted open multipolls first, sorted by soonest deadline
 * 2. Threads without unvoted multipolls, sorted by most recent activity
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

/** Find the thread containing a specific poll ID. */
export function findThreadByPollId(threads: Thread[], pollId: string): Thread | undefined {
  return threads.find(t => t.polls.some(p => p.id === pollId));
}

/** Get the route id (multipoll short_id or first sub-poll id) for a thread. */
export function getThreadRouteId(thread: Thread): string {
  return thread.multipolls[0].short_id || thread.rootPollId;
}

/**
 * Walk up the multipoll-level follow_up chain starting from `multipoll` and
 * return the route ID (short_id or id) of the furthest ancestor reachable.
 * The chain is multipoll-to-multipoll — at each step we follow `follow_up_to`
 * to a parent multipoll.
 *
 * `multipollById` defaults to scanning `getCachedAccessibleMultipolls()`.
 * Pass a custom resolver when you have a faster lookup at hand.
 */
export function findThreadRootRouteId(
  multipoll: Multipoll,
  multipollById?: (id: string) => Multipoll | null | undefined,
): string {
  const resolve = multipollById ?? defaultMultipollById;
  let root: Multipoll = multipoll;
  while (root.follow_up_to) {
    const parent = resolve(root.follow_up_to);
    if (!parent) break;
    root = parent;
  }
  return root.short_id || root.sub_polls[0]?.id || root.id;
}

function defaultMultipollById(id: string): Multipoll | null {
  if (typeof window === 'undefined') return null;
  const cached = getCachedAccessibleMultipolls();
  if (!cached) return null;
  return buildMultipollMap(cached).get(id) ?? null;
}

/**
 * Build a thread starting from a specific multipoll (anchor) and collecting
 * all descendants. Used by the thread page to show "this multipoll + its
 * children" rather than the full ancestor chain.
 */
export function buildThreadFromMultipollDown(
  anchorMultipollId: string,
  allMultipolls: Multipoll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread | null {
  const { multipollById, childrenByParentMultipoll } = buildMultipollMaps(allMultipolls);
  if (!multipollById.has(anchorMultipollId)) return null;

  const collected = collectDescendants(
    [anchorMultipollId],
    multipollById,
    childrenByParentMultipoll,
    new Set(),
  );
  return buildThreadFromMultipolls(collected, votedPollIds, abstainedPollIds);
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
  let anchorMultipollId: string | null = null;
  if (isUuidLike(threadId)) {
    // threadId may be a poll uuid OR a multipoll uuid. Try both.
    const multipolls = getCachedAccessibleMultipolls() ?? [];
    const direct = multipolls.find(mp => mp.id === threadId);
    if (direct) {
      anchorMultipollId = direct.id;
    } else {
      const poll = getCachedPollById(threadId);
      anchorMultipollId = poll?.multipoll_id ?? null;
    }
  } else {
    const mp = getCachedMultipollByShortId(threadId);
    anchorMultipollId = mp?.id ?? null;
  }
  if (!anchorMultipollId) return null;
  const multipolls = getCachedAccessibleMultipolls();
  if (!multipolls) return null;
  return buildThreadFromMultipollDown(anchorMultipollId, multipolls, voted, abstained);
}

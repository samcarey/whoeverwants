/**
 * Thread grouping utilities for the messaging-style UI.
 *
 * A "thread" is a chain of multipolls linked by `multipolls.follow_up_to`.
 * Sub-polls of one multipoll are siblings; the chain itself is multipoll-level.
 * Single-multipoll threads (one wrapper, no parent or children) render as one
 * card group.
 *
 * Phase 3.5: chain walking uses `Poll.multipoll_follow_up_to` (the wrapper's
 * follow_up_to, a multipoll_id). The legacy per-poll `follow_up_to` column is
 * still populated by the server but the FE no longer reads it for chain
 * traversal — Phase 5 retires it.
 */

import type { Poll } from './types';
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls } from './pollCache';
import { isUuidLike } from './pollId';

/** Build a multipoll_id → Poll lookup Map from any iterable of polls. Polls
 *  without a multipoll_id are skipped; the first occurrence per multipoll
 *  wins, so callers can prepend a known-current poll to override an entry
 *  already in the cache (`buildPollByMultipollMap([current, ...accessible])`).
 */
export function buildPollByMultipollMap(polls: Iterable<Poll>): Map<string, Poll> {
  const map = new Map<string, Poll>();
  for (const p of polls) {
    if (p.multipoll_id && !map.has(p.multipoll_id)) map.set(p.multipoll_id, p);
  }
  return map;
}

export interface Thread {
  /** ID of the root poll (topmost accessible poll in the chain) */
  rootPollId: string;
  /** Polls in the thread, sorted chronologically (oldest first) */
  polls: Poll[];
  /** Deduplicated participant names across all polls in the thread */
  participantNames: string[];
  /** Display title: latestPoll.thread_title override if set, otherwise the
   *  comma-separated participant-names default. */
  title: string;
  /** The participant-names default (no thread_title override applied). */
  defaultTitle: string;
  /** Number of unvoted polls in the thread */
  unvotedCount: number;
  /** Earliest deadline among unvoted open polls (undefined if none) */
  soonestUnvotedDeadline?: string;
  /** Pre-computed ms timestamp of soonestUnvotedDeadline for sorting */
  soonestUnvotedDeadlineMs?: number;
  /** Pre-computed ms timestamp of latest poll created_at for sorting */
  latestActivityMs: number;
  /** The latest poll in the thread (most recently created) */
  latestPoll: Poll;
  /** Estimated count of anonymous respondents (max across any single poll) */
  anonymousRespondentCount: number;
}

/**
 * Build index maps and collect descendants via BFS from a set of start IDs.
 * Shared by buildThreads (multiple roots) and buildThreadFromPollDown (single anchor).
 *
 * Phase 3.5: chain edges are multipoll-to-multipoll. Visiting any sub-poll
 * pulls the whole multipoll group (siblings) AND every multipoll that lists
 * the current multipoll in its `follow_up_to` (children). The map keys are
 * multipoll_ids — matching `Poll.multipoll_id` and `Poll.multipoll_follow_up_to`
 * — so legacy per-poll `follow_up_to` is no longer consulted for traversal.
 */
function collectDescendants(
  startIds: string[],
  pollById: Map<string, Poll>,
  pollIdsByMultipoll: Map<string, string[]>,
  childrenByParentMultipoll: Map<string, string[]>,
  visited: Set<string>,
): Poll[] {
  const collected: Poll[] = [];
  const visitedMultipolls = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const poll = pollById.get(current);
    if (!poll) continue;
    collected.push(poll);

    if (!poll.multipoll_id) continue;
    if (visitedMultipolls.has(poll.multipoll_id)) continue;
    visitedMultipolls.add(poll.multipoll_id);

    // Multipoll siblings — sub-polls of this wrapper.
    for (const siblingId of pollIdsByMultipoll.get(poll.multipoll_id) ?? []) {
      if (!visited.has(siblingId)) queue.push(siblingId);
    }

    // Children: any multipoll whose follow_up_to == current multipoll. Enqueue
    // every sub-poll of each child so the BFS covers the entire child group.
    for (const childMultipollId of childrenByParentMultipoll.get(poll.multipoll_id) ?? []) {
      for (const childPollId of pollIdsByMultipoll.get(childMultipollId) ?? []) {
        if (!visited.has(childPollId)) queue.push(childPollId);
      }
    }

    // Ancestor: this multipoll's follow_up_to. Pull every sibling of the
    // parent into the thread too so BFS covers the upstream group.
    const parentMultipollId = poll.multipoll_follow_up_to;
    if (parentMultipollId) {
      for (const parentPollId of pollIdsByMultipoll.get(parentMultipollId) ?? []) {
        if (!visited.has(parentPollId)) queue.push(parentPollId);
      }
    }
  }
  // Sort by (created_at, sub_poll_index). Within a multipoll all sub-polls
  // share the same created_at, so sub_poll_index breaks the tie and preserves
  // the order the creator added them in.
  collected.sort((a, b) => {
    const dt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (dt !== 0) return dt;
    return (a.sub_poll_index ?? 0) - (b.sub_poll_index ?? 0);
  });
  return collected;
}

/** Build pollById + multipoll-level chain maps from a flat list of polls.
 *
 *  - `pollIdsByMultipoll`: multipoll_id -> [pollId, ...]. Drives sibling
 *    grouping AND child/parent expansion (we walk multipoll-level edges and
 *    fan out to all sub-polls of each visited wrapper).
 *  - `childrenByParentMultipoll`: parent_multipoll_id -> [child_multipoll_id, ...].
 *    Built from `Poll.multipoll_follow_up_to`. Polls without a multipoll_id
 *    (legacy / participation-style standalone) are excluded from chain
 *    traversal and stay as their own single-poll thread root.
 */
function buildPollMaps(polls: Poll[]): {
  pollById: Map<string, Poll>;
  pollIdsByMultipoll: Map<string, string[]>;
  childrenByParentMultipoll: Map<string, string[]>;
} {
  const pollById = new Map<string, Poll>();
  for (const poll of polls) {
    pollById.set(poll.id, poll);
  }

  const pollIdsByMultipoll = new Map<string, string[]>();
  // Track which multipolls we've already counted as children so we dedupe
  // child entries even though multiple sub-polls share the same parent ref.
  const seenChildEdge = new Set<string>();
  const childrenByParentMultipoll = new Map<string, string[]>();
  for (const poll of polls) {
    if (!poll.multipoll_id) continue;
    const existing = pollIdsByMultipoll.get(poll.multipoll_id) ?? [];
    existing.push(poll.id);
    pollIdsByMultipoll.set(poll.multipoll_id, existing);

    const parent = poll.multipoll_follow_up_to;
    if (parent) {
      const edgeKey = `${parent}->${poll.multipoll_id}`;
      if (!seenChildEdge.has(edgeKey)) {
        seenChildEdge.add(edgeKey);
        const list = childrenByParentMultipoll.get(parent) ?? [];
        list.push(poll.multipoll_id);
        childrenByParentMultipoll.set(parent, list);
      }
    }
  }
  return { pollById, pollIdsByMultipoll, childrenByParentMultipoll };
}

/**
 * Build threads from a flat list of polls.
 *
 * Groups sub-polls by their multipoll wrapper, then chains wrappers via
 * `multipoll_follow_up_to`. Only multipoll-level follow_up_to relationships
 * form threads.
 */
export function buildThreads(
  polls: Poll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread[] {
  const { pollById, pollIdsByMultipoll, childrenByParentMultipoll } = buildPollMaps(polls);

  // Find root polls: polls whose multipoll has no `follow_up_to` OR whose
  // follow_up_to target is a multipoll we don't have access to. Polls with
  // no multipoll_id (legacy / standalone) are also treated as roots.
  const isChild = new Set<string>();
  for (const poll of polls) {
    const parent = poll.multipoll_follow_up_to;
    if (parent && pollIdsByMultipoll.has(parent)) {
      isChild.add(poll.id);
    }
  }

  const roots = polls.filter(p => !isChild.has(p.id));

  const visited = new Set<string>();
  const threads: Thread[] = [];

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const threadPolls = collectDescendants(
      [root.id],
      pollById,
      pollIdsByMultipoll,
      childrenByParentMultipoll,
      visited,
    );
    threads.push(buildThreadFromPolls(threadPolls, votedPollIds, abstainedPollIds));
  }

  // Safety net for orphaned polls (e.g. polls in a multipoll whose siblings
  // weren't rooted because of a missing multipoll_follow_up_to target).
  for (const poll of polls) {
    if (!visited.has(poll.id)) {
      threads.push(buildThreadFromPolls([poll], votedPollIds, abstainedPollIds));
    }
  }

  return sortThreads(threads);
}

function buildThreadFromPolls(
  polls: Poll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread {
  // Collect all unique participant names
  const nameSet = new Set<string>();
  for (const poll of polls) {
    if (poll.creator_name) nameSet.add(poll.creator_name);
    if (poll.voter_names) {
      for (const name of poll.voter_names) {
        nameSet.add(name);
      }
    }
  }
  const participantNames = Array.from(nameSet).sort();

  // Default title uses participant names; override comes from the latest poll's thread_title.
  const defaultTitle = participantNames.length > 0
    ? participantNames.join(', ')
    : 'New Thread';
  const latestThreadTitle = polls[polls.length - 1]?.thread_title?.trim();
  const title = latestThreadTitle || defaultTitle;

  // Count unvoted polls and find soonest unvoted deadline
  const now = new Date();
  let unvotedCount = 0;
  let soonestUnvotedDeadline: string | undefined;

  for (const poll of polls) {
    const hasVoted = votedPollIds.has(poll.id) || abstainedPollIds.has(poll.id);
    const isOpen = poll.response_deadline
      ? new Date(poll.response_deadline) > now && !poll.is_closed
      : !poll.is_closed;

    if (!hasVoted && isOpen) {
      unvotedCount++;
      if (poll.response_deadline) {
        if (!soonestUnvotedDeadline || poll.response_deadline < soonestUnvotedDeadline) {
          soonestUnvotedDeadline = poll.response_deadline;
        }
      }
    }
  }

  const latestPoll = polls[polls.length - 1];

  // Estimate anonymous respondent count (max across any single poll)
  let anonymousRespondentCount = 0;
  for (const poll of polls) {
    const totalVotes = poll.response_count ?? 0;
    const namedVoters = poll.voter_names?.length ?? 0;
    const anonymous = Math.max(0, totalVotes - namedVoters);
    anonymousRespondentCount = Math.max(anonymousRespondentCount, anonymous);
  }

  return {
    rootPollId: polls[0].id,
    polls,
    participantNames,
    title,
    defaultTitle,
    unvotedCount,
    soonestUnvotedDeadline,
    soonestUnvotedDeadlineMs: soonestUnvotedDeadline ? new Date(soonestUnvotedDeadline).getTime() : undefined,
    latestActivityMs: new Date(latestPoll.created_at).getTime(),
    latestPoll,
    anonymousRespondentCount,
  };
}

/**
 * Sort threads:
 * 1. Threads with unvoted open polls first, sorted by soonest unvoted deadline
 * 2. Threads without unvoted open polls, sorted by most recent activity
 */
function sortThreads(threads: Thread[]): Thread[] {
  return threads.sort((a, b) => {
    // Threads with unvoted polls come first
    if (a.unvotedCount > 0 && b.unvotedCount === 0) return -1;
    if (a.unvotedCount === 0 && b.unvotedCount > 0) return 1;

    // Both have unvoted: sort by soonest deadline
    if (a.unvotedCount > 0 && b.unvotedCount > 0) {
      const aDeadline = a.soonestUnvotedDeadlineMs ?? Infinity;
      const bDeadline = b.soonestUnvotedDeadlineMs ?? Infinity;
      return aDeadline - bDeadline;
    }

    // Neither has unvoted: sort by most recent poll creation (newest first)
    return b.latestActivityMs - a.latestActivityMs;
  });
}

/**
 * Find the thread containing a specific poll ID.
 */
export function findThreadByPollId(threads: Thread[], pollId: string): Thread | undefined {
  return threads.find(t => t.polls.some(p => p.id === pollId));
}

/**
 * Get the root poll's short_id or id for URL routing.
 */
export function getThreadRouteId(thread: Thread): string {
  return thread.polls[0].short_id || thread.polls[0].id;
}

/**
 * Walk up the multipoll-level follow_up chain starting from `poll` and
 * return the route ID (short_id or id) of the furthest ancestor reachable.
 * The chain is multipoll-to-multipoll — at each step we follow the current
 * poll's `multipoll_follow_up_to` to any sub-poll of the parent multipoll.
 * When the cache doesn't have a parent sub-poll, the deepest resolvable
 * ancestor is returned (caller-friendly: a stale cache produces a near-root
 * URL that the FE can still resolve via the loader).
 *
 * `pollByMultipoll` defaults to scanning `getCachedAccessiblePolls()`. Pass
 * a custom resolver when you have a faster lookup at hand (e.g. a Map
 * keyed by `multipoll_id`).
 */
export function findThreadRootRouteId(
  poll: Poll,
  pollByMultipoll?: (multipollId: string) => Poll | null | undefined,
): string {
  const resolveByMultipoll =
    pollByMultipoll ?? defaultPollByMultipoll;
  let root: Poll = poll;
  while (root.multipoll_follow_up_to) {
    const parent = resolveByMultipoll(root.multipoll_follow_up_to);
    if (!parent) break;
    root = parent;
  }
  return root.short_id || root.id;
}

function defaultPollByMultipoll(multipollId: string): Poll | null {
  if (typeof window === 'undefined') return null;
  const cached = getCachedAccessiblePolls();
  if (!cached) return null;
  return buildPollByMultipollMap(cached).get(multipollId) ?? null;
}

/**
 * Build a thread starting from a specific poll and collecting all its descendants.
 * Used by the thread page to show "this poll + its children" rather than the
 * full ancestor chain.
 */
export function buildThreadFromPollDown(
  anchorPollId: string,
  allPolls: Poll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread | null {
  const { pollById, pollIdsByMultipoll, childrenByParentMultipoll } = buildPollMaps(allPolls);
  if (!pollById.has(anchorPollId)) return null;

  const threadPolls = collectDescendants(
    [anchorPollId],
    pollById,
    pollIdsByMultipoll,
    childrenByParentMultipoll,
    new Set(),
  );
  return buildThreadFromPolls(threadPolls, votedPollIds, abstainedPollIds);
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
  const anchor = isUuidLike(threadId) ? getCachedPollById(threadId) : getCachedPollByShortId(threadId);
  if (!anchor) return null;
  const polls = getCachedAccessiblePolls();
  if (!polls) return null;
  return buildThreadFromPollDown(anchor.id, polls, voted, abstained);
}

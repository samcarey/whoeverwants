/**
 * Thread grouping utilities for the messaging-style UI.
 *
 * A "thread" is a chain of polls linked by follow_up_to relationships.
 * Standalone polls (no follow_up_to, nothing follows them) are single-poll threads.
 */

import type { Poll } from './types';
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls } from './pollCache';
import { isUuidLike } from './pollId';

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
 */
function collectDescendants(
  startIds: string[],
  pollById: Map<string, Poll>,
  childrenOf: Map<string, string[]>,
  visited: Set<string>,
): Poll[] {
  const collected: Poll[] = [];
  const queue = [...startIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const poll = pollById.get(current);
    if (poll) {
      collected.push(poll);
      const children = childrenOf.get(current) || [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }
  collected.sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return collected;
}

/** Build pollById and childrenOf maps from a flat list of polls. */
function buildPollMaps(polls: Poll[]): {
  pollById: Map<string, Poll>;
  childrenOf: Map<string, string[]>;
} {
  const pollById = new Map<string, Poll>();
  for (const poll of polls) {
    pollById.set(poll.id, poll);
  }
  const childrenOf = new Map<string, string[]>();
  for (const poll of polls) {
    if (poll.follow_up_to && pollById.has(poll.follow_up_to)) {
      const existing = childrenOf.get(poll.follow_up_to) || [];
      existing.push(poll.id);
      childrenOf.set(poll.follow_up_to, existing);
    }
  }
  return { pollById, childrenOf };
}

/**
 * Build threads from a flat list of polls.
 *
 * Groups polls by follow_up_to chains. Only follow_up_to relationships form
 * threads — fork_of relationships are ignored for threading purposes.
 */
export function buildThreads(
  polls: Poll[],
  votedPollIds: Set<string>,
  abstainedPollIds: Set<string>,
): Thread[] {
  const { pollById, childrenOf } = buildPollMaps(polls);

  // Find root polls: polls whose follow_up_to is null or points to a poll
  // we don't have access to
  const isChild = new Set<string>();
  for (const poll of polls) {
    if (poll.follow_up_to && pollById.has(poll.follow_up_to)) {
      isChild.add(poll.id);
    }
  }

  const roots = polls.filter(p => !isChild.has(p.id));

  const visited = new Set<string>();
  const threads: Thread[] = [];

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const threadPolls = collectDescendants([root.id], pollById, childrenOf, visited);
    threads.push(buildThreadFromPolls(threadPolls, votedPollIds, abstainedPollIds));
  }

  // Safety net for orphaned polls
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
 * Walk up the `follow_up_to` chain starting from `poll`, consulting `lookup`
 * at each step, and return the route ID (short_id or id) of the furthest
 * ancestor reachable. For a standalone poll — or when the cache doesn't
 * have the full chain — the deepest resolvable ancestor is returned.
 */
export function findThreadRootRouteId(
  poll: Poll,
  lookup: (id: string) => Poll | null | undefined,
): string {
  let root: Poll = poll;
  let parentId = poll.follow_up_to;
  while (parentId) {
    const parent = lookup(parentId);
    if (!parent) break;
    root = parent;
    parentId = parent.follow_up_to;
  }
  return root.short_id || root.id;
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
  const { pollById, childrenOf } = buildPollMaps(allPolls);
  if (!pollById.has(anchorPollId)) return null;

  const threadPolls = collectDescendants([anchorPollId], pollById, childrenOf, new Set());
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

/**
 * Thread grouping utilities for the messaging-style UI.
 *
 * A "thread" is a chain of polls linked by follow_up_to relationships.
 * Standalone polls (no follow_up_to, nothing follows them) are single-poll threads.
 */

import type { Poll } from './types';

export interface Thread {
  /** ID of the root poll (topmost accessible poll in the chain) */
  rootPollId: string;
  /** Polls in the thread, sorted chronologically (oldest first) */
  polls: Poll[];
  /** Deduplicated participant names across all polls in the thread */
  participantNames: string[];
  /** Display title: comma-separated participant names */
  title: string;
  /** Number of unvoted polls in the thread */
  unvotedCount: number;
  /** Earliest deadline among unvoted open polls (undefined if none) */
  soonestUnvotedDeadline?: string;
  /** The latest poll in the thread (most recently created) */
  latestPoll: Poll;
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
  const pollById = new Map<string, Poll>();
  for (const poll of polls) {
    pollById.set(poll.id, poll);
  }

  // Build parent→children map (only follow_up_to, not fork_of)
  const childrenOf = new Map<string, string[]>();
  for (const poll of polls) {
    if (poll.follow_up_to && pollById.has(poll.follow_up_to)) {
      const existing = childrenOf.get(poll.follow_up_to) || [];
      existing.push(poll.id);
      childrenOf.set(poll.follow_up_to, existing);
    }
  }

  // Find root polls: polls whose follow_up_to is null or points to a poll
  // we don't have access to
  const isChild = new Set<string>();
  for (const poll of polls) {
    if (poll.follow_up_to && pollById.has(poll.follow_up_to)) {
      isChild.add(poll.id);
    }
  }

  const roots = polls.filter(p => !isChild.has(p.id));

  // For each root, collect all descendants via BFS
  const visited = new Set<string>();
  const threads: Thread[] = [];

  for (const root of roots) {
    if (visited.has(root.id)) continue;

    const threadPolls: Poll[] = [];
    const queue = [root.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const poll = pollById.get(current);
      if (poll) {
        threadPolls.push(poll);
        const children = childrenOf.get(current) || [];
        for (const childId of children) {
          if (!visited.has(childId)) {
            queue.push(childId);
          }
        }
      }
    }

    // Sort chronologically (oldest first)
    threadPolls.sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const thread = buildThreadFromPolls(threadPolls, votedPollIds, abstainedPollIds);
    threads.push(thread);
  }

  // Also handle any orphaned polls not visited (shouldn't happen, but safety net)
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

  // Build title from names
  const title = participantNames.length > 0
    ? participantNames.join(', ')
    : polls[0]?.title || 'Untitled';

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

  return {
    rootPollId: polls[0].id,
    polls,
    participantNames,
    title,
    unvotedCount,
    soonestUnvotedDeadline,
    latestPoll,
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
      const aDeadline = a.soonestUnvotedDeadline ? new Date(a.soonestUnvotedDeadline).getTime() : Infinity;
      const bDeadline = b.soonestUnvotedDeadline ? new Date(b.soonestUnvotedDeadline).getTime() : Infinity;
      return aDeadline - bDeadline;
    }

    // Neither has unvoted: sort by most recent poll creation (newest first)
    const aLatest = new Date(a.latestPoll.created_at).getTime();
    const bLatest = new Date(b.latestPoll.created_at).getTime();
    return bLatest - aLatest;
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

/**
 * Group grouping utilities for the messaging-style UI.
 *
 * A "group" is a flat list of polls sharing the same `group_id`,
 * ordered by `created_at` (oldest first). Migration 105 retired
 * `polls.follow_up_to`, so chain walking is gone — every poll directly
 * carries its `group_id` and `group_short_id`.
 *
 * Phase 5b: this module consumes `Poll[]` as the primary input.
 * Wrapper-level fields (response_deadline, is_closed, creator_name, ...)
 * live on each Poll. Sub-question-level fields (question_type,
 * voter_names, ...) still live on each `Question` inside `poll.questions`.
 */

import type { Poll, Question } from './types';
import {
  getCachedQuestionById,
  getCachedAccessiblePolls,
  getCachedPollByShortId,
} from './questionCache';
import { isUuidLike } from './questionId';

/** Query-param key on `/g/<group>` URLs that names a specific poll the page
 *  should expand and scroll to. Absent → no auto-expand, page scrolls to
 *  bottom (the draft form area). */
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

/** Pick the chronological "root" of a group from a list of its polls —
 *  the oldest by `created_at`, or `polls[0]` if dates are missing/identical.
 *  Migration 105 retired the chain-pointer-based root; "root" now just
 *  means "oldest poll in the group", which is the natural anchor for the
 *  group URL and for buildGroupFromPollDown. Returns null on empty
 *  input. */
export function findChainRoot(polls: Poll[]): Poll | null {
  if (polls.length === 0) return null;
  let root = polls[0];
  let rootMs = new Date(root.created_at).getTime();
  for (let i = 1; i < polls.length; i++) {
    const ms = new Date(polls[i].created_at).getTime();
    if (ms < rootMs) {
      rootMs = ms;
      root = polls[i];
    }
  }
  return root;
}

export interface Group {
  /** ID of the root question (first question of the chain's earliest poll). */
  rootQuestionId: string;
  /** ID of the root poll (oldest poll in the group). */
  rootPollId: string;
  /** The group's id (uuid). All polls in `polls` share this. */
  groupId: string | null;
  /** Polls in the group, sorted chronologically (oldest first). */
  polls: Poll[];
  /** Flat questions list in chronological + question_index order — kept for
   *  callsites that iterate every ballot card. */
  questions: Question[];
  /** Deduplicated participant names across the group (creator + voters). */
  participantNames: string[];
  /** Display title: group_title override if set, otherwise the
   *  comma-separated participant-names default. */
  title: string;
  /** The participant-names default (no group_title override applied). */
  defaultTitle: string;
  /** Number of unvoted polls in the group (one count per wrapper, since
   *  poll-level open/closed determines whether voting is possible). */
  unvotedCount: number;
  /** Earliest deadline among unvoted open polls (undefined if none). */
  soonestUnvotedDeadline?: string;
  /** Pre-computed ms timestamp of soonestUnvotedDeadline for sorting. */
  soonestUnvotedDeadlineMs?: number;
  /** Pre-computed ms timestamp of latest poll created_at for sorting. */
  latestActivityMs: number;
  /** The latest question in the group (most recently created). */
  latestQuestion: Question;
  /** The latest poll in the group (kept for callsites that need
   *  wrapper-level fields like is_closed / response_deadline). */
  latestPoll: Poll;
  /** The poll the group URL should target — oldest open poll with at least
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
 * Pick the poll a group's URL should target. Mirrors the per-question
 * gold-outline rule (open poll + at least one question the user hasn't
 * voted on or abstained from). Among those, picks the oldest by
 * created_at so the user lands on the question that's been waiting longest.
 * Falls back to the newest poll in the group when nothing is awaiting.
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

function sortByCreatedAt(polls: Poll[]): Poll[] {
  return [...polls].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

/** Group a flat list of polls by `group_id`. Polls without a `group_id`
 *  (synthesized placeholders, very old cached polls) become their own
 *  one-element group keyed by the poll's own id — they degrade to
 *  single-poll groups rather than disappearing. */
function groupPollsByGroup(polls: Poll[]): Map<string, Poll[]> {
  const groups = new Map<string, Poll[]>();
  for (const mp of polls) {
    const key = mp.group_id ?? `solo:${mp.id}`;
    const list = groups.get(key) ?? [];
    list.push(mp);
    groups.set(key, list);
  }
  return groups;
}

/**
 * Build groups from a flat list of polls. Each group groups every poll
 * with the same `group_id`, sorted by `created_at` (oldest first).
 */
export function buildGroups(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
): Group[] {
  const groups = groupPollsByGroup(polls);
  const groups: Group[] = [];
  for (const group of groups.values()) {
    groups.push(buildGroupFromPolls(
      sortByCreatedAt(group),
      votedQuestionIds,
      abstainedQuestionIds,
    ));
  }
  return sortGroups(groups);
}

function buildGroupFromPolls(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
): Group {
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

  // Default title uses participant names; override comes from groups.title
  // (surfaced on every poll as `group_title`).
  const defaultTitle = participantNames.length > 0
    ? participantNames.join(', ')
    : 'New Group';
  // Migration 105 makes group_title a single source of truth at the
  // group level — every poll in this group carries the same value.
  // Read off the latest poll for compat with placeholder/legacy polls
  // that may not have it set yet.
  const latestPoll = polls[polls.length - 1];
  const groupTitle = latestPoll.group_title?.trim() ?? null;
  const title = groupTitle || defaultTitle;

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

  const latestActivityMs = polls.reduce(
    (max, p) => Math.max(max, new Date(p.created_at).getTime()),
    0,
  );

  const targetedPoll = pickTargetedPoll(polls, votedQuestionIds, abstainedQuestionIds, now);

  return {
    rootQuestionId: questions[0].id,
    rootPollId: polls[0].id,
    groupId: polls[0].group_id ?? null,
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
 * Sort groups:
 * 1. Groups with unvoted open polls first, sorted by soonest deadline
 * 2. Groups without unvoted polls, sorted by most recent activity
 */
function sortGroups(groups: Group[]): Group[] {
  return groups.sort((a, b) => {
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

/** Find the group containing a specific question ID. */
export function findGroupByQuestionId(groups: Group[], questionId: string): Group | undefined {
  return groups.find(t => t.questions.some(p => p.id === questionId));
}

/** Route id for a group URL. Migration 105 ties this to `groups.short_id`
 *  via `Poll.group_short_id`; the legacy fallbacks (root poll short_id,
 *  root question id) are kept for synthesized placeholder polls that
 *  haven't been persisted yet. */
export function getGroupRouteId(group: Group): string {
  const rootPoll = group.polls.find(p => p.id === group.rootPollId) ?? group.polls[0];
  return rootPoll?.group_short_id || rootPoll?.short_id || group.rootQuestionId;
}

/** Resolve a poll's group route id (the path param of `/g/<routeId>`).
 *  Migration 105: every poll directly carries `group_short_id`. The
 *  fallbacks below cover placeholder polls (pre-API roundtrip) and very
 *  old cached polls left in memory across a deploy. */
export function resolveGroupRootRouteId(poll: Poll): string {
  return poll.group_short_id || poll.short_id || poll.questions[0]?.id || poll.id;
}

/** Build `/g/<root>?p=<pollShort>` for `poll` inside its group — the
 *  canonical "navigate to this poll's group with this poll expanded" URL. */
export function getGroupHrefForPoll(poll: Poll): string {
  const pollShortId = poll.short_id || poll.questions[0]?.id || poll.id;
  const rootRouteId = resolveGroupRootRouteId(poll);
  return `/g/${rootRouteId}?${POLL_QUERY_PARAM}=${pollShortId}`;
}

/** Build the URL for a group.
 *
 * - `/g/<root>?p=<target>` when the user has awaiting work — the poll is
 *   auto-expanded and scrolled-to on landing.
 * - `/g/<root>` when nothing is awaiting — the page scrolls to bottom (draft
 *   form area), inviting the user to start a new poll.
 */
export function getGroupHref(group: Group): string {
  const rootRouteId = getGroupRouteId(group);
  if (group.unvotedCount === 0) {
    return `/g/${rootRouteId}`;
  }
  const target = group.targetedPoll;
  const targetRouteId = target.short_id || target.questions[0]?.id || group.rootQuestionId;
  return `/g/${rootRouteId}?${POLL_QUERY_PARAM}=${targetRouteId}`;
}

/**
 * Build a group from any poll belonging to it — collects every poll in
 * `allPolls` sharing the anchor's `group_id`. Used by the group page
 * to materialize the chain when a user lands on an arbitrary poll.
 */
export function buildGroupFromPollDown(
  anchorPollId: string,
  allPolls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
): Group | null {
  const anchor = allPolls.find(mp => mp.id === anchorPollId);
  if (!anchor) return null;
  const groupId = anchor.group_id;
  // Polls without group_id (placeholders, legacy) form a one-element
  // group for themselves.
  const polls = groupId
    ? allPolls.filter(mp => mp.group_id === groupId)
    : [anchor];
  return buildGroupFromPolls(
    sortByCreatedAt(polls),
    votedQuestionIds,
    abstainedQuestionIds,
  );
}

/** Build the group for a route id synchronously from in-memory caches.
 *  Returns null if any required piece is missing — callers fall through to
 *  their async fetch path.
 *
 *  Migration 105: routeId can be a `groups.short_id` (preferred form,
 *  prefixed with `~` for fresh groups or a backfilled root-poll-short-id
 *  for pre-B.4 groups), a `polls.short_id` (legacy /g/<root-poll-short-id>
 *  fallback), or a UUID (poll/question/group). The accessible polls cache
 *  is grouped by `group_id` for an O(N) lookup.
 */
export function buildGroupSyncFromCache(
  groupId: string,
  voted: Set<string>,
  abstained: Set<string>,
): Group | null {
  if (typeof window === 'undefined') return null;
  const polls = getCachedAccessiblePolls();
  if (!polls) return null;
  let anchorPollId: string | null = null;
  if (isUuidLike(groupId)) {
    // groupId may be a group uuid, a poll uuid, or a question uuid.
    const byGroup = polls.find(mp => mp.group_id === groupId);
    if (byGroup) {
      anchorPollId = byGroup.id;
    } else {
      const direct = polls.find(mp => mp.id === groupId);
      if (direct) {
        anchorPollId = direct.id;
      } else {
        const question = getCachedQuestionById(groupId);
        anchorPollId = question?.poll_id ?? null;
      }
    }
  } else {
    // Phase B.4 preferred path: routeId is a groups.short_id. Any poll
    // matching gives us the group; pick the oldest as the anchor so
    // buildGroupFromPollDown collects every sibling.
    const matches = polls.filter(mp => mp.group_short_id === groupId);
    if (matches.length > 0) {
      anchorPollId = sortByCreatedAt(matches)[0].id;
    } else {
      const mp = getCachedPollByShortId(groupId);
      anchorPollId = mp?.id ?? null;
    }
  }
  if (!anchorPollId) return null;
  return buildGroupFromPollDown(anchorPollId, polls, voted, abstained);
}

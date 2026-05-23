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

import type { GroupSummary, Poll, Question } from './types';
import {
  getCachedQuestionById,
  getCachedAccessiblePolls,
  getCachedPollByShortId,
  getCachedGroupSummary,
} from './questionCache';
import { isUuidLike } from './questionId';
import { getUserName } from './userProfile';
import { API_ORIGIN } from './api/_internal';

/** Fallback group title when no participant names remain after filtering
 *  out the current user. */
export const EMPTY_GROUP_TITLE = 'New Group';

/** Trimmed + case-insensitive name equality. Collapses different casings
 *  of the same name so the viewer doesn't appear twice in respondent
 *  lists when a sibling poll's `voter_names` carries a variant spelling. */
export function namesEqualCaseInsensitive(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Drop the current user's name from a list (case-insensitive, trimmed). */
export function filterOutCurrentUser(
  names: string[],
  currentUserName: string | null,
): string[] {
  if (!currentUserName || !currentUserName.trim()) return names;
  return names.filter(name => !namesEqualCaseInsensitive(name, currentUserName));
}

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

/** State of a group's leading unvoted-poll cutoff, driving the home-list
 *  compact countdown column's color + style. See `Group.unvotedDeadlineKind`.
 *  `response-pending` renders as a solid colored dot when no concrete
 *  deadline exists but the viewer still has un-actioned work. */
export type DeadlineKind = 'prephase' | 'response' | 'response-pending';

export interface Group {
  /** ID of the root question (first question of the chain's earliest poll).
   *  Null for empty groups (no questions yet). */
  rootQuestionId: string | null;
  /** ID of the root poll (oldest poll in the group). Null for empty groups. */
  rootPollId: string | null;
  /** The group's id (uuid). All polls in `polls` share this. Non-null for
   *  empty groups (the group exists in the DB even with no polls). */
  groupId: string | null;
  /** The group's short_id (preferred URL form). Always present for empty
   *  groups (server populates via DB trigger on insert); present on every
   *  Poll in a populated group. */
  groupShortId: string | null;
  /** Polls in the group, sorted chronologically (oldest first). Empty for
   *  empty groups. */
  polls: Poll[];
  /** Flat questions list in chronological + question_index order — kept for
   *  callsites that iterate every ballot card. Empty for empty groups. */
  questions: Question[];
  /** Deduplicated participant names across the group (creator + voters),
   *  with the current user's name filtered out (matches the rule "don't
   *  list yourself in your own group's name or graphic"). */
  participantNames: string[];
  /** Display title: group_title override if set, otherwise the
   *  comma-separated participant-names default ("New Group" if filtered
   *  participantNames is empty). */
  title: string;
  /** The participant-names default (no group_title override applied). */
  defaultTitle: string;
  /** Raw group_title override (from `groups.title`). Null when no
   *  override is set — `title` then falls through to `defaultTitle`.
   *  Distinct from `title` so the edit-title input can pre-fill with the
   *  raw value rather than displaying "New Group" as if it were a typed
   *  title. */
  groupTitleOverride: string | null;
  /** Number of unvoted polls in the group (one count per wrapper, since
   *  poll-level open/closed determines whether voting is possible). */
  unvotedCount: number;
  /** Earliest deadline among unvoted open polls (undefined if none). */
  soonestUnvotedDeadline?: string;
  /** Pre-computed ms timestamp of soonestUnvotedDeadline for sorting. */
  soonestUnvotedDeadlineMs?: number;
  /** Drives the home-list right-rail indicator's color + style:
   *   - `'prephase'`: an active suggestion / time-availability cutoff is the
   *     winning deadline → blue compact countdown.
   *   - `'response'`: the voting deadline is the winning deadline → green
   *     compact countdown.
   *   - `'response-pending'`: viewer has unvoted polls but NO deadline is
   *     set anywhere → solid green circle. Without this, the right edge
   *     would render blank when there's still work to do.
   *   - `undefined`: nothing to show (no unvoted polls at all).
   *  Within one poll, an active prephase always wins over response_deadline
   *  (we don't surface a voting deadline while suggestions are still being
   *  collected); across polls, the soonest deadline wins regardless of kind.
   *  `response-pending` only surfaces as a fallback when no concrete deadline won. */
  unvotedDeadlineKind?: DeadlineKind;
  /** Pre-computed ms timestamp of latest poll created_at for sorting,
   *  or the group's `created_at` for empty groups. */
  latestActivityMs: number;
  /** True iff the group has no polls yet — distinguishes the brand-new
   *  empty-group case from a normal group with `polls.length === 1`. */
  isEmpty: boolean;
  /** The latest question in the group (most recently created). Null for
   *  empty groups. */
  latestQuestion: Question | null;
  /** The latest poll in the group (kept for callsites that need
   *  wrapper-level fields like is_closed / response_deadline). Null for
   *  empty groups. */
  latestPoll: Poll | null;
  /** Estimated count of anonymous respondents (max across polls). */
  anonymousRespondentCount: number;
  /** Migration 108: URL of the group's uploaded avatar image, or null
   *  when no custom image is set. When null, the FE falls back to the
   *  initials-circles graphic (RespondentCircles). When set, the URL
   *  includes a `?v=<timestamp>` cache-buster so the browser refetches
   *  on every change. */
  imageUrl: string | null;
  /** Migration 114 (Phase E): 'public' or 'private', or null for
   *  synthesized placeholder/cached groups that predate the field.
   *  Drives the /info privacy badge + creator-only toggle. */
  privacy: string | null;
  /** Migration 114 (Phase E): the signed-in creator's user_id if the
   *  group was created while signed in, otherwise null. Required to
   *  authorize the privacy-toggle endpoint (server-side gate also
   *  enforces this — the FE check is just for showing/hiding the UI). */
  creatorUserId: string | null;
}

/** Build the avatar image URL for a group from its route id + image-updated
 *  timestamp. The endpoint is server-resolved to the group, so any of the
 *  four route-id forms (groups.short_id, groups.id, polls.short_id, polls.id)
 *  work. Returns null when no image is set on the group. */
export function buildGroupImageUrl(
  routeId: string | null | undefined,
  imageUpdatedAt: string | null | undefined,
): string | null {
  if (!routeId || !imageUpdatedAt) return null;
  const v = encodeURIComponent(imageUpdatedAt);
  return `${API_ORIGIN}/api/groups/by-route-id/${encodeURIComponent(routeId)}/image?v=${v}`;
}

/** True iff the poll wrapper is open: not manually closed AND no
 *  response_deadline has passed. */
export function isPollOpen(poll: Poll, now: Date = new Date()): boolean {
  if (poll.is_closed) return false;
  if (!poll.response_deadline) return true;
  return new Date(poll.response_deadline) > now;
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
 * Build groups from a flat list of polls + an optional list of
 * membership-only "empty groups" (the user joined them via the home
 * new group button but no polls exist yet).
 */
export function buildGroups(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
  emptyGroups: GroupSummary[] = [],
): Group[] {
  const currentUserName = getUserName();
  const byGroupId = groupPollsByGroup(polls);
  const groups: Group[] = [];
  for (const pollsInGroup of byGroupId.values()) {
    groups.push(buildGroupFromPolls(
      sortByCreatedAt(pollsInGroup),
      votedQuestionIds,
      abstainedQuestionIds,
      currentUserName,
    ));
  }
  // Drop empty-group entries whose group_id is already represented by a
  // populated group — handles the race where /api/groups/empty races
  // /api/groups/mine and a poll just landed.
  const populatedGroupIds = new Set(
    groups.map(g => g.groupId).filter((id): id is string => !!id),
  );
  for (const summary of emptyGroups) {
    if (populatedGroupIds.has(summary.id)) continue;
    groups.push(buildEmptyGroup(summary));
  }
  return sortGroups(groups);
}

function buildGroupFromPolls(
  polls: Poll[],
  votedQuestionIds: Set<string>,
  abstainedQuestionIds: Set<string>,
  currentUserName: string | null = getUserName(),
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
  // creator_name + voter_names aggregate. Then filter out the current
  // user (case-insensitive) so they don't see themselves in the group
  // title or graphic.
  const nameSet = new Set<string>();
  for (const mp of polls) {
    if (mp.creator_name) nameSet.add(mp.creator_name);
    for (const name of mp.voter_names) nameSet.add(name);
  }
  const allNames = Array.from(nameSet).sort();
  const participantNames = filterOutCurrentUser(allNames, currentUserName);

  // Default title uses participant names; override comes from groups.title
  // (surfaced on every poll as `group_title`).
  const defaultTitle = participantNames.length > 0
    ? participantNames.join(', ')
    : EMPTY_GROUP_TITLE;
  // Migration 105 makes group_title a single source of truth at the
  // group level — every poll in this group carries the same value.
  // Read off the latest poll for compat with placeholder/legacy polls
  // that may not have it set yet.
  const latestPoll = polls[polls.length - 1];
  const groupTitleOverride = latestPoll.group_title?.trim() || null;
  const title = groupTitleOverride || defaultTitle;

  const now = new Date();
  let unvotedCount = 0;
  let soonestUnvotedDeadline: string | undefined;
  let unvotedDeadlineKind: DeadlineKind | undefined;

  for (const mp of polls) {
    if (!isPollOpen(mp, now)) continue;
    const hasRespondedToAnySub = mp.questions.some(
      sp => votedQuestionIds.has(sp.id) || abstainedQuestionIds.has(sp.id),
    );
    if (hasRespondedToAnySub) continue;
    unvotedCount++;

    // Per-poll state: an active prephase deadline ALWAYS wins over the
    // voting deadline within the same poll — we don't surface the voting
    // deadline while suggestions / availability are still being collected.
    let pollDeadline: string | undefined;
    let pollKind: 'prephase' | 'response' | undefined;
    if (mp.prephase_deadline && new Date(mp.prephase_deadline) > now) {
      pollDeadline = mp.prephase_deadline;
      pollKind = 'prephase';
    } else if (mp.response_deadline) {
      pollDeadline = mp.response_deadline;
      pollKind = 'response';
    }

    if (pollDeadline && pollKind) {
      if (!soonestUnvotedDeadline || pollDeadline < soonestUnvotedDeadline) {
        soonestUnvotedDeadline = pollDeadline;
        unvotedDeadlineKind = pollKind;
      }
    }
  }

  // Awaiting-response indicator: viewer has un-actioned voting work but NO
  // concrete deadline anywhere. Renders as a solid green dot so the right
  // edge is never blank when there's something to do.
  if (!unvotedDeadlineKind && unvotedCount > 0) {
    unvotedDeadlineKind = 'response-pending';
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

  // Every poll in the group carries the same `group_image_updated_at`
  // (sourced server-side from `groups.image_updated_at` via JOIN). Read
  // off the latest poll for symmetry with the group_title source.
  const imageUrl = buildGroupImageUrl(
    latestPoll.group_short_id ?? latestPoll.group_id ?? null,
    latestPoll.group_image_updated_at ?? null,
  );

  return {
    rootQuestionId: questions[0].id,
    rootPollId: polls[0].id,
    groupId: polls[0].group_id ?? null,
    groupShortId: latestPoll.group_short_id ?? null,
    polls,
    questions,
    participantNames,
    title,
    defaultTitle,
    groupTitleOverride,
    unvotedCount,
    soonestUnvotedDeadline,
    soonestUnvotedDeadlineMs: soonestUnvotedDeadline
      ? new Date(soonestUnvotedDeadline).getTime()
      : undefined,
    unvotedDeadlineKind,
    latestActivityMs,
    isEmpty: false,
    latestQuestion: questions[questions.length - 1],
    latestPoll,
    anonymousRespondentCount,
    imageUrl,
    // Migration 114 (Phase E): every poll in the group carries the same
    // group_privacy / group_creator_user_id (sourced from groups via
    // JOIN). Read off the latest poll for symmetry with group_title.
    privacy: latestPoll.group_privacy ?? null,
    creatorUserId: latestPoll.group_creator_user_id ?? null,
  };
}

/** Build a `Group` for a membership-only "empty group" — joined but
 *  no polls yet. */
export function buildEmptyGroup(summary: GroupSummary): Group {
  const groupTitleOverride = summary.title?.trim() || null;
  const participantNames: string[] = [];
  const defaultTitle = EMPTY_GROUP_TITLE;
  const title = groupTitleOverride || defaultTitle;
  const createdMs = summary.created_at
    ? new Date(summary.created_at).getTime()
    : Date.now();
  return {
    rootQuestionId: null,
    rootPollId: null,
    groupId: summary.id,
    groupShortId: summary.short_id ?? null,
    polls: [],
    questions: [],
    participantNames,
    title,
    defaultTitle,
    groupTitleOverride,
    unvotedCount: 0,
    soonestUnvotedDeadline: undefined,
    soonestUnvotedDeadlineMs: undefined,
    unvotedDeadlineKind: undefined,
    latestActivityMs: createdMs,
    isEmpty: true,
    latestQuestion: null,
    latestPoll: null,
    anonymousRespondentCount: 0,
    imageUrl: buildGroupImageUrl(
      summary.short_id ?? summary.id,
      summary.image_updated_at ?? null,
    ),
    privacy: summary.privacy ?? null,
    creatorUserId: summary.creator_user_id ?? null,
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
 *  haven't been persisted yet. Empty groups fall through to
 *  `group.groupShortId` (from the GroupSummary) or `group.groupId`. */
export function getGroupRouteId(group: Group): string {
  if (group.isEmpty) {
    return group.groupShortId || group.groupId || '';
  }
  const rootPoll = group.polls.find(p => p.id === group.rootPollId) ?? group.polls[0];
  return rootPoll?.group_short_id
    || rootPoll?.short_id
    || group.rootQuestionId
    || group.groupShortId
    || group.groupId
    || '';
}

/** Resolve a poll's group route id (the path param of `/g/<routeId>`).
 *  Migration 105: every poll directly carries `group_short_id`. The
 *  fallbacks below cover placeholder polls (pre-API roundtrip) and very
 *  old cached polls left in memory across a deploy. */
export function resolveGroupRootRouteId(poll: Poll): string {
  return poll.group_short_id || poll.short_id || poll.questions[0]?.id || poll.id;
}

/** Build `/g/<root>/p/<pollShort>` for `poll` inside its group — the
 *  canonical "navigate to this poll's detail page" URL. */
export function getGroupHrefForPoll(poll: Poll): string {
  const pollShortId = poll.short_id || poll.questions[0]?.id || poll.id;
  const rootRouteId = resolveGroupRootRouteId(poll);
  return `/g/${rootRouteId}/p/${pollShortId}`;
}

/** Build the URL for a group's root view. */
export function getGroupHref(group: Group): string {
  return `/g/${getGroupRouteId(group)}`;
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
  let anchorPollId: string | null = null;
  if (polls) {
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
  }
  if (anchorPollId && polls) {
    return buildGroupFromPollDown(anchorPollId, polls, voted, abstained);
  }
  // No poll matched — but the group itself may be a membership-only empty
  // group (just-created via the home new group button, or every poll closed before
  // the viewer joined). The group-summary cache resolves both `groups.id`
  // and `groups.short_id`, so a cached summary here means we can render
  // the empty-group chrome synchronously without an API round-trip — which
  // is what prevents the slide-overlay handoff from unmounting onto a
  // loading spinner.
  const summary = getCachedGroupSummary(groupId);
  return summary ? buildEmptyGroup(summary) : null;
}

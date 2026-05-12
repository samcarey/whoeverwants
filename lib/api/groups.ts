/**
 * Phase B.3: group-level API helpers.
 *
 * `apiGetMyGroups(accessibleQuestionIds)` collapses the legacy
 * `discoverRelatedQuestions + apiGetAccessibleQuestions` pair into one
 * server round-trip. The server resolves the question_ids to their groups
 * (via `polls.group_id`) and returns every poll in those groups with the
 * full inline-results / voter aggregates that the home page expects.
 *
 * `apiGetGroupByRouteId(routeId)` returns the same shape for one group,
 * resolved by `routeId` (today: root poll's short_id; Phase B.4 will mint
 * dedicated `groups.short_id`s).
 *
 * Both helpers piggyback on the existing per-poll cache: `cachePoll` is
 * called for each returned poll so subsequent `apiGetPollById` calls hit
 * warm cache.
 *
 * `apiLeaveGroup(routeId)` is the explicit "leave group" action —
 * fire-and-forget DELETE to `/api/groups/{routeId}/membership`. Errors
 * are swallowed because the post-condition is verifiable on the next
 * `/api/groups/mine` call. Used to retire the legacy
 * `accessible_question_ids` bridge in `/api/groups/mine` once
 * forget-of-last-poll calls land.
 */

import type { GroupSummary, Poll } from "@/lib/types";
import {
  cachePoll,
  cacheQuestionResults,
  getCachedAccessiblePolls,
  invalidateAccessibleQuestions,
  invalidatePoll,
} from "@/lib/questionCache";
import { groupFetch, toPoll, toQuestionResults } from "./_internal";

function toGroupSummary(data: any): GroupSummary {
  return {
    id: data.id,
    short_id: data.short_id ?? null,
    title: data.title ?? null,
    created_at: data.created_at,
  };
}

function hydrateAndCache(data: any[]): Poll[] {
  return data.map((d) => {
    const poll = toPoll(d);
    cachePoll(poll);
    // Mirror inline per-question results so apiGetQuestionResults hits
    // the per-question results cache without a late re-fetch (matching
    // apiGetAccessibleQuestions's behavior).
    const sub = Array.isArray(d.questions) ? d.questions : [];
    for (let i = 0; i < sub.length; i++) {
      const subData = sub[i];
      if (subData?.results) {
        const results = toQuestionResults(subData.results);
        cacheQuestionResults(subData.id, results);
        if (poll.questions[i]) {
          poll.questions[i].results = results;
        }
      }
    }
    return poll;
  });
}

export async function apiGetMyGroups(
  accessibleQuestionIds: string[],
  options: { include_results?: boolean } = {},
): Promise<Poll[]> {
  if (accessibleQuestionIds.length === 0) return [];
  const data: any[] = await groupFetch('/mine', {
    method: 'POST',
    body: JSON.stringify({
      accessible_question_ids: accessibleQuestionIds,
      include_results: options.include_results ?? true,
    }),
  });
  return hydrateAndCache(data);
}

export async function apiGetGroupByRouteId(
  routeId: string,
  options: { include_results?: boolean } = {},
): Promise<Poll[]> {
  const params = new URLSearchParams();
  if (options.include_results === false) params.set('include_results', 'false');
  const qs = params.toString();
  const path = `/by-route-id/${encodeURIComponent(routeId)}${qs ? `?${qs}` : ''}`;
  const data: any[] = await groupFetch(path);
  return hydrateAndCache(data);
}

/** Create a brand-new empty group and auto-join the caller as a member.
 *  Used by the home "+" FAB. The next `getMyGroups()` call picks up the
 *  new group via the always-fresh `/api/groups/empty` parallel fetch;
 *  the polls cache is unaffected since this group has no polls. */
export async function apiCreateGroup(): Promise<GroupSummary> {
  const data = await groupFetch<any>('', { method: 'POST' });
  return toGroupSummary(data);
}

/** Empty groups the caller is a member of (joined, zero polls). Returns
 *  `[]` on transient failure — never throws, so an empty-groups blip
 *  can't block the populated list. */
export async function apiGetMyEmptyGroups(): Promise<GroupSummary[]> {
  try {
    const data: any[] = await groupFetch('/empty', { method: 'POST' });
    return Array.isArray(data) ? data.map(toGroupSummary) : [];
  } catch {
    return [];
  }
}

/** Group metadata (no polls, no auto-join). Safe from any read-only
 *  context; returns null on resolution failure. */
export async function apiGetGroupSummary(routeId: string): Promise<GroupSummary | null> {
  try {
    const data = await groupFetch<any>(
      `/by-route-id/${encodeURIComponent(routeId)}/summary`,
    );
    return toGroupSummary(data);
  } catch {
    return null;
  }
}

/**
 * Explicit "leave group" action — DELETE the caller's `group_members`
 * row for the resolved group. Idempotent server-side and fire-and-forget
 * client-side: the server returns 204 whether or not a row existed (and
 * even for strangers), so a transient failure is never user-visible. The
 * post-condition is verifiable on the next `/api/groups/mine` call.
 *
 * `routeId` accepts `groups.short_id`, `groups.id`, `polls.short_id`, or
 * `polls.id` — same as `apiGetGroupByRouteId`.
 */
export async function apiLeaveGroup(routeId: string): Promise<void> {
  try {
    await groupFetch(`/${encodeURIComponent(routeId)}/membership`, {
      method: 'DELETE',
    });
  } catch {
    // intentional: see jsdoc
  }
}

/** Update (or clear) a group's title override.
 *
 *  Migration 105 moved the override from `polls.group_title` to
 *  `groups.title`. The endpoint takes a `route_id` (the same four forms
 *  as `apiGetGroupByRouteId`) and updates `groups.title` directly —
 *  one row per group, no per-poll divergence.
 *
 *  Empty string or null clears the override (stored as NULL).
 *
 *  Cache invalidation: every poll in the group carries `group_title`
 *  in its cached payload, so we evict each one (cascades to per-question
 *  caches via `invalidatePoll`) plus the accessible-polls cache. Done
 *  here so callers don't have to remember the cleanup ritual.
 */
export async function apiUpdateGroupTitle(
  routeId: string,
  title: string | null,
): Promise<{ group_id: string; group_short_id: string | null; title: string | null }> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/title`,
    {
      method: 'POST',
      body: JSON.stringify({ group_title: title }),
    },
  );
  const result = {
    group_id: data.group_id as string,
    group_short_id: (data.group_short_id ?? null) as string | null,
    title: (data.title ?? null) as string | null,
  };
  const accessible = getCachedAccessiblePolls() ?? [];
  for (const mp of accessible) {
    if (mp.group_id === result.group_id) invalidatePoll(mp.id);
  }
  invalidateAccessibleQuestions();
  return result;
}

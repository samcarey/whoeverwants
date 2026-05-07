/**
 * Phase B.3: thread-level API helpers.
 *
 * `apiGetMyThreads(accessibleQuestionIds)` collapses the legacy
 * `discoverRelatedQuestions + apiGetAccessibleQuestions` pair into one
 * server round-trip. The server resolves the question_ids to their threads
 * (via `polls.thread_id`) and returns every poll in those threads with the
 * full inline-results / voter aggregates that the home page expects.
 *
 * `apiGetThreadByRouteId(routeId)` returns the same shape for one thread,
 * resolved by `routeId` (today: root poll's short_id; Phase B.4 will mint
 * dedicated `threads.short_id`s).
 *
 * Both helpers piggyback on the existing per-poll cache: `cachePoll` is
 * called for each returned poll so subsequent `apiGetPollById` calls hit
 * warm cache.
 *
 * `apiLeaveThread(routeId)` is the explicit "leave thread" action — fire-
 * and-forget DELETE to `/api/threads/{routeId}/membership`. Mirrors
 * `apiGrantPollAccess`'s shape so callers can wire it up the same way
 * (try/catch swallow on the call site if needed). Used to retire the
 * legacy `accessible_question_ids` bridge in `/api/threads/mine` once
 * forget-of-last-poll calls land.
 */

import type { Poll } from "@/lib/types";
import { cachePoll, cacheQuestionResults } from "@/lib/questionCache";
import { POLL_QUERY_PARAM } from "@/lib/threadUtils";
import { threadFetch, toPoll, toQuestionResults } from "./_internal";

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

export async function apiGetMyThreads(
  accessibleQuestionIds: string[],
  options: { include_results?: boolean } = {},
): Promise<Poll[]> {
  if (accessibleQuestionIds.length === 0) return [];
  const data: any[] = await threadFetch('/mine', {
    method: 'POST',
    body: JSON.stringify({
      accessible_question_ids: accessibleQuestionIds,
      include_results: options.include_results ?? true,
    }),
  });
  return hydrateAndCache(data);
}

export async function apiGetThreadByRouteId(
  routeId: string,
  options: { include_results?: boolean; pollShortId?: string | null } = {},
): Promise<Poll[]> {
  const params = new URLSearchParams();
  if (options.include_results === false) params.set('include_results', 'false');
  // Phase C.3: when the URL is /t/<thread>?p=<poll>, forward the poll
  // short_id so the server inline-grants poll_access BEFORE applying the
  // visibility filter. Without it, a stranger landing on the direct link
  // 404s on this first call (the fire-and-forget apiGrantPollAccess
  // effect can't run until rootPoll resolves, but rootPoll requires this
  // call to succeed — chicken-and-egg).
  if (options.pollShortId) params.set(POLL_QUERY_PARAM, options.pollShortId);
  const qs = params.toString();
  const path = `/by-route-id/${encodeURIComponent(routeId)}${qs ? `?${qs}` : ''}`;
  const data: any[] = await threadFetch(path);
  return hydrateAndCache(data);
}

/**
 * Explicit "leave thread" action — DELETE the caller's `thread_members`
 * row for the resolved thread. Idempotent server-side and fire-and-forget
 * client-side: the server returns 204 whether or not a row existed (and
 * even for strangers), so a transient failure is never user-visible. Errors
 * are swallowed for the same reason `apiGrantPollAccess` does: the
 * post-condition is verifiable on the next `/api/threads/mine` call.
 *
 * `routeId` accepts `threads.short_id`, `threads.id`, `polls.short_id`, or
 * `polls.id` — same as `apiGetThreadByRouteId`.
 */
export async function apiLeaveThread(routeId: string): Promise<void> {
  try {
    await threadFetch(`/${encodeURIComponent(routeId)}/membership`, {
      method: 'DELETE',
    });
  } catch {
    // intentional: see jsdoc
  }
}

/** Update (or clear) a thread's title override.
 *
 *  Migration 105 moved the override from `polls.thread_title` to
 *  `threads.title`. The endpoint takes a `route_id` (the same four forms
 *  as `apiGetThreadByRouteId`) and updates `threads.title` directly —
 *  one row per thread, no per-poll divergence.
 *
 *  Empty string or null clears the override (stored as NULL).
 */
export async function apiUpdateThreadTitle(
  routeId: string,
  title: string | null,
): Promise<{ thread_id: string; thread_short_id: string | null; title: string | null }> {
  const data = await threadFetch<any>(
    `/${encodeURIComponent(routeId)}/title`,
    {
      method: 'POST',
      body: JSON.stringify({ thread_title: title }),
    },
  );
  return {
    thread_id: data.thread_id,
    thread_short_id: data.thread_short_id ?? null,
    title: data.title ?? null,
  };
}

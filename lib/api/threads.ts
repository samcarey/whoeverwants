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
 */

import type { Poll } from "@/lib/types";
import { cachePoll, cacheQuestionResults } from "@/lib/questionCache";
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
  options: { include_results?: boolean } = {},
): Promise<Poll[]> {
  const params = new URLSearchParams();
  if (options.include_results === false) params.set('include_results', 'false');
  const qs = params.toString();
  const path = `/by-route-id/${encodeURIComponent(routeId)}${qs ? `?${qs}` : ''}`;
  const data: any[] = await threadFetch(path);
  return hydrateAndCache(data);
}

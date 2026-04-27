import type { Multipoll, Poll } from "@/lib/types";
import { cachePoll } from "@/lib/pollCache";
import {
  apiFetch,
  ApiError,
  coalesced,
  toPoll,
  toMultipoll,
  toPollResults,
} from "./_internal";
import { cacheMultipoll, cachePollResults } from "@/lib/pollCache";
import { apiGetMultipollByShortId } from "./multipolls";

// Phase 5: legacy `apiCreatePoll` (POST /api/polls) is gone — everything goes
// through `apiCreateMultipoll`. Same for the per-poll close/reopen/cutoff/
// thread-title/vote helpers — see the corresponding multipoll-level helpers
// in ./multipolls.ts.

const pollInFlight = new Map<string, Promise<Poll>>();

/** Resolve an "anchor poll" for a multipoll's short_id. Phase 5b: short_id
 *  lives on the multipoll wrapper, so we fetch the wrapper (warming the
 *  multipoll cache + its sub-polls in the per-poll cache) and return its
 *  first sub-poll. Callers use this to bootstrap thread building, where any
 *  sub-poll of the target multipoll is sufficient. */
export async function apiGetPollByShortId(shortId: string): Promise<Poll> {
  const mp = await apiGetMultipollByShortId(shortId);
  if (!mp.sub_polls.length) {
    throw new ApiError(404, 'Multipoll has no sub-polls');
  }
  return mp.sub_polls[0];
}

export async function apiGetPollById(pollId: string): Promise<Poll> {
  return coalesced(pollInFlight, `id:${pollId}`, null, async () => {
    const data = await apiFetch(`/${encodeURIComponent(pollId)}`);
    const poll = toPoll(data);
    cachePoll(poll);
    return poll;
  });
}

export async function apiFindDuplicatePoll(title: string, followUpTo: string): Promise<Poll | null> {
  try {
    const params = new URLSearchParams({ title, follow_up_to: followUpTo });
    const data = await apiFetch(`/find-duplicate?${params}`);
    return toPoll(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function apiGetRelatedPolls(pollIds: string[]): Promise<{
  allRelatedIds: string[];
  originalCount: number;
  discoveredCount: number;
}> {
  if (pollIds.length === 0) return { allRelatedIds: [], originalCount: 0, discoveredCount: 0 };
  const data = await apiFetch<{ all_related_ids: string[]; original_count: number; discovered_count: number }>('/related', {
    method: 'POST',
    body: JSON.stringify({ poll_ids: pollIds }),
  });
  return {
    allRelatedIds: data.all_related_ids,
    originalCount: data.original_count,
    discoveredCount: data.discovered_count,
  };
}

// Phase 5b: returns Multipoll[] instead of Poll[]. The multipoll is the unit
// of identity (per the addressability paradigm), so the FE consumes
// wrapper-level fields (response_deadline, is_closed, etc.) from each
// Multipoll directly. cacheMultipoll cascades each sub-poll into the per-poll
// cache so apiGetPollById hits warm cache. Inline `results` on each sub-poll
// are also mirrored into the per-poll results cache so apiGetPollResults
// avoids a late re-fetch.
export async function apiGetAccessiblePolls(pollIds: string[]): Promise<Multipoll[]> {
  if (pollIds.length === 0) return [];
  const data: any[] = await apiFetch('/accessible', {
    method: 'POST',
    body: JSON.stringify({ poll_ids: pollIds, include_results: true }),
  });
  return data.map(d => {
    const multipoll = toMultipoll(d);
    cacheMultipoll(multipoll);
    // Mirror inline per-sub-poll results into the per-poll results cache so
    // apiGetPollResults hits it without a late re-fetch (avoids layout shift
    // when the thread page warms results on viewport intersection).
    for (let i = 0; i < (Array.isArray(d.sub_polls) ? d.sub_polls.length : 0); i++) {
      const subData = d.sub_polls[i];
      if (subData?.results) {
        const results = toPollResults(subData.results);
        cachePollResults(subData.id, results);
        // toPoll() in toMultipoll consumed sub_polls already, but didn't
        // attach results to the Poll — mirror them here so consumers reading
        // multipoll.sub_polls[i].results see them.
        if (multipoll.sub_polls[i]) {
          multipoll.sub_polls[i].results = results;
        }
      }
    }
    return multipoll;
  });
}

export async function apiGetAllPollIds(): Promise<string[]> {
  try {
    const data: { poll_ids: string[] } = await apiFetch('/dev/all-ids');
    return data.poll_ids;
  } catch {
    return [];
  }
}

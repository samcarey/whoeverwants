import { cachePollResults, getCachedPollResults } from "@/lib/pollCache";
import { apiFetch, coalesced, toPollResults, type Results } from "./_internal";

const resultsInFlight = new Map<string, Promise<Results>>();

export async function apiGetPollResults(pollId: string): Promise<Results> {
  return coalesced(resultsInFlight, pollId, getCachedPollResults(pollId), async () => {
    const data = await apiFetch(`/${encodeURIComponent(pollId)}/results`);
    const results = toPollResults(data);
    cachePollResults(pollId, results);
    return results;
  });
}

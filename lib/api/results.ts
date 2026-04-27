import { cacheQuestionResults, getCachedQuestionResults } from "@/lib/questionCache";
import { apiFetch, coalesced, toQuestionResults, type Results } from "./_internal";

const resultsInFlight = new Map<string, Promise<Results>>();

export async function apiGetQuestionResults(questionId: string): Promise<Results> {
  return coalesced(resultsInFlight, questionId, getCachedQuestionResults(questionId), async () => {
    const data = await apiFetch(`/${encodeURIComponent(questionId)}/results`);
    const results = toQuestionResults(data);
    cacheQuestionResults(questionId, results);
    return results;
  });
}

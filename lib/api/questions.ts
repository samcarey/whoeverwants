import type { Poll, Question } from "@/lib/types";
import { cacheQuestion } from "@/lib/questionCache";
import {
  apiFetch,
  ApiError,
  coalesced,
  toQuestion,
  toPoll,
  toQuestionResults,
} from "./_internal";
import { cachePoll, cacheQuestionResults } from "@/lib/questionCache";
import { apiGetPollByShortId } from "./polls";

// Phase 5: legacy `apiCreateQuestion` (POST /api/questions) is gone — everything goes
// through `apiCreatePoll`. Same for the per-question close/reopen/cutoff/
// thread-title/vote helpers — see the corresponding poll-level helpers
// in ./polls.ts.

const questionInFlight = new Map<string, Promise<Question>>();

/** Resolve an "anchor question" for a poll's short_id. Phase 5b: short_id
 *  lives on the poll wrapper, so we fetch the wrapper (warming the
 *  poll cache + its questions in the per-question cache) and return its
 *  first question. Callers use this to bootstrap thread building, where any
 *  question of the target poll is sufficient. */
export async function apiGetQuestionByShortId(shortId: string): Promise<Question> {
  const mp = await apiGetPollByShortId(shortId);
  if (!mp.questions.length) {
    throw new ApiError(404, 'Poll has no questions');
  }
  return mp.questions[0];
}

export async function apiGetQuestionById(questionId: string): Promise<Question> {
  return coalesced(questionInFlight, `id:${questionId}`, null, async () => {
    const data = await apiFetch(`/${encodeURIComponent(questionId)}`);
    const question = toQuestion(data);
    cacheQuestion(question);
    return question;
  });
}

export async function apiFindDuplicateQuestion(title: string, followUpTo: string): Promise<Question | null> {
  try {
    const params = new URLSearchParams({ title, follow_up_to: followUpTo });
    const data = await apiFetch(`/find-duplicate?${params}`);
    return toQuestion(data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function apiGetRelatedQuestions(questionIds: string[]): Promise<{
  allRelatedIds: string[];
  originalCount: number;
  discoveredCount: number;
}> {
  if (questionIds.length === 0) return { allRelatedIds: [], originalCount: 0, discoveredCount: 0 };
  const data = await apiFetch<{ all_related_ids: string[]; original_count: number; discovered_count: number }>('/related', {
    method: 'POST',
    body: JSON.stringify({ question_ids: questionIds }),
  });
  return {
    allRelatedIds: data.all_related_ids,
    originalCount: data.original_count,
    discoveredCount: data.discovered_count,
  };
}

// Phase 5b: returns Poll[] instead of Question[]. The poll is the unit
// of identity (per the addressability paradigm), so the FE consumes
// wrapper-level fields (response_deadline, is_closed, etc.) from each
// Poll directly. cachePoll cascades each question into the per-question
// cache so apiGetQuestionById hits warm cache. Inline `results` on each question
// are also mirrored into the per-question results cache so apiGetQuestionResults
// avoids a late re-fetch.
export async function apiGetAccessibleQuestions(questionIds: string[]): Promise<Poll[]> {
  if (questionIds.length === 0) return [];
  const data: any[] = await apiFetch('/accessible', {
    method: 'POST',
    body: JSON.stringify({ question_ids: questionIds, include_results: true }),
  });
  return data.map(d => {
    const poll = toPoll(d);
    cachePoll(poll);
    // Mirror inline per-question results into the per-question results cache so
    // apiGetQuestionResults hits it without a late re-fetch (avoids layout shift
    // when the thread page warms results on viewport intersection).
    for (let i = 0; i < (Array.isArray(d.questions) ? d.questions.length : 0); i++) {
      const subData = d.questions[i];
      if (subData?.results) {
        const results = toQuestionResults(subData.results);
        cacheQuestionResults(subData.id, results);
        // toQuestion() in toPoll consumed questions already, but didn't
        // attach results to the Question — mirror them here so consumers reading
        // poll.questions[i].results see them.
        if (poll.questions[i]) {
          poll.questions[i].results = results;
        }
      }
    }
    return poll;
  });
}

export async function apiGetAllQuestionIds(): Promise<string[]> {
  try {
    const data: { question_ids: string[] } = await apiFetch('/dev/all-ids');
    return data.question_ids;
  } catch {
    return [];
  }
}

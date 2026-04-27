"use client";

/**
 * Load a thread by route id (short_id or UUID).
 *
 * Initializes synchronously from the in-memory cache when possible so that
 * consumers mount with a full thread on the first render (no loading-spinner
 * flash during view-transition slides). Falls through to an async fetch
 * + relationship-discovery path only when the cache miss occurs.
 */

import { useEffect, useState } from "react";
import type { Question } from "./types";
import { buildThreadFromPollDown, buildThreadSyncFromCache, type Thread } from "./threadUtils";
import { getAccessiblePolls } from "./simpleQuestionQueries";
import { discoverRelatedQuestions } from "./questionDiscovery";
import { apiGetQuestionById, apiGetQuestionByShortId } from "./api";
import { addAccessibleQuestionId } from "./browserQuestionAccess";
import { getCachedQuestionById, getCachedQuestionByShortId } from "./questionCache";
import { isUuidLike } from "./questionId";
import { loadVotedQuestions } from "./votedQuestionsStorage";
import { usePageReady } from "./usePageReady";

export interface UseThreadResult {
  thread: Thread | null;
  loading: boolean;
  error: boolean;
}

export function useThread(threadId: string): UseThreadResult {
  const [initialThread] = useState<Thread | null>(() => {
    if (typeof window === "undefined") return null;
    const voted = loadVotedQuestions();
    return buildThreadSyncFromCache(threadId, voted.votedQuestionIds, voted.abstainedQuestionIds);
  });
  const [thread, setThread] = useState<Thread | null>(initialThread);
  const [loading, setLoading] = useState(!initialThread);
  const [error, setError] = useState(false);

  // Signal "page rendered" to the view-transition helper so the slide
  // animation captures a fully-painted destination.
  usePageReady(!!thread && !loading);

  useEffect(() => {
    // Cache hit: synchronous init already populated `thread`; skip the async
    // refetch/discovery path entirely. Mutations invalidate via questionCache so
    // a stale read here is bounded by the cache TTL.
    if (initialThread) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(false);

        let anchorQuestion: Question;
        try {
          const cached = isUuidLike(threadId)
            ? getCachedQuestionById(threadId)
            : getCachedQuestionByShortId(threadId);
          if (cached) {
            anchorQuestion = cached;
          } else if (isUuidLike(threadId)) {
            anchorQuestion = await apiGetQuestionById(threadId);
          } else {
            anchorQuestion = await apiGetQuestionByShortId(threadId);
          }
          addAccessibleQuestionId(anchorQuestion.id);
        } catch {
          if (!cancelled) setError(true);
          return;
        }

        try { await discoverRelatedQuestions(); } catch {}
        const polls = await getAccessiblePolls();
        if (!polls) { if (!cancelled) setError(true); return; }

        const { votedQuestionIds, abstainedQuestionIds } = loadVotedQuestions();
        const anchorPollId = anchorQuestion.poll_id;
        if (!anchorPollId) { if (!cancelled) setError(true); return; }
        const found = buildThreadFromPollDown(anchorPollId, polls, votedQuestionIds, abstainedQuestionIds);
        if (cancelled) return;
        if (!found) { setError(true); return; }
        setThread(found);
      } catch (err) {
        console.error("useThread: load failed", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [threadId, initialThread]);

  return { thread, loading, error };
}

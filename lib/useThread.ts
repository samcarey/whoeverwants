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
import { buildThreadFromPollDown, buildThreadSyncFromCache, findChainRoot, type Thread } from "./threadUtils";
import { apiGetThreadByRouteId } from "./api";
import { addAccessibleQuestionId } from "./browserQuestionAccess";
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

        // Phase B.3+: a single thread endpoint resolves any route id form
        // (threads.short_id, threads.id, polls.short_id, polls.id) to the
        // full poll list. Migration 105 retired the chain pointer — the
        // "root" is now just the chronologically-oldest poll in the list.
        const polls = await apiGetThreadByRouteId(threadId);
        if (cancelled) return;
        const root = findChainRoot(polls);
        if (!root) { setError(true); return; }
        for (const mp of polls) {
          for (const sp of mp.questions) addAccessibleQuestionId(sp.id);
        }

        const { votedQuestionIds, abstainedQuestionIds } = loadVotedQuestions();
        const found = buildThreadFromPollDown(root.id, polls, votedQuestionIds, abstainedQuestionIds);
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

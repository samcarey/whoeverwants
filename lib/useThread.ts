"use client";

/**
 * Load a thread by route id (short_id or UUID).
 *
 * Initializes synchronously from the in-memory cache when possible so that
 * consumers mount with a full thread on the first render (no loading-spinner
 * flash during view-transition slides). Falls through to an async fetch
 * + relationship-discovery path only when the cache miss occurs.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import type { Poll } from "./types";
import { buildThreadFromPollDown, buildThreadSyncFromCache, type Thread } from "./threadUtils";
import { getAccessiblePolls } from "./simplePollQueries";
import { discoverRelatedPolls } from "./pollDiscovery";
import { apiGetPollById, apiGetPollByShortId } from "./api";
import { addAccessiblePollId } from "./browserPollAccess";
import { getCachedPollById, getCachedPollByShortId } from "./pollCache";
import { isUuidLike, normalizePath } from "./pollId";
import { loadVotedPolls } from "./votedPollsStorage";

export interface UseThreadResult {
  thread: Thread | null;
  loading: boolean;
  error: boolean;
}

export function useThread(threadId: string): UseThreadResult {
  const [initialThread] = useState<Thread | null>(() => {
    if (typeof window === "undefined") return null;
    const voted = loadVotedPolls();
    return buildThreadSyncFromCache(threadId, voted.votedPollIds, voted.abstainedPollIds);
  });
  const [thread, setThread] = useState<Thread | null>(initialThread);
  const [loading, setLoading] = useState(!initialThread);
  const [error, setError] = useState(false);

  // Signal "page rendered" to the view-transition helper so the slide
  // animation captures a fully-painted destination.
  useLayoutEffect(() => {
    if (thread && !loading) {
      const path = normalizePath(window.location.pathname);
      document.documentElement.setAttribute("data-page-ready", path);
      return () => {
        if (document.documentElement.getAttribute("data-page-ready") === path) {
          document.documentElement.removeAttribute("data-page-ready");
        }
      };
    }
  }, [thread, loading]);

  useEffect(() => {
    // Cache hit: synchronous init already populated `thread`; skip the async
    // refetch/discovery path entirely. Mutations invalidate via pollCache so
    // a stale read here is bounded by the cache TTL.
    if (initialThread) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(false);

        let anchorPoll: Poll;
        try {
          const cached = isUuidLike(threadId)
            ? getCachedPollById(threadId)
            : getCachedPollByShortId(threadId);
          if (cached) {
            anchorPoll = cached;
          } else if (isUuidLike(threadId)) {
            anchorPoll = await apiGetPollById(threadId);
          } else {
            anchorPoll = await apiGetPollByShortId(threadId);
          }
          addAccessiblePollId(anchorPoll.id);
        } catch {
          if (!cancelled) setError(true);
          return;
        }

        try { await discoverRelatedPolls(); } catch {}
        const polls = await getAccessiblePolls();
        if (!polls) { if (!cancelled) setError(true); return; }

        const { votedPollIds, abstainedPollIds } = loadVotedPolls();
        const found = buildThreadFromPollDown(anchorPoll.id, polls, votedPollIds, abstainedPollIds);
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

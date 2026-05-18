"use client";

/**
 * Load a group by route id (short_id or UUID).
 *
 * Initializes synchronously from the in-memory cache when possible so that
 * consumers mount with a full group on the first render (no loading-spinner
 * flash during view-transition slides). Falls through to an async fetch
 * + relationship-discovery path only when the cache miss occurs.
 *
 * For empty groups (membership-only, no polls yet — typically just-created
 * via the home new group button), `apiGetGroupByRouteId` returns `[]`. In that case
 * we fall back to `apiGetGroupSummary` to fetch just the group metadata
 * (title, short_id, created_at) and synthesize an empty `Group` via
 * `buildEmptyGroup`. The /info, /edit-title, and group root routes all
 * render correctly against an empty group.
 */

import { useEffect, useState } from "react";
import {
  buildEmptyGroup,
  buildGroupFromPollDown,
  buildGroupSyncFromCache,
  findChainRoot,
  type Group,
} from "./groupUtils";
import { apiGetGroupByRouteId, apiGetGroupSummary } from "./api";
import { addAccessibleQuestionId } from "./browserQuestionAccess";
import { loadVotedQuestions } from "./votedQuestionsStorage";
import { usePageReady } from "./usePageReady";

export interface UseGroupResult {
  group: Group | null;
  loading: boolean;
  error: boolean;
}

export function useGroup(groupId: string): UseGroupResult {
  const [initialGroup] = useState<Group | null>(() => {
    if (typeof window === "undefined") return null;
    const voted = loadVotedQuestions();
    return buildGroupSyncFromCache(groupId, voted.votedQuestionIds, voted.abstainedQuestionIds);
  });
  const [group, setGroup] = useState<Group | null>(initialGroup);
  const [loading, setLoading] = useState(!initialGroup);
  const [error, setError] = useState(false);

  // Signal "page rendered" to the view-transition helper so the slide
  // animation captures a fully-painted destination.
  usePageReady(!!group && !loading);

  useEffect(() => {
    // Cache hit: synchronous init already populated `group`; skip the async
    // refetch/discovery path entirely. Mutations invalidate via questionCache so
    // a stale read here is bounded by the cache TTL.
    if (initialGroup) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(false);

        // Phase B.3+: a single group endpoint resolves any route id form
        // (groups.short_id, groups.id, polls.short_id, polls.id) to the
        // full poll list. Migration 105 retired the chain pointer — the
        // "root" is now just the chronologically-oldest poll in the list.
        const polls = await apiGetGroupByRouteId(groupId);
        if (cancelled) return;

        // Empty group: no visible polls. This happens for membership-only
        // groups (just-created via the home new group button) and for members of a
        // group whose every poll was closed before they joined. Fetch the
        // summary metadata to render the header (title) and let the user
        // create the first poll.
        if (polls.length === 0) {
          const summary = await apiGetGroupSummary(groupId);
          if (cancelled) return;
          if (!summary) { setError(true); return; }
          setGroup(buildEmptyGroup(summary));
          return;
        }

        const root = findChainRoot(polls);
        if (!root) { setError(true); return; }
        for (const mp of polls) {
          for (const sp of mp.questions) addAccessibleQuestionId(sp.id);
        }

        const { votedQuestionIds, abstainedQuestionIds } = loadVotedQuestions();
        const found = buildGroupFromPollDown(root.id, polls, votedQuestionIds, abstainedQuestionIds);
        if (cancelled) return;
        if (!found) { setError(true); return; }
        setGroup(found);
      } catch (err) {
        console.error("useGroup: load failed", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [groupId, initialGroup]);

  return { group, loading, error };
}

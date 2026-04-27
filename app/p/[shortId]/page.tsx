"use client";

import type { Multipoll, Poll } from "@/lib/types";
import {
  apiGetMultipollById,
  apiGetMultipollByShortId,
  apiGetPollById,
  ApiError,
} from "@/lib/api";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { getAccessibleMultipolls } from "@/lib/simplePollQueries";
import {
  getCachedAccessibleMultipolls,
  getCachedMultipollById,
  getCachedMultipollByShortId,
  getCachedPollById,
} from "@/lib/pollCache";
import { findThreadRootRouteId, buildMultipollMap } from "@/lib/threadUtils";
import { isUuidLike } from "@/lib/pollId";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { ThreadContent } from "@/app/thread/[threadId]/page";

function PollContent() {
  const router = useRouter();
  const params = useParams();

  // Resolve synchronously from cache when possible so the thread view renders on first paint.
  // Phase 5b: short_id lives on the multipoll wrapper; the URL `/p/<id>/` may
  // point at a multipoll short_id, multipoll uuid, or sub-poll uuid. Cache
  // lookup tries each in turn.
  const resolvedInitial = (() => {
    if (typeof window === "undefined") return null;
    const raw = params.shortId as string;
    if (!raw) return null;
    let multipoll: Multipoll | null = null;
    let poll: Poll | null = null;
    if (isUuidLike(raw)) {
      multipoll = getCachedMultipollById(raw);
      if (multipoll) {
        poll = multipoll.sub_polls[0] ?? null;
      } else {
        const cachedPoll = getCachedPollById(raw);
        if (cachedPoll) {
          poll = cachedPoll;
          if (cachedPoll.multipoll_id) {
            multipoll = getCachedMultipollById(cachedPoll.multipoll_id);
          }
        }
      }
    } else {
      multipoll = getCachedMultipollByShortId(raw);
      if (multipoll) poll = multipoll.sub_polls[0] ?? null;
    }
    if (!poll || !multipoll) return null;
    // Prepend the current multipoll so it wins over any stale entry.
    const byMultipoll = buildMultipollMap([multipoll, ...(getCachedAccessibleMultipolls() ?? [])]);
    const rootRouteId = findThreadRootRouteId(multipoll, (mid) => byMultipoll.get(mid) ?? null);
    return { poll, rootRouteId };
  })();

  const [resolved, setResolved] = useState<{ poll: Poll; rootRouteId: string } | null>(resolvedInitial);
  const [error, setError] = useState(false);

  useEffect(() => {
    const shortId = params.shortId as string;
    if (!shortId) {
      router.replace("/");
      return;
    }

    // If we already resolved synchronously, just register access and skip the fetch.
    if (resolvedInitial) {
      addAccessiblePollId(resolvedInitial.poll.id);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const isUuid = isUuidLike(shortId);
        // Phase 5b: try the multipoll endpoint first. A 404 means the URL is
        // a sub-poll uuid (the per-poll endpoint resolves it, and we then
        // fetch the parent multipoll to find the root).
        let multipoll: Multipoll | null = await (isUuid
          ? apiGetMultipollById(shortId)
          : apiGetMultipollByShortId(shortId)
        ).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        });
        let poll: Poll | null = multipoll?.sub_polls[0] ?? null;
        if (!multipoll && isUuid) {
          poll = await apiGetPollById(shortId).catch(() => null);
          if (poll?.multipoll_id) {
            multipoll = await apiGetMultipollById(poll.multipoll_id).catch(() => null);
          }
        }
        if (!poll || !multipoll) {
          if (!cancelled) setError(true);
          return;
        }
        addAccessiblePollId(poll.id);
        // Run discovery + fetch accessible multipolls so ancestor wrappers
        // are available for the chain walk.
        try { await discoverRelatedPolls(); } catch {}
        const accessible = (await getAccessibleMultipolls()) ?? [];
        const byMultipoll = buildMultipollMap([multipoll, ...accessible]);
        const rootRouteId = findThreadRootRouteId(multipoll, (mid) => byMultipoll.get(mid) ?? null);
        if (!cancelled) setResolved({ poll, rootRouteId });
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [params.shortId, router, resolvedInitial]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Poll Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This poll may have been removed or the link is incorrect.</p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading poll...</p>
        </div>
      </div>
    );
  }

  return (
    <ThreadContent
      threadId={resolved.rootRouteId}
      initialExpandedPollId={resolved.poll.id}
    />
  );
}

export default function PollPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-64 mx-auto mb-4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mx-auto mb-8"></div>
            <div className="space-y-3">
              <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
              <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            </div>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading poll...</p>
        </div>
      </div>
    }>
      <PollContent />
    </Suspense>
  );
}

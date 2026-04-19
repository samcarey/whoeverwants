"use client";

import { Poll } from "@/lib/types";
import { apiGetPollById, apiGetPollByShortId } from "@/lib/api";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls } from "@/lib/pollCache";
import { findThreadRootRouteId } from "@/lib/threadUtils";
import { isUuidLike } from "@/lib/pollId";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { ThreadContent } from "@/app/thread/[threadId]/page";

function PollContent() {
  const router = useRouter();
  const params = useParams();

  // Resolve synchronously from cache when possible so the thread view renders on first paint.
  // Walk up the follow_up_to chain using both the direct cache and the accessible-polls list
  // (which includes polls not yet fetched individually) to find the thread root.
  const resolvedInitial = (() => {
    if (typeof window === "undefined") return null;
    const raw = params.shortId as string;
    if (!raw) return null;
    const poll = isUuidLike(raw) ? getCachedPollById(raw) : getCachedPollByShortId(raw);
    if (!poll) return null;
    const accessible = getCachedAccessiblePolls();
    const byId = new Map<string, Poll>();
    accessible?.forEach((p) => byId.set(p.id, p));
    byId.set(poll.id, poll);
    const lookup = (id: string) => byId.get(id) ?? getCachedPollById(id) ?? null;
    const rootRouteId = findThreadRootRouteId(poll, lookup);
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
        const poll = isUuid
          ? await apiGetPollById(shortId).catch(() => null)
          : await apiGetPollByShortId(shortId).catch(() => null);
        if (!poll) {
          if (!cancelled) setError(true);
          return;
        }
        addAccessiblePollId(poll.id);
        // Run discovery + fetch the accessible polls so ancestor polls are available
        // for the follow_up_to walk.
        try { await discoverRelatedPolls(); } catch {}
        const accessible = (await getAccessiblePolls()) ?? [];
        const byId = new Map<string, Poll>();
        accessible.forEach((p) => byId.set(p.id, p));
        byId.set(poll.id, poll);
        const lookup = (id: string) => byId.get(id) ?? getCachedPollById(id) ?? null;
        const rootRouteId = findThreadRootRouteId(poll, lookup);
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

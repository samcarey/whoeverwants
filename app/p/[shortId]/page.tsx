"use client";

import { Poll } from "@/lib/types";
import { apiGetPollById, apiGetPollByShortId } from "@/lib/api";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls } from "@/lib/pollCache";
import { isUuidLike } from "@/lib/pollId";
import { findThreadRootRouteId } from "@/lib/threadUtils";
import { useEffect, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";

/** `/p/[shortId]` direct-link handler. Renders the expanded poll modal over
 *  the containing thread. Resolves the thread root and redirects to
 *  `/thread/<rootId>?poll=<shortId>` — the thread page handles ?poll by
 *  pre-opening the modal (fade-in since there's no source card rect). */
function PollRedirect() {
  const router = useRouter();
  const params = useParams();

  useEffect(() => {
    const shortId = params.shortId as string;
    if (!shortId) {
      router.replace('/');
      return;
    }

    async function resolve() {
      // Try cache-first to avoid an API round-trip for already-loaded polls.
      let poll: Poll | null = isUuidLike(shortId)
        ? getCachedPollById(shortId) ?? null
        : getCachedPollByShortId(shortId) ?? null;

      if (!poll) {
        try {
          poll = isUuidLike(shortId)
            ? await apiGetPollById(shortId)
            : await apiGetPollByShortId(shortId);
        } catch {
          poll = null;
        }
      }

      if (!poll) {
        router.replace('/');
        return;
      }
      addAccessiblePollId(poll.id);

      // Walk the follow_up_to chain to find the thread root.
      const accessible = getCachedAccessiblePolls() ?? [];
      const byId = new Map(accessible.map(p => [p.id, p]));
      const lookup = (id: string) => byId.get(id) ?? getCachedPollById(id);
      const rootRouteId = findThreadRootRouteId(poll, lookup);

      router.replace(`/thread/${rootRouteId}?poll=${poll.short_id || poll.id}`);
    }

    resolve();
  }, [params.shortId, router]);

  return (
    <div className="h-full flex items-center justify-center">
      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    </div>
  );
}

export default function PollPage() {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <PollRedirect />
    </Suspense>
  );
}

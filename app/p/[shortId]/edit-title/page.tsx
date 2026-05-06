"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  apiGetPollById,
  apiGetPollByShortId,
  ApiError,
} from "@/lib/api";
import { getCachedAccessiblePolls, getCachedPollById, getCachedPollByShortId } from "@/lib/questionCache";
import { buildPollMap, findThreadRootRouteId } from "@/lib/threadUtils";
import { isUuidLike } from "@/lib/questionId";

export const dynamic = 'force-dynamic';

// Legacy `/p/<shortId>/edit-title` → `/t/<rootShortId>/edit-title` redirect.
function EditTitleRedirect() {
  const router = useRouter();
  const params = useParams();
  const shortId = params.shortId as string;

  useEffect(() => {
    if (!shortId) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    (async () => {
      const isUuid = isUuidLike(shortId);
      let poll = isUuid ? getCachedPollById(shortId) : getCachedPollByShortId(shortId);
      if (!poll) {
        try {
          poll = await (isUuid ? apiGetPollById(shortId) : apiGetPollByShortId(shortId))
            .catch((err: unknown) => {
              if (err instanceof ApiError && err.status === 404) return null;
              throw err;
            });
        } catch {
          poll = null;
        }
      }
      if (cancelled) return;
      if (!poll) {
        router.replace('/');
        return;
      }
      const accessible = getCachedAccessiblePolls() ?? [];
      const byPoll = buildPollMap([poll, ...accessible]);
      const rootRouteId = findThreadRootRouteId(poll, (mid) => byPoll.get(mid) ?? null);
      router.replace(`/t/${rootRouteId}/edit-title`);
    })();
    return () => { cancelled = true; };
  }, [shortId, router]);

  return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
}

export default function EditTitleRedirectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <EditTitleRedirect />
    </Suspense>
  );
}

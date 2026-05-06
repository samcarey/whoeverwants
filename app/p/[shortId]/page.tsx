"use client";

import { useEffect, useMemo, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  apiGetPollById,
  apiGetPollByShortId,
  apiGetQuestionById,
  ApiError,
} from "@/lib/api";
import { getCachedAccessiblePolls, getCachedPollById, getCachedPollByShortId, getCachedQuestionById } from "@/lib/questionCache";
import { buildPollMap, findThreadRootRouteId } from "@/lib/threadUtils";
import { isUuidLike } from "@/lib/questionId";
import type { Poll } from "@/lib/types";

export const dynamic = 'force-dynamic';

// Legacy `/p/<shortId>` redirect. Resolves the ambiguous shortId (poll
// short_id, poll uuid, OR question uuid) to a concrete poll, walks
// `follow_up_to` to the thread root, then `router.replace`s to the canonical
// `/t/<rootShortId>?p=<pollShortId>` form.
//
// Old shareable URLs all flow through this path; the live thread page lives
// at `/t/<id>` and never has to handle the ambiguity itself.
function PollRedirect() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const shortId = params.shortId as string;

  // Try cache first for instant resolution (common when the user is bouncing
  // between threads in-app).
  const cached = useMemo<Poll | null>(() => {
    if (typeof window === "undefined" || !shortId) return null;
    if (isUuidLike(shortId)) {
      const byPollId = getCachedPollById(shortId);
      if (byPollId) return byPollId;
      const cachedQuestion = getCachedQuestionById(shortId);
      if (cachedQuestion?.poll_id) {
        return getCachedPollById(cachedQuestion.poll_id);
      }
      return null;
    }
    return getCachedPollByShortId(shortId);
  }, [shortId]);

  useEffect(() => {
    if (!shortId) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    (async () => {
      let poll: Poll | null = cached;
      if (!poll) {
        try {
          const isUuid = isUuidLike(shortId);
          poll = await (isUuid
            ? apiGetPollById(shortId)
            : apiGetPollByShortId(shortId)
          ).catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          });
          if (!poll && isUuid) {
            const question = await apiGetQuestionById(shortId).catch(() => null);
            if (question?.poll_id) {
              poll = await apiGetPollById(question.poll_id).catch(() => null);
            }
          }
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
      const pollShortId = poll.short_id || poll.id;
      const qs = searchParams.toString();
      const sep = qs ? '&' : '';
      router.replace(`/t/${rootRouteId}?p=${pollShortId}${sep}${qs}`);
    })();
    return () => { cancelled = true; };
  }, [shortId, cached, router, searchParams]);

  return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
}

export default function PollRedirectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PollRedirect />
    </Suspense>
  );
}

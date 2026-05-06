"use client";

/**
 * Shared resolution helper for the legacy `/p/<shortId>/...` redirect stubs.
 *
 * Each stub looks up the (possibly ambiguous) `shortId` in the cache, falls
 * back to the API, then `router.replace`s to a `/t/<rootRouteId>...` URL
 * built by the caller via `buildTarget`. The three stubs (the bare poll
 * redirect plus `/info` and `/edit-title`) only differ in the trailing path
 * suffix and whether they accept a question-uuid form.
 */

import { useEffect, useMemo, Suspense } from "react";
import type { ReactNode } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  apiGetPollById,
  apiGetPollByShortId,
  apiGetQuestionById,
  ApiError,
} from "@/lib/api";
import { getCachedPollById, getCachedPollForShortId } from "@/lib/questionCache";
import { resolveThreadRootRouteId } from "@/lib/threadUtils";
import { isUuidLike } from "@/lib/questionId";
import type { Poll } from "@/lib/types";

/** Resolve `shortId` to a Poll: cache first, then API, optionally falling
 *  back to a question-uuid lookup (for the bare /p/<id> form). */
async function resolvePoll(shortId: string, allowQuestionUuid: boolean): Promise<Poll | null> {
  const cached = getCachedPollForShortId(shortId);
  if (cached) return cached;
  const isUuid = isUuidLike(shortId);
  const direct = await (isUuid ? apiGetPollById(shortId) : apiGetPollByShortId(shortId))
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });
  if (direct) return direct;
  if (allowQuestionUuid && isUuid) {
    const question = await apiGetQuestionById(shortId).catch(() => null);
    if (question?.poll_id) {
      return apiGetPollById(question.poll_id).catch(() => null);
    }
  }
  return null;
}

interface LegacyRedirectInnerProps {
  buildTarget: (rootRouteId: string, pollShortId: string) => string;
  allowQuestionUuid?: boolean;
}

function LegacyRedirectInner({ buildTarget, allowQuestionUuid = false }: LegacyRedirectInnerProps) {
  const router = useRouter();
  const params = useParams();
  const shortId = params.shortId as string;

  const cached = useMemo<Poll | null>(() => {
    if (typeof window === "undefined" || !shortId) return null;
    return getCachedPollForShortId(shortId);
  }, [shortId]);

  useEffect(() => {
    if (!shortId) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    (async () => {
      const poll = cached ?? await resolvePoll(shortId, allowQuestionUuid).catch(() => null);
      if (cancelled) return;
      if (!poll) {
        router.replace('/');
        return;
      }
      const rootRouteId = resolveThreadRootRouteId(poll);
      const pollShortId = poll.short_id || poll.id;
      router.replace(buildTarget(rootRouteId, pollShortId));
    })();
    return () => { cancelled = true; };
  }, [shortId, cached, router, buildTarget, allowQuestionUuid]);

  return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
}

interface LegacyRedirectPageProps extends LegacyRedirectInnerProps {
  fallback?: ReactNode;
}

/** Page-level wrapper that adds a Suspense boundary for `useParams`. */
export function LegacyRedirectPage({ buildTarget, allowQuestionUuid, fallback }: LegacyRedirectPageProps) {
  return (
    <Suspense fallback={fallback ?? <div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <LegacyRedirectInner buildTarget={buildTarget} allowQuestionUuid={allowQuestionUuid} />
    </Suspense>
  );
}

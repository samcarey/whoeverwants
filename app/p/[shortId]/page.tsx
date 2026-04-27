"use client";

import type { Poll, Question } from "@/lib/types";
import {
  apiGetPollById,
  apiGetPollByShortId,
  apiGetQuestionById,
  ApiError,
} from "@/lib/api";
import { addAccessibleQuestionId } from "@/lib/browserQuestionAccess";
import { discoverRelatedQuestions } from "@/lib/questionDiscovery";
import { getAccessiblePolls } from "@/lib/simpleQuestionQueries";
import {
  getCachedAccessiblePolls,
  getCachedPollById,
  getCachedPollByShortId,
  getCachedQuestionById,
} from "@/lib/questionCache";
import { findThreadRootRouteId, buildPollMap } from "@/lib/threadUtils";
import { isUuidLike } from "@/lib/questionId";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { ThreadContent } from "@/app/thread/[threadId]/page";

function QuestionContent() {
  const router = useRouter();
  const params = useParams();

  // Resolve synchronously from cache when possible so the thread view renders on first paint.
  // Phase 5b: short_id lives on the poll wrapper; the URL `/p/<id>/` may
  // point at a poll short_id, poll uuid, or question uuid. Cache
  // lookup tries each in turn.
  const resolvedInitial = (() => {
    if (typeof window === "undefined") return null;
    const raw = params.shortId as string;
    if (!raw) return null;
    let poll: Poll | null = null;
    let question: Question | null = null;
    if (isUuidLike(raw)) {
      poll = getCachedPollById(raw);
      if (poll) {
        question = poll.questions[0] ?? null;
      } else {
        const cachedQuestion = getCachedQuestionById(raw);
        if (cachedQuestion) {
          question = cachedQuestion;
          if (cachedQuestion.poll_id) {
            poll = getCachedPollById(cachedQuestion.poll_id);
          }
        }
      }
    } else {
      poll = getCachedPollByShortId(raw);
      if (poll) question = poll.questions[0] ?? null;
    }
    if (!question || !poll) return null;
    // Prepend the current poll so it wins over any stale entry.
    const byPoll = buildPollMap([poll, ...(getCachedAccessiblePolls() ?? [])]);
    const rootRouteId = findThreadRootRouteId(poll, (mid) => byPoll.get(mid) ?? null);
    return { question, rootRouteId };
  })();

  const [resolved, setResolved] = useState<{ question: Question; rootRouteId: string } | null>(resolvedInitial);
  const [error, setError] = useState(false);

  useEffect(() => {
    const shortId = params.shortId as string;
    if (!shortId) {
      router.replace("/");
      return;
    }

    // If we already resolved synchronously, just register access and skip the fetch.
    if (resolvedInitial) {
      addAccessibleQuestionId(resolvedInitial.question.id);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const isUuid = isUuidLike(shortId);
        // Phase 5b: try the poll endpoint first. A 404 means the URL is
        // a question uuid (the per-question endpoint resolves it, and we then
        // fetch the parent poll to find the root).
        let poll: Poll | null = await (isUuid
          ? apiGetPollById(shortId)
          : apiGetPollByShortId(shortId)
        ).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        });
        let question: Question | null = poll?.questions[0] ?? null;
        if (!poll && isUuid) {
          question = await apiGetQuestionById(shortId).catch(() => null);
          if (question?.poll_id) {
            poll = await apiGetPollById(question.poll_id).catch(() => null);
          }
        }
        if (!question || !poll) {
          if (!cancelled) setError(true);
          return;
        }
        addAccessibleQuestionId(question.id);
        // Run discovery + fetch accessible polls so ancestor wrappers
        // are available for the chain walk.
        try { await discoverRelatedQuestions(); } catch {}
        const accessible = (await getAccessiblePolls()) ?? [];
        const byPoll = buildPollMap([poll, ...accessible]);
        const rootRouteId = findThreadRootRouteId(poll, (mid) => byPoll.get(mid) ?? null);
        if (!cancelled) setResolved({ question, rootRouteId });
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
          <p className="text-gray-600 dark:text-gray-400">Loading question...</p>
        </div>
      </div>
    );
  }

  return (
    <ThreadContent
      threadId={resolved.rootRouteId}
      initialExpandedQuestionId={resolved.question.id}
    />
  );
}

export default function QuestionPage() {
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
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading question...</p>
        </div>
      </div>
    }>
      <QuestionContent />
    </Suspense>
  );
}

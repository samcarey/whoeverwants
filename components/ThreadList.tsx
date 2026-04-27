"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Poll } from "@/lib/types";
import { buildThreads, getThreadRouteId, Thread } from "@/lib/threadUtils";
import { relativeTime } from "@/lib/questionListUtils";
import { loadVotedQuestions } from "@/lib/votedQuestionsStorage";
import ClientOnly from "@/components/ClientOnly";
import RespondentCircles from "@/components/RespondentCircles";
import SimpleCountdown from "@/components/SimpleCountdown";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { apiGetVotes, apiGetQuestionResults } from "@/lib/api";

interface ThreadListProps {
  // Phase 5b: the home page passes the polls (wrapper-level units)
  // returned by getAccessiblePolls(). buildThreads walks
  // poll.follow_up_to to chain wrappers into threads.
  polls: Poll[];
}

export default function ThreadList({ polls }: ThreadListProps) {
  const router = useRouter();
  const { prefetchBatch } = usePrefetch();
  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(new Set());
  const [abstainedQuestionIds, setAbstainedQuestionIds] = useState<Set<string>>(new Set());
  const [pressedThreadId, setPressedThreadId] = useState<string | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);

  // Load voted/abstained from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
    setVotedQuestionIds(voted);
    setAbstainedQuestionIds(abstained);
  }, []);

  const threads = useMemo(() => {
    return buildThreads(polls, votedQuestionIds, abstainedQuestionIds);
  }, [polls, votedQuestionIds, abstainedQuestionIds]);

  // Prefetch thread page routes for all visible threads on mount
  useEffect(() => {
    if (threads.length === 0) return;
    const hrefs = threads.map(t => `/thread/${getThreadRouteId(t)}`);
    prefetchBatch(hrefs, { priority: "low" });
  }, [threads, prefetchBatch]);

  // Warm per-question votes + results for visible threads so the destination
  // renders from cache on first paint. apiGetVotes is coalesced; re-calls are cheap.
  const warmedThreadIdsRef = useRef<Set<string>>(new Set());
  const threadsByRootId = useMemo(
    () => new Map(threads.map((t) => [t.rootQuestionId, t])),
    [threads],
  );
  useEffect(() => {
    if (threads.length === 0 || typeof window === 'undefined') return;
    if (!('IntersectionObserver' in window)) return;

    warmedThreadIdsRef.current = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const rootQuestionId = entry.target.getAttribute('data-thread-root-id');
        if (!rootQuestionId || warmedThreadIdsRef.current.has(rootQuestionId)) continue;
        warmedThreadIdsRef.current.add(rootQuestionId);
        const thread = threadsByRootId.get(rootQuestionId);
        if (!thread) continue;
        for (const question of thread.questions) {
          void apiGetVotes(question.id).catch(() => null);
          if (!question.results) void apiGetQuestionResults(question.id).catch(() => null);
        }
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '200px' });

    const els = document.querySelectorAll<HTMLElement>('[data-thread-root-id]');
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [threads, threadsByRootId]);

  if (threads.length === 0) return null;

  return (
    <div>
      {threads.map((thread, index) => {
        const routeId = getThreadRouteId(thread);
        const latestQuestion = thread.latestQuestion;
        const hasUnvoted = thread.unvotedCount > 0;

        const goToThread = () => {
          navigateWithTransition(router, `/thread/${routeId}`, 'forward');
        };

        const handleTouchStart = (e: React.TouchEvent) => {
          isScrolling.current = false;
          setPressedThreadId(thread.rootQuestionId);
          touchStartPos.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        };

        const handleTouchEnd = () => {
          if (!isScrolling.current) {
            setPressedThreadId(null);
            goToThread();
          } else {
            setPressedThreadId(null);
          }
          touchStartPos.current = null;
          isScrolling.current = false;
        };

        const handleTouchMove = (e: React.TouchEvent) => {
          if (!touchStartPos.current) return;
          const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
          const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
          if (deltaX > 10 || deltaY > 10) {
            isScrolling.current = true;
            setPressedThreadId(null);
          }
        };

        return (
          <div
            key={thread.rootQuestionId}
            data-thread-root-id={thread.rootQuestionId}
            className={`border-b ${index === 0 ? 'border-t' : ''} border-gray-200 dark:border-gray-700 mx-1.5`}
          >
            <div
              onClick={goToThread}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              className={`flex gap-3 pl-2 pr-3 py-3 ${pressedThreadId === thread.rootQuestionId ? 'bg-blue-50 dark:bg-blue-900/30' : ''} hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-blue-50 dark:active:bg-blue-900/30 transition-colors cursor-pointer select-none relative`}
            >
              {/* Respondent circles */}
              <RespondentCircles
                names={thread.participantNames}
                anonymousCount={thread.anonymousRespondentCount}
              />

              {/* Text content */}
              <div className="flex-1 min-w-0">
                {/* Row 1: Thread title + unvoted badge */}
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`font-semibold text-base truncate flex-1 ${hasUnvoted ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                    {thread.title}
                  </h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasUnvoted && (
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                        {thread.unvotedCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: Latest question title (preview) */}
                <p className="text-sm text-gray-600 dark:text-gray-300 truncate mt-0.5">
                  {latestQuestion.title}
                </p>

                {/* Row 3: Metadata row */}
                <div className="flex items-center justify-between mt-1">
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    <ClientOnly fallback={null}>
                      <>
                        {thread.questions.length > 1 && <>{thread.questions.length} questions &middot; </>}
                        {relativeTime(latestQuestion.created_at)}
                      </>
                    </ClientOnly>
                  </div>
                  {thread.soonestUnvotedDeadline && (
                    <div className="text-xs">
                      <ClientOnly fallback={null}>
                        <SimpleCountdown deadline={thread.soonestUnvotedDeadline} colorClass="text-green-600 dark:text-green-400" hideSecondsInDays />
                      </ClientOnly>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

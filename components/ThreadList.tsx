"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Poll } from "@/lib/types";
import { buildThreads, getThreadRouteId, Thread } from "@/lib/threadUtils";
import { loadVotedQuestions } from "@/lib/votedQuestionsStorage";
import ThreadListItem from "@/components/ThreadListItem";
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
    const hrefs = threads.map(t => `/p/${getThreadRouteId(t)}?thread=1`);
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
          // The `thread=1` flag tells PollPageInner that this URL came from
          // the home thread-list pick (not a direct deep-link), so it can
          // suppress auto-expanding the linked poll when nothing about it is
          // actionable (voted on AND closed).
          navigateWithTransition(router, `/p/${routeId}?thread=1`, 'forward');
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
          <ThreadListItem
            key={thread.rootQuestionId}
            threadRootId={thread.rootQuestionId}
            title={thread.title}
            latestQuestionTitle={latestQuestion.title}
            participantNames={thread.participantNames}
            anonymousRespondentCount={thread.anonymousRespondentCount}
            questionCount={thread.questions.length}
            createdAt={latestQuestion.created_at}
            soonestUnvotedDeadline={thread.soonestUnvotedDeadline}
            unvotedCount={thread.unvotedCount}
            hasUnvoted={hasUnvoted}
            pressed={pressedThreadId === thread.rootQuestionId}
            isFirst={index === 0}
            onClick={goToThread}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
      })}
    </div>
  );
}

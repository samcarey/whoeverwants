"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Poll } from "@/lib/types";
import { buildThreads, getThreadHref, isPendingPollId, Thread } from "@/lib/threadUtils";
import { loadVotedQuestions } from "@/lib/votedQuestionsStorage";
import ThreadListItem from "@/components/ThreadListItem";
import ConfirmationModal from "@/components/ConfirmationModal";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { apiGetVotes, apiGetQuestionResults } from "@/lib/api";
import { forgetThread } from "@/lib/forgetQuestion";

interface ThreadListProps {
  // Phase 5b: the home page passes the polls (wrapper-level units)
  // returned by getAccessiblePolls(). buildThreads walks
  // poll.follow_up_to to chain wrappers into threads.
  polls: Poll[];
  /** Called after one or more threads are forgotten so the parent page can
   *  refresh its `polls` prop (re-fetch via getMyThreads). */
  onThreadsForgotten?: () => void;
}

const LONG_PRESS_MS = 500;

export default function ThreadList({ polls, onThreadsForgotten }: ThreadListProps) {
  const router = useRouter();
  const { prefetchBatch } = usePrefetch();
  // Load voted/abstained synchronously so the very first render's
  // buildThreads call sees the real voted state. Initializing these as
  // empty Sets and loading via useEffect made `pickTargetedPoll` treat
  // every question as awaiting on first render, so getThreadRouteId
  // pointed at the chronologically oldest poll (the thread root) instead
  // of the oldest unresponded open poll — clicks and prefetches that
  // raced React's post-effect re-render landed on the root URL.
  const [{ votedQuestionIds, abstainedQuestionIds }] = useState(() => {
    if (typeof window === 'undefined') {
      return { votedQuestionIds: new Set<string>(), abstainedQuestionIds: new Set<string>() };
    }
    return loadVotedQuestions();
  });
  const [pressedThreadId, setPressedThreadId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchHandledRef = useRef(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const threads = useMemo(() => {
    return buildThreads(polls, votedQuestionIds, abstainedQuestionIds);
  }, [polls, votedQuestionIds, abstainedQuestionIds]);

  // Threads can drop out from under us (deletions, re-fetch). Strip selection
  // ids that no longer correspond to a visible thread. (Selection mode stays
  // active even when the set is empty — the user exits explicitly via the
  // upper-left cancel button or Escape.)
  useEffect(() => {
    if (!selectionMode) return;
    const validIds = new Set(threads.map((t) => t.rootPollId));
    setSelectedThreadIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      return next;
    });
  }, [threads, selectionMode]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
    setConfirmingDelete(false);
  }, []);

  // Esc exits selection mode without deleting.
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelectionMode();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectionMode, exitSelectionMode]);

  // Prefetch thread page routes for all visible threads on mount.
  // `getThreadHref` returns `/t/<root>?p=<target>` (with the targeted poll
  // expanded) when the user has awaiting work, or `/t/<root>` (no expand,
  // scroll to bottom) when nothing's awaiting.
  useEffect(() => {
    if (threads.length === 0) return;
    const hrefs = threads.map(t => getThreadHref(t));
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
          if (isPendingPollId(question.id)) continue;
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

  const cancelLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const enterSelectionWithThread = useCallback((threadId: string) => {
    setSelectionMode(true);
    setSelectedThreadIds(new Set([threadId]));
    setPressedThreadId(null);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(50); } catch {}
    }
  }, []);

  const toggleThreadSelection = useCallback((threadId: string) => {
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    const idsToForget = new Set(selectedThreadIds);
    const threadsToForget = threads.filter((t) => idsToForget.has(t.rootPollId));
    for (const thread of threadsToForget) {
      forgetThread(thread);
    }
    setConfirmingDelete(false);
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
    onThreadsForgotten?.();
  }, [selectedThreadIds, threads, onThreadsForgotten]);

  if (threads.length === 0) return null;

  // Selection-mode chrome: cancel (X) button in upper-left visually replaces
  // the home page's gear icon (covers it via fixed positioning + higher
  // z-index), trashcan in upper-right. Both portal to document.body so the
  // template's stacking context can't trap them behind the title row.
  const selectionChrome = selectionMode && portalReady && typeof document !== 'undefined'
    ? createPortal(
        <>
          <button
            onClick={exitSelectionMode}
            aria-label="Exit selection mode"
            className="fixed z-50 w-10 h-10 rounded-full flex items-center justify-center bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 text-gray-700 dark:text-gray-200 shadow-md shadow-black/20 transition-colors"
            style={{
              left: 'max(0.5rem, env(safe-area-inset-left, 0px))',
              top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={selectedThreadIds.size === 0}
            aria-label={`Forget ${selectedThreadIds.size} selected thread${selectedThreadIds.size === 1 ? '' : 's'}`}
            className="fixed z-50 w-12 h-12 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-md shadow-black/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{
              right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
              top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
            }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
            {selectedThreadIds.size > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 text-xs font-bold flex items-center justify-center border border-red-600 dark:border-red-500">
                {selectedThreadIds.size}
              </span>
            )}
          </button>
        </>,
        document.body,
      )
    : null;

  return (
    <div>
      {selectionChrome}
      {threads.map((thread, index) => {
        const href = getThreadHref(thread);
        const latestQuestion = thread.latestQuestion;
        const hasUnvoted = thread.unvotedCount > 0;
        const threadKey = thread.rootPollId;

        const handleActivate = () => {
          if (selectionMode) {
            toggleThreadSelection(threadKey);
          } else {
            // `getThreadHref` returns `/t/<root>?p=<target>` when the thread has
            // awaiting work, else `/t/<root>` — the URL itself encodes whether
            // to auto-expand a poll, replacing the old `?thread=1` +
            // `suppressExpand` heuristic.
            navigateWithTransition(router, href, 'forward');
          }
        };

        const handleClick = () => {
          if (touchHandledRef.current) {
            // Touchend already handled this gesture; suppress synthetic click.
            return;
          }
          handleActivate();
        };

        const handleTouchStart = (e: React.TouchEvent) => {
          isScrolling.current = false;
          longPressFiredRef.current = false;
          touchHandledRef.current = false;
          setPressedThreadId(threadKey);
          touchStartPos.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
          cancelLongPressTimer();
          // Only arm long-press when not already in selection mode — once
          // in selection mode taps just toggle.
          if (!selectionMode) {
            longPressTimerRef.current = setTimeout(() => {
              if (isScrolling.current) return;
              longPressFiredRef.current = true;
              enterSelectionWithThread(threadKey);
            }, LONG_PRESS_MS);
          }
        };

        const handleTouchEnd = () => {
          cancelLongPressTimer();
          setPressedThreadId(null);
          const wasLongPress = longPressFiredRef.current;
          const wasScrolling = isScrolling.current;
          touchStartPos.current = null;
          isScrolling.current = false;
          if (wasLongPress || wasScrolling) {
            // Long-press already opened selection mode (or the user scrolled);
            // don't navigate or toggle. Suppress the synthetic click.
            touchHandledRef.current = true;
            setTimeout(() => { touchHandledRef.current = false; }, 400);
            return;
          }
          touchHandledRef.current = true;
          setTimeout(() => { touchHandledRef.current = false; }, 400);
          handleActivate();
        };

        const handleTouchMove = (e: React.TouchEvent) => {
          if (!touchStartPos.current) return;
          const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
          const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
          if (deltaX > 10 || deltaY > 10) {
            isScrolling.current = true;
            setPressedThreadId(null);
            cancelLongPressTimer();
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
            pressed={pressedThreadId === threadKey}
            isFirst={index === 0}
            selectionMode={selectionMode}
            isSelected={selectedThreadIds.has(threadKey)}
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
      })}

      {confirmingDelete && (
        <ConfirmationModal
          isOpen={true}
          title="Forget threads"
          message={`Forget ${selectedThreadIds.size} ${selectedThreadIds.size === 1 ? 'thread' : 'threads'}? This removes ${selectedThreadIds.size === 1 ? 'it' : 'them'} from this browser.`}
          confirmText="Forget"
          cancelText="Cancel"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

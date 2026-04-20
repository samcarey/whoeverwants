"use client";

import { useEffect, useLayoutEffect, useRef, useState, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import type { Poll } from "@/lib/types";
import type { Thread } from "@/lib/threadUtils";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { buildThreadFromPollDown } from "@/lib/threadUtils";
import { apiGetPollById, apiGetPollByShortId } from "@/lib/api";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls } from "@/lib/pollCache";
import { isUuidLike, normalizePath } from "@/lib/pollId";
import { loadVotedPolls } from "@/lib/votedPollsStorage";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import RespondentCircles from "@/components/RespondentCircles";

function buildThreadSync(threadId: string, voted: Set<string>, abstained: Set<string>): Thread | null {
  if (typeof window === 'undefined') return null;
  const anchor = isUuidLike(threadId) ? getCachedPollById(threadId) : getCachedPollByShortId(threadId);
  if (!anchor) return null;
  const polls = getCachedAccessiblePolls();
  if (!polls) return null;
  return buildThreadFromPollDown(anchor.id, polls, voted, abstained);
}

function ThreadInfoInner() {
  const router = useRouter();
  const params = useParams();
  const threadId = params.threadId as string;

  const [initialThread] = useState<Thread | null>(() => {
    if (typeof window === 'undefined') return null;
    const voted = loadVotedPolls();
    return buildThreadSync(threadId, voted.votedPollIds, voted.abstainedPollIds);
  });
  const [thread, setThread] = useState<Thread | null>(initialThread);
  const [loading, setLoading] = useState(!initialThread);
  const [error, setError] = useState(false);

  useLayoutEffect(() => {
    if (thread && !loading) {
      const path = normalizePath(window.location.pathname);
      document.documentElement.setAttribute('data-page-ready', path);
      return () => {
        if (document.documentElement.getAttribute('data-page-ready') === path) {
          document.documentElement.removeAttribute('data-page-ready');
        }
      };
    }
  }, [thread, loading]);

  useEffect(() => {
    async function fetchThread() {
      try {
        if (!initialThread) setLoading(true);
        setError(false);
        let anchorPoll: Poll;
        try {
          const cached = isUuidLike(threadId)
            ? getCachedPollById(threadId)
            : getCachedPollByShortId(threadId);
          if (cached) {
            anchorPoll = cached;
          } else if (isUuidLike(threadId)) {
            anchorPoll = await apiGetPollById(threadId);
          } else {
            anchorPoll = await apiGetPollByShortId(threadId);
          }
          addAccessiblePollId(anchorPoll.id);
        } catch {
          setError(true);
          return;
        }
        try { await discoverRelatedPolls(); } catch {}
        const polls = await getAccessiblePolls();
        if (!polls) { setError(true); return; }
        const { votedPollIds: voted, abstainedPollIds: abstained } = loadVotedPolls();
        const found = buildThreadFromPollDown(anchorPoll.id, polls, voted, abstained);
        if (!found) { setError(true); return; }
        setThread(found);
      } catch (err) {
        console.error('Error loading thread info:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchThread();
  }, [threadId]);

  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread]);

  const goBack = () => {
    if (hasAppHistory()) navigateBackWithTransition();
    else navigateWithTransition(router, `/thread/${threadId}`, 'back');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Thread Not Found</h2>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const totalCount = thread.participantNames.length;

  return (
    <>
      <div
        className="fixed left-0 right-0 top-0 z-20 bg-background touch-none"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div ref={headerRef} className="max-w-4xl mx-auto pl-2 pr-2 py-2 flex items-center gap-2">
          <button
            onClick={goBack}
            className="w-10 h-10 flex items-center justify-center shrink-0"
            aria-label="Go back"
          >
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="flex-1 min-w-0 text-center font-semibold text-lg text-gray-900 dark:text-white truncate px-1">
            {thread.title}
          </h1>
          <button
            onClick={() => navigateWithTransition(router, `/thread/${threadId}/edit-title`, 'forward')}
            className="w-10 h-10 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 text-sm font-medium"
            aria-label="Edit thread title"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: `calc(${headerHeight}px + 1rem)` }}>
        <div className="flex flex-col items-center text-center mb-6">
          <RespondentCircles names={thread.participantNames} anonymousCount={thread.anonymousRespondentCount} />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {totalCount} {totalCount === 1 ? 'person' : 'people'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {thread.participantNames.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No names submitted yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {thread.participantNames.map((name) => (
                <li key={name} className="px-4 py-3 text-gray-900 dark:text-white">
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

export default function ThreadInfoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    }>
      <ThreadInfoInner />
    </Suspense>
  );
}

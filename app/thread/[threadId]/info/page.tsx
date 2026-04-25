"use client";

import { Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useThread } from "@/lib/useThread";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import RespondentCircles from "@/components/RespondentCircles";
import { ThreadLoading, ThreadNotFound } from "@/components/ThreadLoadState";

function ThreadInfoInner() {
  const params = useParams();
  const threadId = params.threadId as string;
  const { thread, loading, error } = useThread(threadId);

  if (loading) return <ThreadLoading />;
  if (error || !thread) return <ThreadNotFound />;
  return <Info thread={thread} threadId={threadId} />;
}

function Info({ thread, threadId }: { thread: import("@/lib/threadUtils").Thread; threadId: string }) {
  const router = useRouter();
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  const goBack = () => {
    if (hasAppHistory()) navigateBackWithTransition();
    else navigateWithTransition(router, `/thread/${threadId}`, 'back');
  };

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
    <Suspense fallback={<ThreadLoading />}>
      <ThreadInfoInner />
    </Suspense>
  );
}

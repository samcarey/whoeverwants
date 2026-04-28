"use client";

import { Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useThread } from "@/lib/useThread";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import RespondentCircles from "@/components/RespondentCircles";
import ThreadHeader from "@/components/ThreadHeader";
import { ThreadLoading, ThreadNotFound } from "@/components/ThreadLoadState";

function ThreadInfoInner() {
  const params = useParams();
  const threadId = params.shortId as string;
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
    else navigateWithTransition(router, `/p/${threadId}`, 'back');
  };

  const totalCount = thread.participantNames.length;

  return (
    <>
      <ThreadHeader
        headerRef={headerRef}
        title={thread.title}
        onBack={goBack}
        rightSlot={
          <button
            onClick={() => navigateWithTransition(router, `/p/${threadId}/edit-title`, 'forward')}
            className="w-10 h-10 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 text-sm font-medium"
            aria-label="Edit thread title"
          >
            Edit
          </button>
        }
      />

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

"use client";

import { useState, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { apiUpdateMultipollThreadTitle } from "@/lib/api";
import { invalidatePoll } from "@/lib/pollCache";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useThread } from "@/lib/useThread";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import type { Thread } from "@/lib/threadUtils";
import { ThreadLoading, ThreadNotFound } from "@/components/ThreadLoadState";

function Editor({ thread, threadId }: { thread: Thread; threadId: string }) {
  const router = useRouter();
  const latestPoll = thread.polls[thread.polls.length - 1];
  const [value, setValue] = useState<string>(latestPoll.thread_title ?? '');
  const [saving, setSaving] = useState(false);

  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  const goBack = () => {
    if (hasAppHistory()) navigateBackWithTransition();
    else navigateWithTransition(router, `/thread/${threadId}/info`, 'back');
  };

  const save = async () => {
    if (saving) return;
    if (!latestPoll.multipoll_id) {
      console.error('Cannot edit thread title without multipoll_id');
      setSaving(false);
      return;
    }
    setSaving(true);
    try {
      await apiUpdateMultipollThreadTitle(latestPoll.multipoll_id, value.trim() || null);
      invalidatePoll(latestPoll.id);
      goBack();
    } catch (err) {
      console.error('Failed to update thread title:', err);
      setSaving(false);
    }
  };

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
            aria-label="Cancel"
          >
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="flex-1 min-w-0 text-center font-semibold text-lg text-gray-900 dark:text-white truncate px-1">
            Edit Title
          </h1>
          <button
            onClick={save}
            disabled={saving}
            className="w-14 h-10 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 text-sm font-semibold disabled:opacity-50"
            aria-label="Save thread title"
          >
            {saving ? '...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: `calc(${headerHeight}px + 1rem)` }}>
        <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Thread title</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => setValue(e.target.value.trim())}
          placeholder={thread.defaultTitle}
          autoFocus
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Leave blank to use the default: <span className="italic">{thread.defaultTitle}</span>
        </p>
      </div>
    </>
  );
}

function EditThreadTitleInner() {
  const params = useParams();
  const threadId = params.threadId as string;
  const { thread, loading, error } = useThread(threadId);

  if (loading) return <ThreadLoading />;
  if (error || !thread) return <ThreadNotFound />;
  return <Editor thread={thread} threadId={threadId} />;
}

export default function EditThreadTitlePage() {
  return (
    <Suspense fallback={<ThreadLoading />}>
      <EditThreadTitleInner />
    </Suspense>
  );
}

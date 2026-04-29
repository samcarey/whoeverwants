"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { apiGetQuestionById, apiGetPollById } from "@/lib/api";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import ThreadHeader from "@/components/ThreadHeader";
import { DRAFT_POLL_PORTAL_ID, THREAD_LATEST_QUESTION_ID_ATTR } from "@/lib/threadDomMarkers";

export const dynamic = 'force-dynamic';

// `/p/` serves two roles:
//   1. With `?id=<question-uuid>`, redirect to the friendly `/p/<short_id>` URL
//      (legacy deep-link compatibility).
//   2. With no params, render the empty placeholder for a not-yet-created
//      thread. The home page's "+" FAB and the What/When/Where bubble bar both
//      land here; the thread materializes once the user creates a question.
function PollRoot() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get('id');

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const question = await apiGetQuestionById(id);
        const pollId = question?.poll_id;
        const wrapper = pollId ? await apiGetPollById(pollId).catch(() => null) : null;
        if (wrapper?.short_id) {
          router.replace(`/p/${wrapper.short_id}`);
        } else {
          router.replace(`/p/${id}`);
        }
      } catch {
        router.replace(`/p/${id}`);
      }
    })();
  }, [id, router]);

  if (id) {
    return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
  }
  return <EmptyPlaceholder />;
}

function EmptyPlaceholder() {
  usePageReady(true);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  // Defense against stale `<body data-thread-latest-question-id>` from a
  // prior thread page — the create-poll submit handler reads it as the
  // implicit follow-up target, so a missed cleanup binds new threads as
  // follow-ups to whatever was previously viewed.
  useEffect(() => {
    document.body.removeAttribute(THREAD_LATEST_QUESTION_ID_ATTR);
  }, []);

  return (
    <>
      <ThreadHeader headerRef={headerRef} title="New Thread" />
      <div
        className="px-4 text-center"
        style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }}
      >
        <p className="text-base text-gray-700 dark:text-gray-300">
          Create a question and then share the link!
        </p>
        {/* Render target for the in-progress draft poll card while the
            create-poll panel is open. Filled by CreateQuestionContent. */}
        <div id={DRAFT_POLL_PORTAL_ID} className="mt-4" />
      </div>
    </>
  );
}

export default function PollRootPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <PollRoot />
    </Suspense>
  );
}

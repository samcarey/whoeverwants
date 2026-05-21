"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { apiGetQuestionById, apiGetPollById } from "@/lib/api";
import { getGroupHrefForPoll } from "@/lib/groupUtils";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import GroupHeader from "@/components/GroupHeader";
import BubbleBarPanel from "@/components/BubbleBarPanel";
import { GROUP_ID_ATTR } from "@/lib/groupDomMarkers";

export const dynamic = 'force-dynamic';

// `/g/` serves two roles:
//   1. With `?id=<question-uuid>`, look up the group root and redirect to
//      `/g/<rootShortId>?p=<pollShortId>` (legacy deep-link compatibility for
//      the old `/p/?id=<uuid>` form).
//   2. With no params, render the empty placeholder for a not-yet-created
//      group. The home page's new group button and the What/When/Where bubble bar both
//      land here; the group materializes once the user creates a question.
function GroupRoot() {
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
        if (!wrapper) {
          router.replace('/');
          return;
        }
        router.replace(getGroupHrefForPoll(wrapper));
      } catch {
        router.replace('/');
      }
    })();
  }, [id, router]);

  if (id) {
    return <div className="min-h-screen flex items-center justify-center">Redirecting...</div>;
  }
  return <EmptyPlaceholder />;
}

export function EmptyPlaceholder({ inOverlay = false }: { inOverlay?: boolean } = {}) {
  // Inside the slideOverlay, the underlying route hasn't changed yet
  // (we're still on `/`), so writing `data-page-ready=/g` would lie to
  // any other in-flight view-transition. Skip the signal when mounted
  // as the new group button's overlay; the real route mount fires it after router.push.
  usePageReady(!inOverlay);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  // Defense against stale `<body data-group-id>` from a prior group
  // page — the create-poll submit handler reads it as the group to
  // attach the new poll to, so a missed cleanup would bind new groups
  // to whichever was previously viewed. In the overlay variant the
  // caller restores this attribute as soon as `apiCreateGroup` resolves
  // so an early submit still binds to the right group.
  useEffect(() => {
    document.body.removeAttribute(GROUP_ID_ATTR);
  }, []);

  // Overlay variant mirrors GroupContent's empty-group header chrome
  // (avatar bubble + tappable title) so the handoff doesn't shift.
  // Real onTitleClick handler comes online when the route commits
  // behind the overlay; the placeholder is inert.
  const headerProps = inOverlay
    ? {
        headerRef,
        title: "New Group",
        participantNames: [] as string[],
        anonymousCount: 0,
        onTitleClick: () => {},
        backIconVariant: "menu" as const,
      }
    : { headerRef, title: "New Group", backIconVariant: "menu" as const };

  return (
    <>
      <GroupHeader {...headerProps} />
      <div style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }} />
      <BubbleBarPanel />
    </>
  );
}

export default function GroupRootPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <GroupRoot />
    </Suspense>
  );
}

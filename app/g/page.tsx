"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { apiGetQuestionById, apiGetPollById } from "@/lib/api";
import { getGroupHrefForPoll } from "@/lib/groupUtils";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import GroupHeader from "@/components/GroupHeader";
import GroupShareButton from "@/components/GroupShareButton";
import { DRAFT_POLL_PORTAL_ID, GROUP_ID_ATTR } from "@/lib/groupDomMarkers";

export const dynamic = 'force-dynamic';

// `/g/` serves two roles:
//   1. With `?id=<question-uuid>`, look up the group root and redirect to
//      `/g/<rootShortId>?p=<pollShortId>` (legacy deep-link compatibility for
//      the old `/p/?id=<uuid>` form).
//   2. With no params, render the empty placeholder for a not-yet-created
//      group. The home page's "+" FAB and the What/When/Where bubble bar both
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
  // as the FAB's overlay; the real route mount fires it after router.push.
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

  // When mounted as the FAB's slide overlay, render the same header
  // chrome (gray participant-avatar placeholder + Share button +
  // tappable title block) that the destination `/g/<short_id>` route's
  // GroupContent renders for a fresh empty group — without it, the
  // header visibly grows + populates as the overlay unmounts, which
  // reads as a layout shift. The Share button is given an empty
  // routeId (no-op handler) and onTitleClick is a no-op; both real
  // handlers come back online when the real route mounts behind us.
  //
  // The standalone `/g/` route (API-failure fallback path) keeps its
  // bare header — there's no real group to share / open info on.
  const headerProps = inOverlay
    ? {
        headerRef,
        title: "New Group",
        participantNames: [] as string[],
        anonymousCount: 0,
        imageUrl: null,
        onTitleClick: () => {},
        rightSlot: <GroupShareButton routeId="" title="New Group" />,
      }
    : { headerRef, title: "New Group" };

  return (
    <>
      <GroupHeader {...headerProps} />
      {/* The portal target deliberately has NO horizontal padding so the
          bubble bar inside it gets the same effective width as the one
          rendered into GroupContent's portal (which also has no px-*).
          Mismatching outer padding here was the cause of the bubble bar
          visibly rewrapping when the overlay handed off to the real
          route. Padding moves onto the <p> instead. */}
      <div style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }}>
        <p className="px-4 text-base text-gray-700 dark:text-gray-300 text-center">
          Create a question and then share the link!
        </p>
        {/* Render target for the in-progress draft poll card while the
            create-poll panel is open. Filled by CreateQuestionContent. */}
        <div id={DRAFT_POLL_PORTAL_ID} className="mt-4" />
      </div>
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

"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import GroupHeader from "@/components/GroupHeader";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { useSwipeBackGesture } from "@/lib/useSwipeBackGesture";
import { slideToGroupRoot } from "@/lib/slideOverlay";
import { hasAppHistory } from "@/lib/viewTransitions";
import { usePageReady } from "@/lib/usePageReady";
import {
  SHOW_GROUP_BACKDROP_EVENT,
  HIDE_GROUP_BACKDROP_EVENT,
  type GroupBackdropShowDetail,
} from "@/lib/eventChannels";
import {
  GROUP_ID_ATTR,
  DRAFT_POLL_PORTAL_ID,
  POLL_SEND_PORTAL_ID,
  POLL_PAGE_SCROLL_ATTR,
} from "@/lib/groupDomMarkers";
import { releaseIosKeyboardPrimer } from "@/lib/iosKeyboardPrimer";

interface NewPollDraftViewProps {
  groupId: string;
  /** True when rendered inside the slide overlay (a transient copy). The
   *  overlay copy skips the auto-focus so only the real route — mounted
   *  underneath — focuses the single live search input. */
  inOverlay?: boolean;
}

/**
 * Dedicated New-Poll draft page. The poll-creation search box + multi-question
 * draft-stack UI + the round ↑ send button are all owned by the layout-level
 * `CreateQuestionContent`, which portals them into this page's
 * `#draft-poll-portal` (search box + draft bubbles) and `#poll-send-portal`
 * (the upper-right send button). This page provides the chrome (fixed header
 * with "New Poll" title + back arrow + send slot), the swipe-back gesture, and
 * the on-load focus that opens the box "focused + animated to the top".
 */
export function NewPollDraftView({ groupId, inOverlay = false }: NewPollDraftViewProps) {
  const router = useRouter();
  const { group } = useGroup(groupId);
  usePageReady(!inOverlay);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([], 80);
  const portalRef = useRef<HTMLDivElement>(null);

  // Attach the group's uuid to <body data-group-id> so the create-poll submit
  // handler files the new poll into this group. Arriving via the floating
  // "Poll" button the group page already set it (and never clears it — see the
  // overlay-unmount-cleanup pitfall), so this is belt-and-braces for direct
  // navigation. No removeAttribute cleanup, for the same reason.
  useEffect(() => {
    if (group?.groupId) {
      document.body.setAttribute(GROUP_ID_ATTR, group.groupId);
    }
  }, [group?.groupId]);

  // On load (real route only), focus the portaled search input so the box
  // opens focused; its own onFocus handler runs the slide-to-top animation.
  // The input is portaled in by CreateQuestionContent a frame or two after this
  // page mounts, so retry until it appears. Scoped to THIS page's portal ref so
  // we never grab the slide overlay's transient copy. Releasing the keyboard
  // primer (claimed synchronously by the "Poll" button tap) lets iOS keep the
  // soft keyboard up across the navigation.
  useEffect(() => {
    if (inOverlay) return;
    let tries = 0;
    let timer = 0;
    const tryFocus = () => {
      const input = portalRef.current?.querySelector<HTMLInputElement>("input");
      if (input) {
        input.focus({ preventScroll: true });
        releaseIosKeyboardPrimer();
        return;
      }
      if (tries++ < 20) {
        timer = window.setTimeout(tryFocus, 50);
      } else {
        releaseIosKeyboardPrimer();
      }
    };
    // Wait one tick so the slide overlay's copy doesn't shadow the measurement
    // (its pill is mid-transform); the real route underneath is already static.
    timer = window.setTimeout(tryFocus, 80);
    return () => window.clearTimeout(timer);
  }, [inOverlay]);

  const goBack = () => {
    slideToGroupRoot({ groupId, direction: "back", useHistoryBack: hasAppHistory() });
  };

  // Swipe-back → group root (mirrors the scheduled / poll-detail pages). The
  // group backdrop renders the group behind the page during the drag; on commit
  // navigate directly (the backdrop already shows the group).
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef,
    showBackdrop: () => {
      window.dispatchEvent(
        new CustomEvent<GroupBackdropShowDetail>(SHOW_GROUP_BACKDROP_EVENT, {
          detail: { groupId },
        }),
      );
    },
    hideBackdrop: () => {
      window.dispatchEvent(new Event(HIDE_GROUP_BACKDROP_EVENT));
    },
    onCommit: () => router.push(`/g/${groupId}`),
  });

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title="New Poll"
        onBack={goBack}
        backIconVariant="arrow"
        // The round ↑ send button is portaled in here (upper-right) by
        // CreateQuestionContent; empty until a draft is staged.
        rightSlot={
          <div id={POLL_SEND_PORTAL_ID} className="self-stretch flex items-center pr-2" />
        }
      />

      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        // POLL_PAGE_SCROLL_ATTR lets the create-poll focus effect translate this
        // wrapper up (carrying the box) so the box animates to the top of the
        // screen when it focuses — same mechanism the group page uses. The
        // swipe gesture (the only other imperative transform writer here) can't
        // run while the box is focused, so the two never fight.
        {...{ [POLL_PAGE_SCROLL_ATTR]: "" }}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 1,
          background: "var(--background)",
          minHeight: "100dvh",
        }}
      >
        <div style={{ paddingTop: `calc(${headerHeight}px + 1.25rem)` }}>
          {/* Create-poll search box + draft-stack bubbles portal target.
              CreateQuestionContent (root layout) portals the box into it. */}
          <div id={DRAFT_POLL_PORTAL_ID} ref={portalRef} />
        </div>
      </div>
    </>
  );
}

export default function NewPollDraftPage() {
  const params = useParams();
  const raw = params?.groupShortId;
  const groupId = Array.isArray(raw) ? raw[0] : (raw ?? "");
  return <NewPollDraftView groupId={groupId} />;
}

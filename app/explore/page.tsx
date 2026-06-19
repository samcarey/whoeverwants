"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import {
  useSwipeBackGesture,
  useHeaderPortalRef,
} from "@/lib/useSwipeBackGesture";
import {
  SHOW_HOME_BACKDROP_EVENT,
  HIDE_HOME_BACKDROP_EVENT,
  HIDE_EXPLORE_BACKDROP_EVENT,
  EXPLORE_POLL_CHANGED_EVENT,
} from "@/lib/eventChannels";
import { setSwipeScrollbarLock } from "@/lib/scrollbarLock";
import HeaderPortal from "@/components/HeaderPortal";
import { apiGetExplore } from "@/lib/api/groups";
import { getCachedExplorePolls } from "@/lib/questionCache";
import { DRAFT_POLL_PORTAL_ID, EXPLORE_ATTR, GROUP_ID_ATTR } from "@/lib/groupDomMarkers";
import type { Poll } from "@/lib/types";
import { ExploreFeedList, ExploreTitleBar } from "@/components/ExploreFeed";

export default function ExplorePage() {
  const router = useRouter();
  usePageReady(true);

  // Seed from cache for a flicker-free first paint, then refresh.
  const [polls, setPolls] = useState<Poll[]>(() => getCachedExplorePolls() ?? []);
  const [loaded, setLoaded] = useState<boolean>(() => getCachedExplorePolls() !== null);
  const [exploreGroupId, setExploreGroupId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const feed = await apiGetExplore();
    setPolls(feed.polls);
    setExploreGroupId(feed.group?.id ?? null);
    setLoaded(true);
  }, []);

  // Mark the page as the explore composing surface so CreateQuestionContent
  // (the persistent bottom create bar) flags new polls as explore polls and
  // scopes its "recent polls" suggestions to the explore feed. Set the group
  // id once known so category-recency is scoped to the explore group. Also
  // dismiss the explore swipe backdrop + release the swipe scrollbar lock on
  // mount (covers the swipe-commit-from-poll-detail race, where the detail
  // page unmounts before its snap-back cleanup runs — same pattern as the
  // group/poll detail mount effects).
  useEffect(() => {
    document.body.setAttribute(EXPLORE_ATTR, "1");
    window.dispatchEvent(new Event(HIDE_EXPLORE_BACKDROP_EVENT));
    setSwipeScrollbarLock(false);
    return () => {
      document.body.removeAttribute(EXPLORE_ATTR);
      document.body.removeAttribute(GROUP_ID_ATTR);
    };
  }, []);
  useEffect(() => {
    if (exploreGroupId) document.body.setAttribute(GROUP_ID_ATTR, exploreGroupId);
    else document.body.removeAttribute(GROUP_ID_ATTR);
  }, [exploreGroupId]);

  // Initial fetch + refresh on create / tab re-show.
  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener(EXPLORE_POLL_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(EXPLORE_POLL_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Swipe-back → home (mirrors the settings page's gesture).
  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  const backButton = (
    <button
      onClick={() => navigateWithTransition(router, "/", "back")}
      className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      aria-label="Go back"
    >
      <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );

  return (
    <>
      {/* Fixed top bar (ExploreTitleBar fixed) pinned to the viewport top while
          the feed scrolls beneath. Rendered via HeaderPortal (the #header-portal
          node, a swipe-back transform target) so it slides with the page during
          the back gesture. Sits below the z-30 back button. */}
      <HeaderPortal>
        <ExploreTitleBar fixed />
        {backButton}
      </HeaderPortal>

      {/* z-index:2 + opaque background keeps the home backdrop hidden behind
          the page until the swipe moves the wrapper sideways. The negative
          horizontal margins cancel the template wrapper's `px-4` (1rem) PLUS
          the outer safe-area padding so the background paints all the way to
          the screen edges; the inner div re-applies only the safe-area inset
          so the cards sit edge-to-edge (like the group page). */}
      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          style={{
            paddingLeft: "max(0.35rem, env(safe-area-inset-left, 0px))",
            paddingRight: "max(0.35rem, env(safe-area-inset-right, 0px))",
            // Clear the fixed top bar (safe-area inset + the h-14 row).
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)",
            // The create pill is now an inline trigger in flow (it sits at the
            // end of the feed), so just normal bottom breathing room.
            paddingBottom: "1.5rem",
          }}
        >
          <ExploreFeedList polls={polls} />

          {loaded && polls.length === 0 && (
            <p className="text-center text-gray-500 dark:text-gray-400 px-6 py-16 leading-relaxed">
              Post anything here — a question, a poll, a plan.
              <br />
              For now, only you can see what you create.
            </p>
          )}

          {/* Portal target for the always-on create bar (the bottom plus
              button + text box). Rendered INSIDE the page content so the
              fixed bar inherits the page's transform during the swipe-back.
              See DRAFT_POLL_PORTAL_ID. */}
          <div id={DRAFT_POLL_PORTAL_ID} className="relative z-40" />
        </div>
      </div>
    </>
  );
}

"use client";

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
} from "@/lib/eventChannels";
import HeaderPortal from "@/components/HeaderPortal";

export default function ExplorePage() {
  const router = useRouter();
  usePageReady(true);

  // Swipe-back → home (mirrors the settings page's gesture). The home
  // backdrop (cached GroupList + home chrome) renders behind this page
  // during the drag; on commit we navigate directly with router.push (the
  // backdrop is already showing home). The header chrome is the
  // HeaderPortal-floated back button in the body-level `#header-portal`
  // node, so that node is the gesture's "header" transform target — the
  // button slides with the page (see app/layout.tsx for why the portal's
  // fixed/zero-height styling makes that safe).
  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  // Floating opaque-bubble back button, portaled into #header-portal
  // (outside .responsive-scaling-container so position:fixed is
  // viewport-relative on desktop — same as the settings / info pages).
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
      <HeaderPortal>{backButton}</HeaderPortal>

      {/* z-index:1 + opaque background keeps the home backdrop hidden behind
          the page until the swipe moves the wrapper sideways. The negative
          horizontal margins cancel the template wrapper's `px-4` (1rem) PLUS
          the outer safe-area padding so the background paints all the way to
          the screen edges; the inner div re-applies the inset so the content
          doesn't move. Mirrors the settings page. */}
      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          // z-2 (not z-1) so the persistent "+ Group" button can sit at z-1
          // during the swipe-back — above the z-0 home backdrop, below this
          // sliding page — and be revealed as the page slides off (rather
          // than popping on top at swipe start). See CreateGroupButtonHost.
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          style={{
            paddingLeft: "calc(1rem + max(0.35rem, env(safe-area-inset-left, 0px)))",
            paddingRight: "calc(1rem + max(0.35rem, env(safe-area-inset-right, 0px)))",
          }}
        >
          {/* Page title — "Explore". Lives inside the swipe wrapper (NOT the
              template) so it slides with the page during the back gesture. */}
          <div className="max-w-4xl mx-auto px-16 pb-1 page-title-safe-top">
            <h1 className="text-2xl font-bold text-center break-words select-none">
              Explore
            </h1>
          </div>

          <div className="question-content pt-0.5">
            <p className="text-center text-gray-500 dark:text-gray-400 py-16">
              This page is coming soon!
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

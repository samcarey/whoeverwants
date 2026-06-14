"use client";

/**
 * Body-level backdrop that mirrors the real home route (settings gear +
 * "Whoever Wants" title + cached GroupList). Mounted in app/layout.tsx so
 * it persists across the router.push that commits a swipe-back gesture —
 * without this persistence the backdrop would unmount alongside
 * GroupContent and there'd be a blank frame between GroupContent's
 * unmount and the real home page's first paint.
 *
 * The "+ Group" button is NOT painted by this backdrop — it lives in
 * `<CreateGroupButtonHost />` (also mounted at layout level), which
 * keeps a single persistent button instance visible throughout the
 * gesture. The fake button this host used to render was retired because
 * even with identical class lists the swap from fake (backdrop) to real
 * (template) caused a small position jump on iOS.
 *
 * Lifecycle:
 *   - SHOW_HOME_BACKDROP_EVENT (from GroupContent's swipe-lock path) → mount
 *   - HIDE_HOME_BACKDROP_EVENT (from snap-back/cancel OR home's mount
 *     effect) → unmount
 *
 * The backdrop sits at z-index 0 with an opaque background. The group
 * page's swipe wrapper at z-index 1 covers it until the gesture moves
 * the wrapper sideways, at which point the backdrop is revealed on the
 * left. After the swipe commits, the real home page mounts and dispatches
 * HIDE to dismiss this host — so the user sees a continuous visual from
 * backdrop → real home without any white frame in between.
 */

import { createPortal } from "react-dom";
import GroupList from "@/components/GroupList";
import { getCachedAccessiblePolls } from "@/lib/questionCache";
import { getCachedEmptyGroups } from "@/lib/simpleQuestionQueries";
import { getRememberedScroll, HOME_SCROLL_KEY } from "@/lib/scrollMemory";
import { useHomeBackdropActive } from "@/lib/useHomeBackdropActive";
import { getCachedSessionUser } from "@/lib/session";
import { isExploreButtonEnabled } from "@/lib/exploreButtonFlag";

export default function HomeBackdropHost(): React.ReactElement | null {
  const visible = useHomeBackdropActive();

  if (!visible || typeof document === "undefined") return null;

  // Mirror the real home page's empty-state so a swipe-back that reveals
  // home shows the "no groups" message + Sign In button DURING the slide
  // (not only after commit). Decorative — the Sign In button is inert.
  const cachedPolls = getCachedAccessiblePolls() ?? [];
  const cachedEmptyGroups = getCachedEmptyGroups() ?? [];
  const isEmpty = cachedPolls.length === 0 && cachedEmptyGroups.length === 0;
  const signedIn = !!getCachedSessionUser();
  // Mirror the real globe's gating (stored intent === the param the real
  // button reads, since syncExploreParam keeps them in lockstep). Without
  // this gate the backdrop always painted the globe, so a home-revealing
  // transition showed it for the duration of the slide and then dropped it
  // when the flag-off real home committed (the reported "shown until the
  // transition completes then disappears" flicker).
  const showExplore = isExploreButtonEnabled();

  return createPortal(
    // Wrap in a div carrying the Geist sans font-family. The portal target
    // is document.body, which only declares `--font-geist-sans` as a CSS
    // variable — the actual `font-family` rule lives on the inner wrapper
    // inside <ResponsiveScaling> that this portal bypasses. Without this
    // class the backdrop text renders in the browser default (Arial/
    // Helvetica) and snaps to Geist Sans the moment the real home page
    // mounts. Same pattern as SlideOverlayHost.
    <div className="font-[family-name:var(--font-geist-sans)]">
      <div
        ref={(el) => {
          if (!el) return;
          const remembered = getRememberedScroll(HOME_SCROLL_KEY);
          if (remembered !== undefined) el.scrollTop = remembered;
        }}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background: "var(--background)",
          // `overflow-y: auto` + `overflow-x: hidden` instead of just
          // `overflow-y: auto`. Per CSS spec, when one axis is non-
          // `visible` the other coerces from `visible` to `auto` — so a
          // bare `overflow-y: auto` turns into `auto/auto` and surfaces a
          // horizontal scrollbar (the cards-area's `-mx-4` extends ~1 rem
          // past the viewport edge). Explicit `overflow-x: hidden`
          // suppresses it.
          overflowX: "hidden",
          overflowY: "auto",
          // Mirror template.tsx's horizontal safe-area wrapper that the
          // real home page lives inside. Without this, the backdrop
          // content extends ~0.35rem further outward than the real home
          // and snaps inward when the transition commits.
          paddingLeft: "max(0.35rem, env(safe-area-inset-left))",
          paddingRight: "max(0.35rem, env(safe-area-inset-right))",
        }}
      >
        <div
          className="max-w-4xl mx-auto px-2 pb-1"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
        >
          {/* Mirror template.tsx's title row including the gear's absolute
              positioning relative to this `.relative` parent — keeps the
              gear's viewport x in lockstep with the real home so it
              doesn't shift right on commit. */}
          <div className="relative text-center">
            <span
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full"
              style={{
                left: "max(0.25rem, env(safe-area-inset-left, 0px))",
              }}
            >
              <svg
                className="w-6 h-6 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </span>
            {/* Mirror the explore globe (upper-right) so a swipe-back from
                /explore reveals a home that already has it — no pop-in on
                commit. Decorative; the real button lives in template.tsx.
                Gated on the same explore flag so a flag-off home doesn't
                flash the globe through the transition. */}
            {showExplore && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full"
              style={{
                right: "max(0.25rem, env(safe-area-inset-right, 0px))",
              }}
            >
              <svg
                className="w-6 h-6 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
            </span>
            )}
            <h1 className="text-2xl font-bold mb-1 select-none">Whoever Wants</h1>
          </div>
          <div className="h-7 flex items-center justify-center mb-1" />
        </div>
        <div
          className="max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4 pt-0.5"
          style={{ paddingBottom: "6rem" }}
        >
          {isEmpty && (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                You don&apos;t have access to any groups
              </p>
              {!signedIn && (
                <span className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg">
                  Sign In
                </span>
              )}
            </div>
          )}
          <GroupList polls={cachedPolls} emptyGroups={cachedEmptyGroups} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

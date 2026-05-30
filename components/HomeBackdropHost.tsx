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

export default function HomeBackdropHost(): React.ReactElement | null {
  const visible = useHomeBackdropActive();

  if (!visible || typeof document === "undefined") return null;

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
            <h1 className="text-2xl font-bold mb-1 select-none">Whoever Wants</h1>
          </div>
          <div className="h-7 flex items-center justify-center mb-1" />
        </div>
        <div
          className="max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4 pt-0.5"
          style={{ paddingBottom: "6rem" }}
        >
          <GroupList
            polls={getCachedAccessiblePolls() ?? []}
            emptyGroups={getCachedEmptyGroups() ?? []}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

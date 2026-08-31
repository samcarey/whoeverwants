"use client";

/**
 * Body-level backdrop that mirrors the real home route (settings gear +
 * "Whoever Wants" title + the playlist). Mounted in app/layout.tsx so
 * it persists across the router.push that commits a swipe-back gesture —
 * without this persistence the backdrop would unmount alongside
 * GroupContent and there'd be a blank frame between GroupContent's
 * unmount and the real home page's first paint.
 *
 * No floating button is painted here: home is the playlist, whose "+" lives
 * in its own header. (The "+ Group" FAB belongs to /groups — see
 * CreateGroupButtonHost, which keeps a single persistent instance. The fake
 * button this host used to render was retired because even with identical
 * class lists the swap from fake to real caused a position jump on iOS.)
 *
 * Lifecycle:
 *   - SHOW_HOME_BACKDROP_EVENT (from the swipe-lock path of any page that
 *     swipes back to home: /groups, /settings, /explore) → mount
 *   - HIDE_HOME_BACKDROP_EVENT (from snap-back/cancel OR home's mount
 *     effect) → unmount
 *
 * The backdrop sits at z-index 0 with an opaque background. The swiping
 * page's wrapper at z-index 2 covers it until the gesture moves
 * the wrapper sideways, at which point the backdrop is revealed on the
 * left. After the swipe commits, the real home page mounts and dispatches
 * HIDE to dismiss this host — so the user sees a continuous visual from
 * backdrop → real home without any white frame in between.
 */

import { createPortal } from "react-dom";
import PlaylistTab from "@/components/PlaylistTab";
import { getRememberedScroll, HOME_SCROLL_KEY } from "@/lib/scrollMemory";
import { useHomeBackdropActive } from "@/lib/useHomeBackdropActive";
import { isExploreButtonEnabled } from "@/lib/exploreButtonFlag";
import { isGroupsButtonEnabled } from "@/lib/groupsButtonFlag";
import {
  GearIcon,
  GlobeIcon,
  GroupsIcon,
  LegacyGroupsIcon,
  HOME_CHROME_SLOT_CLASS,
  GROUPS_BUTTON_RIGHT,
  EXPLORE_BUTTON_RIGHT,
  LEGACY_GROUPS_BUTTON_RIGHT,
} from "@/components/homeChromeIcons";

export default function HomeBackdropHost(): React.ReactElement | null {
  const visible = useHomeBackdropActive();

  if (!visible || typeof document === "undefined") return null;

  // Mirror the real globe's gating (stored intent === the param the real
  // button reads, since syncExploreParam keeps them in lockstep). Without
  // this gate the backdrop always painted the globe, so a home-revealing
  // transition showed it for the duration of the slide and then dropped it
  // when the flag-off real home committed (the reported "shown until the
  // transition completes then disappears" flicker).
  const showExplore = isExploreButtonEnabled();
  const showLegacyGroups = isGroupsButtonEnabled();

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
          // The timeline surface, NOT --background: this mirrors home, and
          // home paints the tinted surface (the slot cards are the ones in
          // --background). This layer covers the whole viewport and outlives
          // the commit by the unmount delay, so getting it wrong shows as the
          // white cards bleeding into a white page for that window — the real
          // page underneath is transparent, so whatever this paints IS the
          // background the user sees.
          background: "var(--playlist-surface)",
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
            <span aria-hidden="true" className={HOME_CHROME_SLOT_CLASS} style={{ left: "max(0.25rem, env(safe-area-inset-left, 0px))" }}>
              <GearIcon />
            </span>
            {/* Mirror the explore globe so a swipe-back from /explore reveals
                a home that already has it — no pop-in on commit. Gated on the
                same flag so a flag-off home doesn't flash it through the
                slide. Decorative; the real buttons live in template.tsx. */}
            {showLegacyGroups && (
              <span
                aria-hidden="true"
                className={HOME_CHROME_SLOT_CLASS}
                style={{ right: showExplore ? LEGACY_GROUPS_BUTTON_RIGHT : EXPLORE_BUTTON_RIGHT }}
              >
                <LegacyGroupsIcon />
              </span>
            )}
            {showExplore && (
              <span aria-hidden="true" className={HOME_CHROME_SLOT_CLASS} style={{ right: EXPLORE_BUTTON_RIGHT }}>
                <GlobeIcon />
              </span>
            )}
            <span aria-hidden="true" className={HOME_CHROME_SLOT_CLASS} style={{ right: GROUPS_BUTTON_RIGHT }}>
              <GroupsIcon />
            </span>
            <h1 className="text-2xl font-bold mb-1 select-none">Whoever Wants</h1>
          </div>
          <div className="h-7 flex items-center justify-center mb-1" />
        </div>
        <div
          className="max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4 pt-0.5"
          style={{ paddingBottom: "6rem" }}
        >
          {/* The real home page IS the playlist. PlaylistTab seeds itself
              from the slots cache, so this paints the timeline immediately
              instead of spinning through the slide (it also refetches on
              mount, which is harmless here and keeps the cache warm). */}
          <PlaylistTab />
        </div>
      </div>
    </div>,
    document.body,
  );
}

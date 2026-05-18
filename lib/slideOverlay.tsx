"use client";

/**
 * Overlay-slide navigation for instant page transitions.
 *
 * The View Transitions API gates animation start on the destination route
 * being committed + signaling `data-page-ready`; even with a warm cache that
 * adds ~300ms of router.push + snapshot work before the first frame moves.
 * This module renders the destination as a portal-mounted overlay above the
 * current page and slides it in via pure CSS transform, then fires
 * `router.push` (or `router.back`) in parallel so URL/history catch up while
 * the slide plays.
 *
 * Supported destination kinds (discriminated union in `SlideOverlayKind`):
 *   - `group`           → `<GroupContent>`
 *   - `groupInfo`       → `<GroupInfoView>` (member list / hero avatar)
 *   - `groupEditTitle`  → `<GroupEditTitleView>` (title + image staging)
 *   - `pollDetail`      → `<PollDetailView>` (full poll content, no card)
 *   - `pollInfo`        → `<PollInfoView>` (poll-level actions + respondents)
 *
 * All render inside the group-family layout (no template chrome, fixed
 * GroupHeader rendered by the page itself), so the same outer wrapper works
 * for every kind. Adding a new kind requires:
 *   1. Extend `SlideOverlayKind` in `lib/eventChannels.ts`.
 *   2. Export a prop-driven `<Kind>View` from the page's route file.
 *   3. Add a case in `renderForKind` here.
 *   4. Add a `slideToKind(...)` helper at the bottom of this file.
 *
 * Lifecycle:
 *   1. Caller invokes `slideToGroup` / `slideToGroupInfo` / etc.
 *   2. Host receives the event, sets phase='enter' (overlay mounts at
 *      translateX(±100%), transition:none — sign depends on direction).
 *   3. Double-rAF flips phase='shown' → CSS transition kicks in toward
 *      translateX(0). Single rAF can land in the same paint pass as the
 *      mount commit on some engines and skip the transition.
 *   4. The same render pass fires `router.push(href)` (or `router.back()`
 *      when `useHistoryBack`).
 *   5. Once `usePathname()` matches the destination AND the slide duration
 *      has elapsed, the overlay unmounts — the real route is now visible
 *      underneath with identical content (both renders read from
 *      `questionCache`, deduped via `coalesced()`).
 */

import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { isGroupRootView, normalizePath } from "./questionId";
import { getRememberedScroll, groupScrollKey } from "./scrollMemory";
import {
  SLIDE_TO_GROUP_EVENT,
  type SlideToGroupDetail,
  type SlideOverlayKind,
} from "./eventChannels";
import { GroupContent } from "@/app/g/[groupShortId]/GroupPage";
import { GroupInfoView } from "@/app/g/[groupShortId]/info/page";
import { GroupEditTitleView } from "@/app/g/[groupShortId]/edit-title/page";
import { PollDetailView } from "@/app/g/[groupShortId]/p/[pollShortId]/page";
import { PollInfoView } from "@/app/g/[groupShortId]/p/[pollShortId]/info/page";
import { EmptyPlaceholder } from "@/app/g/page";

const SLIDE_DURATION_MS = 350; // iOS push duration. Tune here only.
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
// Hard upper bound on overlay lifetime if pathname never matches (unexpected
// redirect, route error). Keeps the user from being stranded behind a stuck
// slide.
const OVERLAY_SAFETY_TIMEOUT_MS = 4000;

/** Fire-and-forget: dispatch the slide event. Caller doesn't await anything;
 *  the host component handles the full lifecycle. Safe inside React event
 *  handlers — does not synchronously update React state. */
function dispatchSlide(detail: SlideToGroupDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SLIDE_TO_GROUP_EVENT, { detail }));
}

/** Slide-in the group view (canonical iOS-style push from home or any
 *  page that conceptually contains the group as a child). */
export function slideToGroup(detail: {
  href: string;
  groupId: string;
}): void {
  dispatchSlide({
    href: detail.href,
    direction: 'forward',
    kind: { type: 'group', groupId: detail.groupId },
    // Same as `slideToGroupRoot` — if the user has a saved scroll for
    // this group from a previous visit, pre-position the overlay's
    // cards wrapper to that offset so the slide-in shows the correct
    // position rather than the top-of-list with a snap on unmount.
    overlayCardsOffset: getRememberedScroll(groupScrollKey(detail.groupId)),
  });
}

/** Slide-in a poll's detail page (tap on a group card). The destination
 *  renders the poll's full content full-bleed at `/g/<groupId>/p/<pollShortId>`. */
export function slideToPollDetail({
  groupId,
  pollShortId,
  direction = 'forward',
  useHistoryBack = false,
}: {
  groupId: string;
  pollShortId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): void {
  dispatchSlide({
    href: `/g/${groupId}/p/${pollShortId}`,
    direction,
    useHistoryBack,
    kind: { type: 'pollDetail', groupId, pollShortId },
  });
}

/** Slide-in the poll's /info subroute. Used by GroupHeader's title click on
 *  the poll detail page. Hosts forget / close / reopen / cutoff actions and
 *  the full respondent list. */
export function slideToPollInfo({
  groupId,
  pollShortId,
  direction = 'forward',
  useHistoryBack = false,
}: {
  groupId: string;
  pollShortId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): void {
  dispatchSlide({
    href: `/g/${groupId}/p/${pollShortId}/info`,
    direction,
    useHistoryBack,
    kind: { type: 'pollInfo', groupId, pollShortId },
  });
}

/** Slide-in the group's /info subroute. Used by GroupHeader's title click. */
export function slideToGroupInfo({
  groupId,
  direction = 'forward',
  useHistoryBack = false,
}: {
  groupId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): void {
  dispatchSlide({
    href: `/g/${groupId}/info`,
    direction,
    useHistoryBack,
    kind: { type: 'groupInfo', groupId },
  });
}

/** Slide-in the group's /edit-title subroute. */
export function slideToGroupEditTitle({
  groupId,
  direction = 'forward',
  useHistoryBack = false,
}: {
  groupId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): void {
  dispatchSlide({
    href: `/g/${groupId}/edit-title`,
    direction,
    useHistoryBack,
    kind: { type: 'groupEditTitle', groupId },
  });
}

/** Slide-in the "New Group" empty placeholder. Caller (the home "+" FAB)
 *  fires `apiCreateGroup` in parallel, then `router.push('/g/<short_id>')`
 *  on success or `router.push('/g')` on failure. The host skips its
 *  automatic router.push for this kind so the destination URL is decided
 *  by the caller once the API resolves. Unmount predicate prefix-matches
 *  any `/g[/...]` path so both outcomes unmount cleanly. */
export function slideToNewGroup(): void {
  dispatchSlide({
    href: '/g',
    direction: 'forward',
    kind: { type: 'newGroup' },
  });
}

/** Slide-in the group root (e.g. back from /info to /g/<id>). The `back`
 *  direction is typical, but the forward variant is supported too. */
export function slideToGroupRoot({
  groupId,
  direction = 'back',
  useHistoryBack = false,
}: {
  groupId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): void {
  // `href` is used for pathname matching at unmount time (normalizePath
  // strips query strings, so omitting `?p=` here is safe even when the
  // history entry we're popping to had one). When `useHistoryBack` is
  // true, router.back() restores the exact prior URL (including `?p=`).
  // `overlayCardsOffset` pre-positions the destination via cards-wrapper
  // transform so the slide doesn't show top-of-list followed by a snap.
  dispatchSlide({
    href: `/g/${groupId}`,
    direction,
    useHistoryBack,
    kind: { type: 'group', groupId },
    overlayCardsOffset: getRememberedScroll(groupScrollKey(groupId)),
  });
}

interface OverlayState extends SlideToGroupDetail {
  phase: "enter" | "shown";
}

function renderForKind(
  kind: SlideOverlayKind,
  overlayCardsOffset: number | undefined,
): React.ReactNode {
  switch (kind.type) {
    case 'group':
      // Pass the saved scroll as a visual offset on the cards wrapper.
      // The overlay itself does NOT scroll (its scrollTop stays 0), so
      // the fixed header isn't dragged off-screen by contain:strict's
      // position-fixed-scrolls-with-content behavior. The destination's
      // window.scrollY is set to the same value by GroupContent's own
      // layoutEffect, so when the overlay unmounts the real route shows
      // identical content with no visible motion.
      return (
        <GroupContent
          key={kind.groupId}
          groupId={kind.groupId}
          overlayCardsOffset={overlayCardsOffset}
        />
      );
    case 'groupInfo':
      return <GroupInfoView key={kind.groupId} groupId={kind.groupId} />;
    case 'groupEditTitle':
      return <GroupEditTitleView key={kind.groupId} groupId={kind.groupId} />;
    case 'pollDetail':
      return (
        <PollDetailView
          key={`${kind.groupId}/${kind.pollShortId}`}
          groupId={kind.groupId}
          pollShortId={kind.pollShortId}
        />
      );
    case 'pollInfo':
      return (
        <PollInfoView
          key={`${kind.groupId}/${kind.pollShortId}/info`}
          groupId={kind.groupId}
          pollShortId={kind.pollShortId}
        />
      );
    case 'newGroup':
      return <EmptyPlaceholder inOverlay />;
  }
}

/** Mount once at layout level (NOT template — template re-instances per
 *  navigation, which would unmount the overlay mid-slide). */
export function SlideOverlayHost(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<OverlayState | null>(null);
  // Guards against the push effect re-firing if state.href changes while
  // phase is still 'shown' (only happens if a new slide event arrives
  // mid-slide; that resets phase to 'enter' first, clearing the ref).
  const pushedRef = useRef(false);
  // Single ref-tracked timer covers both the pathname-match unmount and the
  // safety unmount. Cleared on every new slide event so a previous slide's
  // pending unmount can't null out the new state mid-flight.
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearUnmountTimer = () => {
    if (unmountTimerRef.current !== null) {
      clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SlideToGroupDetail>).detail;
      if (!detail) return;
      clearUnmountTimer();
      pushedRef.current = false;
      setState({ ...detail, phase: "enter" });
    };
    window.addEventListener(SLIDE_TO_GROUP_EVENT, handler);
    return () => window.removeEventListener(SLIDE_TO_GROUP_EVENT, handler);
  }, []);

  // Double-rAF so the browser paints the 'enter' frame at translateX(±100%)
  // before we change the transform — without that gap, the transition is
  // skipped on some engines.
  useLayoutEffect(() => {
    if (state?.phase !== "enter") return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setState((prev) => (prev ? { ...prev, phase: "shown" } : prev));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [state?.phase]);

  // Fire router.push (or router.back) once the slide has begun. Deferring
  // out of the event handler keeps the slide's first paint off the critical
  // path of router's internal commit work.
  //
  // Skipped for the 'newGroup' kind — the FAB fires its own router.push
  // once `apiCreateGroup` resolves (so the URL is the real `/g/<short_id>`
  // form rather than the placeholder `/g`). The slide still plays
  // immediately because the overlay handles the animation; the URL just
  // catches up a moment later.
  useEffect(() => {
    if (state?.phase !== "shown" || pushedRef.current) return;
    if (state.kind.type === 'newGroup') {
      pushedRef.current = true;
      return;
    }
    pushedRef.current = true;
    if (state.useHistoryBack) {
      router.back();
    } else {
      router.push(state.href);
    }
  }, [state?.phase, router]);

  // Overlay does not adjust its own `scrollTop`. The destination's
  // `<GroupContent>` runs its own initial-load `useLayoutEffect` that
  // bottom-pins `window.scrollY`; by the time the overlay unmounts,
  // the real route is already at the correct scroll position. Earlier
  // attempts that scrolled the overlay tripped a WebKit quirk where
  // `position:fixed` children of a `contain:strict` + transformed
  // ancestor scroll with the content, requiring a counter-translate
  // on the header to keep it at viewport top — and the
  // counter-translate went stale when `scrollHeight` changed mid-slide
  // (placeholder cards → real cards) because the browser auto-clamped
  // `overlay.scrollTop` to the new max while the header's transform
  // stayed frozen at the initial value, leaving the header drifting
  // mid-viewport on iOS Firefox. Not solving the problem at all
  // sidesteps the entire class of stale-transform bugs.

  // Unmount when either (a) the URL has flipped + slide duration has elapsed,
  // or (b) the safety timeout fires. One timer per slide; cleared on new
  // events via clearUnmountTimer.
  //
  // For the 'newGroup' kind the caller's final URL is dynamic
  // (`/g/<short_id>` on success, `/g` on failure), so we match any
  // group root view instead of requiring exact `state.href` equality.
  useEffect(() => {
    if (state?.phase !== "shown") return;
    clearUnmountTimer();
    const target = normalizePath(new URL(state.href, window.location.origin).pathname);
    const current = normalizePath(pathname || "/");
    const urlMatches =
      state.kind.type === 'newGroup'
        ? isGroupRootView(current)
        : current === target;
    const delay = urlMatches ? SLIDE_DURATION_MS + 30 : OVERLAY_SAFETY_TIMEOUT_MS;
    unmountTimerRef.current = setTimeout(() => {
      unmountTimerRef.current = null;
      setState(null);
    }, delay);
    return clearUnmountTimer;
  }, [pathname, state?.phase]);

  if (!state || typeof document === "undefined") return null;

  // Forward enters from the right; back from the left.
  const enterTransform =
    state.direction === 'back'
      ? "translate3d(-100%, 0, 0)"
      : "translate3d(100%, 0, 0)";
  const isGroupKind = state.kind.type === 'group';
  // Inner wrapper class must match what the destination route gets from
  // template.tsx around {children}. Group routes get the negative-margin
  // layout (max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4 + paddingBottom
  // 0.5rem); info / edit-title / pollDetail get the standard layout
  // (max-w-4xl mx-auto px-4 pb-6) — without matching this, the page's own
  // inner `max-w-4xl mx-auto px-4` is the only padding layer the overlay
  // has, and the unmount shifts the content inward as template's extra
  // px-4 kicks in. If template.tsx's wrapper ever changes, update this too.
  const innerClass = isGroupKind
    ? "max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4"
    : "max-w-4xl mx-auto px-4 pb-6";
  const innerStyle: React.CSSProperties | undefined = isGroupKind
    ? { paddingBottom: "0.5rem" }
    : undefined;

  return createPortal(
    <div
      aria-hidden="true"
      // Inherit Geist sans; the template's font wrapper is inside
      // ResponsiveScaling, outside the body portal target.
      className="font-[family-name:var(--font-geist-sans)]"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "var(--background, #ffffff)",
        transform:
          state.phase === "enter"
            ? enterTransform
            : "translate3d(0, 0, 0)",
        transition:
          state.phase === "enter"
            ? "none"
            : `transform ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`,
        willChange: "transform",
        contain: "strict",
        overflow: "hidden auto",
      }}
    >
      <div
        style={{
          paddingLeft: "max(0.35rem, env(safe-area-inset-left))",
          paddingRight: "max(0.35rem, env(safe-area-inset-right))",
        }}
      >
        <div className={innerClass} style={innerStyle}>
          {renderForKind(state.kind, state.overlayCardsOffset)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

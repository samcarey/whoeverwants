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
import { getRememberedScroll, groupScrollKey, pollScrollKey } from "./scrollMemory";
import {
  SLIDE_TO_GROUP_EVENT,
  SLIDE_OVERLAY_GROUP_ACTIVE_EVENT,
  type SlideToGroupDetail,
  type SlideOverlayGroupActiveDetail,
  type SlideOverlayKind,
} from "./eventChannels";
import { GroupContent } from "@/app/g/[groupShortId]/GroupPage";
import { GroupInfoView } from "@/app/g/[groupShortId]/info/page";
import { GroupEditTitleView } from "@/app/g/[groupShortId]/edit-title/page";
import { GroupInviteMembersView } from "@/app/g/[groupShortId]/invite-members/page";
import { PollDetailView } from "@/app/g/[groupShortId]/p/[pollShortId]/PollDetailPage";
import { ScheduledView } from "@/app/g/[groupShortId]/scheduled/page";
import { PollInfoView } from "@/app/g/[groupShortId]/p/[pollShortId]/info/page";
import { EmptyPlaceholder } from "@/app/g/page";

const SLIDE_DURATION_MS = 350; // iOS push duration. Tune here only.

// Module-level state for "is a group-kind overlay currently mounted?" —
// read synchronously by `useIsSlideOverlayGroupActive()` on first render
// (avoids a one-frame flash where the hook returns false while the event
// listener attaches). SlideOverlayHost is the sole writer.
let slideOverlayGroupActive = false;

function setSlideOverlayGroupActive(value: boolean): void {
  if (slideOverlayGroupActive === value) return;
  slideOverlayGroupActive = value;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<SlideOverlayGroupActiveDetail>(
        SLIDE_OVERLAY_GROUP_ACTIVE_EVENT,
        { detail: { active: value } },
      ),
    );
  }
}

/** Subscribe to whether a group-kind slide overlay is currently mounted.
 *  See `SLIDE_OVERLAY_GROUP_ACTIVE_EVENT` for the use case. */
export function useIsSlideOverlayGroupActive(): boolean {
  const [active, setActive] = useState<boolean>(slideOverlayGroupActive);
  useEffect(() => {
    // Re-sync in case the module-level value changed between the lazy
    // useState initializer and the effect attaching (rare but possible
    // in StrictMode dev double-mount + concurrent slide).
    setActive(slideOverlayGroupActive);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SlideOverlayGroupActiveDetail>).detail;
      if (!detail) return;
      setActive(detail.active);
    };
    window.addEventListener(SLIDE_OVERLAY_GROUP_ACTIVE_EVENT, handler);
    return () => window.removeEventListener(SLIDE_OVERLAY_GROUP_ACTIVE_EVENT, handler);
  }, []);
  return active;
}

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
    // Pre-position the overlay's cards wrapper to the poll's saved scroll
    // (set when the user left the detail page for /info or the group), so
    // the slide-in shows the position the real route will restore instead
    // of top-of-page with a snap on unmount. Undefined for a fresh poll.
    overlayCardsOffset: getRememberedScroll(pollScrollKey(pollShortId)),
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

/** Slide-in the group's /info subroute. Used by GroupHeader's title click.
 *  `chainTo` plays a follow-up slide once this one lands (see
 *  `SlideToGroupDetail.chainTo`) — the solo-group "Add People" CTA chains
 *  into `groupInviteMembersSlideDetail` so the /info history entry exists
 *  for invite-members' back button. */
export function slideToGroupInfo({
  groupId,
  direction = 'forward',
  useHistoryBack = false,
  chainTo,
}: {
  groupId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
  chainTo?: SlideToGroupDetail;
}): void {
  dispatchSlide({
    href: `/g/${groupId}/info`,
    direction,
    useHistoryBack,
    kind: { type: 'groupInfo', groupId },
    chainTo,
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

/** Detail for the group's /invite-members subroute slide. Exported (in
 *  addition to the dispatching helper below) so callers can pass it as a
 *  `chainTo` follow-up on another slide. */
export function groupInviteMembersSlideDetail({
  groupId,
  direction = 'forward',
  useHistoryBack = false,
}: {
  groupId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): SlideToGroupDetail {
  return {
    href: `/g/${groupId}/invite-members`,
    direction,
    useHistoryBack,
    kind: { type: 'groupInviteMembers', groupId },
  };
}

/** Slide-in the group's /invite-members subroute. Used by the "Add people"
 *  button atop the /info members list. */
export function slideToGroupInviteMembers(
  opts: Parameters<typeof groupInviteMembersSlideDetail>[0],
): void {
  dispatchSlide(groupInviteMembersSlideDetail(opts));
}

/** Slide-in the group's /scheduled subroute (upcoming recurring-poll
 *  instances). Reached from the "Scheduled ›" link at the top of the group
 *  scroll. */
export function slideToGroupScheduled({
  groupId,
  direction = 'forward',
  useHistoryBack = false,
}: {
  groupId: string;
  direction?: 'forward' | 'back';
  useHistoryBack?: boolean;
}): void {
  dispatchSlide({
    href: `/g/${groupId}/scheduled`,
    direction,
    useHistoryBack,
    kind: { type: 'groupScheduled', groupId },
  });
}

/** Slide-in the "New Group" empty placeholder. Caller (the home new group button)
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
          inOverlay
        />
      );
    case 'groupInfo':
      return <GroupInfoView key={kind.groupId} groupId={kind.groupId} />;
    case 'groupEditTitle':
      return <GroupEditTitleView key={kind.groupId} groupId={kind.groupId} />;
    case 'groupInviteMembers':
      return <GroupInviteMembersView key={kind.groupId} groupId={kind.groupId} />;
    case 'groupScheduled':
      return <ScheduledView key={kind.groupId} groupId={kind.groupId} />;
    case 'pollDetail':
      // `inOverlay` keeps this transient instance from scrolling the
      // document (the still-mounted source page) — the real route owns
      // window scroll; the overlay shows the right position via the
      // cards-wrapper `overlayCardsOffset` transform.
      return (
        <PollDetailView
          key={`${kind.groupId}/${kind.pollShortId}`}
          groupId={kind.groupId}
          pollShortId={kind.pollShortId}
          overlayCardsOffset={overlayCardsOffset}
          inOverlay
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

  // Broadcast group-kind overlay mount/unmount so the real-route
  // <GroupContent> for the destination can elevate its scroll-helper
  // arrows above the overlay during the slide. See
  // `SLIDE_OVERLAY_GROUP_ACTIVE_EVENT` for why.
  useEffect(() => {
    const isGroupKind =
      state?.kind.type === 'group' || state?.kind.type === 'newGroup';
    setSlideOverlayGroupActive(isGroupKind);
  }, [state?.kind.type]);

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
  // Skipped for the 'newGroup' kind — the new group button fires its own router.push
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
      // Only the `group` and `pollDetail` kinds run their own
      // scroll-restoration layoutEffect (GroupContent / PollDetail), so
      // they need `scroll: false` to stop Next.js' post-commit
      // scroll-to-0 from fighting it — on iOS Safari that leaves a
      // 13-30ms window where scrollY=0 right when the overlay unmounts,
      // visible as a bubble-bar / bottom-of-list flicker when the saved
      // scroll is near the doc bottom. Every other kind (groupInfo /
      // groupEditTitle / groupInviteMembers / pollInfo) has NO scroll
      // management and must land at the top: suppressing Next's
      // scroll-to-top there would preserve the (taller) parent page's
      // scrolled-down position underneath — clamped to the shorter
      // subroute's max — and reveal it jumped down when the overlay
      // unmounts. So let Next scroll the document to the top behind the
      // overlay for those, keeping the handoff seamless.
      const ownsScrollRestore =
        state.kind.type === 'group' || state.kind.type === 'pollDetail';
      router.push(state.href, { scroll: !ownsScrollRestore });
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
    const chainTo = urlMatches ? state.chainTo : undefined;
    unmountTimerRef.current = setTimeout(() => {
      unmountTimerRef.current = null;
      if (chainTo) {
        // Chained slide (see SlideToGroupDetail.chainTo): the URL has
        // genuinely flipped to this slide's destination, so the follow-up
        // slide's own router.push stacks the next history entry on top.
        // dispatchSlide is synchronous — the event handler above replaces
        // the overlay state in place (entering from the right over the
        // committed destination), so no setState(null) in between. The
        // safety-timeout branch deliberately DROPS the chain: if this
        // slide never landed, playing the next leg would compound the
        // failure.
        dispatchSlide(chainTo);
      } else {
        setState(null);
      }
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
  // layout (max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4, no bottom
  // padding — the create-poll search bar is position-fixed and reserves its
  // own space via the cards-wrapper's padding-bottom); info / edit-title /
  // pollDetail get the standard layout (max-w-4xl mx-auto px-4 pb-6).
  // Without matching this, the page's own inner `max-w-4xl mx-auto px-4`
  // is the only padding layer the overlay has, and the unmount shifts
  // the content inward as template's extra px-4 kicks in. If
  // template.tsx's wrapper ever changes, update this too.
  const innerClass = isGroupKind
    ? "max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4"
    : "max-w-4xl mx-auto px-4 pb-6";

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
        <div className={innerClass}>
          {renderForKind(state.kind, state.overlayCardsOffset)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
 *
 * All three render inside the group-family layout (no template chrome, fixed
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
import { normalizePath } from "./questionId";
import {
  SLIDE_TO_GROUP_EVENT,
  type SlideToGroupDetail,
  type SlideOverlayKind,
} from "./eventChannels";
import { GroupContent } from "@/app/g/[groupShortId]/GroupPage";
import { GroupInfoView } from "@/app/g/[groupShortId]/info/page";
import { GroupEditTitleView } from "@/app/g/[groupShortId]/edit-title/page";
import { EmptyPlaceholder } from "@/app/g/page";

const SLIDE_DURATION_MS = 350; // iOS push duration. Tune here only.
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
// Hard upper bound on overlay lifetime if pathname never matches (unexpected
// redirect, route error). Keeps the user from being stranded behind a stuck
// slide.
const OVERLAY_SAFETY_TIMEOUT_MS = 4000;
// rAF retries for the no-expand scroll-to-bottom (caps the wait if scrollHeight
// never settles, e.g. data fetch error). 30 frames ≈ 500ms at 60fps, plenty for
// the overlay's 380ms visible lifetime.
const SCROLL_RETRY_FRAMES = 30;
// Spread into the overlay's style when there's an expanded card. Collapses
// GroupContent's header→first-card gap so the first card sits flush with the
// header without needing overlay.scrollTop. See the overlayDivRef comment for
// why scrollTop doesn't work here.
const COLLAPSE_CARD_GAP_STYLE: React.CSSProperties = {
  ["--group-card-gap" as string]: "0px",
};

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
  expandedQuestionId: string | null;
}): void {
  dispatchSlide({
    href: detail.href,
    direction: 'forward',
    kind: {
      type: 'group',
      groupId: detail.groupId,
      expandedQuestionId: detail.expandedQuestionId,
    },
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
  dispatchSlide({
    href: `/g/${groupId}`,
    direction,
    useHistoryBack,
    kind: { type: 'group', groupId, expandedQuestionId: null },
  });
}

interface OverlayState extends SlideToGroupDetail {
  phase: "enter" | "shown";
}

function renderForKind(kind: SlideOverlayKind): React.ReactNode {
  switch (kind.type) {
    case 'group':
      return (
        <GroupContent
          key={kind.groupId}
          groupId={kind.groupId}
          initialExpandedQuestionId={kind.expandedQuestionId}
        />
      );
    case 'groupInfo':
      return <GroupInfoView key={kind.groupId} groupId={kind.groupId} />;
    case 'groupEditTitle':
      return <GroupEditTitleView key={kind.groupId} groupId={kind.groupId} />;
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
  // We can't use `overlay.scrollTop` to align cards with the header. The
  // overlay's `contain: strict` (combined with its transform) makes
  // `position: fixed` descendants behave like absolute-positioned within
  // the overlay — they scroll with the overlay's scrollTop. Setting
  // scrollTop=8 pulls the GroupHeader 8px above the viewport top
  // ("top bar shifts down" on unmount). Instead we collapse the 0.5rem gap
  // between header and first card via the `--group-card-gap` CSS variable
  // that GroupContent's `.pb-2` paddingTop reads: with the gap at 0 in the
  // overlay context, the first card sits at offsetTop = headerHeight
  // (flush with the header) without any scroll. The real route keeps the
  // 0.5rem default and reaches the same visual layout via window.scrollY,
  // so the unmount is a no-op.
  const overlayDivRef = useRef<HTMLDivElement>(null);

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

  // Group destinations without an expanded card scroll to the bottom of
  // their content (the draft poll card area). For the targeted-card case,
  // `--group-card-gap: 0px` (set on the overlay wrapper below) puts the
  // first card flush with the header without needing any scroll. See the
  // overlayDivRef comment above for why scrollTop doesn't work as an
  // alignment tool here.
  //
  // Only applies to `group` kind — info/edit-title pages don't have a
  // bottom-anchored scrolling element.
  const overlayMounted = state !== null;
  const isGroupNoExpand =
    state?.kind.type === 'group' && state.kind.expandedQuestionId === null;
  useLayoutEffect(() => {
    if (!overlayMounted) return;
    if (!isGroupNoExpand) return;
    let cancelled = false;
    let rafId: number | null = null;
    let attempts = 0;
    const scrollToBottom = () => {
      rafId = null;
      if (cancelled) return;
      const o = overlayDivRef.current;
      if (!o) return;
      const target = Math.max(0, o.scrollHeight - o.clientHeight);
      if (target === 0 && attempts++ < SCROLL_RETRY_FRAMES) {
        rafId = requestAnimationFrame(scrollToBottom);
        return;
      }
      if (o.scrollTop !== target) o.scrollTop = target;
    };
    scrollToBottom();
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [overlayMounted, isGroupNoExpand]);

  // Unmount when either (a) the URL has flipped + slide duration has elapsed,
  // or (b) the safety timeout fires. One timer per slide; cleared on new
  // events via clearUnmountTimer.
  //
  // For the 'newGroup' kind the caller's final URL is dynamic
  // (`/g/<short_id>` on success, `/g` on failure), so we prefix-match
  // `/g[/...]` instead of requiring an exact `state.href` match.
  useEffect(() => {
    if (state?.phase !== "shown") return;
    clearUnmountTimer();
    const target = normalizePath(new URL(state.href, window.location.origin).pathname);
    const current = normalizePath(pathname || "/");
    const urlMatches =
      state.kind.type === 'newGroup'
        ? current === '/g' || current.startsWith('/g/')
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
  // 4.5rem); info/edit-title get the standard layout (max-w-4xl mx-auto
  // px-4 pb-6) — without matching this, the page's own inner
  // `max-w-4xl mx-auto px-4` is the only padding layer the overlay has,
  // and the unmount shifts the content inward as template's extra px-4
  // kicks in. If template.tsx's wrapper ever changes, update this too.
  const innerClass = isGroupKind
    ? "max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4"
    : "max-w-4xl mx-auto px-4 pb-6";
  const innerStyle: React.CSSProperties | undefined = isGroupKind
    ? { paddingBottom: "4.5rem" }
    : undefined;

  return createPortal(
    <div
      ref={overlayDivRef}
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
        // TypeScript narrows state.kind to the 'group' variant inside this
        // check; needed to access .expandedQuestionId on the union.
        ...(state.kind.type === 'group' && state.kind.expandedQuestionId !== null
          ? COLLAPSE_CARD_GAP_STYLE
          : null),
      }}
    >
      <div
        style={{
          paddingLeft: "max(0.35rem, env(safe-area-inset-left))",
          paddingRight: "max(0.35rem, env(safe-area-inset-right))",
        }}
      >
        <div className={innerClass} style={innerStyle}>
          {renderForKind(state.kind)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

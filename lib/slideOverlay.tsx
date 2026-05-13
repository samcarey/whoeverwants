"use client";

/**
 * Overlay-slide navigation for instant home→group transitions.
 *
 * The View Transitions API gates animation start on the destination route
 * being committed + signaling `data-page-ready`; even with a warm cache that
 * adds ~300ms of router.push + snapshot work before the first frame moves.
 * This module renders the destination as a portal-mounted overlay above the
 * current page and slides it in via pure CSS transform, then fires
 * `router.push` in parallel so URL/history catch up while the slide plays.
 *
 * Lifecycle:
 *   1. Caller invokes `slideToGroup(...)` (or dispatches `SLIDE_TO_GROUP_EVENT`).
 *   2. Host receives the event, sets phase='enter' (overlay mounts at
 *      translateX(100%), transition:none).
 *   3. Double-rAF flips phase='shown' → CSS transition kicks in toward
 *      translateX(0). Single rAF can land in the same paint pass as the
 *      mount commit on some engines and skip the transition.
 *   4. The same render pass fires `router.push(href)`.
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
} from "./eventChannels";
import { GroupContent } from "@/app/g/[groupShortId]/GroupPage";

const SLIDE_DURATION_MS = 350; // iOS push duration. Tune here only.
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
// Hard upper bound on overlay lifetime if pathname never matches (unexpected
// redirect, route error). Keeps the user from being stranded behind a stuck
// slide.
const OVERLAY_SAFETY_TIMEOUT_MS = 4000;

/** Fire-and-forget: dispatch the slide event. Caller doesn't await anything;
 *  the host component handles the full lifecycle. Safe inside React event
 *  handlers — does not synchronously update React state. */
export function slideToGroup(detail: SlideToGroupDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SLIDE_TO_GROUP_EVENT, { detail }));
}

interface OverlayState extends SlideToGroupDetail {
  phase: "enter" | "shown";
}

/** Mount once at layout level (NOT template — template re-instances per
 *  navigation, which would unmount the overlay mid-slide). */
export function GroupSlideOverlayHost(): React.ReactElement | null {
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

  // Double-rAF so the browser paints the 'enter' frame at translateX(100%)
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

  // Fire router.push once the slide has begun. Deferring out of the event
  // handler keeps the slide's first paint off the critical path of
  // router.push's internal commit work.
  useEffect(() => {
    if (state?.phase !== "shown" || pushedRef.current) return;
    pushedRef.current = true;
    router.push(state.href);
  }, [state?.phase, router]);

  // The "no-expand" case (no `expandedQuestionId`) still needs the overlay
  // to show the bottom of the content (the draft poll card area). For that
  // case only, scroll the overlay to its scrollHeight — the GroupHeader
  // riding along with that scroll is fine because the user isn't looking
  // at it; they're looking at the bottom of the content where the draft
  // form lives. For the targeted-card case, `--group-card-gap: 0px` (set
  // on the overlay wrapper below) puts the first card flush with the
  // header without needing any scroll.
  const overlayMounted = state !== null;
  const expandedQuestionId = state?.expandedQuestionId ?? null;
  useLayoutEffect(() => {
    if (!overlayMounted) return;
    if (expandedQuestionId) return;
    let cancelled = false;
    let rafId: number | null = null;
    let attempts = 0;
    const scrollToBottom = () => {
      rafId = null;
      if (cancelled) return;
      const o = overlayDivRef.current;
      if (!o) return;
      const target = Math.max(0, o.scrollHeight - o.clientHeight);
      if (target === 0 && attempts++ < 30) {
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
  }, [overlayMounted, expandedQuestionId]);

  // Unmount when either (a) the URL has flipped + slide duration has elapsed,
  // or (b) the safety timeout fires. One timer per slide; cleared on new
  // events via clearUnmountTimer.
  useEffect(() => {
    if (state?.phase !== "shown") return;
    clearUnmountTimer();
    const target = normalizePath(new URL(state.href, window.location.origin).pathname);
    const urlMatches = normalizePath(pathname || "/") === target;
    const delay = urlMatches ? SLIDE_DURATION_MS + 30 : OVERLAY_SAFETY_TIMEOUT_MS;
    unmountTimerRef.current = setTimeout(() => {
      unmountTimerRef.current = null;
      setState(null);
    }, delay);
    return clearUnmountTimer;
  }, [pathname, state?.phase]);

  if (!state || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayDivRef}
      aria-hidden="true"
      // `font-[family-name:...]` matches the wrapper inside ResponsiveScaling
      // in app/layout.tsx so the overlay inherits the Geist sans variable
      // instead of falling through to body's Arial/Helvetica default.
      // `--group-card-gap: 0px` collapses the gap between GroupHeader and
      // the first card so the first card sits flush with the header
      // without needing overlay.scrollTop (which would also pull the
      // contain:strict header off the viewport — see the overlayDivRef
      // declaration).
      className="font-[family-name:var(--font-geist-sans)]"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "var(--background, #ffffff)",
        transform:
          state.phase === "enter"
            ? "translate3d(100%, 0, 0)"
            : "translate3d(0, 0, 0)",
        transition:
          state.phase === "enter"
            ? "none"
            : `transform ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`,
        willChange: "transform",
        contain: "strict",
        overflow: "hidden auto",
        ...(state.expandedQuestionId
          ? ({ ["--group-card-gap" as string]: "0px" } as React.CSSProperties)
          : {}),
      }}
    >
      {/* Mirrors template.tsx's wrappers around {children} for group routes
          (safe-area padding + max-w-4xl mx-auto -mx-4 + paddingBottom 4.5rem).
          Without these the overlay's cards render ~11px wider than the
          route's, producing a visible shrink at unmount. If template's wrapper
          ever changes, update this too. */}
      <div
        style={{
          paddingLeft: "max(0.35rem, env(safe-area-inset-left))",
          paddingRight: "max(0.35rem, env(safe-area-inset-right))",
        }}
      >
        <div
          className="max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4"
          style={{ paddingBottom: "4.5rem" }}
        >
          <GroupContent
            key={state.groupId}
            groupId={state.groupId}
            initialExpandedQuestionId={state.expandedQuestionId}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

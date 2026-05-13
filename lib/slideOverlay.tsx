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
  // The overlay has its own `overflow: hidden auto` scroll container, so
  // window.scrollY changes inside the overlay's GroupContent (initial
  // alignment of the expanded card with the header, scroll-helpers, etc.)
  // don't move the overlay's view. Without this sync the overlay shows
  // content at scrollTop=0 while window.scrollY ends up at the real route's
  // target — when the overlay unmounts, the cards visually jump by that
  // amount (the "slight shift after the slide completes" bug). The real-route
  // scroll typically lands AFTER the router.push commit (the home document
  // is too short to allow the target scrollY during the overlay-only phase),
  // so a scroll listener catches that update too.
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

  // Mirror window.scrollY → overlay.scrollTop ONCE the route has committed
  // to the slide target. See the overlayDivRef declaration for the rationale.
  // Why gate on the path match: before the commit the document is still the
  // origin route, so window.scrollY reflects the origin's scroll history
  // plus any in-flight relative-math scrollTo's from the overlay's own
  // GroupContent (those use `window.scrollY + targetDelta`). Mirroring those
  // would briefly snap the overlay to nonsensical positions. Once the real
  // route commits, Next.js applies its scroll restoration and the real
  // route's GroupContent computes an absolute target — at that point
  // window.scrollY matches what the user should see, and we mirror.
  const overlayMounted = state !== null;
  const targetPath = state
    ? normalizePath(new URL(state.href, window.location.origin).pathname)
    : null;
  const onTargetPath =
    overlayMounted && targetPath !== null && normalizePath(pathname || "/") === targetPath;
  useEffect(() => {
    if (!onTargetPath) return;
    const sync = () => {
      const d = overlayDivRef.current;
      if (d) d.scrollTop = window.scrollY;
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, [onTargetPath]);

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

"use client";

/**
 * Overlay-slide navigation: instant-feeling iOS-style push transitions.
 *
 * Why this exists: the View Transitions API gates the animation start on the
 * destination route being committed + `data-page-ready`. Even with a warm
 * cache (which makes the destination render in <10ms), `router.push` +
 * snapshot capture costs ~250-400ms before the first frame of the slide can
 * appear. That feels like "click → pause → slide" instead of "click → slide".
 *
 * This module mounts the destination as an overlay portal-rendered above the
 * current page, slides it in from the right via a pure CSS transform (no
 * snapshot involved), and only AFTER the slide animation has started calls
 * `router.push` so the URL/history catches up in the background. The user
 * perceives the slide beginning on the same frame as their tap.
 *
 * Lifecycle:
 *   1. Caller invokes `slideToGroup({ href, groupId, expandedQuestionId })`.
 *   2. <GroupSlideOverlayHost/> (mounted in app/template.tsx) receives the
 *      event, sets state to `{ phase: 'enter' }`, the overlay mounts with
 *      `transform: translate3d(100%, 0, 0)`.
 *   3. Next frame: phase flips to 'shown' → CSS transitions to `translate3d(0)`.
 *   4. Same tick the host calls `router.push(href)` to update URL + commit
 *      Next.js navigation in the background.
 *   5. When `usePathname()` matches the destination, the host unmounts the
 *      overlay — the real route is now the source of truth.
 *
 * The overlay's GroupContent reads from the same in-memory caches as the
 * route, so its first paint matches what the route renders. Duplicate API
 * calls during the brief overlap are deduped by the `coalesced()` helper
 * in `lib/api/_internal.ts`.
 */

import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { normalizePath } from "./questionId";
import { GroupContent } from "@/app/g/[groupShortId]/GroupPage";

export const SLIDE_TO_GROUP_EVENT = "__slide:to-group";
const SLIDE_DURATION_MS = 350; // iOS push duration. Tune here only.
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export interface SlideToGroupOptions {
  /** Canonical destination href, e.g. `/g/abc?p=xyz`. */
  href: string;
  /** Group route id (groups.short_id or root poll short_id). */
  groupId: string;
  /** Initial-expanded question id (resolved from `?p=`). */
  expandedQuestionId: string | null;
}

/** Fire-and-forget: dispatch the slide event. Caller doesn't await anything;
 *  the host component handles the full lifecycle. Safe to call from inside
 *  React event handlers — it does not synchronously update React state. */
export function slideToGroup(opts: SlideToGroupOptions): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SLIDE_TO_GROUP_EVENT, { detail: opts }));
}

interface OverlayState {
  href: string;
  groupId: string;
  expandedQuestionId: string | null;
  /** 'enter' = freshly mounted at translateX(100%); 'shown' = transitioning to 0;
   *  'done' = transition complete, awaiting route commit + unmount. */
  phase: "enter" | "shown" | "done";
}

/** Host component that listens for slide events and renders the overlay.
 *  Mount it once at the layout/template level (above any route content). */
export function GroupSlideOverlayHost(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<OverlayState | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  // True for the brief window between firing slideToGroup and Next.js
  // committing the new route. Holds onto the overlay until the route lands.
  const pushedRef = useRef(false);

  useEffect(() => { setIsMounted(true); }, []);

  // Event listener: arm a new overlay.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SlideToGroupOptions>).detail;
      if (!detail) return;
      // Reset push tracker — a previous slide that never fully resolved must
      // not block this one.
      pushedRef.current = false;
      setState({
        href: detail.href,
        groupId: detail.groupId,
        expandedQuestionId: detail.expandedQuestionId,
        phase: "enter",
      });
    };
    window.addEventListener(SLIDE_TO_GROUP_EVENT, handler);
    return () => window.removeEventListener(SLIDE_TO_GROUP_EVENT, handler);
  }, []);

  // After mounting at translateX(100%), flip to 'shown' on the next frame
  // so CSS transition fires. Two rAFs ensure the browser laid out the
  // 'enter' frame before we change the transform (single rAF is sometimes
  // batched into the same layout pass, skipping the transition).
  useLayoutEffect(() => {
    if (!state || state.phase !== "enter") return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setState((prev) => (prev && prev.phase === "enter" ? { ...prev, phase: "shown" } : prev));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [state?.phase]);

  // Once the slide has started (phase=shown), fire router.push so Next.js
  // navigation catches up. Done in an effect (not synchronously with the
  // event) so router.push's internal commit work doesn't compete with the
  // browser's first paint of the slide.
  useEffect(() => {
    if (!state || state.phase !== "shown" || pushedRef.current) return;
    pushedRef.current = true;
    router.push(state.href);
  }, [state?.phase, state?.href, router]);

  // Unmount the overlay once the URL has flipped to the destination AND
  // the slide animation has played long enough that the user perceives it
  // as complete. Removing the overlay too early causes a visible "snap"
  // back to the unaffected layout for one frame.
  useEffect(() => {
    if (!state) return;
    if (state.phase !== "shown") return;
    const currentPath = normalizePath(pathname || "/");
    const targetPath = normalizePath(new URL(state.href, "http://x").pathname);
    if (currentPath !== targetPath) return;
    // URL has flipped. Schedule unmount AT LEAST after the slide animation
    // would have finished, so the visual handoff is seamless.
    const timer = setTimeout(() => {
      setState(null);
    }, SLIDE_DURATION_MS + 30);
    return () => clearTimeout(timer);
  }, [pathname, state?.phase, state?.href]);

  // Safety: if router.push never causes pathname to match (e.g. an
  // unexpected redirect), unmount the overlay after a generous timeout so
  // we don't strand the user behind a stuck slide.
  useEffect(() => {
    if (!state || state.phase !== "shown") return;
    const timer = setTimeout(() => {
      setState(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [state?.phase]);

  if (!isMounted || !state) return null;

  // Always render directly to <body> so route changes don't unmount us.
  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        // The browser default for fixed elements: they paint above normal
        // flow but BELOW elements with a higher stacking context. The
        // template's HeaderPortal uses z-50 for the cancel button etc. —
        // 60 places the overlay above page content but the in-overlay
        // content can still install its own headers as needed.
        background: "var(--background, #ffffff)",
        transform:
          state.phase === "enter"
            ? "translate3d(100%, 0, 0)"
            : "translate3d(0, 0, 0)",
        transition:
          state.phase === "enter"
            ? "none"
            : `transform ${SLIDE_DURATION_MS}ms ${SLIDE_EASING}`,
        // Promote to its own composited layer so the slide animation runs
        // off the main thread (transform alone is enough on modern Chromium
        // + Safari, but `will-change` makes the promotion explicit).
        willChange: "transform",
        contain: "strict",
        overflow: "hidden auto",
      }}
    >
      <GroupContent
        key={state.groupId}
        groupId={state.groupId}
        initialExpandedQuestionId={state.expandedQuestionId}
      />
    </div>,
    document.body,
  );
}

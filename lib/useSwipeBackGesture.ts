"use client";

/**
 * iOS-style swipe-back gesture: dragging rightward on the page wrapper
 * slides it off to the right, revealing a backdrop underneath that shows
 * the user's destination. On commit (≥30% of viewport width OR velocity
 * ≥0.5 px/ms), `onCommit` is called and the wrapper finishes sliding off;
 * on cancel, the wrapper snaps back.
 *
 * Refs (not state) drive the per-frame transform so motion doesn't
 * trigger React re-renders. `touch-action: pan-y` on the wrapper hands
 * horizontal pans to the app while leaving vertical scroll to the
 * browser — we never preventDefault on touchmove (per CLAUDE.md: that
 * permanently kills iOS scroll for the touch sequence).
 *
 * Both consumers (`GroupContent` for group→home, `PollDetail` for
 * poll→group) keep their own backdrop event dispatchers; this hook only
 * orchestrates the gesture state-machine + transforms.
 */

import { useCallback, useRef } from "react";
import type React from "react";
import { setSwipeScrollbarLock } from "./scrollbarLock";

const COMMIT_OFFSET_RATIO = 0.3;
const COMMIT_VELOCITY = 0.5; // px/ms
const SWIPE_RECOGNIZE_THRESHOLD = 10; // px
const SNAP_BACK_DURATION_MS = 220;
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

interface SwipeBackGestureOptions {
  /** Fixed top-bar element that should slide with the page (transformed
   *  in lockstep with the wrapper). Caller already has this ref for
   *  layout measurement. */
  headerRef: React.RefObject<HTMLElement | null>;
  /** Additional body-portaled elements to transform alongside the wrapper
   *  (e.g. group page's scroll-helper arrows, the create-poll bar's portal
   *  node). Caller passes refs; this hook reads `current` on every transform.
   *  NOTE: applying a transform makes the target a NEW stacking context, so a
   *  static target drops to z-auto and can vanish behind the destination
   *  backdrop (z-0) mid-swipe — give any target that must stay visible an
   *  explicit `position: relative; z-index` above the backdrop. */
  extraTargets?: React.RefObject<HTMLElement | null>[];
  /** Mount the destination backdrop. Called once when motion crosses the
   *  swipe-recognize threshold. */
  showBackdrop: () => void;
  /** Unmount the destination backdrop. Called on snap-back / cancel; the
   *  commit path leaves the backdrop visible (destination's mount effect
   *  dismisses it). */
  hideBackdrop: () => void;
  /** Fired the moment the commit threshold is crossed — before the
   *  finishing transform — so the caller can save scroll memory etc. */
  onBeforeCommit?: () => void;
  /** Called after the finishing slide-off animation. Caller does the
   *  navigation (router.push / router.back). */
  onCommit: () => void;
}

export interface SwipeBackGestureHandle {
  swipeWrapperRef: React.RefObject<HTMLDivElement | null>;
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchCancel: () => void;
  };
}

interface SwipeState {
  startX: number;
  startY: number;
  swiping: boolean;
  ignored: boolean;
  startTime: number;
  committing: boolean;
}

export function useSwipeBackGesture(
  opts: SwipeBackGestureOptions,
): SwipeBackGestureHandle {
  const { headerRef, extraTargets, showBackdrop, hideBackdrop, onBeforeCommit, onCommit } = opts;

  const swipeWrapperRef = useRef<HTMLDivElement | null>(null);
  const swipeStateRef = useRef<SwipeState | null>(null);

  const collectTargets = useCallback((): (HTMLElement | null)[] => {
    const targets: (HTMLElement | null)[] = [
      swipeWrapperRef.current,
      headerRef.current,
    ];
    if (extraTargets) {
      for (const ref of extraTargets) targets.push(ref.current);
    }
    if (typeof document !== "undefined") {
      // The commit-age badge is portaled to body and shared across routes;
      // it must slide with whichever page is sliding so it doesn't strand
      // in place during the gesture.
      targets.push(document.getElementById("commit-badge-portal"));
    }
    return targets;
  }, [headerRef, extraTargets]);

  const applySwipeTransform = useCallback(
    (translateX: number, transitionMs: number) => {
      const wrapperTransform =
        translateX === 0 ? "" : `translate3d(${translateX}px, 0, 0)`;
      const transition =
        transitionMs > 0
          ? `transform ${transitionMs}ms ${SLIDE_EASING}`
          : "none";
      for (const el of collectTargets()) {
        if (!el) continue;
        el.style.transform = wrapperTransform;
        el.style.transition = transition;
      }
    },
    [collectTargets],
  );

  const clearSwipeTransform = useCallback(() => {
    for (const el of collectTargets()) {
      if (!el) continue;
      el.style.transform = "";
      el.style.transition = "";
    }
  }, [collectTargets]);

  const wrapShowBackdrop = useCallback(() => {
    setSwipeScrollbarLock(true);
    showBackdrop();
  }, [showBackdrop]);

  const wrapHideBackdrop = useCallback(() => {
    setSwipeScrollbarLock(false);
    hideBackdrop();
  }, [hideBackdrop]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeStateRef.current = null;
      return;
    }
    if (swipeStateRef.current?.committing) return;
    swipeStateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      swiping: false,
      ignored: false,
      startTime: Date.now(),
      committing: false,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const st = swipeStateRef.current;
    if (!st || st.ignored || st.committing) return;
    if (e.touches.length !== 1) {
      if (st.swiping) applySwipeTransform(0, 200);
      st.ignored = true;
      return;
    }
    const dx = e.touches[0].clientX - st.startX;
    const dy = e.touches[0].clientY - st.startY;
    if (!st.swiping) {
      // Decide direction once motion crosses the threshold. Require
      // horizontal motion to be dominant AND rightward; anything else
      // (vertical scroll, leftward drag) is not our gesture.
      if (Math.abs(dx) < SWIPE_RECOGNIZE_THRESHOLD && Math.abs(dy) < SWIPE_RECOGNIZE_THRESHOLD) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
        st.ignored = true;
        return;
      }
      st.swiping = true;
      wrapShowBackdrop();
    }
    // Cap at 0 so the user can't pull the page past its starting edge.
    applySwipeTransform(Math.max(0, dx), 0);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const st = swipeStateRef.current;
    if (!st || !st.swiping || st.ignored || st.committing) {
      swipeStateRef.current = null;
      return;
    }
    const endX = e.changedTouches[0]?.clientX ?? st.startX;
    const dx = endX - st.startX;
    const dt = Date.now() - st.startTime;
    const offset = Math.max(0, dx);
    const velocity = dx / Math.max(1, dt);
    const vw = window.innerWidth;
    const shouldCommit = offset >= vw * COMMIT_OFFSET_RATIO || velocity >= COMMIT_VELOCITY;
    if (shouldCommit) {
      st.committing = true;
      onBeforeCommit?.();
      // Block taps while the page slides off — otherwise a tap landing
      // on a button mid-slide could race the navigation.
      const wrapper = swipeWrapperRef.current;
      if (wrapper) wrapper.style.pointerEvents = "none";
      const remaining = vw - offset;
      const duration = Math.max(
        140,
        Math.min(360, remaining / Math.max(0.4, velocity)),
      );
      applySwipeTransform(vw, duration);
      window.setTimeout(onCommit, duration);
    } else {
      applySwipeTransform(0, SNAP_BACK_DURATION_MS);
      window.setTimeout(() => {
        clearSwipeTransform();
        swipeStateRef.current = null;
        wrapHideBackdrop();
      }, SNAP_BACK_DURATION_MS + 20);
    }
  };

  const onTouchCancel = () => {
    const st = swipeStateRef.current;
    swipeStateRef.current = null;
    if (st?.swiping && !st.committing) {
      applySwipeTransform(0, 200);
      window.setTimeout(() => {
        clearSwipeTransform();
        wrapHideBackdrop();
      }, 220);
    } else {
      wrapHideBackdrop();
    }
  };

  return {
    swipeWrapperRef,
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}

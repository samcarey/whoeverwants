/**
 * Swipe-down-to-dismiss for a bottom sheet (native iOS sheet behavior).
 *
 * Shared by the create-poll sheet (`app/create-poll/page.tsx`) and the
 * Playlist "New Slot" sheet (`components/NewSlotSheet.tsx`) so the subtle
 * gesture logic lives in one place — the pitfalls it bakes in (the 0ms-dt
 * velocity artifact, `atTop` gating so a mid-content downward drag still
 * scrolls, the imperative per-frame transform, the snap-back transition
 * restore) are exactly the kind of thing that drifts when copied.
 *
 * Attach the returned `sheetRef` + spread `touchHandlers` onto the OUTER sheet
 * div (the whole sheet — header, body, any sub-panel — moves rigidly), and
 * `backdropRef` onto the dim backdrop (faded out on commit). The per-frame
 * `translateY` is applied imperatively to `sheetRef` (no re-render). The
 * gesture engages only when the body scroller is at the top AND the drag is
 * downward-dominant; anything else is left to native scroll for that touch.
 *
 * Optional hooks let a specialized caller intercept:
 *   - `canStart()` → false bails the gesture at touchstart (create-poll uses
 *     this while a sub-panel is open, since it owns its own swipe-back).
 *   - `onBeforeDismiss()` → false snaps back instead of closing, so the caller
 *     can, e.g., show a "discard your draft?" confirm (side effects allowed).
 */

import { useCallback, useRef } from "react";

const RECOGNIZE_PX = 8;
const COMMIT_RATIO = 0.5; // dismiss past half the sheet height…
const COMMIT_VELOCITY = 0.5; // …or on a downward flick (px/ms)
const CLOSE_MS = 250;
const SNAP_BACK_MS = 220;
const EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

interface SheetDismissOptions {
  /** Ref to the scrollable sheet body — the gesture only engages at its top. */
  scrollerRef: { current: HTMLElement | null };
  /** Called to actually close the sheet after the slide-out animation. */
  onDismiss: () => void;
  /** Return false to skip the gesture entirely for this touch (default true). */
  canStart?: () => boolean;
  /** Return false to snap back instead of dismissing (default: always dismiss). */
  onBeforeDismiss?: () => boolean;
}

interface SwipeState {
  startY: number;
  startX: number;
  startTime: number;
  atTop: boolean;
  swiping: boolean;
  ignored: boolean;
}

export function useSheetDismissGesture({
  scrollerRef,
  onDismiss,
  canStart,
  onBeforeDismiss,
}: SheetDismissOptions) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<SwipeState | null>(null);

  const resetTransform = useCallback((el: HTMLDivElement) => {
    el.style.transition = "";
    el.style.transform = "";
  }, []);

  // The handlers are plain onTouch* props on a div (not window listeners), so
  // they can carry the caller callbacks in their deps and re-bind on identity
  // change — no window-listener churn, and a gesture reads its own state from
  // swipeRef regardless of which handler identity ends up bound.
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((canStart && !canStart()) || e.touches.length !== 1) {
        swipeRef.current = null;
        return;
      }
      const scroller = scrollerRef.current;
      swipeRef.current = {
        startY: e.touches[0].clientY,
        startX: e.touches[0].clientX,
        startTime: Date.now(),
        atTop: !scroller || scroller.scrollTop <= 0,
        swiping: false,
        ignored: false,
      };
    },
    [scrollerRef, canStart],
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const st = swipeRef.current;
    if (!st || st.ignored) return;
    if (e.touches.length !== 1) {
      st.ignored = true;
      return;
    }
    const dy = e.touches[0].clientY - st.startY;
    const dx = e.touches[0].clientX - st.startX;
    if (!st.swiping) {
      if (Math.abs(dy) < RECOGNIZE_PX && Math.abs(dx) < RECOGNIZE_PX) return;
      // Engage only for a downward, vertical-dominant drag that began at the
      // top of the body. Anything else (upward, horizontal, or started
      // mid-scroll) is left to the native scroll for this touch sequence.
      if (!st.atTop || dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
        st.ignored = true;
        return;
      }
      st.swiping = true;
    }
    const el = sheetRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const st = swipeRef.current;
      swipeRef.current = null;
      if (!st || !st.swiping || st.ignored) return;
      const endY = e.changedTouches[0]?.clientY ?? st.startY;
      const dy = Math.max(0, endY - st.startY);
      const dt = Date.now() - st.startTime;
      const velocity = (endY - st.startY) / Math.max(1, dt);
      const el = sheetRef.current;
      const height = el?.offsetHeight ?? window.innerHeight;
      const shouldClose = dy >= height * COMMIT_RATIO || velocity >= COMMIT_VELOCITY;

      const snapBack = () => {
        if (!el) return;
        el.style.transition = `transform ${SNAP_BACK_MS}ms ${EASING}`;
        el.style.transform = "translateY(0)";
        window.setTimeout(() => {
          if (sheetRef.current === el) resetTransform(el);
        }, SNAP_BACK_MS + 20);
      };

      if (!shouldClose) {
        snapBack();
        return;
      }
      // Caller may veto the dismiss (e.g. show a discard-confirm) — snap back.
      if (onBeforeDismiss && !onBeforeDismiss()) {
        snapBack();
        return;
      }
      // Slide the sheet the rest of the way down + fade the backdrop, then close.
      if (el) {
        el.style.transition = `transform ${CLOSE_MS}ms ${EASING}`;
        el.style.transform = "translateY(100%)";
      }
      if (backdropRef.current) {
        backdropRef.current.style.transition = `opacity ${CLOSE_MS}ms ease`;
        backdropRef.current.style.opacity = "0";
      }
      window.setTimeout(() => onDismiss(), CLOSE_MS);
    },
    [onDismiss, onBeforeDismiss, resetTransform],
  );

  return {
    sheetRef,
    backdropRef,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}

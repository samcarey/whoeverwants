"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import type React from "react";
import { DRAFT_POLL_PORTAL_ID } from "@/lib/groupDomMarkers";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";

// Pixels of scroll delta required before we update the cached direction —
// filters iOS momentum / rubber-band jitter that would otherwise toggle
// visibility on sub-pixel motion.
const SCROLL_DELTA_THRESHOLD = 5;

// Swallow touch propagation on the panel so a horizontal drag on the
// bubble row CAN'T initiate the page-level swipe-back-to-home gesture.
// The panel is already a sibling of `swipeWrapperRef` in the React tree
// (touches that start here don't bubble to the wrapper's React handlers
// via the structural separation), but `stopPropagation` makes the
// exemption explicit and defends against a future refactor that moves
// the panel inside the swipe wrapper. The native browser still gets
// the events for horizontal scroll of the bubble row.
// Module-scope so the function identity is stable across renders.
const stopTouchPropagation = (e: React.TouchEvent) => {
  e.stopPropagation();
};

/**
 * CSS variable set on `<html>` to the panel's measured height. Stable
 * regardless of visibility so the host's bottom padding doesn't reflow
 * when the panel hides. Exported so consumers don't hand-write the name.
 */
export const PANEL_HEIGHT_VAR = "--bubble-bar-panel-height";

/**
 * CSS variable set on `<html>` to the panel's height when visible, 0
 * when hidden. Other floating chrome (e.g. the down scroll-helper arrow)
 * reads this to stay above the panel while it's on-screen but reclaim
 * the space when it auto-hides.
 */
export const PANEL_OFFSET_VAR = "--bubble-bar-panel-offset";

/**
 * Fixed-bottom panel that hosts the create-poll bubble bar.
 *
 * The bar's JSX is owned by `CreateQuestionContent` (it queries for every
 * `#draft-poll-portal` in the DOM and renders into all matches); this
 * component just provides the panel chrome + an internal `#draft-poll-portal`
 * div, and runs the auto-hide scroll logic.
 *
 * Visibility rule:
 *   visible = atTopOfDocument || atBottomOfDocument || lastDirection === 'up'
 *
 * Showing at the top is the user's discoverability default ("you just
 * landed, here's how to create one"); showing at the bottom is the
 * `you've reached the end, here's how to keep going` case; showing on
 * scroll-up is the iOS-style "I want chrome back" gesture.
 *
 * Initial state is visible. Mounted by `GroupContent` and `EmptyPlaceholder`
 * as a sibling of the swipe wrapper (NOT a child): the panel is
 * `position: fixed`, and any transformed ancestor would re-anchor it to
 * that ancestor's containing block — pushing it far below the viewport on
 * tall pages during a back-swipe. Both the slide overlay's copy of
 * GroupContent and the real route's copy render their own BubbleBarPanel
 * — same dual-portal pattern the bubble bar already relies on.
 *
 * **Two-layer structure**: outer `shell` div is the swipe-back transform
 * target (position-fixed, no visuals); inner `panel` div carries the
 * background / border / safe-area padding + the visibility translateY.
 * Decoupling the two means `useSwipeBackGesture`'s
 * `el.style.transform = translate3d(X,0,0)` write on the shell composes
 * cleanly with the inner panel's translateY — neither overrides the
 * other. The forwarded ref points at the shell so callers can register
 * it as an extra swipe target.
 */
const BubbleBarPanel = forwardRef<HTMLDivElement>((_props, forwardedShellRef) => {
  const [visible, setVisible] = useState(true);
  // Bumped on every `visualViewport.resize` so `useMeasuredHeight`'s
  // ResizeObserver re-attaches and re-reads `offsetHeight`. iOS browsers
  // resolve `env(safe-area-inset-bottom)` differently depending on URL
  // bar / toolbar visibility, but the env()-driven size change isn't
  // always picked up by ResizeObserver on those browsers — refreshing via
  // a deps bump catches the shift so the host's padding stays correct.
  const [vvCounter, setVvCounter] = useState(0);
  // Initial height estimate covers a 3-row bubble bar + heading + 34px
  // safe-area inset (matches the fallback in the host's padding-bottom).
  const [panelRef, panelHeight] = useMeasuredHeight<HTMLDivElement>([vvCounter], 192);

  // Cached document scrollHeight — reading it on every scroll tick forces
  // a synchronous layout flush, which is expensive on long group pages.
  // Refresh only when the document actually resizes.
  const cachedScrollHeightRef = useRef(0);
  useEffect(() => {
    const update = () => {
      cachedScrollHeightRef.current = document.documentElement.scrollHeight;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);

  // Scroll-driven visibility.
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let lastDirection: "up" | "down" = "up";
    let rafId: number | null = null;

    const evaluate = () => {
      rafId = null;
      const currentY = window.scrollY;
      const maxScroll = Math.max(
        0,
        cachedScrollHeightRef.current - window.innerHeight,
      );
      // 2px tolerance for sub-pixel fp imprecision at the document
      // edges. When the doc can't scroll (maxScroll === 0), atBottom is
      // trivially true so the panel stays visible.
      const atTop = currentY <= 2;
      const atBottom = currentY >= maxScroll - 2;

      const delta = currentY - lastScrollY;
      if (Math.abs(delta) > SCROLL_DELTA_THRESHOLD) {
        lastDirection = delta > 0 ? "down" : "up";
        lastScrollY = currentY;
      }

      const nextVisible = atTop || atBottom || lastDirection === "up";
      setVisible((prev) => (prev === nextVisible ? prev : nextVisible));
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    // Initial eval — handles cases like back-nav landing scrolled.
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Track visualViewport resizes so the panel measurement stays current
  // when iOS toggles UA chrome (and `env(safe-area-inset-bottom)` shifts).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setVvCounter((n) => n + 1);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Write the two CSS vars whenever measurement OR visibility flips.
  // Guarded against no-op writes so the same value doesn't repeatedly
  // invalidate style on the cards-wrapper (which reads `--bubble-bar-
  // panel-height`) and the down scroll-helper arrow (which reads
  // `--bubble-bar-panel-offset`). On unmount we deliberately DON'T
  // clear the vars — a sibling instance (overlay vs real route during
  // a slide) may still be rendering and the host's padding would jump
  // to 0 otherwise.
  const lastWrittenRef = useRef({ height: -1, visible: true });
  useEffect(() => {
    const heightPx = Math.round(panelHeight);
    const last = lastWrittenRef.current;
    if (last.height === heightPx && last.visible === visible) return;
    lastWrittenRef.current = { height: heightPx, visible };
    const root = document.documentElement.style;
    root.setProperty(PANEL_HEIGHT_VAR, `${heightPx}px`);
    root.setProperty(PANEL_OFFSET_VAR, visible ? `${heightPx}px` : "0px");
  }, [panelHeight, visible]);

  return (
    <div
      ref={forwardedShellRef}
      className="fixed bottom-0 left-0 right-0 z-30"
      onTouchStart={stopTouchPropagation}
      onTouchMove={stopTouchPropagation}
      onTouchEnd={stopTouchPropagation}
      onTouchCancel={stopTouchPropagation}
    >
      <div
        ref={panelRef}
        aria-hidden={!visible}
        className="bg-background transition-transform duration-200 ease-out"
        style={{
          transform: visible ? "translateY(0)" : "translateY(100%)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div id={DRAFT_POLL_PORTAL_ID} />
      </div>
    </div>
  );
});

BubbleBarPanel.displayName = "BubbleBarPanel";

export default BubbleBarPanel;

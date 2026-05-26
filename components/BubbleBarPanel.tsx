"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import type React from "react";
import { DRAFT_POLL_PORTAL_ID } from "@/lib/groupDomMarkers";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { isScrollRestoring } from "@/lib/scrollRestoreState";

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

// Empty-panel threshold. The panel mounts with an empty `#draft-poll-portal`
// because the bubble bar JSX is owned by CreateQuestionContent (in
// app/layout.tsx) and gets portaled in asynchronously via its
// MutationObserver. Until that lands, the panel's offsetHeight is only its
// 1px border + `env(safe-area-inset-bottom)` — max ~35px on iPhone X-class,
// near 0 on browsers without safe-area. Writing this small value to the
// CSS var pulls the down scroll-helper arrow to the viewport bottom; when
// content lands and we rewrite to the real ~130px+ height, the arrow's
// `bottom` transition fires and the user sees it animate up — that's the
// "arrow repositions after the slide completes" bug. Skip writes below this
// threshold so consumers read the `:root` CSS default (192px) instead.
// Empirically the populated bar is ~88px (1-row + heading + padding) on a
// wide desktop viewport, ~130px+ (multi-row) on phone widths; the threshold
// sits comfortably above max empty (35px) and well below min populated.
const MIN_MEANINGFUL_PANEL_HEIGHT = 50;

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
 *   - At the top, or scrolling up: fully visible (the iOS-style "bring the
 *     chrome back" gesture + the landing discoverability default).
 *   - Scrolling down, more than a panel-height from the bottom: hidden.
 *   - Scrolling down within a panel-height of the bottom: slide up in sync
 *     with the scroll so the panel progressively fills the reserved padding
 *     under the last poll (never a void, never a pop).
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
  // Panel vertical offset as a percentage of its own height: 0 = fully
  // visible, 100 = fully hidden (translated entirely below the viewport).
  // Continuous (not boolean) so the panel can slide up *in sync* with the
  // scroll as the user nears the bottom of the list — progressively filling
  // the reserved padding under the last poll instead of popping into view
  // once the bottom is reached.
  const [translatePercent, setTranslatePercent] = useState(0);
  // Whether transform changes animate. ON for the auto-hide show/hide (the
  // 200ms ease "bring the chrome back" gesture); OFF while sliding in sync
  // near the bottom, where a transition would lag behind the finger.
  const [animate, setAnimate] = useState(true);
  // Bumped on every `visualViewport.resize` so `useMeasuredHeight`'s
  // ResizeObserver re-attaches and re-reads `offsetHeight`. iOS browsers
  // resolve `env(safe-area-inset-bottom)` differently depending on URL
  // bar / toolbar visibility, but the env()-driven size change isn't
  // always picked up by ResizeObserver on those browsers — refreshing via
  // a deps bump catches the shift so the host's padding stays correct.
  const [vvCounter, setVvCounter] = useState(0);
  // No seed value — default 0 keeps Render 1's `panelHeight` below
  // MIN_MEANINGFUL_PANEL_HEIGHT, so if Render 1's useEffect closure runs
  // (React behavior here is subtle when useLayoutEffect setState triggers
  // a re-render before paint) the threshold check skips the write. The
  // :root CSS default for `--bubble-bar-panel-offset` (192px) is what
  // consumers see until the real measurement lands and we override.
  const [panelRef, panelHeight] = useMeasuredHeight<HTMLDivElement>([vvCounter]);

  // Mirror the measured height into a ref so the scroll closure (empty-deps
  // effect, below) reads the live value without re-subscribing on resize.
  const panelHeightRef = useRef(0);
  useEffect(() => {
    panelHeightRef.current = panelHeight;
  }, [panelHeight]);

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
      // A back-nav scroll restore is replaying programmatic scroll jumps
      // (often 0 → a mid-list offset). Don't read those as the user scrolling
      // down — that would hide the bar at the restored position. Sync
      // lastScrollY so the first real post-restore scroll computes a correct
      // delta, and leave the transform untouched (the fresh-mounted panel
      // starts visible, which is what we want after a back-nav).
      if (isScrollRestoring()) {
        lastScrollY = currentY;
        return;
      }
      const maxScroll = Math.max(
        0,
        cachedScrollHeightRef.current - window.innerHeight,
      );
      const distanceFromBottom = Math.max(0, maxScroll - currentY);
      // 2px tolerance for sub-pixel fp imprecision at the top edge.
      const atTop = currentY <= 2;

      const delta = currentY - lastScrollY;
      if (Math.abs(delta) > SCROLL_DELTA_THRESHOLD) {
        lastDirection = delta > 0 ? "down" : "up";
        lastScrollY = currentY;
      }

      const h = panelHeightRef.current;
      let nextPercent: number;
      let nextAnimate: boolean;
      if (atTop || lastDirection === "up") {
        // Fully visible: just landed at the top, or the user scrolled up to
        // "bring the chrome back".
        nextPercent = 0;
        nextAnimate = true;
      } else if (h > 0 && distanceFromBottom < h) {
        // Within one panel-height of the bottom while scrolling down: slide
        // up in sync with the scroll so the panel exactly fills the reserved
        // padding under the last poll — no void, no pop. distanceFromBottom
        // === h → fully hidden (100%); at the very bottom → fully shown (0%).
        nextPercent = Math.min(100, (distanceFromBottom / h) * 100);
        nextAnimate = false;
      } else {
        // Scrolling down, more than a panel-height from the bottom: hidden.
        nextPercent = 100;
        nextAnimate = true;
      }

      setTranslatePercent((prev) => (prev === nextPercent ? prev : nextPercent));
      setAnimate((prev) => (prev === nextAnimate ? prev : nextAnimate));
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
  const lastWrittenRef = useRef({ height: -1, engaged: true });
  useEffect(() => {
    const heightPx = Math.round(panelHeight);
    // `engaged` = the panel is at least partially on-screen (mid-slide near
    // the bottom, or fully shown). The down scroll-helper arrow floats above
    // the panel's full height whenever it's engaged and drops to the bottom
    // only when fully hidden — a binary value (not the live partial offset)
    // so the arrow's own `bottom` transition doesn't lag the scroll.
    const engaged = translatePercent < 100;
    // Skip the empty-mount write — the panel is still waiting for its
    // bubble bar JSX to portal in. See MIN_MEANINGFUL_PANEL_HEIGHT above.
    if (engaged && heightPx < MIN_MEANINGFUL_PANEL_HEIGHT) return;
    const last = lastWrittenRef.current;
    if (last.height === heightPx && last.engaged === engaged) return;
    lastWrittenRef.current = { height: heightPx, engaged };
    const root = document.documentElement.style;
    root.setProperty(PANEL_HEIGHT_VAR, `${heightPx}px`);
    root.setProperty(PANEL_OFFSET_VAR, engaged ? `${heightPx}px` : "0px");
  }, [panelHeight, translatePercent]);

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
        aria-hidden={translatePercent >= 100}
        className={`bg-background${animate ? " transition-transform duration-200 ease-out" : ""}`}
        style={{
          transform: `translateY(${translatePercent}%)`,
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

"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { DRAFT_POLL_PORTAL_ID } from "@/lib/groupDomMarkers";

// Pixels of scroll delta required before we update the cached direction —
// filters iOS momentum / rubber-band jitter that would otherwise toggle
// visibility on sub-pixel motion.
const SCROLL_DELTA_THRESHOLD = 5;

// CSS vars exposed on `:root`:
//   --bubble-bar-panel-height — measured panel height. Stable regardless
//     of visibility so the host's bottom padding doesn't reflow when the
//     panel hides.
//   --bubble-bar-panel-offset — height when visible, 0 when hidden. Other
//     floating chrome (e.g. the down scroll-helper arrow) reads this to
//     stay above the panel while it's on-screen but reclaim the space
//     when it auto-hides.
const PANEL_HEIGHT_VAR = "--bubble-bar-panel-height";
const PANEL_OFFSET_VAR = "--bubble-bar-panel-offset";

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
  const panelRef = useRef<HTMLDivElement>(null);

  // Scroll-driven visibility.
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let lastDirection: "up" | "down" = "up";
    let rafScheduled = false;

    const evaluate = () => {
      rafScheduled = false;
      const currentY = window.scrollY;
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
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
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    // Initial eval — handles cases like back-nav landing scrolled.
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  // Measure panel height + mirror it into two CSS vars. Both vars need to
  // stay in sync with the latest measurement AND the latest visibility, so
  // we route every update through a single writer driven by:
  //   - ResizeObserver on the panel (height changes)
  //   - the visibility effect below (toggles the offset between full
  //     height and 0)
  // The visibleRef bridges the two: the measure effect reads the latest
  // visibility without listing it in deps (we don't want to tear down the
  // observer on every scroll-direction flip).
  const measuredHeightRef = useRef(0);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const writeCssVars = (heightPx: number, isVisible: boolean) => {
    const root = document.documentElement.style;
    root.setProperty(PANEL_HEIGHT_VAR, `${heightPx}px`);
    root.setProperty(PANEL_OFFSET_VAR, isVisible ? `${heightPx}px` : "0px");
  };

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onMeasure = (h: number) => {
      const rounded = Math.round(h);
      measuredHeightRef.current = rounded;
      writeCssVars(rounded, visibleRef.current);
    };
    const remeasure = () => {
      if (panelRef.current) onMeasure(panelRef.current.offsetHeight);
    };
    onMeasure(el.offsetHeight);
    // rAF-defer the observer callback so the CSS-var write doesn't run
    // in the same tick that observed the size change. Without this,
    // browsers raise "ResizeObserver loop completed with undelivered
    // notifications" warnings (benign, but they noise the client log
    // forwarder).
    let pendingHeight: number | null = null;
    let rafId: number | null = null;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        pendingHeight = entry.contentRect.height;
      }
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (pendingHeight !== null) {
          onMeasure(pendingHeight);
          pendingHeight = null;
        }
      });
    });
    observer.observe(el);
    // iOS browsers can resolve `env(safe-area-inset-bottom)` differently
    // depending on URL-bar / toolbar visibility — but the panel's
    // bounding box change isn't always picked up by ResizeObserver on
    // those browsers. Re-measure on visualViewport resize to catch the
    // env() shift so the host's padding stays correct as the user scrolls
    // and the UA chrome toggles.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", remeasure);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      vv?.removeEventListener("resize", remeasure);
      // Don't clear the vars on unmount — a sibling instance (overlay vs
      // real route during a slide) may still be rendering and the host's
      // padding would jump to 0 otherwise.
    };
  }, []);

  // Re-write on visibility flips (no measurement change, just the offset
  // toggle).
  useEffect(() => {
    writeCssVars(measuredHeightRef.current, visible);
  }, [visible]);

  return (
    <div
      ref={forwardedShellRef}
      className="fixed bottom-0 left-0 right-0 z-30"
    >
      <div
        ref={panelRef}
        aria-hidden={!visible}
        className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 transition-transform duration-200 ease-out"
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

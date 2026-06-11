"use client";

import { useEffect, useRef, useState } from "react";

interface KeyboardSuggestionPickerProps {
  /**
   * When true, expands into a full-screen, keyboard-aware picker pinned to the
   * visual viewport (rows fill the area above the keyboard, the input bar sits
   * just above it). When false, renders ONLY the bottom input bar (a collapsed
   * pill anchored to the bottom edge).
   */
  focused: boolean;
  /**
   * The suggestion rows. Bottom-anchored ("best match nearest the bar") and
   * shown only while focused. The first child rendered ends up furthest from
   * the bar; render the most-relevant row last (nearest the input).
   */
  rows: React.ReactNode;
  /** The input bar content (a pill row). Always rendered at the bottom. */
  children: React.ReactNode;
  /**
   * Outer stacking class. The settled new-poll bar lives inside the group
   * content's portal target (z-40 within it); a body-portalled overlay that
   * must cover a modal passes a higher z (e.g. `z-[85]`).
   */
  zClassName?: string;
  /** Ref to the bottom input-bar wrapper (e.g. to measure its collapsed height). */
  barRef?: React.Ref<HTMLDivElement>;
  /**
   * Bump whenever the rows change so the list re-pins to the bottom (the
   * bottom-anchored list keeps the best match in view as suggestions shift).
   */
  scrollSignal?: unknown;
}

/**
 * The shared keyboard-aware suggestion-picker chrome behind BOTH the new-poll
 * search bar (`app/create-poll/page.tsx`) and the category autocomplete
 * overlay (`AutocompleteInput.tsx`).
 *
 * iOS keeps the layout viewport at full height when the keyboard opens (a
 * `position: fixed; bottom: 0` element would sit BEHIND the keyboard), so we
 * pin the container to `top: vv.offsetTop; height: vv.height` — its bottom edge
 * then lands flush on the keyboard's top and the input bar (the last child)
 * sits just above it.
 *
 * Body-scroll-lock is intentionally NOT done here — each callsite owns its own
 * lock (the new-poll bar composes it with the modal lock; the autocomplete
 * overlay locks on its own open state), so the lock snapshot/restore can't
 * thrash across the focus → modal-open handoff.
 */
export default function KeyboardSuggestionPicker({
  focused,
  rows,
  children,
  zClassName = "z-40",
  barRef,
  scrollSignal,
}: KeyboardSuggestionPickerProps) {
  const [vv, setVv] = useState<{ height: number; offsetTop: number }>({
    height: 0,
    offsetTop: 0,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Track the visual viewport ONLY while focused — otherwise a layout-
  // persistent host would setState (and re-render) on every scroll/resize.
  useEffect(() => {
    if (!focused) return;
    const vp = window.visualViewport;
    if (!vp) return;
    const update = () => setVv({ height: vp.height, offsetTop: vp.offsetTop });
    update();
    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", update);
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", update);
    };
  }, [focused]);

  // Keep the bottom of the bottom-anchored list (best match, nearest the bar)
  // in view: on focus, as the suggestion set changes, and as the keyboard
  // animates in (visual-viewport height shifts the overflow).
  useEffect(() => {
    if (!focused) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [focused, vv.height, vv.offsetTop, scrollSignal]);

  // iOS Safari: while the keyboard is open, a drag the suggestion list can't
  // consume (no overflow, or already at the edge in the drag direction) pans
  // the VISUAL VIEWPORT within the layout viewport instead. Neither the
  // callsite's body lock (`position: fixed`) nor `overscroll-contain` governs
  // that keyboard-driven pan — the page behind visibly scrolls by, and the
  // pan's visualViewport scroll events make this pinned container chase
  // `vv.offsetTop` through async re-renders (the reported stutter). Block such
  // drags ourselves with a non-passive touchmove. preventDefault here is safe
  // despite the "never preventDefault in touchmove on a scrollable element"
  // rule (see CLAUDE.md): gestures the list CAN consume return early and are
  // never prevented, so real list scrolling is untouched.
  useEffect(() => {
    if (!focused) return;
    const root = rootRef.current;
    if (!root) return;
    let lastY = 0;
    // Per-gesture state, classified ONCE at touchstart — touch events keep
    // targeting the touchstart element for the whole gesture, and the list's
    // size doesn't change mid-drag — so the 60Hz move handler avoids repeated
    // DOM traversal + layout-forcing size reads (only scrollTop per move).
    let allowNative = false; // caret-drag / text-selection on the input
    let scrollableList: HTMLDivElement | null = null;
    let listMaxScroll = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastY = e.touches[0]?.clientY ?? 0;
      const target = e.target instanceof Element ? e.target : null;
      allowNative = !!target?.closest("input, textarea");
      const list = listRef.current;
      const maxScroll =
        list && target && list.contains(target)
          ? list.scrollHeight - list.clientHeight
          : 0;
      scrollableList = maxScroll > 1 ? list : null;
      listMaxScroll = maxScroll;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0]?.clientY ?? lastY;
      const dy = y - lastY;
      lastY = y;
      if (allowNative) return;
      if (scrollableList) {
        const atTop = scrollableList.scrollTop <= 0;
        const atBottom = scrollableList.scrollTop >= listMaxScroll - 1;
        // Not at the edge the drag pushes past → the list consumes it.
        if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return;
      }
      e.preventDefault();
    };
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
    };
  }, [focused]);

  return (
    <div
      ref={rootRef}
      className={`fixed left-0 right-0 ${zClassName} flex flex-col`}
      style={
        focused
          ? vv.height > 0
            ? { top: vv.offsetTop, height: vv.height }
            : { top: 0, bottom: 0 }
          : { bottom: 0 }
      }
    >
      {focused && (
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-background flex flex-col"
          // Clear the notch / status bar in standalone PWA (viewport-fit=cover),
          // where the visible viewport top sits under it. 0px elsewhere.
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        >
          {/* `mt-auto` bottom-anchors the rows: with spare room they stack up
              from just above the bar; once they overflow it collapses to 0 so
              the top stays scrollable. */}
          <div className="mt-auto">{rows}</div>
        </div>
      )}
      <div
        ref={barRef}
        className={`shrink-0 px-3 pt-2 ${focused ? "bg-background" : ""}`}
        style={
          focused
            ? { paddingBottom: "0.5rem" }
            : { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }
        }
      >
        {children}
      </div>
    </div>
  );
}

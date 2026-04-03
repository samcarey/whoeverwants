"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';

interface ScrollWheelProps {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  itemHeight?: number;
  visibleItems?: number;
  width?: number;
  loop?: boolean;
  hideHighlight?: boolean;
}

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 18;
const MIN_OPACITY = 0.35;
const LOOP_REPEATS = 40; // total copies of the item list when looping
const LOOP_CENTER = Math.floor(LOOP_REPEATS / 2); // which repetition to center on
const SMOOTH_SCROLL_SETTLE_MS = 300;

export default function ScrollWheel({
  items,
  selectedIndex,
  onChange,
  itemHeight = 40,
  visibleItems = 5,
  width,
  loop = false,
  hideHighlight = false,
}: ScrollWheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isTouching = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  const suppressSafetyTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  const lastReportedIndex = useRef(selectedIndex);
  const didMount = useRef(false);
  const rAFId = useRef<number | null>(null);
  const suppressScrollHandler = useRef(false);
  const selectedIndexRef = useRef(selectedIndex); // always tracks latest prop
  selectedIndexRef.current = selectedIndex;

  // Safely set suppressScrollHandler with a safety timeout that guarantees it gets cleared.
  // This prevents the flag from getting permanently stuck (e.g., when recenterLoop sets it
  // and the clearing rAF/timeout is overwritten by a subsequent touch interaction).
  const setSuppressed = useCallback((value: boolean) => {
    suppressScrollHandler.current = value;
    if (suppressSafetyTimeout.current) clearTimeout(suppressSafetyTimeout.current);
    if (value) {
      suppressSafetyTimeout.current = setTimeout(() => {
        suppressScrollHandler.current = false;
      }, 500);
    }
  }, []);

  const padding = Math.floor(visibleItems / 2) * itemHeight;
  const containerHeight = visibleItems * itemHeight;

  // Convert a selectedIndex (0..items.length-1) to the scroll position in the center repetition
  const selectedToScroll = useCallback((idx: number) => {
    if (loop) {
      return (LOOP_CENTER * items.length + idx) * itemHeight;
    }
    return idx * itemHeight;
  }, [loop, items.length, itemHeight]);

  // Convert a raw scroll index (in the repeated list) to the real item index
  const rawToReal = useCallback((rawIndex: number) => {
    if (!loop) return rawIndex;
    return ((rawIndex % items.length) + items.length) % items.length;
  }, [loop, items.length]);

  // Update item styles based on scroll position
  const updateItemStyles = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const visibleCenter = scrollTop + padding + itemHeight / 2;
    const maxDistance = Math.floor(visibleItems / 2);

    for (let i = 0; i < itemRefs.current.length; i++) {
      const itemEl = itemRefs.current[i];
      if (!itemEl) continue;

      const itemCenter = padding + i * itemHeight + itemHeight / 2;
      const distance = Math.abs(itemCenter - visibleCenter) / itemHeight;

      // Skip styling items far from viewport
      if (distance > maxDistance + 1) continue;

      const proximity = Math.max(0, 1 - distance / maxDistance);
      const fontSize = MIN_FONT_SIZE + (MAX_FONT_SIZE - MIN_FONT_SIZE) * proximity;
      const opacity = MIN_OPACITY + (1 - MIN_OPACITY) * proximity;
      const fontWeight = Math.round(400 + 200 * proximity);

      itemEl.style.fontSize = `${fontSize}px`;
      itemEl.style.opacity = String(opacity);
      itemEl.style.fontWeight = String(fontWeight);
    }
  }, [itemHeight, padding, visibleItems]);

  // On mount: position scroll before first paint.
  // Suppress the scroll handler so the initial scrollTop assignment
  // doesn't fire onChange with a stale index mid-positioning.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) {
      suppressScrollHandler.current = true;
      const targetScroll = selectedToScroll(selectedIndex);
      el.scrollTop = targetScroll;
      updateItemStyles();
      requestAnimationFrame(() => {
        if (el.scrollTop !== targetScroll) {
          el.scrollTop = targetScroll;
        }
        el.style.scrollSnapType = 'y mandatory';
        requestAnimationFrame(() => {
          suppressScrollHandler.current = false;
          const currentIdx = selectedIndexRef.current;
          if (currentIdx !== lastReportedIndex.current) {
            lastReportedIndex.current = currentIdx;
            el.scrollTop = selectedToScroll(currentIdx);
            updateItemStyles();
          }
        });
      });
    }
    didMount.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selectedIndex changes externally, sync scroll.
  // Suppress the scroll handler during programmatic scrolls so intermediate
  // positions during the smooth animation don't fire onChange with stale indices.
  useEffect(() => {
    if (!didMount.current) return;
    if (suppressScrollHandler.current) return;
    if (isTouching.current) return;
    if (selectedIndex === lastReportedIndex.current) return;
    lastReportedIndex.current = selectedIndex;
    const el = containerRef.current;
    if (el) {
      setSuppressed(true);
      // For looping wheels, scroll to the nearest occurrence of the target index
      // instead of always jumping to the center repetition. This prevents the
      // wheel from scrolling the long way around (e.g., 12→1 going backwards).
      let targetScroll = selectedToScroll(selectedIndex);
      if (loop) {
        const currentRawIndex = Math.round(el.scrollTop / itemHeight);
        const currentRepStart = Math.floor(currentRawIndex / items.length) * items.length;
        // Check the occurrence in the current, previous, and next repetitions
        const candidates = [
          currentRepStart - items.length + selectedIndex,
          currentRepStart + selectedIndex,
          currentRepStart + items.length + selectedIndex,
        ];
        let bestCandidate = candidates[1];
        let bestDist = Math.abs(candidates[1] - currentRawIndex);
        for (const c of candidates) {
          const dist = Math.abs(c - currentRawIndex);
          if (dist < bestDist) {
            bestDist = dist;
            bestCandidate = c;
          }
        }
        targetScroll = bestCandidate * itemHeight;
      }
      el.scrollTo({ top: targetScroll, behavior: 'smooth' });
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => {
        setSuppressed(false);
        updateItemStyles();
      }, SMOOTH_SCROLL_SETTLE_MS);
    }
    return () => {
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, [selectedIndex, selectedToScroll, items, updateItemStyles, loop, itemHeight, setSuppressed]);

  // Re-center the loop scroll position silently after scrolling stops
  const recenterLoop = useCallback(() => {
    if (!loop) return;
    const el = containerRef.current;
    if (!el) return;

    const rawIndex = Math.round(el.scrollTop / itemHeight);
    const realIndex = rawToReal(rawIndex);
    const centerScroll = selectedToScroll(realIndex);

    // Only re-center if we've drifted far from center
    if (Math.abs(el.scrollTop - centerScroll) > items.length * itemHeight * 2) {
      setSuppressed(true);
      el.scrollTop = centerScroll;
      // Allow the scroll handler to fire again after the jump settles
      requestAnimationFrame(() => {
        setSuppressed(false);
        updateItemStyles();
      });
    }
  }, [loop, itemHeight, rawToReal, selectedToScroll, items.length, updateItemStyles, setSuppressed]);

  // Correct scroll position to match selectedIndex (e.g. after parent clamped the value)
  const correctPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el || suppressScrollHandler.current) return;

    const rawIdx = Math.round(el.scrollTop / itemHeight);
    const realIdx = loop
      ? rawToReal(rawIdx)
      : Math.max(0, Math.min(items.length - 1, rawIdx));
    const target = selectedIndexRef.current;
    if (realIdx === target) return;

    lastReportedIndex.current = target;
    setSuppressed(true);
    let targetScroll: number;
    if (loop) {
      const currentRepStart = Math.floor(rawIdx / items.length) * items.length;
      const candidates = [
        currentRepStart - items.length + target,
        currentRepStart + target,
        currentRepStart + items.length + target,
      ];
      let best = candidates[1];
      let bestDist = Math.abs(candidates[1] - rawIdx);
      for (const c of candidates) {
        const dist = Math.abs(c - rawIdx);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
      targetScroll = best * itemHeight;
    } else {
      targetScroll = target * itemHeight;
    }
    el.scrollTo({ top: targetScroll, behavior: 'smooth' });
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      setSuppressed(false);
      updateItemStyles();
    }, SMOOTH_SCROLL_SETTLE_MS);
  }, [itemHeight, items.length, loop, rawToReal, updateItemStyles, setSuppressed]);

  // Keep a ref so touchend handler (created with [] deps) can access latest version
  const correctPositionRef = useRef(correctPosition);
  correctPositionRef.current = correctPosition;

  const handleScroll = useCallback(() => {
    if (suppressScrollHandler.current) return;

    // Update styles every frame during scroll
    if (rAFId.current === null) {
      rAFId.current = requestAnimationFrame(() => {
        rAFId.current = null;
        updateItemStyles();
      });
    }

    // Immediately report nearest index as it changes (no debounce)
    const el = containerRef.current;
    if (el) {
      const rawIndex = Math.round(el.scrollTop / itemHeight);
      const realIndex = loop
        ? rawToReal(rawIndex)
        : Math.max(0, Math.min(items.length - 1, rawIndex));
      if (realIndex !== lastReportedIndex.current) {
        lastReportedIndex.current = realIndex;
        onChange(realIndex);
      }
    }

    // Debounced scroll-settle actions (loop re-centering + constraint correction)
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      if (loop) recenterLoop();
      // After scroll settles, snap to constrained position if parent clamped selectedIndex.
      // If recenterLoop just set suppressScrollHandler, defer correctPosition until after
      // the suppression clears (via rAF) to avoid it bailing out immediately.
      if (!isTouching.current) {
        if (suppressScrollHandler.current) {
          requestAnimationFrame(() => {
            if (!isTouching.current) correctPositionRef.current();
          });
        } else {
          correctPositionRef.current();
        }
      }
    }, 150);
  }, [itemHeight, items.length, onChange, updateItemStyles, loop, rawToReal, recenterLoop]);

  // Track touch state — on touch end, schedule a correction check
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = () => { isTouching.current = true; };
    const onTouchEnd = () => {
      isTouching.current = false;
      // After touch ends, wait for any momentum scroll to settle, then correct
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => {
        correctPositionRef.current();
      }, 150);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Cleanup rAF and scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (rAFId.current !== null) cancelAnimationFrame(rAFId.current);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      if (suppressSafetyTimeout.current) clearTimeout(suppressSafetyTimeout.current);
    };
  }, []);

  const renderedItems = useMemo(() => {
    const result: { label: string; realIndex: number }[] = [];
    const repeats = loop ? LOOP_REPEATS : 1;
    for (let rep = 0; rep < repeats; rep++) {
      for (let i = 0; i < items.length; i++) {
        result.push({ label: items[i], realIndex: i });
      }
    }
    return result;
  }, [items, loop]);

  return (
    <div className="relative" style={{ height: containerHeight, width }}>
      {/* Selection highlight band (can be hidden when parent provides its own) */}
      {!hideHighlight && (
        <div
          className="absolute left-0 right-0 pointer-events-none bg-blue-200/50 dark:bg-blue-700/30 z-0 rounded-lg"
          style={{ top: padding, height: itemHeight }}
        />
      )}
      {/* Top fade */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-20 bg-gradient-to-b from-white dark:from-gray-800 to-transparent"
        style={{ height: padding }}
      />
      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none z-20 bg-gradient-to-t from-white dark:from-gray-800 to-transparent"
        style={{ height: padding }}
      />
      {/* Scrollable list */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        data-scroll-wheel
        className="h-full overflow-y-auto scrollbar-hide"
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Top padding */}
        <div style={{ height: padding }} />
        {renderedItems.map((item, i) => (
          <div
            key={i}
            ref={(el) => { itemRefs.current[i] = el; }}
            className="flex items-center justify-center cursor-pointer select-none text-gray-900 dark:text-white"
            style={{
              height: itemHeight,
              scrollSnapAlign: 'center',
            }}
            onClick={() => {
              lastReportedIndex.current = item.realIndex;
              onChange(item.realIndex);
              const el = containerRef.current;
              if (el) {
                el.scrollTo({ top: i * itemHeight, behavior: 'smooth' });
              }
            }}
          >
            {item.label}
          </div>
        ))}
        {/* Bottom padding */}
        <div style={{ height: padding }} />
      </div>
    </div>
  );
}

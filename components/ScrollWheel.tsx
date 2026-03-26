"use client";

import { useRef, useEffect, useCallback } from 'react';

interface ScrollWheelProps {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  itemHeight?: number;
  visibleItems?: number;
  width?: number;
}

const MIN_FONT_SIZE = 14;  // px at edge
const MAX_FONT_SIZE = 18;  // px at center
const MIN_OPACITY = 0.35;

export default function ScrollWheel({
  items,
  selectedIndex,
  onChange,
  itemHeight = 40,
  visibleItems = 5,
  width,
}: ScrollWheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isTouching = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  const lastReportedIndex = useRef(selectedIndex);
  const didMount = useRef(false);
  const rAFId = useRef<number | null>(null);

  const padding = Math.floor(visibleItems / 2) * itemHeight;
  const containerHeight = visibleItems * itemHeight;
  const centerOffset = padding; // distance from container top to center of highlight band

  // Update item styles based on scroll position — called via rAF, no React re-renders
  const updateItemStyles = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const scrollTop = el.scrollTop;

    for (let i = 0; i < items.length; i++) {
      const itemEl = itemRefs.current[i];
      if (!itemEl) continue;

      // Item's center position relative to container top (accounting for top padding)
      const itemCenter = padding + i * itemHeight + itemHeight / 2;
      // Visible center = scrollTop + centerOffset + itemHeight/2
      const visibleCenter = scrollTop + centerOffset + itemHeight / 2;
      // Distance from center in item-heights (0 = perfectly centered, 1 = one slot away)
      const distance = Math.abs(itemCenter - visibleCenter) / itemHeight;
      // Proximity: 1 at center, 0 at edge (clamped to visible range)
      const maxDistance = Math.floor(visibleItems / 2);
      const proximity = Math.max(0, 1 - distance / maxDistance);

      const fontSize = MIN_FONT_SIZE + (MAX_FONT_SIZE - MIN_FONT_SIZE) * proximity;
      const opacity = MIN_OPACITY + (1 - MIN_OPACITY) * proximity;
      // font-weight: interpolate 400-600 based on proximity
      const fontWeight = Math.round(400 + 200 * proximity);

      itemEl.style.fontSize = `${fontSize}px`;
      itemEl.style.opacity = String(opacity);
      itemEl.style.fontWeight = String(fontWeight);
    }
  }, [items.length, itemHeight, padding, centerOffset, visibleItems]);

  // On mount: jump to initial position and style items
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = selectedIndex * itemHeight;
    }
    didMount.current = true;
    updateItemStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selectedIndex changes externally, sync scroll
  useEffect(() => {
    if (!didMount.current) return;
    if (isTouching.current) return;
    if (selectedIndex === lastReportedIndex.current) return;
    lastReportedIndex.current = selectedIndex;
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: selectedIndex * itemHeight, behavior: 'smooth' });
    }
  }, [selectedIndex, itemHeight]);

  const handleScroll = useCallback(() => {
    // Update styles every frame during scroll
    if (rAFId.current === null) {
      rAFId.current = requestAnimationFrame(() => {
        rAFId.current = null;
        updateItemStyles();
      });
    }

    // Debounced selection change
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const index = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      if (clamped !== lastReportedIndex.current) {
        lastReportedIndex.current = clamped;
        onChange(clamped);
      }
    }, 150);
  }, [itemHeight, items.length, onChange, updateItemStyles]);

  // Track touch state
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = () => { isTouching.current = true; };
    const onTouchEnd = () => { isTouching.current = false; };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rAFId.current !== null) cancelAnimationFrame(rAFId.current);
    };
  }, []);

  return (
    <div className="relative" style={{ height: containerHeight, width }}>
      {/* Selection highlight band */}
      <div
        className="absolute left-0 right-0 pointer-events-none border-y border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 z-10"
        style={{ top: padding, height: itemHeight }}
      />
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
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Top padding */}
        <div style={{ height: padding }} />
        {items.map((item, i) => (
          <div
            key={i}
            ref={(el) => { itemRefs.current[i] = el; }}
            className="flex items-center justify-center cursor-pointer select-none text-gray-900 dark:text-white"
            style={{
              height: itemHeight,
              scrollSnapAlign: 'center',
            }}
            onClick={() => {
              lastReportedIndex.current = i;
              onChange(i);
              const el = containerRef.current;
              if (el) {
                el.scrollTo({ top: i * itemHeight, behavior: 'smooth' });
              }
            }}
          >
            {item}
          </div>
        ))}
        {/* Bottom padding */}
        <div style={{ height: padding }} />
      </div>
    </div>
  );
}

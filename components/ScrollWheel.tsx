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

export default function ScrollWheel({
  items,
  selectedIndex,
  onChange,
  itemHeight = 40,
  visibleItems = 5,
  width,
}: ScrollWheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isTouching = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout>>(null);
  const lastReportedIndex = useRef(selectedIndex);
  const didMount = useRef(false);

  const padding = Math.floor(visibleItems / 2) * itemHeight;
  const containerHeight = visibleItems * itemHeight;

  // On mount only: jump to the initial selected index
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = selectedIndex * itemHeight;
    }
    didMount.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selectedIndex changes externally (e.g. from click), sync scroll —
  // but NOT while the user is actively touching/scrolling.
  useEffect(() => {
    if (!didMount.current) return;
    if (isTouching.current) return;
    // Only sync if the change came from outside (not from our own onScroll)
    if (selectedIndex === lastReportedIndex.current) return;
    lastReportedIndex.current = selectedIndex;
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: selectedIndex * itemHeight, behavior: 'smooth' });
    }
  }, [selectedIndex, itemHeight]);

  const handleScroll = useCallback(() => {
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
  }, [itemHeight, items.length, onChange]);

  // Track touch state with native listeners to reliably know when user is dragging
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
            className={`flex items-center justify-center cursor-pointer select-none transition-colors ${
              i === selectedIndex
                ? 'text-gray-900 dark:text-white font-semibold'
                : 'text-gray-400 dark:text-gray-500'
            }`}
            style={{
              height: itemHeight,
              scrollSnapAlign: 'center',
              fontSize: i === selectedIndex ? '1.25rem' : '1rem',
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

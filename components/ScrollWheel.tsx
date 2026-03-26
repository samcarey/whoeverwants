"use client";

import { useRef, useEffect, useCallback } from 'react';

interface ScrollWheelProps {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  itemHeight?: number;
  visibleItems?: number;
}

export default function ScrollWheel({
  items,
  selectedIndex,
  onChange,
  itemHeight = 40,
  visibleItems = 5,
}: ScrollWheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  const padding = Math.floor(visibleItems / 2) * itemHeight;
  const containerHeight = visibleItems * itemHeight;

  // Scroll to selected index (only when not user-initiated)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || isUserScrolling.current) return;
    el.scrollTop = selectedIndex * itemHeight;
  }, [selectedIndex, itemHeight]);

  const handleScroll = useCallback(() => {
    isUserScrolling.current = true;
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);

    scrollTimeout.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const index = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      if (clamped !== selectedIndex) {
        onChange(clamped);
      }
      isUserScrolling.current = false;
    }, 80);
  }, [itemHeight, items.length, selectedIndex, onChange]);

  return (
    <div className="relative" style={{ height: containerHeight }}>
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
              onChange(i);
              const el = containerRef.current;
              if (el) {
                isUserScrolling.current = false;
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

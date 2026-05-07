"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface CollapsibleFadeSectionProps {
  children: ReactNode;
  collapsedHeight: number;
  fadePx?: number;
  expandedHeight?: number;
  innerClassName?: string;
  header?: ReactNode;
  ariaLabel?: string;
}

export default function CollapsibleFadeSection({
  children,
  collapsedHeight,
  fadePx = 20,
  expandedHeight,
  innerClassName = "",
  header,
  ariaLabel = "section",
}: CollapsibleFadeSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const next = el.scrollHeight > collapsedHeight + 2;
      setNeedsTruncation(prev => prev === next ? prev : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsedHeight]);

  const fadeMask = `linear-gradient(to bottom, black ${collapsedHeight - fadePx}px, transparent ${collapsedHeight}px)`;
  const isCapped = expanded && expandedHeight != null;

  return (
    <div>
      {header}
      <div
        ref={innerRef}
        className={innerClassName}
        style={{
          overflow: "hidden",
          maxHeight: expanded ? expandedHeight : collapsedHeight,
          ...(isCapped ? { overflowY: "auto" } : {}),
          ...(needsTruncation && !expanded ? {
            maskImage: fadeMask,
            WebkitMaskImage: fadeMask,
          } : {}),
        }}
      >
        {children}
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex justify-center py-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label={expanded ? `Collapse ${ariaLabel}` : `Expand ${ariaLabel}`}
        >
          <svg
            className={`w-6 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            viewBox="0 0 24 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2 L12 10 L20 2" />
          </svg>
        </button>
      )}
    </div>
  );
}

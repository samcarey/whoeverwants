"use client";

import { useState, useRef, useEffect } from "react";

interface PollDetailsProps {
  details: string;
}

export default function PollDetails({ details }: PollDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const collapsedRef = useRef<HTMLDivElement>(null);

  // Line height in px (text-sm = 1.25rem line-height = 20px)
  const lineHeight = 20;
  const collapsedLines = 3;
  const expandedLines = 20;
  const collapsedHeight = collapsedLines * lineHeight;
  const expandedHeight = expandedLines * lineHeight;

  useEffect(() => {
    if (collapsedRef.current) {
      // Check if content exceeds 3 lines
      const scrollHeight = collapsedRef.current.scrollHeight;
      setNeedsTruncation(scrollHeight > collapsedHeight + 2);
    }
  }, [details, collapsedHeight]);

  if (!details) return null;

  return (
    <div className="mb-4">
      <div className="relative">
        {/* Content area — mask fades out the bottom line when collapsed */}
        <div
          ref={collapsedRef}
          className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words overflow-hidden"
          style={{
            maxHeight: expanded ? expandedHeight : collapsedHeight,
            overflowY: expanded ? 'auto' : 'hidden',
            ...(needsTruncation && !expanded ? {
              maskImage: `linear-gradient(to bottom, black ${collapsedHeight - lineHeight}px, transparent ${collapsedHeight}px)`,
              WebkitMaskImage: `linear-gradient(to bottom, black ${collapsedHeight - lineHeight}px, transparent ${collapsedHeight}px)`,
            } : {}),
          }}
        >
          <div ref={contentRef}>{details}</div>
        </div>
      </div>

      {/* Expand/collapse arrow */}
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex justify-center py-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label={expanded ? "Collapse details" : "Expand details"}
        >
          <svg
            className={`w-6 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
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

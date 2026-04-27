"use client";

import { useState, useRef, useEffect, useMemo } from "react";

interface QuestionDetailsProps {
  details: string;
}

// text-sm line-height = 1.25rem = 20px
const LINE_HEIGHT = 20;
const COLLAPSED_LINES = 3;
const EXPANDED_LINES = 20;
const COLLAPSED_HEIGHT = COLLAPSED_LINES * LINE_HEIGHT;
const EXPANDED_HEIGHT = EXPANDED_LINES * LINE_HEIGHT;

const URL_REGEX = /(https?:\/\/\S+|www\.\S+)/gi;

function renderWithLinks(text: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Odd indices are captured URL matches from split
      const href = part.startsWith('http') ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export default function QuestionDetails({ details }: QuestionDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const collapsedRef = useRef<HTMLDivElement>(null);
  const renderedDetails = useMemo(() => renderWithLinks(details), [details]);

  useEffect(() => {
    if (collapsedRef.current) {
      setNeedsTruncation(collapsedRef.current.scrollHeight > COLLAPSED_HEIGHT + 2);
    }
  }, [details]);

  if (!details) return null;

  return (
    <div className="mb-4">
      <div className="relative">
        {/* Content area — mask fades out the bottom line when collapsed */}
        <div
          ref={collapsedRef}
          className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words overflow-hidden"
          style={{
            maxHeight: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
            overflowY: expanded ? 'auto' : 'hidden',
            ...(needsTruncation && !expanded ? {
              maskImage: `linear-gradient(to bottom, black ${COLLAPSED_HEIGHT - LINE_HEIGHT}px, transparent ${COLLAPSED_HEIGHT}px)`,
              WebkitMaskImage: `linear-gradient(to bottom, black ${COLLAPSED_HEIGHT - LINE_HEIGHT}px, transparent ${COLLAPSED_HEIGHT}px)`,
            } : {}),
          }}
        >
          {renderedDetails}
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

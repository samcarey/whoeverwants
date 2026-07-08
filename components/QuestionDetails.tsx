"use client";

import { useMemo } from "react";
import CollapsibleFadeSection from "./CollapsibleFadeSection";

interface QuestionDetailsProps {
  details: string;
  label?: string;
}

const LINE_HEIGHT = 20; // text-sm line-height = 1.25rem
const COLLAPSED_LINES = 3;
const EXPANDED_LINES = 20;
const COLLAPSED_HEIGHT = COLLAPSED_LINES * LINE_HEIGHT;
const EXPANDED_HEIGHT = EXPANDED_LINES * LINE_HEIGHT;

const URL_REGEX = /(https?:\/\/\S+|www\.\S+)/gi;

/** Shared autolinker: splits text on URLs and renders each as a safe
 *  new-tab anchor. Also consumed by PollComments for comment bodies. */
export function renderWithLinks(text: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith("http") ? part : `https://${part}`;
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

export default function QuestionDetails({ details, label }: QuestionDetailsProps) {
  const renderedDetails = useMemo(() => renderWithLinks(details), [details]);
  if (!details) return null;

  return (
    <div className="mb-4">
      <CollapsibleFadeSection
        collapsedHeight={COLLAPSED_HEIGHT}
        fadePx={LINE_HEIGHT}
        expandedHeight={EXPANDED_HEIGHT}
        innerClassName="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words"
        ariaLabel="details"
      >
        {label && <span className="font-medium">{label}</span>}
        {renderedDetails}
      </CollapsibleFadeSection>
    </div>
  );
}

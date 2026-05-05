"use client";

import { useRouter } from "next/navigation";
import RespondentCircles from "@/components/RespondentCircles";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { THREAD_HEADER_ATTR } from "@/lib/threadDomMarkers";

export interface ThreadHeaderProps {
  headerRef: React.Ref<HTMLDivElement>;
  title: string;
  participantNames?: string[];
  anonymousCount?: number;
  subtitle?: string;
  onTitleClick?: () => void;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
}

/**
 * Fixed thread header. top:0 + padding-top:env(safe-area-inset-top) fills
 * the notch zone with the header background (otherwise items are visible
 * there when the document scrolls). headerRef is on the inner content
 * div so offsetHeight stays content-only; the sibling content below
 * reserves exactly that much padding-top.
 *
 * onBack defaults to navigating to '/'; sub-routes pass their own handler
 * (e.g. back to the thread root or the info page when in-app history exists).
 * rightSlot renders an action button on the right; when provided, the title
 * becomes centered to balance the layout.
 */
export default function ThreadHeader({
  headerRef,
  title,
  participantNames,
  anonymousCount,
  subtitle,
  onTitleClick,
  onBack,
  rightSlot,
}: ThreadHeaderProps) {
  const router = useRouter();
  const hasRightSlot = !!rightSlot;
  const handleBack = onBack ?? (() => navigateWithTransition(router, '/', 'back'));

  const titleBlock = (
    <>
      <h1
        className={`font-semibold text-lg text-gray-900 dark:text-white truncate${
          hasRightSlot ? ' text-center px-1' : ''
        }`}
      >
        {title}
      </h1>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      )}
    </>
  );
  return (
    <div
      {...{ [THREAD_HEADER_ATTR]: '' }}
      className="fixed left-0 right-0 top-0 z-20 bg-background touch-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div
        ref={headerRef}
        className={`max-w-4xl mx-auto pl-2 ${hasRightSlot ? 'pr-2' : 'pr-4'} py-2 flex items-center gap-2 overflow-hidden`}
      >
        <button
          onClick={handleBack}
          className={`w-10 h-10 ${hasRightSlot ? '' : '-mr-1.5'} flex items-center justify-center shrink-0`}
          aria-label="Go back"
        >
          <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {participantNames && (
          <RespondentCircles
            names={participantNames}
            anonymousCount={anonymousCount ?? 0}
          />
        )}
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className="min-w-0 flex-1 text-left active:opacity-60 transition-opacity"
            aria-label="Thread details"
          >
            {titleBlock}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{titleBlock}</div>
        )}
        {rightSlot}
      </div>
    </div>
  );
}

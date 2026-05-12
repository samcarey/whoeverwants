"use client";

import { useRouter } from "next/navigation";
import RespondentCircles from "@/components/RespondentCircles";
import { navigateWithTransition } from "@/lib/viewTransitions";

export interface GroupHeaderProps {
  headerRef: React.Ref<HTMLDivElement>;
  title?: string;
  participantNames?: string[];
  anonymousCount?: number;
  subtitle?: string;
  onTitleClick?: () => void;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
}

/**
 * Fixed group header. top:0 + padding-top:env(safe-area-inset-top) fills
 * the notch zone with the header background (otherwise items are visible
 * there when the document scrolls). headerRef is on the OUTER fixed div
 * so offsetHeight includes the safe-area-inset-top padding — sibling
 * content below reserves the full visual header height (47-59px notch +
 * ~40px content in iOS PWA, just ~40px in browser/desktop where the env
 * resolves to 0). Earlier the ref was on the inner content div, leaving
 * iOS PWA pages with content tucked behind the bottom of the header.
 *
 * Hitbox split: back / middle (participant graphic + title) / rightSlot
 * each take a full-height slice of the bar so there is no untappable
 * padding strip. The original `pl-2 / gap-2 / pr-2` whitespace on the
 * inner container is folded into the children's own padding so icon
 * positions stay pixel-identical:
 *   back  = pl-2 + w-10 + pr-2 (absorbs left edge + gap to title)
 *   title = pr-2  (absorbs gap to rightSlot when present, else pr-4)
 *   share = pr-2 + w-10  (absorbs gap from title + right edge)
 * `items-center` on the row preserves vertical centering for callers
 * whose rightSlot has an explicit `h-10` (info/edit-title Edit/Save);
 * back + title + GroupShareButton mark themselves `self-stretch` so
 * their hitboxes span the full bar height.
 *
 * onBack defaults to navigating to '/'; sub-routes pass their own handler
 * (e.g. back to the group root or the info page when in-app history exists).
 * rightSlot renders an action button on the right.
 */
export default function GroupHeader({
  headerRef,
  title,
  participantNames,
  anonymousCount,
  subtitle,
  onTitleClick,
  onBack,
  rightSlot,
}: GroupHeaderProps) {
  const router = useRouter();
  const hasRightSlot = !!rightSlot;
  const handleBack = onBack ?? (() => navigateWithTransition(router, '/', 'back'));

  const titleBlock = title ? (
    <>
      <h1 className="font-semibold text-lg text-gray-900 dark:text-white truncate">
        {title}
      </h1>
      {subtitle && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      )}
    </>
  ) : null;

  const middleRightPad = hasRightSlot ? 'pr-2' : 'pr-4';
  const middleContent = (
    <>
      {participantNames && (
        <RespondentCircles
          names={participantNames}
          anonymousCount={anonymousCount ?? 0}
        />
      )}
      <div className="min-w-0 flex-1">{titleBlock}</div>
    </>
  );

  return (
    <div
      ref={headerRef}
      data-group-header=""
      className="fixed left-0 right-0 top-0 z-20 bg-background touch-none"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="max-w-4xl mx-auto flex items-center overflow-hidden">
        <button
          onClick={handleBack}
          className="self-stretch py-2 pl-2 pr-2 flex items-center justify-center shrink-0"
          aria-label="Go back"
        >
          <span className="w-10 h-10 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </span>
        </button>
        {onTitleClick && titleBlock ? (
          <button
            type="button"
            onClick={onTitleClick}
            className={`self-stretch min-w-0 flex-1 py-2 ${middleRightPad} flex items-center gap-2 text-left active:opacity-60 transition-opacity`}
            aria-label="Group details"
          >
            {middleContent}
          </button>
        ) : (
          <div className={`self-stretch min-w-0 flex-1 py-2 ${middleRightPad} flex items-center gap-2`}>
            {middleContent}
          </div>
        )}
        {rightSlot}
      </div>
    </div>
  );
}

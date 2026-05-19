"use client";

import { useRouter } from "next/navigation";
import GroupAvatar from "@/components/GroupAvatar";
import { navigateWithTransition } from "@/lib/viewTransitions";

export interface GroupHeaderProps {
  headerRef: React.Ref<HTMLDivElement>;
  title?: string;
  participantNames?: string[];
  anonymousCount?: number;
  /** Migration 108: when set, the header shows the uploaded image circle
   *  instead of the initials graphic. Null/undefined → initials fallback. */
  imageUrl?: string | null;
  onTitleClick?: () => void;
  /** aria-label for the title button when `onTitleClick` is provided.
   *  Defaults to "Group details"; the poll detail page passes
   *  "Poll details" since tapping there opens the per-poll info page. */
  titleAriaLabel?: string;
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
 * padding strip. The original inner-container whitespace is folded
 * into the children's own padding so icon positions stay pixel-
 * identical. `items-center` (not `items-stretch`) preserves vertical
 * centering for callers whose rightSlot has an explicit `h-10` (info /
 * edit-title Edit/Save); back + title mark themselves `self-stretch`
 * so their hitboxes span the full bar height.
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
  imageUrl,
  onTitleClick,
  titleAriaLabel = "Group details",
  onBack,
  rightSlot,
}: GroupHeaderProps) {
  const router = useRouter();
  const hasRightSlot = !!rightSlot;
  const handleBack = onBack ?? (() => navigateWithTransition(router, '/', 'back'));

  const titleBlock = title ? (
    <>
      <h1 className="min-w-0 font-semibold text-lg text-gray-900 dark:text-white truncate">
        {title}
      </h1>
      {onTitleClick && (
        <svg
          className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </>
  ) : null;

  const middleRightPad = hasRightSlot ? 'pr-2' : 'pr-4';
  const middleContent = (
    <>
      {participantNames && (
        <GroupAvatar
          imageUrl={imageUrl ?? null}
          names={participantNames}
          anonymousCount={anonymousCount ?? 0}
        />
      )}
      <div className="min-w-0 flex-1 flex items-center gap-1">{titleBlock}</div>
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
          className="self-stretch py-2 px-2 flex items-center justify-center shrink-0"
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
            aria-label={titleAriaLabel}
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

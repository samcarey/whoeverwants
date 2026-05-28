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
  /** Custom left-of-title graphic. When provided, replaces the default
   *  GroupAvatar (built from `participantNames`/`anonymousCount`/`imageUrl`).
   *  The poll detail page passes `<PollAvatar questions={...}/>` here so
   *  the header carries an at-a-glance graphic of the poll's questions
   *  — keeps GroupHeader agnostic of poll-vs-group concerns. */
  avatar?: React.ReactNode;
  /** Small faded line under the title (e.g. the group name on a poll
   *  detail page). Single-line truncated. Omitted when null/undefined. */
  subtitle?: string | null;
  onTitleClick?: () => void;
  /** aria-label for the title button when `onTitleClick` is provided.
   *  Defaults to "Group details"; the poll detail page passes
   *  "Poll details" since tapping there opens the per-poll info page. */
  titleAriaLabel?: string;
  onBack?: () => void;
  /** Icon shown in the left-edge button. 'arrow' (default) is a chevron-left
   *  for sub-routes that conceptually "go back" to a parent. 'menu' is a
   *  hamburger-style three-line glyph (third line shorter) used on the
   *  group root and poll detail pages — top-level surfaces where the
   *  control still navigates back but reads more as primary nav. */
  backIconVariant?: "arrow" | "menu";
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
  avatar: avatarOverride,
  subtitle,
  onTitleClick,
  titleAriaLabel = "Group details",
  onBack,
  backIconVariant = "arrow",
  rightSlot,
}: GroupHeaderProps) {
  const router = useRouter();
  const hasRightSlot = !!rightSlot;
  const handleBack = onBack ?? (() => navigateWithTransition(router, '/', 'back'));

  const backIcon = backIconVariant === "menu" ? (
    <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 18h11" />
    </svg>
  ) : (
    <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );

  // The title + optional subtitle stack as a flex-col inside the inner
  // row so the chevron stays vertically centered next to the whole block.
  // `line-clamp-2` on the h1 lets the title wrap once before truncating;
  // the subtitle is single-line and faded.
  const titleBlock = title ? (
    <>
      <div className="min-w-0 flex-1 flex flex-col">
        <h1 className="font-semibold text-lg text-gray-900 dark:text-white line-clamp-2 leading-[1.1]">
          {title}
        </h1>
        {subtitle && (
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {subtitle}
          </span>
        )}
      </div>
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
  const avatar =
    avatarOverride ??
    (participantNames ? (
      <GroupAvatar
        imageUrl={imageUrl ?? null}
        names={participantNames}
        anonymousCount={anonymousCount ?? 0}
      />
    ) : null);
  const middleContent = (
    <>
      {avatar}
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
          className="self-stretch py-2 pl-2 pr-[5.6px] flex items-center justify-center shrink-0"
          aria-label="Go back"
        >
          <span className="w-10 h-10 flex items-center justify-center">
            {backIcon}
          </span>
        </button>
        {onTitleClick && titleBlock ? (
          <button
            type="button"
            onClick={onTitleClick}
            className={`self-stretch min-w-0 flex-1 py-[4.8px] ${middleRightPad} flex items-center gap-[6.4px] text-left active:opacity-60 transition-opacity`}
            aria-label={titleAriaLabel}
          >
            {middleContent}
          </button>
        ) : (
          <div className={`self-stretch min-w-0 flex-1 py-[4.8px] ${middleRightPad} flex items-center gap-[6.4px]`}>
            {middleContent}
          </div>
        )}
        {rightSlot}
      </div>
    </div>
  );
}

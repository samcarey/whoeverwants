"use client";

import React from "react";
import ClientOnly from "@/components/ClientOnly";
import GroupAvatar from "@/components/GroupAvatar";
import SimpleCountdown from "@/components/SimpleCountdown";
import { relativeTime } from "@/lib/questionListUtils";

/**
 * Shared row used by both the home/group poll list and the in-progress
 * "Draft Poll" card in the create-poll flow. Keeping the structure unified
 * means the submit-time morph (dashed → solid border, DRAFT pill collapse)
 * lands on a card that's already pixel-aligned with what real polls render
 * — so the transition reads as "becoming real" rather than "rebuilding".
 *
 * Set `draftMode` to apply the dashed-blue chrome + show the DRAFT pill;
 * set `finalizing` (a transient prop driven by submit) to release those
 * styles back to the regular live appearance over a CSS transition.
 *
 * Live polls use GroupList's `goToGroup` onClick; the draft variant
 * passes onClick=undefined (the entire card isn't clickable; per-draft
 * editing happens via the edit-rows slot rendered below the card).
 */
export interface GroupListItemProps {
  title: string;
  latestQuestionTitle: string;
  participantNames: string[];
  anonymousRespondentCount: number;
  /** When set, "N min ago" appears in the metadata row; omit for drafts. */
  createdAt?: string | null;
  /** When set, the left column renders a countdown to this timestamp. */
  soonestUnvotedDeadline?: string | null;
  /** Drives the left column's display: 'response' → green compact countdown,
   *  'prephase' → blue compact countdown (suggestion / availability timer
   *  is ticking), 'prephase-pending' → solid blue circle (suggestions open
   *  but timer hasn't started). undefined → empty slot. */
  unvotedDeadlineKind?: 'prephase' | 'response' | 'prephase-pending';
  hasUnvoted?: boolean;
  pressed?: boolean;
  draftMode?: boolean;
  /** Transient: while true, the card visually morphs from draft → live. */
  finalizing?: boolean;
  /** Renders the top border too — caller passes true on the first list item. */
  isFirst?: boolean;
  /** When true, the left respondent-circle column is omitted entirely so the
   *  text content takes the full row width. Used by the draft poll card so the
   *  in-progress poll doesn't show pre-vote initials before anyone has voted. */
  hideRespondents?: boolean;
  /** When set, the group has an uploaded avatar image — overrides the
   *  initials graphic. Null/undefined → render the participant initials
   *  (RespondentCircles). */
  imageUrl?: string | null;
  /** Inline replacement for the relative-time stamp when `createdAt` is
   *  absent — e.g. "ready to submit" / "just now" for the draft poll card. */
  statusBadge?: React.ReactNode;
  /** When true, render a circular selection checkbox to the left of the row.
   *  Used by the home-page bulk-forget flow. */
  selectionMode?: boolean;
  /** Whether this group is selected. Only meaningful when selectionMode. */
  isSelected?: boolean;
  onClick?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchEnd?: () => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  groupRootId?: string;
}

export default function GroupListItem(props: GroupListItemProps) {
  const {
    title,
    latestQuestionTitle,
    participantNames,
    anonymousRespondentCount,
    createdAt,
    soonestUnvotedDeadline,
    unvotedDeadlineKind,
    hasUnvoted = false,
    pressed = false,
    draftMode = false,
    finalizing = false,
    isFirst = false,
    hideRespondents = false,
    imageUrl = null,
    statusBadge,
    selectionMode = false,
    isSelected = false,
    onClick,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    groupRootId,
  } = props;

  // Apply draft chrome only while still in draft mode AND not yet finalizing.
  // The finalizing flag releases the chrome over a CSS transition so the
  // morph reads as a single fluid change instead of an instant swap.
  const showDraftChrome = draftMode && !finalizing;
  const titleEmphasized = hasUnvoted || (draftMode && !finalizing);

  return (
    <div
      data-group-root-id={groupRootId}
      className={`${draftMode ? 'mx-1.5' : 'mr-1.5'} transition-colors duration-500 ease-out ${
        showDraftChrome
          ? `${isFirst ? 'border-t' : ''} border-b border-dashed border-blue-400 dark:border-blue-500`
          : ''
      }`}
    >
      <div
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        className={`flex gap-3 ${draftMode ? 'pl-2' : 'pl-[8.064px]'} pr-3 py-3 select-none relative transition-colors duration-500 ease-out ${
          pressed ? 'bg-blue-50 dark:bg-blue-900/30' : ''
        } ${
          onClick
            ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-blue-50 dark:active:bg-blue-900/30 cursor-pointer'
            : ''
        } ${
          showDraftChrome ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''
        }`}
      >
        {selectionMode && (
          <div
            aria-checked={isSelected}
            role="checkbox"
            className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center self-center transition-colors ${
              isSelected
                ? 'bg-blue-600 border-blue-600 dark:bg-blue-500 dark:border-blue-500'
                : 'border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900'
            }`}
          >
            {isSelected && (
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* Fixed-width countdown column, left of the avatar. Always
            reserved when an avatar is rendered so indentation is consistent
            whether the row has an active cutoff or not. The negative
            right-margin shrinks the effective gap between this column and
            the avatar to 7.776px (the row's gap-3 is 12px; -mr-[4.224px]
            subtracts 4.224px). Three states driven by `unvotedDeadlineKind`:
              - 'response':         green compact countdown (voting cutoff)
              - 'prephase':         blue compact countdown (suggestion /
                                    availability timer running)
              - 'prephase-pending': solid blue dot (suggestions open, timer
                                    not yet started — no scheduled time
                                    to render in a single-glyph column)
            On expiry the countdown clears to empty instead of "Expired" —
            the parent's `isOpen` filter unmounts the row a tick later, so
            no stray "Expired" word should flash through this slot. */}
        {!hideRespondents && (
          <div className="w-7 flex items-center justify-center shrink-0 self-center -mr-[4.224px]">
            {soonestUnvotedDeadline && unvotedDeadlineKind && unvotedDeadlineKind !== 'prephase-pending' && (
              <span className="text-[15.84px]">
                <ClientOnly fallback={null}>
                  <SimpleCountdown
                    deadline={soonestUnvotedDeadline}
                    compact
                    blankOnExpire
                    numberClass="font-bold tracking-tighter"
                    colorClass={
                      unvotedDeadlineKind === 'prephase'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-green-600 dark:text-green-400'
                    }
                  />
                </ClientOnly>
              </span>
            )}
            {unvotedDeadlineKind === 'prephase-pending' && !soonestUnvotedDeadline && (
              <span
                aria-label="Suggestions open"
                className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 dark:bg-blue-400"
              />
            )}
          </div>
        )}

        {/* Drafts skip this entirely so the "?" placeholder doesn't appear
            before anyone has actually voted. */}
        {!hideRespondents && (
          <GroupAvatar
            imageUrl={imageUrl}
            names={participantNames}
            anonymousCount={anonymousRespondentCount}
          />
        )}

        <div className="flex-1 min-w-0 -ml-[3px] pr-4">
          {/* Row 1: title (left, truncates) + draft pill / "5m ago" (right) */}
          <div className="flex items-baseline gap-2">
            <h3
              className={`font-semibold text-base truncate flex-1 transition-colors duration-500 ease-out ${
                titleEmphasized ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {title}
            </h3>
            {/* DRAFT pill — collapses out via opacity + width on finalize. */}
            {draftMode && (
              <span
                className={`inline-flex items-center justify-center h-5 rounded-full bg-blue-500 text-white text-xs font-bold uppercase tracking-wide overflow-hidden whitespace-nowrap transition-[opacity,max-width,padding] duration-300 ease-out shrink-0 ${
                  finalizing ? 'opacity-0 max-w-0 px-0' : 'opacity-100 max-w-[80px] px-2'
                }`}
              >
                draft
              </span>
            )}
            {createdAt && (
              <div className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                <ClientOnly fallback={null}>{relativeTime(createdAt)}</ClientOnly>
              </div>
            )}
          </div>

          {/* Empty-group status row (only when no createdAt) */}
          {!createdAt && statusBadge && (
            <div className="mt-px text-xs text-gray-400 dark:text-gray-500">
              <ClientOnly fallback={null}>{statusBadge}</ClientOnly>
            </div>
          )}

          {/* Latest-poll body — 2-line max. */}
          {latestQuestionTitle && (
            <div
              className="mt-px text-sm text-gray-600 dark:text-gray-300 leading-tight"
              style={{ maxHeight: '2.55em', overflow: 'hidden' }}
            >
              {latestQuestionTitle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

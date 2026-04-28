"use client";

import React from "react";
import ClientOnly from "@/components/ClientOnly";
import RespondentCircles from "@/components/RespondentCircles";
import SimpleCountdown from "@/components/SimpleCountdown";
import { relativeTime } from "@/lib/questionListUtils";

/**
 * Shared row used by both the home/thread poll list and the in-progress
 * "Draft Poll" card in the create-poll flow. Keeping the structure unified
 * means the submit-time morph (dashed → solid border, DRAFT pill collapse)
 * lands on a card that's already pixel-aligned with what real polls render
 * — so the transition reads as "becoming real" rather than "rebuilding".
 *
 * Set `draftMode` to apply the dashed-blue chrome + show the DRAFT pill;
 * set `finalizing` (a transient prop driven by submit) to release those
 * styles back to the regular live appearance over a CSS transition.
 *
 * Live polls use ThreadList's `goToThread` onClick; the draft variant
 * passes onClick=undefined (the entire card isn't clickable; per-draft
 * editing happens via the edit-rows slot rendered below the card).
 */
export interface ThreadListItemProps {
  title: string;
  latestQuestionTitle: string;
  participantNames: string[];
  anonymousRespondentCount: number;
  questionCount: number;
  /** When set, "N min ago" appears in the metadata row; omit for drafts. */
  createdAt?: string | null;
  /** When set, a colored countdown shows on the right. */
  soonestUnvotedDeadline?: string | null;
  unvotedCount?: number;
  hasUnvoted?: boolean;
  pressed?: boolean;
  draftMode?: boolean;
  /** Transient: while true, the card visually morphs from draft → live. */
  finalizing?: boolean;
  /** Renders the top border too — caller passes true on the first list item. */
  isFirst?: boolean;
  /** Caller can drop in extra metadata (e.g. "ready to submit") inline. */
  metadataExtra?: React.ReactNode;
  onClick?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchEnd?: () => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  threadRootId?: string;
}

export default function ThreadListItem(props: ThreadListItemProps) {
  const {
    title,
    latestQuestionTitle,
    participantNames,
    anonymousRespondentCount,
    questionCount,
    createdAt,
    soonestUnvotedDeadline,
    unvotedCount = 0,
    hasUnvoted = false,
    pressed = false,
    draftMode = false,
    finalizing = false,
    isFirst = false,
    metadataExtra,
    onClick,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    threadRootId,
  } = props;

  // Apply draft chrome only while still in draft mode AND not yet finalizing.
  // The finalizing flag releases the chrome over a CSS transition so the
  // morph reads as a single fluid change instead of an instant swap.
  const showDraftChrome = draftMode && !finalizing;
  const titleEmphasized = hasUnvoted || (draftMode && !finalizing);

  return (
    <div
      data-thread-root-id={threadRootId}
      className={`mx-1.5 transition-colors duration-500 ease-out ${isFirst ? 'border-t' : ''} border-b ${
        showDraftChrome
          ? 'border-dashed border-blue-400 dark:border-blue-500'
          : 'border-solid border-gray-200 dark:border-gray-700'
      }`}
    >
      <div
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        className={`flex gap-3 pl-2 pr-3 py-3 select-none relative transition-colors duration-500 ease-out ${
          pressed ? 'bg-blue-50 dark:bg-blue-900/30' : ''
        } ${
          onClick
            ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-blue-50 dark:active:bg-blue-900/30 cursor-pointer'
            : ''
        } ${
          showDraftChrome ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''
        }`}
      >
        {/* Respondent circles — empty for drafts (RespondentCircles renders a
            placeholder when names is empty + anonymous=0). */}
        <RespondentCircles
          names={participantNames}
          anonymousCount={anonymousRespondentCount}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3
              className={`font-semibold text-base truncate flex-1 transition-colors duration-500 ease-out ${
                titleEmphasized ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {title}
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* DRAFT pill — collapses out via opacity + width on finalize. */}
              {draftMode && (
                <span
                  className={`inline-flex items-center justify-center h-5 rounded-full bg-blue-500 text-white text-xs font-bold uppercase tracking-wide overflow-hidden whitespace-nowrap transition-[opacity,max-width,padding] duration-300 ease-out ${
                    finalizing ? 'opacity-0 max-w-0 px-0' : 'opacity-100 max-w-[80px] px-2'
                  }`}
                >
                  draft
                </span>
              )}
              {hasUnvoted && unvotedCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                  {unvotedCount}
                </span>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-300 truncate mt-0.5">
            {latestQuestionTitle}
          </p>

          <div className="flex items-center justify-between mt-1">
            <div className="text-xs text-gray-400 dark:text-gray-500">
              <ClientOnly fallback={null}>
                <>
                  {questionCount > 1 && <>{questionCount} questions &middot; </>}
                  {createdAt
                    ? relativeTime(createdAt)
                    : metadataExtra ?? null}
                </>
              </ClientOnly>
            </div>
            {soonestUnvotedDeadline && (
              <div className="text-xs">
                <ClientOnly fallback={null}>
                  <SimpleCountdown
                    deadline={soonestUnvotedDeadline}
                    colorClass="text-green-600 dark:text-green-400"
                    hideSecondsInDays
                  />
                </ClientOnly>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

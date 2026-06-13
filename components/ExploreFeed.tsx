"use client";

/**
 * Shared rendering for the /explore feed's poll list, used by BOTH the page
 * (`app/explore/page.tsx`) and the swipe-back snapshot (`ExploreBackdropHost`).
 * Each poll is an edge-to-edge rectangle with a bottom divider — a trimmed
 * version of the group card (icon + title + muted metadata). Tapping slides to
 * the poll's detail page; the detail page is marked as explore-origin so its
 * back + swipe return to /explore (see lib/pollDetailOrigin).
 */

import { useCallback } from "react";
import type { Poll, Question } from "@/lib/types";
import { getCategoryIcon, relativeTime } from "@/lib/questionListUtils";
import { slideToPollDetail } from "@/lib/slideOverlay";
import { markPollDetailFromExplore } from "@/lib/pollDetailOrigin";

// Mirrors ROW_DIVIDER_CLASS in GroupCardItem (inlined to keep that heavy
// "use client" component module out of the /explore bundle).
export const EXPLORE_ROW_DIVIDER = "border-gray-300 dark:border-gray-600";

export function ExplorePollCard({
  poll,
  interactive = true,
}: {
  poll: Poll;
  /** false → a read-only snapshot row (the swipe backdrop): no tap, no hit area. */
  interactive?: boolean;
}) {
  const anchor: Question | undefined = poll.questions[0];
  // The poll's OWN title (the wrapper-level question title), NOT poll.title —
  // the latter resolves to the explore group's "Explore" name override.
  const title = anchor?.title || poll.title || "Poll";
  const icon = anchor ? getCategoryIcon(anchor) : "🗳️";
  const groupRoute = poll.group_short_id ?? poll.group_id ?? null;
  const pollShort = poll.short_id ?? poll.id;
  const views = poll.viewed_total ?? 0;

  const onTap = useCallback(() => {
    if (!groupRoute) return;
    // Mark this detail page as explore-origin so its back + swipe return to
    // /explore (with the explore feed backdrop) rather than the group root.
    markPollDetailFromExplore(pollShort);
    slideToPollDetail({ groupId: groupRoute, pollShortId: pollShort });
  }, [groupRoute, pollShort]);

  return (
    <button
      type="button"
      onClick={interactive ? onTap : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-hidden={interactive ? undefined : true}
      className={`block w-full text-left pl-[0.9rem] pr-[0.65rem] pt-3 pb-2 border-b ${EXPLORE_ROW_DIVIDER} ${interactive ? "active:bg-gray-100 dark:active:bg-gray-800/60" : "pointer-events-none"}`}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-lg leading-tight" aria-hidden>{icon}</span>
        <h3 className="min-w-0 flex-1 text-lg font-medium leading-tight break-words">
          {title}
        </h3>
        <svg className="shrink-0 w-4 h-4 mt-1 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="mt-1 flex items-baseline gap-1 text-xs text-gray-400 dark:text-gray-500">
        {poll.creator_name && <span className="truncate shrink min-w-0">{poll.creator_name}</span>}
        {poll.creator_name && <span aria-hidden>·</span>}
        <span className="shrink-0">{relativeTime(poll.created_at)}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{views} {views === 1 ? "View" : "Views"}</span>
      </div>
    </button>
  );
}

/** The full feed list (top sentinel divider + cards). Returns null when empty
 *  so the caller can render its own empty-state copy. */
export function ExploreFeedList({
  polls,
  interactive = true,
}: {
  polls: Poll[];
  interactive?: boolean;
}) {
  if (polls.length === 0) return null;
  return (
    <>
      <div className={`border-t ${EXPLORE_ROW_DIVIDER}`} />
      {polls.map((poll) => (
        <ExplorePollCard key={poll.id} poll={poll} interactive={interactive} />
      ))}
    </>
  );
}

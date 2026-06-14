"use client";

/**
 * Shared rendering for the /explore feed's poll list, used by BOTH the page
 * (`app/explore/page.tsx`) and the swipe-back snapshot (`ExploreBackdropHost`).
 * Each poll is a compact edge-to-edge row with a bottom divider: vote count +
 * title only (no icon, no metadata). The title is a strong color until this
 * device opens the poll, then faded. Tapping slides to the poll's detail page;
 * the detail page is marked as explore-origin so its back + swipe return to
 * /explore (see lib/pollDetailOrigin).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Poll, Question } from "@/lib/types";
import { slideToPollDetail } from "@/lib/slideOverlay";
import { markPollDetailFromExplore } from "@/lib/pollDetailOrigin";
import { getPollViewedAt, POLL_VIEWED_CHANGED_EVENT } from "@/lib/unread";

// Mirrors ROW_DIVIDER_CLASS in GroupCardItem (inlined to keep that heavy
// "use client" component module out of the /explore bundle).
export const EXPLORE_ROW_DIVIDER = "border-gray-300 dark:border-gray-600";

/**
 * The "Explore" title bar — shared by the live page and the swipe-back backdrop
 * so the two can't drift. `fixed` pins it to the viewport top (the live page,
 * rendered into #header-portal so it slides with the back gesture); unfixed it
 * sits in-flow at the top of the contained backdrop snapshot, which reads the
 * same at scroll 0. The h-14 row height matches the live page's content
 * paddingTop (3.5rem + safe-area).
 */
export function ExploreTitleBar({ fixed = false }: { fixed?: boolean }) {
  return (
    <div
      className={`${fixed ? "fixed left-0 right-0 top-0 z-20 " : ""}bg-background border-b border-gray-200 dark:border-gray-700`}
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="h-14 flex items-center justify-center px-16">
        <h1 className="text-2xl font-bold text-center break-words select-none">
          Explore
        </h1>
      </div>
    </div>
  );
}

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
  const groupRoute = poll.group_short_id ?? poll.group_id ?? null;
  const pollShort = poll.short_id ?? poll.id;

  // Vote count = distinct voters (named, with multiplicity) + anonymous.
  // Inlined rather than importing namedVoterCount from VoterList so the heavy
  // VoterList module stays out of the /explore bundle (see ROW_DIVIDER note).
  const votes = useMemo(() => {
    const counts = poll.voter_name_counts;
    const named = (poll.voter_names ?? []).reduce(
      (sum, n) => sum + (counts?.[n] ?? 1),
      0,
    );
    return named + (poll.anonymous_count ?? 0);
  }, [poll.voter_names, poll.voter_name_counts, poll.anonymous_count]);

  // Opened = this device has viewed the poll detail page. Strong title when
  // unopened, faded once opened. Re-renders via the tick from ExploreFeedList.
  const opened = getPollViewedAt(poll.id) > 0;

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
      className={`block w-full text-left pl-[0.9rem] pr-[0.65rem] py-1.5 border-b ${EXPLORE_ROW_DIVIDER} ${interactive ? "active:bg-gray-100 dark:active:bg-gray-800/60" : "pointer-events-none"}`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="shrink-0 tabular-nums text-sm font-semibold text-gray-400 dark:text-gray-500"
          aria-label={`${votes} ${votes === 1 ? "vote" : "votes"}`}
        >
          {votes}
        </span>
        <h3
          className={`min-w-0 flex-1 text-base leading-snug break-words ${
            opened
              ? "font-normal text-gray-400 dark:text-gray-500"
              : "font-medium text-gray-900 dark:text-gray-100"
          }`}
        >
          {title}
        </h3>
      </div>
    </button>
  );
}

/** The full feed list (top sentinel divider + cards), sorted newest-first —
 *  the single source of truth for explore ordering, so callers (the page +
 *  the swipe backdrop) pass `polls` unsorted. Returns null when empty so the
 *  caller can render its own empty-state copy. */
export function ExploreFeedList({
  polls,
  interactive = true,
}: {
  polls: Poll[];
  interactive?: boolean;
}) {
  // Bump on every poll-view so the cards' opened/faded title state re-renders
  // when returning from a poll detail page (markPollViewed fires the event).
  const [, setViewedTick] = useState(0);
  useEffect(() => {
    const onViewed = () => setViewedTick((t) => t + 1);
    window.addEventListener(POLL_VIEWED_CHANGED_EVENT, onViewed);
    return () => window.removeEventListener(POLL_VIEWED_CHANGED_EVENT, onViewed);
  }, []);

  const sorted = useMemo(
    () => [...polls].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [polls],
  );
  if (sorted.length === 0) return null;
  return (
    <>
      <div className={`border-t ${EXPLORE_ROW_DIVIDER}`} />
      {sorted.map((poll) => (
        <ExplorePollCard key={poll.id} poll={poll} interactive={interactive} />
      ))}
    </>
  );
}

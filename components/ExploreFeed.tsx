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

// Indentation step per variant generation (the spine grows away from the
// trunk; deeper variants sit further right).
const INDENT_STEP_REM = 1.25;

export function ExplorePollCard({
  poll,
  interactive = true,
  indent = 0,
}: {
  poll: Poll;
  /** false → a read-only snapshot row (the swipe backdrop): no tap, no hit area. */
  interactive?: boolean;
  /** Variant depth from the trunk (0 = trunk, ≥1 = spawned variant). Drives the
   *  left indentation that visualizes the evolution spine. */
  indent?: number;
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
      style={{
        paddingLeft:
          indent > 0
            ? `calc(0.9rem + ${indent * INDENT_STEP_REM}rem)`
            : "0.9rem",
      }}
      className={`relative block w-full text-left pr-[0.65rem] py-1.5 border-b ${EXPLORE_ROW_DIVIDER} ${interactive ? "active:bg-gray-100 dark:active:bg-gray-800/60" : "pointer-events-none"}`}
    >
      {/* Thin guides in the indentation channels so the spine reads as a tree.
       *  One rail per ancestor level (not just this row's own channel), so the
       *  shallower rails are SHARED across every row in a chain and form a
       *  continuous vertical line converging toward the trunk — a single
       *  per-row tick at (indent-0.5) would sit at a different x each
       *  generation and never connect. */}
      {indent > 0 &&
        Array.from({ length: indent }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute inset-y-0 w-px bg-gray-200 dark:bg-gray-700"
            style={{ left: `calc(0.9rem + ${(i + 0.5) * INDENT_STEP_REM}rem)` }}
          />
        ))}
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
              : indent === 0
                ? "font-semibold text-gray-900 dark:text-gray-100"
                : "font-medium text-gray-900 dark:text-gray-100"
          }`}
        >
          {title}
        </h3>
      </div>
    </button>
  );
}

type SpineRow = { poll: Poll; indent: number };

/** Group polls into evolution spines and order each as up-chain (deepest at
 *  top) → trunk → down-chain, indenting by variant generation. Spines are
 *  ordered newest-trunk-first. A plain (non-variant) poll is a one-row spine. */
export function buildSpines(polls: Poll[]): SpineRow[] {
  const rootKey = (p: Poll) => p.variant_root_id ?? p.id;
  const byRoot = new Map<string, Poll[]>();
  for (const p of polls) {
    const k = rootKey(p);
    const arr = byRoot.get(k);
    if (arr) arr.push(p);
    else byRoot.set(k, [p]);
  }
  const gen = (p: Poll) => p.variant_generation ?? 0;
  const built: { time: number; rows: SpineRow[] }[] = [];
  for (const members of byRoot.values()) {
    const trunk =
      members.find((p) => gen(p) === 0 || !p.variant_parent_id) ??
      [...members].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )[0];
    const chain = (dir: "up" | "down") =>
      members
        .filter((p) => p.variant_direction === dir)
        .sort((a, b) => gen(a) - gen(b));
    const up = chain("up");
    const down = chain("down");
    const rows: SpineRow[] = [];
    for (let i = up.length - 1; i >= 0; i--) rows.push({ poll: up[i], indent: gen(up[i]) });
    rows.push({ poll: trunk, indent: 0 });
    for (const p of down) rows.push({ poll: p, indent: gen(p) });
    built.push({ time: new Date(trunk.created_at).getTime(), rows });
  }
  built.sort((a, b) => b.time - a.time);
  return built.flatMap((s) => s.rows);
}

/** The full feed list (top sentinel divider + cards), grouped into evolution
 *  spines (each trunk with its variants growing above/below it, newest trunk
 *  first) — the single source of truth for explore ordering, so callers (the
 *  page + the swipe backdrop) pass `polls` unsorted. Returns null when empty so
 *  the caller can render its own empty-state copy. */
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

  const rows = useMemo(() => buildSpines(polls), [polls]);
  if (rows.length === 0) return null;
  return (
    <>
      <div className={`border-t ${EXPLORE_ROW_DIVIDER}`} />
      {rows.map(({ poll, indent }) => (
        <ExplorePollCard
          key={poll.id}
          poll={poll}
          indent={indent}
          interactive={interactive}
        />
      ))}
    </>
  );
}

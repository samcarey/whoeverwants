/**
 * Gap 1: per-poll follow/ignore tab classification ("To Do · New · Old").
 *
 * A poll's tab is derived from its server-set `viewer_follow_state` plus the
 * viewer's local response state:
 *
 *   - Old   — the viewer ✕'d it (`viewer_follow_state === 'old'`). Sticky:
 *             new activity does NOT pull it back; only the green + does.
 *   - To Do — followed (not Old), NEEDS the viewer's input: open + votable now
 *             (or in an active prephase the viewer can contribute to), deadline
 *             not passed, and the viewer hasn't voted/abstained on every
 *             sub-question. (To Do ⊆ New.)
 *   - New   — followed, everything else (already responded, or closed-and-still-
 *             followed so the viewer sees the outcome).
 *
 * Pure + dependency-light so it's testable and cheap to call per-card. The
 * "responded" signal is `pollHasResponse`: the localStorage voted/abstained
 * sets the rest of the group page uses, ORed with the server's account-aware
 * `poll.viewer_responded` (a vote cast on another linked device clears To Do
 * here even though this device's local sets are empty).
 */

import type { Poll } from "@/lib/types";
import { pollHasResponse } from "@/lib/unread";

export type PollTab = "todo" | "new" | "old";

/** Whether a followed poll still wants the viewer's input — open, deadline not
 *  passed, and not yet responded. An active prephase (suggestions/availability
 *  collection) counts: the viewer can still contribute, so it's To Do.
 *
 *  INTENTIONAL divergence from `isPollUnread`'s todoMode branch (lib/unread.ts):
 *  that one EXCLUDES polls still in a prephase (`prephase_deadline > now → not
 *  unread`), because the app-icon to-do BADGE only counts polls where voting is
 *  actually open. The Gap-1 To Do TAB is deliberately more inclusive — the spec
 *  says "a poll in an active prephase the viewer can contribute to counts as To
 *  Do." So the two predicates are NOT meant to be unified; this comment is the
 *  cross-reference so the difference reads as deliberate. */
function pollNeedsInput(
  poll: Poll,
  voted: Set<string>,
  abstained: Set<string>,
  nowMs: number,
): boolean {
  if (poll.is_closed) return false;
  if (
    poll.response_deadline &&
    new Date(poll.response_deadline).getTime() <= nowMs
  ) {
    return false;
  }
  return !pollHasResponse(poll, voted, abstained);
}

export function classifyPollTab(
  poll: Poll,
  voted: Set<string>,
  abstained: Set<string>,
  nowMs: number = Date.now(),
): PollTab {
  if (poll.viewer_follow_state === "old") return "old";
  if (pollNeedsInput(poll, voted, abstained, nowMs)) return "todo";
  return "new";
}

export interface FollowTabCounts {
  todo: number;
  /** Everything the viewer is following (not Old) — To Do is a subset. */
  new: number;
  old: number;
}

/** Tally a group's polls into the three tab buckets. `new` counts every
 *  followed (non-Old) poll, so `todo <= new`. */
export function tallyFollowTabs(
  polls: Poll[],
  voted: Set<string>,
  abstained: Set<string>,
  nowMs: number = Date.now(),
): FollowTabCounts {
  const counts: FollowTabCounts = { todo: 0, new: 0, old: 0 };
  for (const poll of polls) {
    const tab = classifyPollTab(poll, voted, abstained, nowMs);
    if (tab === "old") {
      counts.old += 1;
    } else {
      counts.new += 1;
      if (tab === "todo") counts.todo += 1;
    }
  }
  return counts;
}

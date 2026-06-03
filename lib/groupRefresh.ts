/**
 * Helpers for the periodic background refresh on `/g/<id>` that keeps a
 * group in sync with other users' actions (new polls, new votes, close /
 * reopen / cutoff).
 *
 * The group page already has the machinery to update its state on the
 * user's own writes (POLL_HYDRATED, QUESTION_VOTES_CHANGED, etc.). For
 * remote writes we poll `apiGetGroupByRouteId` every few seconds and
 * merge the response. To avoid forcing every memoized `GroupCardItem` to
 * re-render on every poll tick, the merge preserves prev `Poll` and
 * `Question` identities when their content is unchanged.
 *
 * `arePropsEqual` in `GroupCardItem.tsx` compares `prev.group.poll` /
 * `subQuestions[i]` by reference, so passing the SAME `Poll` object for
 * polls whose data didn't change is the difference between zero and N
 * card re-renders per refresh tick.
 */

import type { Poll, Question, QuestionResults, SuggestionCount } from './types';

function isStringArrayEqual(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (al !== bl) return false;
  if (al === 0) return true;
  for (let i = 0; i < al; i++) if (a![i] !== b![i]) return false;
  return true;
}

function isNumberRecordEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a === !b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

function isSuggestionCountsEqual(
  a: SuggestionCount[] | undefined,
  b: SuggestionCount[] | undefined,
): boolean {
  if (a === b) return true;
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (al !== bl) return false;
  for (let i = 0; i < al; i++) {
    if (a![i].option !== b![i].option) return false;
    if (a![i].count !== b![i].count) return false;
  }
  return true;
}

function isResultsContentEqual(
  a: QuestionResults | null | undefined,
  b: QuestionResults | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a === !b;
  return (
    a.total_votes === b.total_votes &&
    a.yes_count === b.yes_count &&
    a.no_count === b.no_count &&
    a.abstain_count === b.abstain_count &&
    a.yes_percentage === b.yes_percentage &&
    a.no_percentage === b.no_percentage &&
    a.winner === b.winner &&
    a.total_rounds === b.total_rounds &&
    a.ranked_choice_winner === b.ranked_choice_winner &&
    a.consensus_winner === b.consensus_winner &&
    a.max_availability === b.max_availability &&
    isStringArrayEqual(a.options, b.options) &&
    isStringArrayEqual(a.included_slots, b.included_slots) &&
    isSuggestionCountsEqual(a.suggestion_counts, b.suggestion_counts) &&
    isNumberRecordEqual(a.availability_counts, b.availability_counts) &&
    isNumberRecordEqual(a.like_counts, b.like_counts) &&
    isNumberRecordEqual(a.dislike_counts, b.dislike_counts) &&
    (a.ranked_choice_rounds?.length ?? 0) === (b.ranked_choice_rounds?.length ?? 0)
  );
}

function isQuestionContentEqual(a: Question, b: Question): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.title !== b.title) return false;
  if (a.updated_at !== b.updated_at) return false;
  if (a.response_count !== b.response_count) return false;
  if (a.question_index !== b.question_index) return false;
  if (a.poll_id !== b.poll_id) return false;
  if (!isStringArrayEqual(a.options, b.options)) return false;
  if (!isResultsContentEqual(a.results, b.results)) return false;
  return true;
}

function isPollContentEqual(a: Poll, b: Poll): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.is_closed !== b.is_closed) return false;
  if (a.close_reason !== b.close_reason) return false;
  if (a.response_deadline !== b.response_deadline) return false;
  if (a.prephase_deadline !== b.prephase_deadline) return false;
  if (a.prephase_deadline_minutes !== b.prephase_deadline_minutes) return false;
  if (a.group_title !== b.group_title) return false;
  if (a.group_image_updated_at !== b.group_image_updated_at) return false;
  if (a.title !== b.title) return false;
  if (a.context !== b.context) return false;
  if (a.details !== b.details) return false;
  if (a.anonymous_count !== b.anonymous_count) return false;
  if ((a.viewed_total ?? 0) !== (b.viewed_total ?? 0)) return false;
  // Gap 1: a cross-device ✕/+ flips this; reflect it on the next refresh.
  if ((a.viewer_follow_state ?? "new") !== (b.viewer_follow_state ?? "new")) return false;
  if ((a.suggestion_count ?? 0) !== (b.suggestion_count ?? 0)) return false;
  if (a.updated_at !== b.updated_at) return false;
  if (a.creator_name !== b.creator_name) return false;
  if (!isStringArrayEqual(a.voter_names, b.voter_names)) return false;
  if (a.questions.length !== b.questions.length) return false;
  for (let i = 0; i < b.questions.length; i++) {
    if (!isQuestionContentEqual(a.questions[i], b.questions[i])) return false;
  }
  return true;
}

export interface PollMergeResult {
  /** Polls list to use going forward. Equals `prev` when no content
   *  changed (both reference and order — safe to short-circuit further
   *  group-state updates against). */
  polls: Poll[];
  /** Whether `polls` differs from `prev` (membership, order, or content). */
  changed: boolean;
}

/** Merge a freshly-fetched poll list with the previous in-state list,
 *  preserving prev `Poll` identities for polls whose content is
 *  unchanged. The fresh ordering wins (so chronological sort from the
 *  server is honored). */
export function mergePollListPreservingIdentity(
  prev: readonly Poll[],
  fresh: readonly Poll[],
): PollMergeResult {
  const prevById = new Map<string, Poll>();
  for (const p of prev) prevById.set(p.id, p);
  const merged: Poll[] = [];
  let anyContentChanged = false;
  for (const fp of fresh) {
    const pp = prevById.get(fp.id);
    if (!pp) {
      merged.push(fp);
      anyContentChanged = true;
      continue;
    }
    if (isPollContentEqual(pp, fp)) {
      merged.push(pp);
    } else {
      merged.push(fp);
      anyContentChanged = true;
    }
  }
  if (!anyContentChanged && merged.length === prev.length) {
    let identical = true;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] !== prev[i]) { identical = false; break; }
    }
    if (identical) {
      return { polls: prev as Poll[], changed: false };
    }
  }
  return { polls: merged, changed: true };
}

/** Merge inline `question.results` from `polls` into the group page's
 *  `questionResultsMap` state, returning `prev` unchanged when nothing
 *  meaningful differs. Identity preservation here matters because this
 *  Map is one of the slices `arePropsEqual` compares per-question. */
export function mergeQuestionResultsMap(
  prev: Map<string, QuestionResults>,
  polls: readonly Poll[],
): Map<string, QuestionResults> {
  let next: Map<string, QuestionResults> | null = null;
  for (const mp of polls) {
    for (const sp of mp.questions) {
      const fresh = sp.results;
      if (!fresh) continue;
      const existing = prev.get(sp.id);
      if (existing && isResultsContentEqual(existing, fresh)) continue;
      if (!next) next = new Map(prev);
      next.set(sp.id, fresh);
    }
  }
  return next ?? prev;
}

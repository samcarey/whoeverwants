"use client";

/**
 * One poll of an event, as its own card under the event page's "Polls"
 * heading — with the ballot INLINE:
 *
 *   - TWO options (a yes/no question, or a 2-option ranked choice): the
 *     one-click ballot is always visible in the card — tap a side to vote
 *     (tap the other to change). No expand/collapse, no chevron.
 *   - MORE than two options: the card collapses to its header; tapping the
 *     title (or the upper-right chevron) expands it inline into the full
 *     drag-to-rank ballot (RankableOptions) + Submit. The PARENT enforces
 *     one-open-at-a-time (expanding one collapses the other) and the
 *     expand/collapse is height-animated (the grid-rows 0fr↔1fr clip).
 *
 * The card fetches its own poll + results + own vote (the poll page's data,
 * scoped down): counts refresh on a 7s visible-gated loop so the tallies
 * track other voters live. Votes go through the same atomic
 * `apiSubmitPollVotes` the real ballot uses (vote_id set on edits), and the
 * localStorage vote markers are kept in sync so the poll page agrees.
 * Closed polls render a "See results ›" header that navigates instead.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import RankableOptions from "@/components/RankableOptions";
import SimpleCountdown from "@/components/SimpleCountdown";
import {
  apiGetPollByShortId,
  apiGetQuestionResults,
  apiGetVotes,
  apiSubmitPollVotes,
} from "@/lib/api";
import type { Poll, Question, QuestionResults } from "@/lib/types";
import type { SlotEventPoll } from "@/lib/api/slots";
import { getCategoryIcon } from "@/lib/questionListUtils";
import { getUserName } from "@/lib/userProfile";
import {
  getStoredVoteId,
  setStoredVoteId,
  setVotedQuestionFlag,
} from "@/lib/votedQuestionsStorage";
import { haptic } from "@/lib/haptics";

const RESULTS_REFRESH_MS = 7000;

/** Round-1 count for an option (the binary card's tally). */
function firstRoundCount(results: QuestionResults | null, option: string): number {
  return (
    results?.ranked_choice_rounds?.find(
      (r) => r.round_number === 1 && r.option_name === option,
    )?.vote_count ?? 0
  );
}

function pct(count: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

/** One selectable side of a two-option ballot. */
function BinaryChoice({
  label,
  count,
  total,
  selected,
  disabled,
  onPick,
}: {
  label: string;
  count: number;
  total: number;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-pressed={selected}
      className={`relative flex-1 min-w-0 rounded-2xl border px-2 py-2.5 text-center transition disabled:opacity-60 ${
        selected
          ? "border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/30"
          : "border-gray-200 bg-white active:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:active:bg-gray-700/60"
      }`}
    >
      {selected && (
        <span className="absolute -top-2 -right-2 flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-full bg-blue-600">
          <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={4} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
        {label}
      </span>
      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
        {pct(count, total)} <span className="text-gray-400 dark:text-gray-500">({count})</span>
      </span>
    </button>
  );
}

export default function EventPollCard({
  pollRef,
  eventIso,
  expanded,
  onToggleExpand,
  gateOnName,
  onOpenPoll,
}: {
  pollRef: SlotEventPoll;
  /** The event's start instant — the voting-window countdown. */
  eventIso: string;
  expanded: boolean;
  onToggleExpand: () => void;
  gateOnName: (retry: () => void) => boolean;
  /** Navigate to the full poll page (closed polls' "See results ›"). */
  onOpenPoll: () => void;
}) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [results, setResults] = useState<QuestionResults | null>(null);
  const [myVote, setMyVote] = useState<{
    voteId: string;
    yesNo: string | null;
    ranking: string[] | null;
    tiers: string[][] | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const question: Question | undefined = poll?.questions?.[0];
  const options = useMemo(() => question?.options ?? [], [question]);
  const isYesNo = question?.question_type === "yes_no";
  const isBinary = !isYesNo && options.length === 2;
  const expandable = !isYesNo && options.length > 2 && !pollRef.is_closed;

  // The full drag-ballot's in-progress order. STATE, not a ref: whether the
  // Submit button shows depends on it (hidden once a submitted vote exists
  // and the ballot matches it) — RankableOptions reports per drop / tap-move,
  // not per drag frame, so the re-render is cheap.
  const [liveRanking, setLiveRanking] = useState<{
    order: string[];
    tiers: string[][];
  } | null>(null);

  const loadResults = useCallback(async (qid: string) => {
    try {
      setResults(await apiGetQuestionResults(qid));
    } catch {
      // Counts are supplementary; the next tick retries.
    }
  }, []);

  // Poll + own vote, once per pollRef.
  useEffect(() => {
    if (!pollRef.poll_short_id) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await apiGetPollByShortId(pollRef.poll_short_id!);
        if (cancelled) return;
        setPoll(p);
        const q = p.questions?.[0];
        if (!q) return;
        void loadResults(q.id);
        // Own vote (ballot-privacy-scoped — anything returned is the
        // caller's). Adopt the id locally so the poll page agrees.
        try {
          const votes = await apiGetVotes(q.id);
          const mine = votes.find((v) => !v.is_abstain) ?? votes[0];
          if (cancelled || !mine) return;
          if (!getStoredVoteId(q.id)) {
            setStoredVoteId(q.id, mine.id);
            setVotedQuestionFlag(q.id, mine.is_abstain ? "abstained" : true);
          }
          setMyVote({
            voteId: mine.id,
            yesNo: mine.yes_no_choice,
            ranking: mine.ranked_choices,
            tiers: mine.ranked_choice_tiers,
          });
        } catch {
          // No own vote / fetch failed — fresh ballot.
        }
      } catch {
        if (!cancelled) setError("Couldn't load the poll.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pollRef.poll_short_id, loadResults]);

  // Live tallies (visible-gated recursive timeout, the comments cadence).
  useEffect(() => {
    const qid = question?.id;
    if (!qid || pollRef.is_closed) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible" && !submitting) {
        await loadResults(qid);
      }
      if (alive) timer = setTimeout(() => void tick(), RESULTS_REFRESH_MS);
    };
    timer = setTimeout(() => void tick(), RESULTS_REFRESH_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // `submitting` deliberately not a dep — the loop reads it per tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, pollRef.is_closed, loadResults]);

  const submitItems = useCallback(
    async (item: Record<string, unknown>) => {
      if (!poll || !question || submitting) return;
      setSubmitting(true);
      setError(null);
      haptic.success();
      try {
        const votes = await apiSubmitPollVotes(poll.id, {
          voter_name: getUserName()?.trim() ?? "",
          items: [
            {
              question_id: question.id,
              vote_id: myVote?.voteId ?? getStoredVoteId(question.id) ?? null,
              is_abstain: false,
              ...item,
            } as never,
          ],
        });
        const v = votes.find((x) => x.question_id === question.id) ?? votes[0];
        if (v) {
          setStoredVoteId(question.id, v.id);
          setVotedQuestionFlag(question.id, true);
          setMyVote({
            voteId: v.id,
            yesNo: v.yes_no_choice,
            ranking: v.ranked_choices,
            tiers: v.ranked_choice_tiers,
          });
        }
        void loadResults(question.id);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1800);
      } catch {
        setError("Failed to submit vote");
      } finally {
        setSubmitting(false);
      }
    },
    [poll, question, submitting, myVote, loadResults],
  );

  const pickYesNo = (choice: "yes" | "no") => {
    if (myVote?.yesNo === choice) return;
    const fire = () =>
      void submitItems({ vote_type: "yes_no", yes_no_choice: choice });
    if (!gateOnName(fire)) return;
    fire();
  };

  const pickBinary = (option: string) => {
    if (myVote?.ranking?.[0] === option) return;
    const other = options.find((o) => o !== option)!;
    const fire = () =>
      void submitItems({
        vote_type: "ranked_choice",
        ranked_choices: [option, other],
        ranked_choice_tiers: [[option], [other]],
      });
    if (!gateOnName(fire)) return;
    fire();
  };

  const submitRanking = () => {
    if (!liveRanking || liveRanking.order.length === 0) return;
    const { order } = liveRanking;
    const tiers =
      liveRanking.tiers.length > 0 ? liveRanking.tiers : order.map((o) => [o]);
    const fire = () =>
      void submitItems({
        vote_type: "ranked_choice",
        ranked_choices: order,
        ranked_choice_tiers: tiers,
      });
    if (!gateOnName(fire)) return;
    fire();
  };

  // Show Submit only while the ballot DIFFERS from what's already submitted:
  // a first-time voter always sees it; after voting it stays hidden until a
  // drag/tap changes the order (or tie links), and hides again on save.
  const ballotDirty = useMemo(() => {
    if (!liveRanking || liveRanking.order.length === 0) return false;
    const submitted = myVote?.ranking;
    if (!submitted || submitted.length === 0) return true;
    const sameOrder = (a: string[], b: string[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    if (!sameOrder(liveRanking.order, submitted)) return true;
    // Tier (equal-rank link) changes are ballot changes too; null/absent
    // tiers mean the strict singleton order.
    const norm = (tiers: string[][] | null, order: string[]) =>
      tiers && tiers.length > 0 ? tiers : order.map((o) => [o]);
    const a = norm(liveRanking.tiers, liveRanking.order);
    const b = norm(myVote?.tiers ?? null, submitted);
    return a.length !== b.length || a.some((t, i) => !sameOrder(t, b[i]));
  }, [liveRanking, myVote]);

  const icon = question ? getCategoryIcon(question) : "📊";
  const yesNoTotal = (results?.yes_count ?? 0) + (results?.no_count ?? 0);
  const binaryTotal =
    firstRoundCount(results, options[0] ?? "") + firstRoundCount(results, options[1] ?? "");

  const header = (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="shrink-0 text-xl leading-none">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-base text-gray-900 dark:text-gray-100">
        {pollRef.title ?? "Poll"}
      </span>
      <span className="shrink-0 text-sm">
        {pollRef.is_closed ? (
          <span className="text-gray-400 dark:text-gray-500">See results ›</span>
        ) : (
          <SimpleCountdown
            deadline={eventIso}
            compact
            blankOnExpire
            colorClass="text-blue-600 dark:text-blue-400"
          />
        )}
      </span>
      {expandable && (
        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      )}
    </div>
  );

  return (
    <div className="rounded-3xl bg-gray-50 px-4 py-2.5 dark:bg-gray-800">
      {pollRef.is_closed ? (
        <button type="button" onClick={onOpenPoll} className="block w-full text-left">
          {header}
        </button>
      ) : expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="block w-full text-left"
        >
          {header}
        </button>
      ) : (
        header
      )}

      {/* TWO options: the one-click ballot, always inline. */}
      {!pollRef.is_closed && question && (isYesNo || isBinary) && (
        <div className="mt-2.5 flex items-stretch gap-2">
          {isYesNo ? (
            <>
              <BinaryChoice
                label="Yes"
                count={results?.yes_count ?? 0}
                total={yesNoTotal}
                selected={myVote?.yesNo === "yes"}
                disabled={submitting}
                onPick={() => pickYesNo("yes")}
              />
              <BinaryChoice
                label="No"
                count={results?.no_count ?? 0}
                total={yesNoTotal}
                selected={myVote?.yesNo === "no"}
                disabled={submitting}
                onPick={() => pickYesNo("no")}
              />
            </>
          ) : (
            options.map((o) => (
              <BinaryChoice
                key={o}
                label={o}
                count={firstRoundCount(results, o)}
                total={binaryTotal}
                selected={myVote?.ranking?.[0] === o}
                disabled={submitting}
                onPick={() => pickBinary(o)}
              />
            ))
          )}
        </div>
      )}

      {/* MORE options: the full drag-to-rank ballot, expand-animated. */}
      {expandable && question && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-2.5">
              <p className="mb-1.5 px-1 text-center text-xs text-gray-500 dark:text-gray-400">
                Drag to rank, most preferred first
              </p>
              <RankableOptions
                // RankableOptions initializes once per mount — re-key it when
                // the (async-loaded) submitted vote lands so the ballot
                // re-seeds from it; without this the pre-load shuffle would
                // read as "different from submitted" and show Update Vote
                // untouched.
                key={myVote?.voteId ?? "fresh"}
                options={options}
                onRankingChange={(order, tiers) =>
                  setLiveRanking({ order, tiers })
                }
                disabled={submitting}
                storageKey={`event-poll-ranking-${question.id}`}
                initialRanking={myVote?.ranking ?? undefined}
                initialTiers={myVote?.tiers ?? undefined}
                optionsMetadata={question.options_metadata}
              />
              {ballotDirty ? (
                <button
                  type="button"
                  onClick={submitRanking}
                  disabled={submitting}
                  className="mt-2.5 w-full rounded-2xl bg-blue-600 py-2 font-medium text-white transition active:bg-blue-700 disabled:opacity-50"
                >
                  {submitting
                    ? "Submitting…"
                    : myVote?.ranking?.length
                      ? "Update Vote"
                      : "Submit Vote"}
                </button>
              ) : (
                myVote?.ranking?.length ? (
                  <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
                    Your vote is in — drag to change it
                  </p>
                ) : null
              )}
            </div>
          </div>
        </div>
      )}

      {justSaved && (
        <p className="mt-1.5 text-center text-xs text-green-600 dark:text-green-400">
          ✓ Vote saved
        </p>
      )}
      {error && (
        <p className="mt-1.5 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

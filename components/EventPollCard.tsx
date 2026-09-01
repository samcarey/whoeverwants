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
 *   - COLLECTING options (the activity asked for a suggestion phase, so the
 *     poll opens with none): the same expand, into the suggestion ballot —
 *     second what's been proposed, type your own, submit.
 *
 * The countdown belongs to the event page's "Polls" header line, not to the
 * cards — one clock for the section, naming whichever phase is running.
 *
 * The card fetches its own poll + results + own vote (the poll page's data,
 * scoped down): counts refresh on a 7s visible-gated loop so the tallies
 * track other voters live. Votes go through the same atomic
 * `apiSubmitPollVotes` the real ballot uses (vote_id set on edits), and the
 * localStorage vote markers are kept in sync so the poll page agrees.
 *
 * Anything left over navigates to the full poll instead, so a card is never
 * inert: closed polls read "See results ›", and that same fallback covers the
 * not-yet-loaded and unexpected-shape cases.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import RankableOptions from "@/components/RankableOptions";
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

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameTiers = (a: string[][], b: string[][]) =>
  a.length === b.length && a.every((t, i) => sameOrder(t, b[i]));
/** Null/absent tiers mean the strict singleton order. */
const normTiers = (tiers: string[][] | null, order: string[]) =>
  tiers && tiers.length > 0 ? tiers : order.map((o) => [o]);

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
  expanded,
  onToggleExpand,
  gateOnName,
  onOpenPoll,
}: {
  pollRef: SlotEventPoll;
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
    suggestions: string[] | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // Suggestion ballot: what the viewer has picked (their own proposals +
  // seconds), and the text they're typing. `picked` is seeded from their
  // submitted vote once it loads.
  const [picked, setPicked] = useState<string[]>([]);
  const [draftSuggestion, setDraftSuggestion] = useState("");

  const question: Question | undefined = poll?.questions?.[0];
  const options = useMemo(() => question?.options ?? [], [question]);
  const isYesNo = question?.question_type === "yes_no";
  const isBinary = !isYesNo && options.length === 2;
  // A poll whose activity asked for a suggestion phase opens with NO options:
  // the ballot is "propose / second an option" until the cutoff.
  const isCollecting = !!question && !isYesNo && options.length === 0 && !pollRef.is_closed;
  const expandable = !pollRef.is_closed && !isYesNo && (isCollecting || options.length > 2);
  // Every card must do SOMETHING when tapped: with no inline ballot to offer
  // (still loading, or a shape this card doesn't render), the whole card
  // routes to the full poll instead of sitting inert.
  const opensPoll = pollRef.is_closed || !(isYesNo || isBinary || expandable);
  // Everything proposed so far, with its second-count — the aggregate, never
  // per-voter (ballot privacy: `suggestion_counts` carries no names).
  const proposed = useMemo(
    () => (results?.suggestion_counts ?? []).map((sc) => ({ option: sc.option, count: sc.count })),
    [results],
  );
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  // The full drag-ballot's in-progress order. STATE, not a ref: whether the
  // Submit button shows depends on it (hidden once a submitted vote exists
  // and the ballot matches it) — RankableOptions reports per drop / tap-move,
  // not per drag frame, so the re-render is cheap.
  const [liveRanking, setLiveRanking] = useState<{
    order: string[];
    tiers: string[][];
  } | null>(null);
  // STABLE identity + content-equal bail, both load-bearing: RankableOptions
  // reports from an effect keyed on this callback, so an inline arrow (new
  // identity per render) + an always-new state object is an infinite
  // setState loop ("Maximum update depth exceeded").
  const handleRankingChange = useCallback((order: string[], tiers: string[][]) => {
    setLiveRanking((prev) =>
      prev && sameOrder(prev.order, order) && sameTiers(prev.tiers, tiers)
        ? prev
        : { order, tiers },
    );
  }, []);

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
            suggestions: mine.suggestions,
          });
          // Seed the suggestion ballot from what they already submitted.
          if (mine.suggestions?.length) setPicked(mine.suggestions);
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
            suggestions: v.suggestions,
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

  /** Toggle a proposed option in/out of the viewer's ballot (a "second"). */
  const togglePicked = (option: string) => {
    setPicked((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
    );
  };

  /** Commit the typed text as a new proposal (picked by definition — you
   *  second what you propose). Case-insensitive dedupe against what's already
   *  on the board, so typing an existing option just selects it. */
  const addDraftSuggestion = () => {
    const text = draftSuggestion.trim();
    if (!text) return;
    const existing =
      proposed.find((p) => p.option.toLowerCase() === text.toLowerCase())?.option ??
      picked.find((o) => o.toLowerCase() === text.toLowerCase());
    const value = existing ?? text;
    setPicked((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setDraftSuggestion("");
  };

  const submitSuggestions = () => {
    // Fold in whatever is still sitting in the input, so a typed-but-not-added
    // option isn't silently dropped by tapping Submit.
    const text = draftSuggestion.trim();
    const all = text && !picked.includes(text) ? [...picked, text] : picked;
    if (all.length === 0) return;
    const fire = () =>
      void submitItems({
        vote_type: "ranked_choice",
        suggestions: all,
        ranked_choices: null,
        ranked_choice_tiers: null,
        is_ranking_abstain: false,
      });
    if (!gateOnName(fire)) return;
    setDraftSuggestion("");
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
    if (!sameOrder(liveRanking.order, submitted)) return true;
    // Tier (equal-rank link) changes are ballot changes too.
    return !sameTiers(
      normTiers(liveRanking.tiers, liveRanking.order),
      normTiers(myVote?.tiers ?? null, submitted),
    );
  }, [liveRanking, myVote]);

  // Show Submit while the picks differ from what's submitted (a first-time
  // suggester always sees it), or while text is still sitting in the input.
  const suggestionsDirty = useMemo(() => {
    if (draftSuggestion.trim()) return true;
    const submitted = myVote?.suggestions ?? [];
    if (picked.length !== submitted.length) return true;
    const have = new Set(submitted);
    return picked.some((o) => !have.has(o));
  }, [picked, draftSuggestion, myVote]);

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
      {pollRef.is_closed && (
        <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500">See results ›</span>
      )}
      {expandable && (
        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${
            expanded ? "-rotate-90" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {/* Points LEFT while collapsed — this opens in place, and a right
              chevron reads as "a new page slides in". Rotates to down as it
              opens, the disclosure convention. */}
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      )}
    </div>
  );

  return (
    <div className="rounded-3xl bg-gray-50 px-4 py-2.5 dark:bg-gray-800">
      {opensPoll ? (
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

      {/* MORE options (or none yet): the ballot, expand-animated. */}
      {expandable && question && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        >
          <div className="min-h-0 overflow-hidden">
            {isCollecting ? (
            <div className="pt-2.5">
              <p className="mb-1.5 px-1 text-center text-xs text-gray-500 dark:text-gray-400">
                {proposed.length > 0
                  ? "Tap to second an option, or add your own"
                  : "Add the first option — everyone ranks them at the cutoff"}
              </p>
              {proposed.length > 0 && (
                <ul className="space-y-1.5">
                  {proposed.map((sug) => {
                    const on = pickedSet.has(sug.option);
                    return (
                      <li key={sug.option}>
                        <button
                          type="button"
                          onClick={() => togglePicked(sug.option)}
                          disabled={submitting}
                          aria-pressed={on}
                          className={`flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left transition disabled:opacity-60 ${
                            on
                              ? "border-green-500 bg-green-50 dark:border-green-500 dark:bg-green-900/25"
                              : "border-gray-200 bg-white active:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:active:bg-gray-700/60"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                              on
                                ? "border-green-600 bg-green-600 dark:border-green-500 dark:bg-green-500"
                                : "border-gray-300 dark:border-gray-600"
                            }`}
                          >
                            {on && (
                              <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth={4} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                            {sug.option}
                          </span>
                          <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                            {sug.count}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Picks that aren't on the board yet (typed this session). */}
              {picked.filter((o) => !proposed.some((p) => p.option === o)).length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {picked
                    .filter((o) => !proposed.some((p) => p.option === o))
                    .map((o) => (
                      <li
                        key={o}
                        className="flex items-center gap-2 rounded-2xl border border-green-500 bg-green-50 px-3 py-2 dark:border-green-500 dark:bg-green-900/25"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                          {o}
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePicked(o)}
                          disabled={submitting}
                          aria-label={`Remove ${o}`}
                          className="shrink-0 text-gray-400 hover:text-red-500 dark:text-gray-500"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  value={draftSuggestion}
                  onChange={(e) => setDraftSuggestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDraftSuggestion();
                    }
                  }}
                  disabled={submitting}
                  placeholder="Add an option…"
                  aria-label="Add an option"
                  className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-900/40 dark:placeholder:text-gray-500"
                />
                <button
                  type="button"
                  onClick={addDraftSuggestion}
                  disabled={submitting || !draftSuggestion.trim()}
                  className="shrink-0 rounded-2xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition active:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:active:bg-gray-700/60"
                >
                  Add
                </button>
              </div>
              {suggestionsDirty ? (
                <button
                  type="button"
                  onClick={submitSuggestions}
                  disabled={submitting || (picked.length === 0 && !draftSuggestion.trim())}
                  className="mt-2.5 w-full rounded-2xl bg-blue-600 py-2 font-medium text-white transition active:bg-blue-700 disabled:opacity-50"
                >
                  {submitting
                    ? "Submitting…"
                    : myVote?.suggestions?.length
                      ? "Update"
                      : "Submit"}
                </button>
              ) : myVote?.suggestions?.length ? (
                <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
                  Your options are in — tap to change them
                </p>
              ) : null}
            </div>
            ) : (
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
                onRankingChange={handleRankingChange}
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
            )}
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

"use client";

/**
 * Per-poll detail page: `/g/<groupShortId>/p/<pollShortId>`. Renders the
 * poll's full content (notes + every sub-question's ballot + voter list) as
 * a stand-alone page, without the card chrome that the group list uses.
 *
 * Tapping a card on `/g/<groupShortId>` slides here via `slideToPollDetail`
 * (lib/slideOverlay.tsx — same overlay-slide mechanism as home→group, so
 * the first frame moves on the next rAF). Back arrow slides back to the
 * group root.
 *
 * State shape mirrors what GroupContent kept inside the now-removed expand
 * clip: votes / staged choices / wrapper-submit visibility all live in
 * `useGroupVoting`, fed a one-poll synthetic Group. Voter / results data
 * refreshes on QUESTION_VOTES_CHANGED_EVENT just like the group page.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  apiCutoffPollAvailability,
  apiCutoffPollSuggestions,
  apiClosePoll,
  apiGetPollById,
  apiGetPollByShortId,
  apiGetQuestionResults,
  apiGetVotes,
  apiReopenPoll,
  ApiError,
  QUESTION_VOTES_CHANGED_EVENT,
} from "@/lib/api";
import { POLL_HYDRATED_EVENT, type PollHydratedDetail } from "@/lib/eventChannels";
import { slideToGroupRoot } from "@/lib/slideOverlay";
import { buildGroupFromPollDown, isPendingPollId } from "@/lib/groupUtils";
import { useGroupVoting, type PreparedNonYesNoEntry } from "@/lib/useGroupVoting";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import {
  cachePoll,
  getCachedPollForShortId,
  invalidateQuestion,
} from "@/lib/questionCache";
import { addAccessibleQuestionId, getCreatorSecret } from "@/lib/browserQuestionAccess";
import { getUserName } from "@/lib/userProfile";
import { hasAppHistory } from "@/lib/viewTransitions";
import {
  getCategoryIcon,
  getQuestionSectionTitle,
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
} from "@/lib/questionListUtils";
import {
  loadVotedQuestions,
  parseYesNoChoice,
  getStoredVoteId,
} from "@/lib/votedQuestionsStorage";
import { haptic } from "@/lib/haptics";
import GroupHeader from "@/components/GroupHeader";
import QuestionBallot, { type QuestionBallotHandle } from "@/components/QuestionBallot";
import QuestionDetails from "@/components/QuestionDetails";
import QuestionResultsDisplay from "@/components/QuestionResults";
import CompactNameField from "@/components/CompactNameField";
import VoterList from "@/components/VoterList";
import ConfirmationModal from "@/components/ConfirmationModal";
import FollowUpModal from "@/components/FollowUpModal";
import PollShareButton from "@/components/PollShareButton";
import type { Poll, Question, QuestionResults } from "@/lib/types";
import { PENDING_ACTION_COPY, type PendingActionKind } from "../../groupActionCopy";

/** Hanging category emoji to the LEFT of a section, anchored to the
 *  section's top edge. Mirrors the GroupCardItem helper. */
function HangingCategoryIcon({
  question,
  isClosed,
}: {
  question: Question;
  isClosed: boolean;
}) {
  return (
    <div
      className="absolute flex items-center justify-center text-lg leading-none h-7"
      style={{ width: "1.75rem", left: "-2.375rem", top: 0 }}
      aria-hidden="true"
    >
      {getCategoryIcon(question, isClosed)}
    </div>
  );
}

interface PollDetailViewProps {
  groupId: string;
  pollShortId: string;
}

/** Prop-driven view exposed so SlideOverlayHost can render the page during
 *  the slide-in animation. The default page export below wraps this with
 *  `useParams` for direct URL navigation. */
export function PollDetailView({ groupId, pollShortId }: PollDetailViewProps) {
  const router = useRouter();
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([], 80);

  // Synchronous cache-first init: cache hit → instant render with no spinner
  // (matches the slide handoff). Cache miss → async fetch below.
  const [poll, setPoll] = useState<Poll | null>(() => {
    if (typeof window === "undefined") return null;
    return getCachedPollForShortId(pollShortId);
  });
  const [loading, setLoading] = useState(!poll);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (poll) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const fetched = pollShortId.length > 10 && pollShortId.includes("-")
          ? await apiGetPollById(pollShortId)
          : await apiGetPollByShortId(pollShortId);
        if (cancelled) return;
        setPoll(fetched);
        for (const sp of fetched.questions) addAccessibleQuestionId(sp.id);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setError(true);
        } else {
          console.error("PollDetail: fetch failed", err);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poll, pollShortId]);

  // POLL_HYDRATED swaps a placeholder poll for the real one. If the user
  // landed on the detail page for a placeholder (e.g. clicked through right
  // after submitting), swap in-place when the matching real Poll arrives.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollHydratedDetail>).detail;
      if (!detail?.poll || !poll) return;
      if (detail.placeholderId !== poll.id) return;
      flushSync(() => setPoll(detail.poll));
      // The new short_id is the canonical URL — swap without remount.
      const newShort = detail.poll.short_id;
      if (newShort && newShort !== pollShortId) {
        cachePoll(detail.poll);
        window.history.replaceState(window.history.state, "", `/g/${groupId}/p/${newShort}`);
      }
    };
    window.addEventListener(POLL_HYDRATED_EVENT, handler);
    return () => window.removeEventListener(POLL_HYDRATED_EVENT, handler);
  }, [poll, pollShortId, groupId]);

  const goBack = useCallback(() => {
    slideToGroupRoot({ groupId, direction: "back", useHistoryBack: hasAppHistory() });
  }, [groupId]);

  if (loading && !poll) {
    return (
      <>
        <GroupHeader headerRef={headerRef} onBack={goBack} />
        <div className="min-h-[40vh] flex items-center justify-center">
          <p className="text-gray-600 dark:text-gray-400">Loading poll...</p>
        </div>
      </>
    );
  }

  if (error || !poll) {
    return (
      <>
        <GroupHeader headerRef={headerRef} onBack={goBack} />
        <div className="min-h-[40vh] flex flex-col items-center justify-center text-center px-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Poll Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This poll may have been removed.</p>
          <button
            onClick={() => router.push(`/g/${groupId}`)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Back to Group
          </button>
        </div>
      </>
    );
  }

  return <PollDetail poll={poll} setPoll={setPoll} groupId={groupId} headerRef={headerRef} headerHeight={headerHeight} onBack={goBack} />;
}

interface PollDetailProps {
  poll: Poll;
  setPoll: React.Dispatch<React.SetStateAction<Poll | null>>;
  groupId: string;
  headerRef: React.Ref<HTMLDivElement>;
  headerHeight: number;
  onBack: () => void;
}

function PollDetail({ poll, setPoll, groupId, headerRef, headerHeight, onBack }: PollDetailProps) {
  const router = useRouter();

  // Voted/abstained sets (used to mark question state + by useGroupVoting
  // for post-write sync). Seeded synchronously from localStorage; the
  // QUESTION_VOTES_CHANGED_EVENT listener keeps them fresh.
  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return loadVotedQuestions().votedQuestionIds;
  });
  const [abstainedQuestionIds, setAbstainedQuestionIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return loadVotedQuestions().abstainedQuestionIds;
  });

  // Synthetic single-poll Group so `useGroupVoting` can find each question's
  // poll_id and run the shared post-write sync. The hook only reads
  // `group.questions`, so we don't need a fully-populated Group.
  const syntheticGroup = useMemo(
    () => buildGroupFromPollDown(poll.id, [poll], votedQuestionIds, abstainedQuestionIds),
    // We deliberately omit voted/abstained from deps: the hook reads them
    // via the setters we pass; rebuilding the Group on every vote would
    // churn identity for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poll],
  );

  const {
    userVoteMap,
    setUserVoteMap,
    pendingVoteChange,
    setPendingVoteChange,
    voteChangeSubmitting,
    pendingPollChoices,
    setPendingPollChoices,
    pollVoterNames,
    setPollVoterName,
    pendingPollSubmit,
    setPendingPollSubmit,
    pollSubmitting,
    pollSubmitError,
    wrapperSubmitState,
    handleWrapperSubmitStateChange,
    confirmPollSubmit,
    confirmVoteChange,
    submitYesNoChoice,
  } = useGroupVoting({
    group: syntheticGroup,
    setVotedQuestionIds,
    setAbstainedQuestionIds,
  });

  // Per-question results map. Seeded from inline `question.results`, refreshed
  // on QUESTION_VOTES_CHANGED_EVENT.
  const [questionResultsMap, setQuestionResultsMap] = useState<Map<string, QuestionResults>>(() => {
    const seed = new Map<string, QuestionResults>();
    for (const sp of poll.questions) {
      if (sp.results) seed.set(sp.id, sp.results);
    }
    return seed;
  });

  // Per-question ballot handles for the wrapper-level Submit button.
  const subQuestionBallotRefs = useMemo(() => new Map<string, QuestionBallotHandle>(), []);

  // Load this viewer's yes_no votes + fresh results once on mount, then again
  // whenever the vote-changed event fires for one of our questions.
  useEffect(() => {
    let cancelled = false;
    const fetchOne = async (sp: Question) => {
      if (isPendingPollId(sp.id)) return;
      const wantsResults =
        sp.question_type === "yes_no" ||
        sp.question_type === "ranked_choice" ||
        sp.question_type === "time";
      if (!wantsResults) return;
      const voteId = sp.question_type === "yes_no" ? getStoredVoteId(sp.id) : null;
      const [results, votes] = await Promise.all([
        apiGetQuestionResults(sp.id).catch(() => null),
        voteId ? apiGetVotes(sp.id).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (results) {
        setQuestionResultsMap((prev) => {
          const existing = prev.get(sp.id);
          if (
            existing &&
            existing.total_votes === results.total_votes &&
            existing.yes_count === results.yes_count &&
            existing.no_count === results.no_count &&
            existing.winner === results.winner &&
            (existing.suggestion_counts?.length ?? 0) === (results.suggestion_counts?.length ?? 0)
          ) {
            return prev;
          }
          const next = new Map(prev);
          next.set(sp.id, results);
          return next;
        });
      }
      if (voteId && votes) {
        const mine = votes.find((v) => v.id === voteId);
        if (!mine) return;
        const choice = parseYesNoChoice(mine);
        const voterName = mine.voter_name ?? null;
        setUserVoteMap((prev) => {
          const existing = prev.get(sp.id);
          if (existing && existing.voteId === voteId && existing.choice === choice && existing.voterName === voterName) {
            return prev;
          }
          const next = new Map(prev);
          next.set(sp.id, { choice, voteId, voterName });
          return next;
        });
      }
    };

    for (const sp of poll.questions) void fetchOne(sp);

    const onVotesChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId?: string } | undefined;
      const qid = detail?.questionId;
      if (!qid) return;
      const sp = poll.questions.find((p) => p.id === qid);
      if (!sp) return;
      void fetchOne(sp);
      // Also refetch the wrapper so voter_names + prephase_deadline stay
      // fresh in the respondent row and the status label.
      void apiGetPollById(poll.id).then((fresh) => {
        if (cancelled) return;
        setPoll(fresh);
        cachePoll(fresh);
      }).catch(() => null);
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);
    };
  }, [poll, setPoll, setUserVoteMap]);

  // Long-press modal + per-question pending action (close/reopen/cutoff/forget).
  const [modalQuestion, setModalQuestion] = useState<Question | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    { kind: PendingActionKind; question: Question } | null
  >(null);

  // Listen for cross-component updates that may shift wrapper-level state
  // (e.g. dispatchAction from elsewhere closing the same poll).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId: string; updates: Partial<Question> };
      if (!detail?.questionId) return;
      setPoll((prev) => {
        if (!prev) return prev;
        if (!prev.questions.some((p) => p.id === detail.questionId)) return prev;
        return {
          ...prev,
          questions: prev.questions.map((p) =>
            p.id === detail.questionId ? { ...p, ...detail.updates } : p,
          ),
        };
      });
      setModalQuestion((prev) =>
        prev && prev.id === detail.questionId ? { ...prev, ...detail.updates } : prev,
      );
    };
    window.addEventListener("question:updated", handler);
    return () => window.removeEventListener("question:updated", handler);
  }, [setPoll]);

  // Scroll to top on mount so the slide handoff lands at the page top
  // (independent of whatever scrollY the group page had).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
  }, []);

  const subQuestions = poll.questions;
  const isMultiPoll = subQuestions.length > 1;
  const allYesNo = subQuestions.every((sp) => sp.question_type === "yes_no");
  const isClosed = !!poll.is_closed;
  const usePollSubmit = isMultiPoll;
  const useWrapperSubmit =
    !isMultiPoll && subQuestions[0]?.question_type !== "yes_no";

  const dispatchYesNoTap = (
    questionId: string,
    newChoice: "yes" | "no" | "abstain",
  ) => {
    // First-time votes on single-question polls auto-submit; multi-poll
    // taps and edits route through the confirmation modal.
    if (!isMultiPoll && !userVoteMap.get(questionId)) {
      void submitYesNoChoice(questionId, newChoice);
      return;
    }
    setPendingVoteChange({ questionId, newChoice });
  };

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const short = poll.short_id || subQuestions[0]?.id || poll.id;
    return `${window.location.origin}/g/${groupId}/p/${short}`;
  }, [poll.short_id, poll.id, subQuestions, groupId]);

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title={poll.title || subQuestions[0]?.title}
        onBack={onBack}
        rightSlot={
          <div className="self-stretch py-2 px-2 flex items-center justify-center shrink-0">
            <PollShareButton title={poll.title || subQuestions[0]?.title || ""} url={shareUrl} />
          </div>
        }
      />

      <div style={{ paddingTop: `calc(${headerHeight}px + 0.5rem)` }}>
        {/* Poll-level notes */}
        {poll.details && <QuestionDetails details={poll.details} label="Notes: " />}

        {/* Stacked sub-question sections — no outer card chrome. */}
        {subQuestions.map((sp, idx) => {
          const isYesNo = sp.question_type === "yes_no";
          const r = questionResultsMap.get(sp.id);
          const userVote = userVoteMap.get(sp.id);
          return (
            <div
              key={sp.id}
              className={`${
                idx > 0
                  ? "mt-6 pt-4 border-t border-gray-200 dark:border-gray-800"
                  : "mt-2"
              } relative`}
            >
              {isMultiPoll && (
                <div className="mb-2 relative">
                  <HangingCategoryIcon question={sp} isClosed={isClosed} />
                  <div className="text-lg font-medium leading-tight text-gray-900 dark:text-white">
                    {getQuestionSectionTitle(sp)}
                  </div>
                </div>
              )}
              {!isMultiPoll && <HangingCategoryIcon question={sp} isClosed={isClosed} />}

              {isYesNo && r && (() => {
                const stagedChoice = usePollSubmit
                  ? pendingPollChoices.get(sp.id) ?? null
                  : null;
                const displayedChoice =
                  stagedChoice ?? userVote?.choice ?? null;
                return (
                  <div className="mt-2">
                    <QuestionResultsDisplay
                      results={r}
                      isQuestionClosed={isClosed}
                      hideLoser={false}
                      userVoteChoice={displayedChoice}
                      isStagedChoice={stagedChoice !== null}
                      onVoteChange={
                        isClosed
                          ? undefined
                          : (newChoice) => {
                              if (usePollSubmit) {
                                setPendingPollChoices((prev) => {
                                  if (prev.get(sp.id) === newChoice) return prev;
                                  const next = new Map(prev);
                                  next.set(sp.id, newChoice);
                                  return next;
                                });
                              } else {
                                dispatchYesNoTap(sp.id, newChoice);
                              }
                            }
                      }
                    />
                  </div>
                );
              })()}

              <QuestionBallot
                ref={(handle) => {
                  if (handle) subQuestionBallotRefs.set(sp.id, handle);
                  else subQuestionBallotRefs.delete(sp.id);
                }}
                question={sp}
                poll={poll}
                createdDate=""
                questionId={sp.id}
                externalYesNoResults={isYesNo}
                isExpanded={true}
                partOfPollGroup={isMultiPoll}
                wrapperHandlesSubmit={
                  !!poll.id && (useWrapperSubmit || (usePollSubmit && !isYesNo))
                }
                externalVoterName={
                  (useWrapperSubmit || (usePollSubmit && !isYesNo))
                    ? pollVoterNames.get(poll.id) ?? getUserName() ?? ""
                    : undefined
                }
                setExternalVoterName={
                  (useWrapperSubmit || (usePollSubmit && !isYesNo))
                    ? (name: string) => setPollVoterName(poll.id, name)
                    : undefined
                }
                onWrapperSubmitStateChange={
                  (useWrapperSubmit || (usePollSubmit && !isYesNo))
                    ? handleWrapperSubmitStateChange
                    : undefined
                }
              />
            </div>
          );
        })}

        {/* Wrapper-level Submit for multi-question polls (batches yes/no
            staged choices + each non-yes_no ballot's prepared item). */}
        {usePollSubmit && !isClosed && (() => {
          const pollId = poll.id;
          const hasYesNoStaged = subQuestions.some(
            (sp) =>
              sp.question_type === "yes_no" && pendingPollChoices.has(sp.id),
          );
          const hasNonYesNoReady = subQuestions.some(
            (sp) =>
              sp.question_type !== "yes_no" &&
              wrapperSubmitState.get(sp.id)?.visible === true,
          );
          const hasStagedChange = hasYesNoStaged || hasNonYesNoReady;
          const submitting = pollSubmitting.has(pollId);
          const submitError = pollSubmitError.get(pollId);
          const voterNameVal =
            pollVoterNames.get(pollId) ?? getUserName() ?? "";
          return (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
              <section className="mb-3 rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
                <CompactNameField
                  name={voterNameVal}
                  setName={(name: string) => setPollVoterName(pollId, name)}
                  disabled={submitting}
                  maxLength={30}
                />
              </section>
              {submitError && (
                <div className="mb-3 p-2 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
                  {submitError}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  const preparedNonYesNo: PreparedNonYesNoEntry[] = [];
                  let stagedCount = 0;
                  let hadValidationError = false;
                  for (const sp of subQuestions) {
                    if (sp.question_type === "yes_no") {
                      if (pendingPollChoices.has(sp.id)) stagedCount++;
                      continue;
                    }
                    const handle = subQuestionBallotRefs.get(sp.id);
                    if (!handle) continue;
                    const result = handle.prepareBatchVoteItem();
                    if ("skip" in result) continue;
                    if (!result.ok) {
                      hadValidationError = true;
                      continue;
                    }
                    preparedNonYesNo.push({
                      questionId: sp.id,
                      item: result.item,
                      commit: result.commit,
                      fail: result.fail,
                    });
                    stagedCount++;
                  }
                  if (hadValidationError) return;
                  if (stagedCount === 0) return;
                  setPendingPollSubmit({
                    pollId,
                    subQuestions,
                    stagedCount,
                    preparedNonYesNo,
                  });
                }}
                disabled={submitting || !hasStagedChange}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {submitting ? "Submitting..." : "Submit Vote"}
              </button>
            </div>
          );
        })()}

        {/* Wrapper-level Submit for single-question non-yes_no polls. The
            QuestionBallot exposes triggerSubmit via ref. */}
        {useWrapperSubmit && !isClosed && (() => {
          const pollId = poll.id;
          const sp = subQuestions[0]!;
          const submitState = wrapperSubmitState.get(sp.id);
          if (!submitState?.visible) return null;
          const voterNameVal =
            pollVoterNames.get(pollId) ?? getUserName() ?? "";
          return (
            <div className="mt-3">
              <section className="mb-3 rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
                <CompactNameField
                  name={voterNameVal}
                  setName={(name: string) => setPollVoterName(pollId, name)}
                  maxLength={30}
                />
              </section>
              <button
                type="button"
                onClick={() => {
                  subQuestionBallotRefs.get(sp.id)?.triggerSubmit();
                }}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {submitState.label}
              </button>
            </div>
          );
        })()}

        {/* Respondent row at the foot of the page. */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          <VoterList
            staticVoterNames={poll.voter_names ?? []}
            staticAnonymousCount={poll.anonymous_count ?? 0}
            label="Respondents"
          />
        </div>

        {/* Floating "more actions" trigger — opens the same long-press modal
            the group card supported (forget / reopen / close / cutoffs). */}
        <button
          type="button"
          onClick={() => {
            setModalQuestion(subQuestions[0]);
            setShowModal(true);
          }}
          className="mt-6 mb-2 w-full py-2 px-4 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-800 rounded-lg transition-colors"
        >
          More actions…
        </button>
      </div>

      {modalQuestion && (
        <FollowUpModal
          isOpen={showModal}
          question={modalQuestion}
          poll={poll}
          totalVotes={questionResultsMap.get(modalQuestion.id)?.total_votes}
          onClose={() => setShowModal(false)}
          onDelete={() => setPendingAction({ kind: "forget", question: modalQuestion })}
          onReopen={
            isClosed &&
            (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === "development")
              ? () => setPendingAction({ kind: "reopen", question: modalQuestion })
              : undefined
          }
          onCloseQuestion={
            !isClosed &&
            (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === "development")
              ? () => setPendingAction({ kind: "close", question: modalQuestion })
              : undefined
          }
          onCutoffAvailability={
            !isClosed &&
            isInTimeAvailabilityPhase(modalQuestion) &&
            (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === "development")
              ? () => setPendingAction({ kind: "cutoff-availability", question: modalQuestion })
              : undefined
          }
          onCutoffSuggestions={
            !isClosed &&
            isInSuggestionPhase(modalQuestion, poll.prephase_deadline ?? null) &&
            (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === "development")
              ? () => setPendingAction({ kind: "cutoff-suggestions", question: modalQuestion })
              : undefined
          }
        />
      )}

      {pendingAction && (
        <ConfirmationModal
          isOpen={true}
          title={PENDING_ACTION_COPY[pendingAction.kind].title}
          message={PENDING_ACTION_COPY[pendingAction.kind].message}
          confirmText={PENDING_ACTION_COPY[pendingAction.kind].confirmText}
          cancelText="Cancel"
          confirmButtonClass={PENDING_ACTION_COPY[pendingAction.kind].confirmButtonClass}
          onConfirm={async () => {
            const action = pendingAction;
            if (!action) return;
            haptic.medium();
            setPendingAction(null);
            if (action.kind === "forget") {
              const { forgetQuestion } = await import("@/lib/forgetQuestion");
              forgetQuestion(action.question.id);
              router.push(`/g/${groupId}`);
            } else if (action.kind === "reopen") {
              try {
                const secret = getCreatorSecret(action.question.id) || "dev-override";
                const updated = await apiReopenPoll(poll.id, secret);
                setPoll((prev) => prev ? {
                  ...prev,
                  is_closed: false,
                  close_reason: null,
                  response_deadline: updated.response_deadline ?? null,
                } : prev);
              } catch (err) {
                console.error("Failed to reopen poll:", err);
              }
            } else if (action.kind === "close") {
              try {
                const secret = getCreatorSecret(action.question.id) || "";
                await apiClosePoll(poll.id, secret);
                setPoll((prev) => prev ? { ...prev, is_closed: true, close_reason: "manual" } : prev);
              } catch (err) {
                console.error("Failed to close poll:", err);
              }
            } else if (action.kind === "cutoff-suggestions" || action.kind === "cutoff-availability") {
              const apiFn = action.kind === "cutoff-suggestions"
                ? apiCutoffPollSuggestions
                : apiCutoffPollAvailability;
              try {
                const secret = getCreatorSecret(action.question.id);
                if (!secret) {
                  console.error(`Missing creator secret for ${action.kind}`);
                  return;
                }
                const updated = await apiFn(poll.id, secret);
                setPoll((prev) => prev ? {
                  ...prev,
                  prephase_deadline: updated.prephase_deadline ?? null,
                  questions: prev.questions.map((p) => {
                    const fresh = updated.questions.find((q) => q.id === p.id);
                    return fresh?.options ? { ...p, options: fresh.options } : p;
                  }),
                } : prev);
                for (const sp of updated.questions) {
                  invalidateQuestion(sp.id);
                  void apiGetQuestionResults(sp.id).then((r) => {
                    setQuestionResultsMap((prev) => {
                      const next = new Map(prev);
                      next.set(sp.id, r);
                      return next;
                    });
                  }).catch(() => null);
                }
              } catch (err) {
                console.error(`Failed to ${action.kind}:`, err);
              }
            }
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* Confirmation for yes/no vote tap/change (multi-poll path and
          single-poll edits route through this modal; first-time
          single-poll taps bypass it via dispatchYesNoTap). */}
      {(() => {
        const current = pendingVoteChange
          ? userVoteMap.get(pendingVoteChange.questionId)?.choice
          : undefined;
        const label = (c: "yes" | "no" | "abstain" | null | undefined) =>
          c === "abstain" ? "Abstain" : c === "yes" ? "Yes" : c === "no" ? "No" : "";
        const isChange = !!current;
        return (
          <ConfirmationModal
            isOpen={!!pendingVoteChange}
            title={isChange ? "Change vote?" : "Submit vote?"}
            message={
              pendingVoteChange
                ? isChange
                  ? `Change your vote from ${label(current)} to ${label(pendingVoteChange.newChoice)}?`
                  : `Submit your vote: ${label(pendingVoteChange.newChoice)}?`
                : ""
            }
            confirmText={
              voteChangeSubmitting
                ? "Saving…"
                : isChange
                  ? "Change vote"
                  : "Submit vote"
            }
            cancelText="Cancel"
            confirmButtonClass="bg-blue-600 hover:bg-blue-700 text-white"
            onConfirm={confirmVoteChange}
            onCancel={() => setPendingVoteChange(null)}
          />
        );
      })()}

      <ConfirmationModal
        isOpen={!!pendingPollSubmit}
        title="Submit vote"
        message={
          pendingPollSubmit
            ? pendingPollSubmit.stagedCount === 1
              ? "Submit your vote on this question?"
              : `Submit your vote across ${pendingPollSubmit.stagedCount} questions?`
            : ""
        }
        confirmText={pendingPollSubmit && pollSubmitting.has(pendingPollSubmit.pollId) ? "Submitting…" : "Submit Vote"}
        cancelText="Cancel"
        confirmButtonClass="bg-blue-600 hover:bg-blue-700 text-white"
        onConfirm={() => {
          if (!pendingPollSubmit) return;
          void confirmPollSubmit(
            pendingPollSubmit.pollId,
            pendingPollSubmit.subQuestions,
            pendingPollSubmit.preparedNonYesNo,
          );
        }}
        onCancel={() => setPendingPollSubmit(null)}
      />
    </>
  );
}

/** Default route export: read params and render the prop-driven view. */
function PollDetailPageInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  const pollShortId = params.pollShortId as string;
  return <PollDetailView groupId={groupId} pollShortId={pollShortId} />;
}

export default function PollDetailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Loading poll…</p>
      </div>
    }>
      <PollDetailPageInner />
    </Suspense>
  );
}

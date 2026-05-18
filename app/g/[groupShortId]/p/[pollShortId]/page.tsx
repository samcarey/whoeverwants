"use client";

/**
 * Per-poll detail page: `/g/<groupShortId>/p/<pollShortId>`. Renders the
 * poll's full content (notes + every sub-question's ballot + voter list) as
 * a stand-alone page, without the card chrome that the group list uses.
 *
 * Tapping a card on `/g/<groupShortId>` slides here via `slideToPollDetail`
 * — same overlay-slide mechanism as home→group, so the first frame moves
 * on the next rAF. Back arrow slides back to the group root.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  buildGroupFromPollDown,
  getGroupHrefForPoll,
  isPendingPollId,
} from "@/lib/groupUtils";
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

function InlineCategoryIcon({
  question,
  isClosed,
}: {
  question: Question;
  isClosed: boolean;
}) {
  return (
    <span
      className="inline-flex items-center justify-center text-lg leading-none shrink-0"
      style={{ width: "1.75rem", height: "1.75rem" }}
      aria-hidden="true"
    >
      {getCategoryIcon(question, isClosed)}
    </span>
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
        if (!(err instanceof ApiError && err.status === 404)) {
          console.error("PollDetail: fetch failed", err);
        }
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poll, pollShortId]);

  // POLL_HYDRATED swaps a placeholder poll for the real one. Handles the
  // case where the user clicked through to a freshly-submitted poll before
  // apiCreatePoll resolved.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollHydratedDetail>).detail;
      if (!detail?.poll || !poll) return;
      if (detail.placeholderId !== poll.id) return;
      flushSync(() => setPoll(detail.poll));
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

  if (loading && !poll) return <SimpleFrame onBack={goBack}><p className="text-gray-600 dark:text-gray-400">Loading poll...</p></SimpleFrame>;

  if (error || !poll) {
    return (
      <SimpleFrame onBack={goBack}>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Poll Not Found</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">This poll may have been removed.</p>
        <button
          onClick={() => router.push(`/g/${groupId}`)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Back to Group
        </button>
      </SimpleFrame>
    );
  }

  return <PollDetail poll={poll} setPoll={setPoll} groupId={groupId} onBack={goBack} />;
}

/** Loading / error frame — no measured header since nothing flows under it. */
function SimpleFrame({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <GroupHeader headerRef={headerRef} onBack={onBack} />
      <div className="min-h-[40vh] flex flex-col items-center justify-center text-center px-4">
        {children}
      </div>
    </>
  );
}

interface PollDetailProps {
  poll: Poll;
  setPoll: React.Dispatch<React.SetStateAction<Poll | null>>;
  groupId: string;
  onBack: () => void;
}

function PollDetail({ poll, setPoll, groupId, onBack }: PollDetailProps) {
  const router = useRouter();
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([], 80);

  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return loadVotedQuestions().votedQuestionIds;
  });
  const [abstainedQuestionIds, setAbstainedQuestionIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return loadVotedQuestions().abstainedQuestionIds;
  });

  // Synthetic single-poll Group: useGroupVoting only reads `group.questions`
  // to resolve poll_id per vote write. Voted/abstained sets are passed via
  // setters; rebuilding the Group on every vote would churn identity for
  // no benefit, so they're deliberately omitted from deps.
  const syntheticGroup = useMemo(
    () => buildGroupFromPollDown(poll.id, [poll], votedQuestionIds, abstainedQuestionIds),
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

  const [questionResultsMap, setQuestionResultsMap] = useState<Map<string, QuestionResults>>(() => {
    const seed = new Map<string, QuestionResults>();
    for (const sp of poll.questions) {
      if (sp.results) seed.set(sp.id, sp.results);
    }
    return seed;
  });

  const subQuestionBallotRefs = useMemo(() => new Map<string, QuestionBallotHandle>(), []);

  // Ref so the QUESTION_VOTES_CHANGED listener can stay registered with
  // empty deps — re-attaching on every poll mutation would also re-fan-out
  // the initial-mount fetch loop for every sub-question.
  const pollRef = useRef(poll);
  useEffect(() => { pollRef.current = poll; }, [poll]);

  const fetchOneResults = useCallback(async (sp: Question) => {
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
  }, [setUserVoteMap]);

  useEffect(() => {
    for (const sp of poll.questions) void fetchOneResults(sp);
  }, [poll.id, poll.questions, fetchOneResults]);

  // Wrapper refetch keeps voter_names + prephase_deadline + closed-state
  // fresh in the respondent row and status label after a vote.
  useEffect(() => {
    const onVotesChanged = (e: Event) => {
      const qid = (e as CustomEvent).detail?.questionId as string | undefined;
      if (!qid) return;
      const current = pollRef.current;
      const sp = current.questions.find((p) => p.id === qid);
      if (!sp) return;
      void fetchOneResults(sp);
      void apiGetPollById(current.id).then((fresh) => {
        setPoll(fresh);
        cachePoll(fresh);
      }).catch(() => null);
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);
    return () => window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);
  }, [fetchOneResults, setPoll]);

  const [modalQuestion, setModalQuestion] = useState<Question | null>(null);
  const [pendingAction, setPendingAction] = useState<
    { kind: PendingActionKind; question: Question } | null
  >(null);

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
    return `${window.location.origin}${getGroupHrefForPoll(poll)}`;
  }, [poll]);

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

      <div style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }}>
        {poll.details && <QuestionDetails details={poll.details} label="Notes: " />}

        {subQuestions.map((sp, idx) => {
          const isYesNo = sp.question_type === "yes_no";
          const r = questionResultsMap.get(sp.id);
          const userVote = userVoteMap.get(sp.id);
          const wrapperOwnsSubmit = useWrapperSubmit || (usePollSubmit && !isYesNo);
          return (
            <div
              key={sp.id}
              className={
                idx > 0
                  ? "mt-6 pt-4 border-t border-gray-200 dark:border-gray-800"
                  : "mt-2"
              }
            >
              {isMultiPoll && (
                <div className="mb-2 flex items-center gap-2">
                  <InlineCategoryIcon question={sp} isClosed={isClosed} />
                  <div className="text-lg font-medium leading-tight text-gray-900 dark:text-white min-w-0">
                    {getQuestionSectionTitle(sp)}
                  </div>
                </div>
              )}

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
                wrapperHandlesSubmit={!!poll.id && wrapperOwnsSubmit}
                externalVoterName={
                  wrapperOwnsSubmit
                    ? pollVoterNames.get(poll.id) ?? getUserName() ?? ""
                    : undefined
                }
                setExternalVoterName={
                  wrapperOwnsSubmit
                    ? (name: string) => setPollVoterName(poll.id, name)
                    : undefined
                }
                onWrapperSubmitStateChange={
                  wrapperOwnsSubmit ? handleWrapperSubmitStateChange : undefined
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

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          <VoterList
            staticVoterNames={poll.voter_names ?? []}
            staticAnonymousCount={poll.anonymous_count ?? 0}
            label="Respondents"
          />
        </div>

        <button
          type="button"
          onClick={() => setModalQuestion(subQuestions[0])}
          className="mt-6 mb-2 w-full py-2 px-4 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-800 rounded-lg transition-colors"
        >
          More actions…
        </button>
      </div>

      {modalQuestion && (() => {
        const isCreatorOrDev =
          !!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === "development";
        return (
          <FollowUpModal
            isOpen={true}
            question={modalQuestion}
            poll={poll}
            totalVotes={questionResultsMap.get(modalQuestion.id)?.total_votes}
            onClose={() => setModalQuestion(null)}
            onDelete={() => setPendingAction({ kind: "forget", question: modalQuestion })}
            onReopen={
              isClosed && isCreatorOrDev
                ? () => setPendingAction({ kind: "reopen", question: modalQuestion })
                : undefined
            }
            onCloseQuestion={
              !isClosed && isCreatorOrDev
                ? () => setPendingAction({ kind: "close", question: modalQuestion })
                : undefined
            }
            onCutoffAvailability={
              !isClosed && isInTimeAvailabilityPhase(modalQuestion) && isCreatorOrDev
                ? () => setPendingAction({ kind: "cutoff-availability", question: modalQuestion })
                : undefined
            }
            onCutoffSuggestions={
              !isClosed &&
              isInSuggestionPhase(modalQuestion, poll.prephase_deadline ?? null) &&
              isCreatorOrDev
                ? () => setPendingAction({ kind: "cutoff-suggestions", question: modalQuestion })
                : undefined
            }
          />
        );
      })()}

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

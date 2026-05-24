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

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  apiGetPollById,
  apiGetPollByShortId,
  apiGetQuestionResults,
  apiGetVotes,
  apiRecordPollView,
  ApiError,
  QUESTION_VOTES_CHANGED_EVENT,
} from "@/lib/api";
import {
  POLL_HYDRATED_EVENT,
  SHOW_GROUP_BACKDROP_EVENT,
  HIDE_GROUP_BACKDROP_EVENT,
  type PollHydratedDetail,
  type GroupBackdropShowDetail,
} from "@/lib/eventChannels";
import { useSwipeBackGesture } from "@/lib/useSwipeBackGesture";
import { slideToGroupRoot, slideToPollInfo } from "@/lib/slideOverlay";
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
} from "@/lib/questionCache";
import { addAccessibleQuestionId, isCreatedByThisBrowser } from "@/lib/browserQuestionAccess";
import { getUserName, isCurrentUserName } from "@/lib/userProfile";
import { hasAppHistory } from "@/lib/viewTransitions";
import {
  getRememberedScroll,
  pollScrollKey,
  rememberCurrentScroll,
} from "@/lib/scrollMemory";
import { isUuidLike } from "@/lib/questionId";
import {
  compactDurationSince,
  getCategoryIcon,
  getQuestionSectionTitle,
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
  relativeTime,
} from "@/lib/questionListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import {
  loadVotedQuestions,
  parseYesNoChoice,
  getStoredVoteId,
} from "@/lib/votedQuestionsStorage";
import ClientOnly from "@/components/ClientOnly";
import GroupHeader from "@/components/GroupHeader";
import InitialBubble from "@/components/InitialBubble";
import QuestionBallot, { type QuestionBallotHandle, POLL_SUBCARD_CLASS } from "@/components/QuestionBallot";
import QuestionDetails from "@/components/QuestionDetails";
import QuestionResultsDisplay from "@/components/QuestionResults";
import VoterList from "@/components/VoterList";
import ConfirmationModal from "@/components/ConfirmationModal";
import NameRequiredModal from "@/components/NameRequiredModal";
import { isValidUserName } from "@/lib/nameValidation";
import PollShareButton from "@/components/PollShareButton";
import SimpleCountdown from "@/components/SimpleCountdown";
import type { Poll, Question, QuestionResults } from "@/lib/types";

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
  /** See `SlideToGroupDetail.overlayCardsOffset` in `lib/eventChannels.ts`. */
  overlayCardsOffset?: number;
}

/** Prop-driven view exposed so SlideOverlayHost can render the page during
 *  the slide-in animation. The default page export below wraps this with
 *  `useParams` for direct URL navigation. */
export function PollDetailView({ groupId, pollShortId, overlayCardsOffset }: PollDetailViewProps) {
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
        const fetched = isUuidLike(pollShortId)
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
    rememberCurrentScroll(pollScrollKey(pollShortId));
    slideToGroupRoot({ groupId, direction: "back", useHistoryBack: hasAppHistory() });
  }, [groupId, pollShortId]);

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

  return (
    <PollDetail
      poll={poll}
      setPoll={setPoll}
      groupId={groupId}
      pollShortId={pollShortId}
      onBack={goBack}
      overlayCardsOffset={overlayCardsOffset}
    />
  );
}

/** Loading / error frame — no measured header since nothing flows under it. */
function SimpleFrame({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <GroupHeader headerRef={headerRef} onBack={onBack} backIconVariant="menu" />
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
  pollShortId: string;
  onBack: () => void;
  overlayCardsOffset?: number;
}

function PollDetail({ poll, setPoll, groupId, pollShortId, onBack, overlayCardsOffset }: PollDetailProps) {
  const router = useRouter();
  const scrollKey = pollScrollKey(pollShortId);
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

  // While the prephase (suggestions / availability) is still open, record
  // that we've seen the current options. The phase-transition push skips a
  // prevoter only when no new option arrived after their last view, so this
  // watermark keeps "I already looked, nothing's changed" members quiet.
  useEffect(() => {
    const deadline = poll.prephase_deadline
      ? new Date(poll.prephase_deadline).getTime()
      : null;
    if (deadline !== null && deadline > Date.now()) {
      void apiRecordPollView(poll.id);
    }
  }, [poll.id, poll.prephase_deadline]);

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
    };
    window.addEventListener("question:updated", handler);
    return () => window.removeEventListener("question:updated", handler);
  }, [setPoll]);

  // Same restore-loop pattern as GroupContent — see CLAUDE.md "Scroll-Position Memory".
  // The rAF loop defeats iOS Safari + Next.js App Router's post-layoutEffect
  // scroll-to-top reset (~30-40ms after our scrollTo).
  const restoreTargetRef = useRef<number | null>(null);
  const restoreDeadlineRef = useRef(0);
  const userInteractedRef = useRef(false);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const remembered = getRememberedScroll(scrollKey);
    if (remembered !== undefined) {
      restoreTargetRef.current = remembered;
      restoreDeadlineRef.current = Date.now() + 800;
      window.scrollTo(0, remembered);
      return;
    }
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restoreTargetRef.current == null) return;
    let rafId: number | null = null;
    let stableFrames = 0;
    const tick = () => {
      rafId = null;
      if (userInteractedRef.current || Date.now() >= restoreDeadlineRef.current) {
        restoreTargetRef.current = null;
        return;
      }
      const target = restoreTargetRef.current;
      if (target == null) return;
      if (Math.abs(window.scrollY - target) > 0.5) {
        window.scrollTo(0, target);
        stableFrames = 0;
      } else if (++stableFrames >= 3) {
        restoreTargetRef.current = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const disable = () => { userInteractedRef.current = true; };
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("pointerdown", disable, opts);
    window.addEventListener("wheel", disable, opts);
    window.addEventListener("keydown", disable, opts);
    return () => {
      window.removeEventListener("pointerdown", disable, opts);
      window.removeEventListener("wheel", disable, opts);
      window.removeEventListener("keydown", disable, opts);
    };
  }, []);

  // Swipe-back gesture (mirrors group→home in GroupContent). On commit
  // we navigate directly with router.push — calling slideToGroupRoot
  // would layer a second animation on top of the in-flight swipe; the
  // backdrop is already showing the group view, so navigation just
  // commits the URL.
  const { swipeWrapperRef, touchHandlers: swipeTouchHandlers } = useSwipeBackGesture({
    headerRef,
    showBackdrop: () => {
      window.dispatchEvent(
        new CustomEvent<GroupBackdropShowDetail>(SHOW_GROUP_BACKDROP_EVENT, {
          detail: { groupId },
        }),
      );
    },
    hideBackdrop: () => {
      window.dispatchEvent(new Event(HIDE_GROUP_BACKDROP_EVENT));
    },
    onBeforeCommit: () => rememberCurrentScroll(scrollKey),
    onCommit: () => router.push(`/g/${groupId}`),
  });

  const subQuestions = poll.questions;
  const isMultiPoll = subQuestions.length > 1;
  const allYesNo = subQuestions.every((sp) => sp.question_type === "yes_no");
  const isClosed = !!poll.is_closed;
  const usePollSubmit = isMultiPoll;
  const useWrapperSubmit =
    !isMultiPoll && subQuestions[0]?.question_type !== "yes_no";

  // Mirror the GroupCardItem's anchor-based status computation. Poll-level
  // deadlines (voting + prephase) are shared across sibling questions, so
  // one status line describes the whole poll.
  const anchor = subQuestions[0];
  const wrapperPrephaseDeadline = poll.prephase_deadline ?? null;
  const wrapperResponseDeadline = poll.response_deadline ?? null;
  const wrapperUpdatedAt = poll.updated_at ?? anchor?.updated_at;
  const statusEl: React.ReactNode = (() => {
    if (!anchor) return null;
    const inSuggestions = isInSuggestionPhase(anchor, wrapperPrephaseDeadline);
    const inTimeAvailability = isInTimeAvailabilityPhase(anchor);
    if (isClosed) {
      const closedAt =
        poll.close_reason === "deadline" && wrapperResponseDeadline
          ? wrapperResponseDeadline
          : wrapperUpdatedAt;
      return closedAt ? (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Closed {compactDurationSince(closedAt)} ago
        </span>
      ) : null;
    }
    if (inSuggestions && wrapperPrephaseDeadline) {
      return <SimpleCountdown deadline={wrapperPrephaseDeadline} label="Suggestions" />;
    }
    if (inTimeAvailability) {
      if (wrapperPrephaseDeadline) {
        return <SimpleCountdown deadline={wrapperPrephaseDeadline} label="Availability" />;
      }
      return (
        <span className="font-semibold text-blue-600 dark:text-blue-400">
          Collecting Availability
        </span>
      );
    }
    if (wrapperResponseDeadline) {
      return (
        <SimpleCountdown
          deadline={wrapperResponseDeadline}
          label="Voting"
          colorClass="text-green-600 dark:text-green-400"
        />
      );
    }
    return null;
  })();

  // Creator avatar: prefer the current user's uploaded image when this poll
  // is theirs (creator_secret in localStorage, name fallback).
  const myUserImageUrl = useMyUserImageUrl();
  const creatorIsMe =
    (anchor ? isCreatedByThisBrowser(anchor.id) : false) ||
    isCurrentUserName(poll.creator_name);
  const creatorImageUrl = creatorIsMe ? myUserImageUrl : null;

  // When a submit action fires without a saved name, the retry closure is
  // stashed here and replayed after NameRequiredModal save.
  const [pendingNameRetry, setPendingNameRetry] = useState<(() => void) | null>(null);

  const gateOnName = (retry: () => void): boolean => {
    if (isValidUserName(getUserName())) return true;
    setPendingNameRetry(() => retry);
    return false;
  };

  const dispatchYesNoTap = (
    questionId: string,
    newChoice: "yes" | "no" | "abstain",
  ) => {
    if (!isMultiPoll && !userVoteMap.get(questionId)) {
      if (!gateOnName(() => void submitYesNoChoice(questionId, newChoice))) return;
      void submitYesNoChoice(questionId, newChoice);
      return;
    }
    setPendingVoteChange({ questionId, newChoice });
  };

  const runMultiSubmit = (pollId: string) => {
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
  };

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${getGroupHrefForPoll(poll)}`;
  }, [poll]);

  const pollTitle = subQuestions[0]?.title || poll.title;
  // One localStorage read per render — passed into N sub-question QuestionBallots.
  const savedUserName = getUserName() ?? "";

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title={pollTitle}
        onBack={onBack}
        onTitleClick={() => {
          rememberCurrentScroll(scrollKey);
          slideToPollInfo({
            groupId,
            pollShortId: poll.short_id || poll.id,
          });
        }}
        titleAriaLabel="Poll details"
        backIconVariant="menu"
        rightSlot={
          <div className="self-stretch py-2 px-2 flex items-center justify-center shrink-0">
            <PollShareButton title={pollTitle || ""} url={shareUrl} />
          </div>
        }
      />

      {/* z-index:1 + opaque background keeps the group backdrop hidden
          behind the page until the swipe moves the wrapper sideways. */}
      <div
        ref={swipeWrapperRef}
        {...swipeTouchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 1,
          background: "var(--background)",
          minHeight: "100dvh",
          // Negative horizontal margins cancel the template/overlay wrapper's
          // `px-4` (1rem) PLUS the outer `paddingLeft/Right: max(0.35rem,
          // env(safe-area-inset-*))` so the swipeWrapper's
          // `background: var(--background)` paints all the way to the screen
          // edge — matching the full-width fixed header above it. Without
          // this, a swipe-back exposes the GroupBackdropHost (z=0, full
          // viewport) through the ~16px inset strips just below the header.
          // The inner content div re-applies the same inset via padding so
          // the cards don't move. Mirrors GroupContent's swipeWrapper margin
          // (which only cancels the safe-area inset, since group routes have
          // no px-4). On desktop the 1rem pull stays inside the centered
          // max-w-4xl bounds.
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
      <div
        style={{
          paddingTop: `calc(${headerHeight}px + 1.5rem)`,
          // Re-apply the inset the swipeWrapper's negative margins removed so
          // the content sits exactly where the template padding would place it.
          paddingLeft: "calc(1rem + max(0.35rem, env(safe-area-inset-left, 0px)))",
          paddingRight: "calc(1rem + max(0.35rem, env(safe-area-inset-right, 0px)))",
          transform: overlayCardsOffset
            ? `translate3d(0, ${-overlayCardsOffset}px, 0)`
            : undefined,
          willChange: overlayCardsOffset ? "transform" : undefined,
        }}
      >
        {/* Meta strip: creator avatar + name · relative time on the left,
            poll-level status (countdown / closed / phase label) on the
            right. Mirrors the group-list card's chrome so the detail page
            surfaces the same information about the poll. */}
        {anchor && (
          <div className="mb-2 flex items-center gap-2 px-1 min-w-0">
            <InitialBubble
              name={poll.creator_name ?? null}
              imageUrl={creatorImageUrl}
              className="shrink-0"
            />
            <ClientOnly fallback={null}>
              <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
                {poll.creator_name && <>{poll.creator_name} &middot; </>}
                <span title={formatCreationTimestamp(anchor.created_at)}>
                  {relativeTime(anchor.created_at)}
                </span>
              </span>
            </ClientOnly>
            <div className="flex-1 min-w-0 flex justify-end text-sm leading-tight text-gray-500 dark:text-gray-400">
              <ClientOnly fallback={null}>{statusEl}</ClientOnly>
            </div>
          </div>
        )}

        {poll.details && <QuestionDetails details={poll.details} label="Notes: " />}

        {subQuestions.map((sp, idx) => {
          const isYesNo = sp.question_type === "yes_no";
          const r = questionResultsMap.get(sp.id);
          const userVote = userVoteMap.get(sp.id);
          const wrapperOwnsSubmit = useWrapperSubmit || (usePollSubmit && !isYesNo);
          // Early-voting ranked choice: the suggestion entry and the ranking
          // ballot each get their own card (rendered inside QuestionBallot via
          // splitEarlyVotingCards) with the "Early Voting" header outside, so
          // we drop the single outer card here to avoid nesting.
          const isEarlyVoting =
            sp.question_type === "ranked_choice" &&
            poll.allow_pre_ranking !== false &&
            isInSuggestionPhase(sp, poll.prephase_deadline ?? null);

          const ballot = (
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
              splitEarlyVotingCards={isEarlyVoting}
              wrapperHandlesSubmit={!!poll.id && wrapperOwnsSubmit}
              externalVoterName={wrapperOwnsSubmit ? savedUserName : undefined}
              onWrapperSubmitStateChange={
                wrapperOwnsSubmit ? handleWrapperSubmitStateChange : undefined
              }
            />
          );

          if (isEarlyVoting) {
            return (
              <div key={sp.id} className={idx > 0 ? "mt-3" : "mt-2"}>
                {isMultiPoll && (
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <InlineCategoryIcon question={sp} isClosed={isClosed} />
                    <div className="text-lg font-medium leading-tight text-gray-900 dark:text-white min-w-0">
                      {getQuestionSectionTitle(sp)}
                    </div>
                  </div>
                )}
                {ballot}
              </div>
            );
          }

          return (
            <div
              key={sp.id}
              className={`${idx > 0 ? "mt-3" : "mt-2"} ${POLL_SUBCARD_CLASS}`}
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

              {ballot}
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
          return (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
              {submitError && (
                <div className="mb-3 p-2 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
                  {submitError}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!gateOnName(() => runMultiSubmit(pollId))) return;
                  runMultiSubmit(pollId);
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
          return (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  const fire = () => subQuestionBallotRefs.get(sp.id)?.triggerSubmit();
                  if (!gateOnName(fire)) return;
                  fire();
                }}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {submitState.label}
              </button>
            </div>
          );
        })()}

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
            Respondents
          </h2>
          <VoterList
            singleLine
            includeSelf
            staticVoterNames={poll.voter_names ?? []}
            staticAnonymousCount={poll.anonymous_count ?? 0}
            emptyText="No voters yet"
            className="px-1"
          />
        </div>

      </div>
      </div>

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
            onConfirm={() => {
              if (!pendingVoteChange) return;
              const { questionId, newChoice } = pendingVoteChange;
              const fire = () => void submitYesNoChoice(questionId, newChoice);
              if (!gateOnName(fire)) {
                setPendingVoteChange(null);
                return;
              }
              void confirmVoteChange();
            }}
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

      <NameRequiredModal
        isOpen={!!pendingNameRetry}
        message="Please enter your name to submit your vote."
        onSubmit={() => {
          const retry = pendingNameRetry;
          setPendingNameRetry(null);
          if (retry) retry();
        }}
        onCancel={() => setPendingNameRetry(null)}
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

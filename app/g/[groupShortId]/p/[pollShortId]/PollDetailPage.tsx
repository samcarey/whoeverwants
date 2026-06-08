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

import { Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  apiGetPlusOneCandidates,
  apiGetGroupPoll,
  apiGetPollById,
  apiGetQuestionResults,
  apiGetVotes,
  apiRecordPollView,
  ApiError,
  QUESTION_VOTES_CHANGED_EVENT,
  type PlusOneCandidate,
} from "@/lib/api";
import PlusOnesInput, { type PlusOneEntry } from "@/components/PlusOnesInput";
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
  buildGroupSyncFromCache,
  getGroupHrefForPoll,
  isPendingPollId,
  isPollOpen,
} from "@/lib/groupUtils";
import { useGroupVoting, type PreparedNonYesNoEntry, type YesNoChoice } from "@/lib/useGroupVoting";
import { loadQuestionDraft, saveQuestionDraft } from "@/lib/ballotDraft";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { useDeadlineTick } from "@/lib/useDeadlineTick";
import {
  cachePoll,
  getCachedPollForShortId,
} from "@/lib/questionCache";
import { getUserName, isCurrentUserName } from "@/lib/userProfile";
import { markPollViewed } from "@/lib/unread";
import { hasAppHistory } from "@/lib/viewTransitions";
import {
  getRememberedScroll,
  pollScrollKey,
  rememberCurrentScroll,
} from "@/lib/scrollMemory";
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
  setStoredVoteId,
  setVotedQuestionFlag,
  hasVotedOnQuestion,
} from "@/lib/votedQuestionsStorage";
import ClientOnly from "@/components/ClientOnly";
import GroupHeader from "@/components/GroupHeader";
import PollAvatar from "@/components/PollAvatar";
import InitialBubble from "@/components/InitialBubble";
import QuestionBallot, { type QuestionBallotHandle, POLL_SUBCARD_CLASS } from "@/components/QuestionBallot";
import QuestionDetails from "@/components/QuestionDetails";
import QuestionResultsDisplay from "@/components/QuestionResults";
import ConfirmationModal from "@/components/ConfirmationModal";
import AccountGateModal from "@/components/AccountGateModal";
import { isValidUserName } from "@/lib/nameValidation";
import PollShareButton from "@/components/PollShareButton";
import SimpleCountdown from "@/components/SimpleCountdown";
import type { Poll, Question, QuestionResults } from "@/lib/types";

// Back-nav scroll-restore re-application window, measured from the first rAF
// tick that actually runs (see GroupPage's restore loop for the rationale —
// the slide + mount work starves rAF, so an arm-time deadline expires before
// the loop re-applies, leaving the page at Next.js' scroll-to-0). Bounded but
// interaction-gated, so a generous value is safe.
const RESTORE_PIN_DURATION_MS = 2500;

function InlineCategoryIcon({ question }: { question: Question }) {
  return (
    <span
      className="inline-flex items-center justify-center text-lg leading-none shrink-0"
      style={{ width: "1.75rem", height: "1.75rem" }}
      aria-hidden="true"
    >
      {getCategoryIcon(question)}
    </span>
  );
}

/** Per-question section header used inside a multi-question poll card.
 *  Icon + title row, with the title omitted (icon-only) when
 *  `getQuestionSectionTitle` returns null. `extraClass` carries the px-1
 *  inset used by the split-suggestion-phase layout (which has no outer
 *  card chrome to absorb it). */
function QuestionSectionHeader({
  question,
  extraClass = "",
}: {
  question: Question;
  extraClass?: string;
}) {
  const sectionTitle = getQuestionSectionTitle(question);
  return (
    <div className={`mb-2 flex items-center gap-2 ${extraClass}`}>
      <InlineCategoryIcon question={question} />
      {sectionTitle && (
        <div className="text-lg font-medium leading-tight text-gray-900 dark:text-white min-w-0">
          {sectionTitle}
        </div>
      )}
    </div>
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
  // Set when the poll exists in this group but closed BEFORE the caller
  // joined — its contents are withheld by the visibility rule, so we show
  // a "closed before you joined" note instead of either the leaked
  // contents or a misleading "not found". `closedAt` is the closure
  // timestamp (ISO) or null. See `apiGetGroupPoll`.
  const [hiddenPreJoin, setHiddenPreJoin] = useState<{ closedAt: string | null } | null>(null);

  useEffect(() => {
    if (poll) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Visibility-aware read (NOT the visibility-blind
        // apiGetPollByShortId): a closed-before-join poll returns a marker,
        // never its contents.
        const result = await apiGetGroupPoll(groupId, pollShortId);
        if (cancelled) return;
        if (result.status === "visible") {
          setPoll(result.poll);
        } else {
          setHiddenPreJoin({ closedAt: result.closedAt });
        }
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
  }, [poll, pollShortId, groupId]);

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

  if (hiddenPreJoin && !poll) {
    return (
      <MessageFrame
        onBack={goBack}
        onBackToGroup={() => router.push(`/g/${groupId}`)}
        heading="Poll Closed"
        message={
          hiddenPreJoin.closedAt
            ? `This poll closed ${relativeTime(hiddenPreJoin.closedAt)}, before you joined the group, so it's no longer available to view.`
            : "This poll closed before you joined the group, so it's no longer available to view."
        }
      />
    );
  }

  if (error || !poll) {
    return (
      <MessageFrame
        onBack={goBack}
        onBackToGroup={() => router.push(`/g/${groupId}`)}
        heading="Poll Not Found"
        message="This poll may have been removed."
      />
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

/** Terminal "can't show the poll" frame (not-found / closed-before-join):
 *  heading + message + a single "Back to Group" button. */
function MessageFrame({
  onBack,
  onBackToGroup,
  heading,
  message,
}: {
  onBack: () => void;
  onBackToGroup: () => void;
  heading: string;
  message: string;
}) {
  return (
    <SimpleFrame onBack={onBack}>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{heading}</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-4">{message}</p>
      <button
        onClick={onBackToGroup}
        className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
      >
        Back to Group
      </button>
    </SimpleFrame>
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

  // "Plus one/more": the poll-level list of additional people this ballot
  // counts for. Only meaningful when `poll.allow_plus_ones`. Each entry is a
  // freeform name (weighted on the submitter's row) OR a looked-up account
  // (`userId` set → its own seeded editable vote). A ref mirror keeps the
  // submit getter (read inside useGroupVoting) from going stale.
  const [plusOnes, setPlusOnes] = useState<PlusOneEntry[]>([]);
  const plusOnesRef = useRef<PlusOneEntry[]>([]);
  plusOnesRef.current = plusOnes;
  // Contacts for the lookup dropdown (responded ones greyed + unselectable).
  const [plusOneCandidates, setPlusOneCandidates] = useState<PlusOneCandidate[]>([]);
  const getPlusOnes = useRef(() => {
    if (!poll.allow_plus_ones) return null;
    const names: string[] = [];
    const userIds: string[] = [];
    for (const e of plusOnesRef.current) {
      if (e.userId) userIds.push(e.userId);
      else names.push((e.name ?? "").trim());
    }
    return { names, userIds };
  }).current;

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
    getPlusOnes,
  });

  const [questionResultsMap, setQuestionResultsMap] = useState<Map<string, QuestionResults>>(() => {
    const seed = new Map<string, QuestionResults>();
    for (const sp of poll.questions) {
      if (sp.results) seed.set(sp.id, sp.results);
    }
    return seed;
  });

  const subQuestionBallotRefs = useMemo(() => new Map<string, QuestionBallotHandle>(), []);

  // For location/restaurant sub-questions, QuestionBallot reports when its
  // "Near X" line should sit BELOW the ballot card (i.e. once results are on
  // display). We render the line outside the card based on this map. Stable
  // setter keeps the callback identity fixed so the child effect doesn't churn.
  const [referenceBelowMap, setReferenceBelowMap] = useState<Map<string, boolean>>(new Map());
  const handleReferenceLocationStateChange = useRef(
    (questionId: string, state: { showBelow: boolean }) => {
      setReferenceBelowMap((prev) => {
        if ((prev.get(questionId) ?? false) === state.showBelow) return prev;
        const next = new Map(prev);
        next.set(questionId, state.showBelow);
        return next;
      });
    },
  ).current;

  // Ref so the QUESTION_VOTES_CHANGED listener can stay registered with
  // empty deps — re-attaching on every poll mutation would also re-fan-out
  // the initial-mount fetch loop for every sub-question.
  const pollRef = useRef(poll);
  useEffect(() => { pollRef.current = poll; }, [poll]);

  // "Plus one/more": load the contact lookup candidates (with per-poll
  // `responded` flags) + pre-fill the freeform list from the viewer's existing
  // vote so editing doesn't silently drop previously-added people. Also a
  // seeded-vote DISCOVERY pass: a looked-up account that someone voted for has
  // a real vote attributed to them but no local stored id — fetch their vote
  // from the server (ballot privacy scopes /votes to the caller's own rows) and
  // adopt it so they see it as their response and can change it (rather than
  // double-voting).
  const plusOnesPrefilledRef = useRef(false);
  const seededDiscoveryRef = useRef(false);
  useEffect(() => {
    if (!poll.allow_plus_ones) return;
    let cancelled = false;
    apiGetPlusOneCandidates(poll.id)
      .then((cands) => {
        if (!cancelled) setPlusOneCandidates(cands);
      })
      .catch(() => { /* freeform entry still works without candidates */ });

    (async () => {
      for (const sp of poll.questions) {
        if (isPendingPollId(sp.id)) continue;
        const localVoteId = getStoredVoteId(sp.id);
        // Prefill the freeform plus-ones list once from the viewer's own vote.
        if (localVoteId && !plusOnesPrefilledRef.current) {
          const votes = await apiGetVotes(sp.id).catch(() => null);
          if (cancelled) return;
          const mine = votes?.find((v) => v.id === localVoteId);
          if (mine?.plus_one_names && mine.plus_one_names.length > 0) {
            setPlusOnes(mine.plus_one_names.map((name) => ({ name })));
            plusOnesPrefilledRef.current = true;
          }
        }
        // Discover a seeded vote: no local id but the server returns a vote for
        // me (it can only be mine) → adopt it so the existing edit flow works.
        if (!localVoteId && !seededDiscoveryRef.current) {
          const votes = await apiGetVotes(sp.id).catch(() => null);
          if (cancelled) return;
          const mine = votes && votes.length > 0 ? votes[0] : null;
          if (mine) {
            setStoredVoteId(sp.id, mine.id);
            setVotedQuestionFlag(sp.id, mine.is_abstain ? "abstained" : true);
            const fresh = loadVotedQuestions();
            setVotedQuestionIds(fresh.votedQuestionIds);
            setAbstainedQuestionIds(fresh.abstainedQuestionIds);
            // Surface the choice for the externally-rendered yes/no card too.
            if (sp.question_type === "yes_no") {
              setUserVoteMap((prev) => {
                const next = new Map(prev);
                next.set(sp.id, {
                  choice: parseYesNoChoice(mine),
                  voteId: mine.id,
                  voterName: mine.voter_name ?? null,
                });
                return next;
              });
            }
            // Wake QuestionBallot (ranked/time) so it loads the adopted vote.
            window.dispatchEvent(
              new CustomEvent(QUESTION_VOTES_CHANGED_EVENT, { detail: { questionId: sp.id } }),
            );
          }
        }
      }
      plusOnesPrefilledRef.current = true;
      seededDiscoveryRef.current = true;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.allow_plus_ones, poll.id]);

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

  // Record that we've opened this poll. This single "seen" watermark
  // (poll_views.last_viewed_at) drives three things: (1) the phase-transition
  // push skips a prevoter only when no new option arrived after their last
  // view; (2) the unread app-icon badge clears a poll once it's been opened;
  // (3) the "Viewed (N)" roster on the poll info page. Fires on every open
  // now (was prephase-only) — opening the poll page IS the "seen" signal per
  // the badge model.
  useEffect(() => {
    void apiRecordPollView(poll.id);
    // Local mirror of the same "seen" signal — drives the gold "unread" bar
    // on group cards + the home-list emphasis instantly (no round trip), so
    // opening + backing out of a poll clears it. See lib/unread.ts.
    markPollViewed(poll.id);
  }, [poll.id]);

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
      // Arm (don't start) the window — the rAF loop starts the countdown
      // on its first tick that actually runs. See GroupPage's restore loop
      // for why an arm-time deadline gets starved by the slide + mount work.
      restoreDeadlineRef.current = 0;
      window.scrollTo(0, remembered);
      return;
    }
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restoreTargetRef.current == null) return;
    let rafId: number | null = null;
    let reentryGuard = false;
    // Shared by the rAF loop and a synchronous `scroll` listener — the
    // listener snaps back the instant Next.js' post-commit scroll-to-0 fires,
    // before paint, regardless of rAF starvation. See GroupPage's restore
    // loop for the full rationale.
    const repin = () => {
      const target = restoreTargetRef.current;
      if (target == null) return;
      if (userInteractedRef.current) {
        restoreTargetRef.current = null;
        return;
      }
      if (restoreDeadlineRef.current === 0) {
        restoreDeadlineRef.current = Date.now() + RESTORE_PIN_DURATION_MS;
      }
      if (!reentryGuard && Math.abs(window.scrollY - target) > 0.5) {
        reentryGuard = true;
        window.scrollTo(0, target);
        reentryGuard = false;
      }
      if (Date.now() >= restoreDeadlineRef.current) {
        restoreTargetRef.current = null;
      }
    };
    const tick = () => {
      rafId = null;
      repin();
      if (restoreTargetRef.current == null) return;
      rafId = requestAnimationFrame(tick);
    };
    const onScroll = () => repin();
    rafId = requestAnimationFrame(tick);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
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
  // Treat a poll whose response_deadline has passed as closed even if the
  // server hasn't flipped `is_closed` yet (the per-minute tick may not have
  // run). `useDeadlineTick` below forces a re-render at the crossing so the
  // UI never lingers in a "Voting: Expired" state.
  useDeadlineTick(
    poll.is_closed ? [] : [poll.response_deadline, poll.prephase_deadline],
  );
  const isClosed = !isPollOpen(poll);
  // A single yes/no keeps tap-to-submit UNLESS the voter has added plus-ones —
  // then it routes through the explicit staged-Submit flow so they can finish
  // adding people and the button can show "for X". Multi-question polls always
  // use the staged flow.
  const usePollSubmit =
    isMultiPoll || (allYesNo && !!poll.allow_plus_ones && plusOnes.length > 0);
  // yes_no AND limited_supply self-submit on tap (no wrapper Submit button) —
  // QuestionBallot owns their submission, so the wrapper must not render one.
  const SELF_SUBMIT_TYPES = ["yes_no", "limited_supply"];
  // A single limited-supply poll keeps tap-to-claim UNTIL the voter adds a
  // plus-one, then it routes through the explicit "Claim N spots" wrapper
  // Submit so the claim and its plus-ones commit together (mirrors the
  // yes/no-with-plus-ones staging). QuestionBallot's `supplySelectionMode`
  // turns claim/decline into a selection in that case.
  const limitedSupplyStaged =
    !isMultiPoll &&
    subQuestions[0]?.question_type === "limited_supply" &&
    !!poll.allow_plus_ones &&
    plusOnes.length > 0;
  const useWrapperSubmit =
    !isMultiPoll &&
    (!SELF_SUBMIT_TYPES.includes(subQuestions[0]?.question_type ?? "") ||
      limitedSupplyStaged);

  // Restore any per-poll staged yes/no choices (multi-question polls) so taps
  // made before submitting survive a refresh or navigating away. Single-question
  // yes/no auto-submits, so there's no staging to restore there. Only restore
  // for questions the browser hasn't already voted on (the committed vote wins).
  const stagedYesNoRestoredRef = useRef(false);
  useEffect(() => {
    if (stagedYesNoRestoredRef.current) return;
    if (!usePollSubmit || !poll.id) return;
    stagedYesNoRestoredRef.current = true;
    const restored = new Map<string, YesNoChoice>();
    for (const sp of subQuestions) {
      if (sp.question_type !== "yes_no" || hasVotedOnQuestion(sp.id)) continue;
      const draft = loadQuestionDraft(poll.id, sp.id);
      if (!draft) continue;
      if (draft.isAbstaining) restored.set(sp.id, "abstain");
      else if (draft.yesNoChoice === "yes" || draft.yesNoChoice === "no") {
        restored.set(sp.id, draft.yesNoChoice);
      }
    }
    if (restored.size === 0) return;
    setPendingPollChoices((prev) => {
      const next = new Map(prev);
      for (const [k, v] of restored) next.set(k, v);
      return next;
    });
  }, [usePollSubmit, poll.id, subQuestions, setPendingPollChoices]);

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
      // See GroupCardItem.tsx — prefer response_deadline whenever it has
      // passed so the FE's deadline-expired path (server hasn't run its
      // close tick yet) shows a sensible "Closed Xm ago" value.
      const deadlineHasPassed =
        !!wrapperResponseDeadline && new Date(wrapperResponseDeadline) <= new Date();
      const closedAt =
        (poll.close_reason === "deadline" || deadlineHasPassed) && wrapperResponseDeadline
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
    // Time questions: show the "Availability" countdown only while the prephase
    // (availability) deadline is still in the future. Once it passes the poll is
    // in its preferences-voting phase — fall through to the response-deadline
    // countdown labeled "Preferences" (NOT a stale "Availability: Expired",
    // which is what showed while `anchor.options` lagged behind the cutoff).
    if (inTimeAvailability) {
      if (wrapperPrephaseDeadline && new Date(wrapperPrephaseDeadline) > new Date()) {
        return <SimpleCountdown deadline={wrapperPrephaseDeadline} label="Availability" />;
      }
      if (!wrapperPrephaseDeadline) {
        return (
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            Collecting Availability
          </span>
        );
      }
    }
    if (wrapperResponseDeadline) {
      return (
        <SimpleCountdown
          deadline={wrapperResponseDeadline}
          label={anchor.question_type === "time" ? "Preferences" : "Voting"}
          colorClass="text-green-600 dark:text-green-400"
        />
      );
    }
    return null;
  })();

  // Creator avatar: prefer the current user's uploaded image when this poll
  // is theirs (server-computed viewer_is_creator, name fallback).
  const myUserImageUrl = useMyUserImageUrl();
  const creatorIsMe =
    poll.viewer_is_creator === true ||
    isCurrentUserName(poll.creator_name);
  const creatorImageUrl = creatorIsMe ? myUserImageUrl : null;

  // When a submit action fires without a saved name, the retry closure is
  // stashed here and replayed after AccountGateModal completes.
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

  // "Plus one/more": total responses being submitted = you (1) + each plus-one.
  // Drives the "Submit Vote for X" button label.
  const plusOnesCount = poll.allow_plus_ones ? plusOnes.length : 0;
  const submitForSuffix = plusOnesCount > 0 ? ` for ${1 + plusOnesCount}` : "";

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${getGroupHrefForPoll(poll)}`;
  }, [poll]);

  const pollTitle = subQuestions[0]?.title || poll.title;
  // Group name shown under the title. Read the full group from cache when
  // available (other polls in the group contribute their participants to the
  // default name); fall back to the single-poll synthetic group's title when
  // the cache hasn't been warmed yet. `poll.group_title` is the override and
  // is identical across every poll in the group — surfacing it on a cache
  // miss keeps the subtitle stable. Returns null when nothing is resolvable.
  const cachedFullGroup = useMemo(
    () => buildGroupSyncFromCache(groupId, votedQuestionIds, abstainedQuestionIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupId, poll],
  );
  const groupSubtitle =
    cachedFullGroup?.title ?? poll.group_title ?? syntheticGroup?.title ?? null;
  // One localStorage read per render — passed into N sub-question QuestionBallots.
  const savedUserName = getUserName() ?? "";

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title={pollTitle}
        subtitle={groupSubtitle}
        avatar={<PollAvatar questions={subQuestions} />}
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
          const selfSubmits = SELF_SUBMIT_TYPES.includes(sp.question_type);
          const r = questionResultsMap.get(sp.id);
          const userVote = userVoteMap.get(sp.id);
          const wrapperOwnsSubmit = useWrapperSubmit || (usePollSubmit && !selfSubmits);
          // A ranked_choice question in its suggestion phase renders as two
          // stacked cards: the suggestion entry on top, and below it either the
          // ranking ballot (early voting, allow_pre_ranking !== false) or the
          // "voting will open when suggestions close" notice (pre-ranking
          // disabled). QuestionBallot renders both per-section cards itself via
          // splitEarlyVotingCards, so we drop the single outer card here to
          // avoid nesting either case.
          const splitSuggestionPhaseCards =
            sp.question_type === "ranked_choice" &&
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
              splitEarlyVotingCards={splitSuggestionPhaseCards}
              wrapperHandlesSubmit={!!poll.id && wrapperOwnsSubmit}
              externalVoterName={wrapperOwnsSubmit ? savedUserName : undefined}
              onWrapperSubmitStateChange={
                wrapperOwnsSubmit ? handleWrapperSubmitStateChange : undefined
              }
              onReferenceLocationStateChange={handleReferenceLocationStateChange}
              onRequireName={gateOnName}
              getPlusOnes={getPlusOnes}
              plusOnesCount={plusOnesCount}
            />
          );

          // "Near X" footnote rendered BELOW the ballot card once results are
          // on display (QuestionBallot reports the placement via the callback
          // above). The suggestion-phase split branch is always pre-results, so
          // it never shows it.
          const referenceBelow =
            referenceBelowMap.get(sp.id) && sp.reference_location_label ? (
              <div className="mt-1.5 flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Near {sp.reference_location_label}</span>
              </div>
            ) : null;

          if (splitSuggestionPhaseCards) {
            return (
              <div key={sp.id} className={idx > 0 ? "mt-3" : "mt-2"}>
                {isMultiPoll && <QuestionSectionHeader question={sp} extraClass="px-1" />}
                {ballot}
              </div>
            );
          }

          return (
            <Fragment key={sp.id}>
            <div
              className={`${idx > 0 ? "mt-3" : "mt-2"} ${POLL_SUBCARD_CLASS}`}
            >
              {isMultiPoll && <QuestionSectionHeader question={sp} />}

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
                                // Persist the staged choice so it survives a
                                // refresh before the wrapper Submit. Only for
                                // not-yet-voted questions (the committed vote is
                                // the source of truth otherwise); cleared on
                                // submit by useGroupVoting.
                                if (poll.id && !hasVotedOnQuestion(sp.id)) {
                                  saveQuestionDraft(poll.id, sp.id, {
                                    yesNoChoice:
                                      newChoice === "abstain" ? null : newChoice,
                                    isAbstaining: newChoice === "abstain",
                                  });
                                }
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
            {referenceBelow}
            </Fragment>
          );
        })}

        {/* "Plus one/more": when the poll allows it, the voter can add extra
            people their single ballot counts for (each optionally named, with a
            contact lookup). Poll-level — applies to every question. */}
        {poll.allow_plus_ones && !isClosed && (
          <div className="mt-6">
            <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
              Voting for others?
            </h2>
            {plusOnes.length > 0 && (
              <p className="px-1 mb-2 text-xs text-gray-400 dark:text-gray-500">
                Your response will be duplicated for each person you represent. If they already have the app, look them up below and they can change their response later.
              </p>
            )}
            <PlusOnesInput
              entries={plusOnes}
              setEntries={setPlusOnes}
              candidates={plusOneCandidates}
            />
          </div>
        )}

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
                {submitting ? "Submitting..." : `Submit Vote${submitForSuffix}`}
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
          // limited_supply bakes the head count into its own label
          // ("Claim 3 spots" / "Decline"), so the generic " for N" suffix
          // would double it up — skip it for that type only.
          const label =
            sp.question_type === "limited_supply"
              ? submitState.label
              : `${submitState.label}${submitForSuffix}`;
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
                {label}
              </button>
            </div>
          );
        })()}

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
        confirmText={pendingPollSubmit && pollSubmitting.has(pendingPollSubmit.pollId) ? "Submitting…" : `Submit Vote${submitForSuffix}`}
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

      <AccountGateModal
        isOpen={!!pendingNameRetry}
        message="to vote"
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

"use client";

/**
 * Per-card render for the group page. Memoized via React.memo with a custom
 * equality function that compares only the slices of state Maps relevant to
 * this card's question/sub-question/poll IDs — so a vote on card A never
 * re-renders cards B..N. Card-local handlers (touch/swipe/click) live inside
 * the component so they close over per-card props instead of being re-created
 * on every parent render.
 *
 * See CLAUDE.md → "Group-Page Layout Stability" for the rationale and the
 * subscription pattern used for high-frequency state.
 */

import * as React from "react";
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Poll, Question, QuestionResults } from "@/lib/types";
import type { ApiVote } from "@/lib/api";
import type {
  PendingPollSubmit,
  PreparedNonYesNoEntry,
  UserYesNoVote,
  WrapperSubmitState,
  YesNoChoice,
} from "@/lib/useGroupVoting";
import {
  getCategoryIcon,
  getBuiltInCategoryIcon,
  getQuestionSectionTitle,
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
  compactDurationSince,
  relativeTime,
} from "@/lib/questionListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { getUserName } from "@/lib/userProfile";
import { getGroupHrefForPoll } from "@/lib/groupUtils";
import ClientOnly from "@/components/ClientOnly";
import VoterList from "@/components/VoterList";
import InitialBubble from "@/components/InitialBubble";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import CompactNameField from "@/components/CompactNameField";
import QuestionBallot, { type QuestionBallotHandle } from "@/components/QuestionBallot";
import QuestionDetails from "@/components/QuestionDetails";
import QuestionResultsDisplay, {
  CompactRankedChoicePreview,
  CompactSuggestionPreview,
  CompactTimePreview,
} from "@/components/QuestionResults";
import SimpleCountdown from "@/components/SimpleCountdown";

export type GroupCardGroup = {
  key: string;
  pollId: string | null;
  poll: Poll | null;
  subQuestions: Question[];
  anchor: Question;
};

export type SwipeState = {
  questionId: string | null;
  pollId: string | null;
  cardWidth: number;
  startX: number;
  startY: number;
  offsetPx: number;
  swiping: boolean;
  pastAbstainPoint: boolean;
};

const SWIPE_ABSTAIN_THRESHOLD_RATIO = 0.3;
const SWIPE_DIRECTION_THRESHOLD_PX = 12;

// Stable filter: votes submitted during the suggestion phase (gave suggestions
// or fully abstained from suggestions). Module-scope so VoterList doesn't
// re-run its effect on every parent render.
const suggestionPhaseRespondentFilter = (v: ApiVote) =>
  !!(v.suggestions && v.suggestions.length > 0) || !!v.is_abstain;

// Per-question category emoji that hangs to the LEFT of the card,
// vertically anchored at the top of its parent's relative box. The parent
// must be `position: relative` (or be the cardFrame itself).
//
// left: -2.375rem = -(card px-2 0.5rem + outer-grid gap-x-0.5 0.125rem +
//   col-1 width 1.75rem) — places the icon centered in the same column
//   the creator bubble occupies at the top of the card. width matches
//   col-1 so the glyph centers there.
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
      style={{ width: '1.75rem', left: '-2.375rem', top: 0 }}
      aria-hidden="true"
    >
      {getCategoryIcon(question, isClosed)}
    </div>
  );
}

// Inverse grid-rows clip for compact pills in the group card header:
// full height when collapsed, 0 when expanded, animating in lockstep with the
// heavy-content expand clip below. The pill sits directly at the top of the
// overflow-hidden child so its text center aligns with the sibling status
// text via the parent flex row's items-center.
function CompactPreviewClip({
  isExpanded,
  children,
}: {
  isExpanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid w-full min-w-0 transition-[grid-template-rows] duration-300 ease-out ${
        isExpanded ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
      }`}
      aria-hidden={isExpanded}
    >
      <div className="overflow-hidden min-w-0">{children}</div>
    </div>
  );
}

export interface GroupCardItemProps {
  // Identity / data ---------------------------------------------------------
  group: GroupCardGroup;

  // Per-card primitives (computed in parent .map) --------------------------
  isExpanded: boolean;
  isPressed: boolean;
  isPlaceholder: boolean;
  isAwaiting: boolean;
  isClosed: boolean;
  isVisible: boolean;
  isSwipeThresholdActive: boolean;
  isTooltipActive: boolean;

  // State Maps. Pass directly + custom equality slices per-card. -----------
  questionResultsMap: Map<string, QuestionResults>;
  userVoteMap: Map<string, UserYesNoVote>;
  pendingPollChoices: Map<string, YesNoChoice>;
  wrapperSubmitState: Map<string, WrapperSubmitState>;
  pollVoterNames: Map<string, string>;
  pollSubmitting: Set<string>;
  pollSubmitError: Map<string, string>;

  // Refs (stable identity — no need to compare in equality fn) -------------
  cardFrameRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  expandedWrapperRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  subQuestionBallotRefs: MutableRefObject<Map<string, QuestionBallotHandle>>;
  longPressTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  isLongPressRef: MutableRefObject<boolean>;
  touchStartPosRef: MutableRefObject<{ x: number; y: number } | null>;
  isScrollingRef: MutableRefObject<boolean>;
  swipeRef: MutableRefObject<SwipeState>;
  swipeJustHandledRef: MutableRefObject<boolean>;
  touchJustHandledRef: MutableRefObject<boolean>;

  // Stable callbacks/setters ------------------------------------------------
  attachCardEl: (el: HTMLElement, anchorId: string, groupKey: string) => void;
  detachCardEl: (anchorId: string) => void;
  resetSwipeRef: () => void;
  submitSwipeAbstain: (
    pollId: string,
    subQuestions: Question[],
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  setExpandedQuestionId: Dispatch<SetStateAction<string | null>>;
  setPressedQuestionId: Dispatch<SetStateAction<string | null>>;
  setSwipeThresholdQuestionId: Dispatch<SetStateAction<string | null>>;
  setTooltipQuestionId: Dispatch<SetStateAction<string | null>>;
  setModalQuestion: Dispatch<SetStateAction<Question | null>>;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  setPendingVoteChange: Dispatch<
    SetStateAction<{ questionId: string; newChoice: YesNoChoice } | null>
  >;
  submitYesNoChoice: (questionId: string, newChoice: YesNoChoice) => void;
  setPollVoterName: (id: string, name: string) => void;
  setPendingPollChoices: Dispatch<SetStateAction<Map<string, YesNoChoice>>>;
  setPendingPollSubmit: Dispatch<SetStateAction<PendingPollSubmit | null>>;
  handleWrapperSubmitStateChange: (
    questionId: string,
    state: WrapperSubmitState,
  ) => void;
}

function GroupCardItemImpl(props: GroupCardItemProps) {
  const {
    group,
    isExpanded,
    isPressed,
    isPlaceholder,
    isAwaiting,
    isClosed,
    isVisible,
    isSwipeThresholdActive,
    isTooltipActive,
    questionResultsMap,
    userVoteMap,
    pendingPollChoices,
    wrapperSubmitState,
    pollVoterNames,
    pollSubmitting,
    pollSubmitError,
    cardFrameRefs,
    expandedWrapperRefs,
    subQuestionBallotRefs,
    longPressTimerRef,
    isLongPressRef,
    touchStartPosRef,
    isScrollingRef,
    swipeRef,
    swipeJustHandledRef,
    touchJustHandledRef,
    attachCardEl,
    detachCardEl,
    resetSwipeRef,
    submitSwipeAbstain,
    setExpandedQuestionId,
    setPressedQuestionId,
    setSwipeThresholdQuestionId,
    setTooltipQuestionId,
    setModalQuestion,
    setShowModal,
    setPendingVoteChange,
    submitYesNoChoice,
    setPollVoterName,
    setPendingPollChoices,
    setPendingPollSubmit,
    handleWrapperSubmitStateChange,
  } = props;

  const question = group.anchor;
  const isMultiGroup = group.subQuestions.length > 1;
  const wrapper = group.poll;

  // First-time votes on single-question polls submit directly so a stray
  // tap on a vote-change still hits the confirmation modal.
  const dispatchYesNoTap = (questionId: string, newChoice: YesNoChoice) => {
    if (!isMultiGroup && !userVoteMap.get(questionId)) {
      submitYesNoChoice(questionId, newChoice);
      return;
    }
    setPendingVoteChange({ questionId, newChoice });
  };

  // Wrapper-level reads (Phase 5b). Hoisted so every callsite below can use
  // them without re-deriving.
  const wrapperResponseDeadline = wrapper?.response_deadline ?? null;
  const wrapperPrephaseDeadline = wrapper?.prephase_deadline ?? null;
  const wrapperCloseReason = wrapper?.close_reason ?? null;
  const wrapperUpdatedAt = wrapper?.updated_at ?? question.updated_at;

  // Swipe-to-abstain is only allowed when the golden border is on: open poll,
  // anchor un-responded, card collapsed. Multi-question polls where the user
  // has voted on q1 but not q2 are skipped (anchor not awaiting) — by then
  // they've engaged with the poll.
  const swipeEligible = isAwaiting && !isExpanded && !isClosed && !!group.pollId;

  // Stable ref-callbacks. Without useCallback the inline arrows would have
  // fresh identity every time THIS card re-renders (e.g. when isExpanded
  // flips); React would call the previous callback with `null` (detaching
  // observers) then the new callback with the element (re-attaching),
  // churning the IntersectionObserver / ResizeObserver wiring on every
  // expand/press/swipe-threshold flip. Deps are `question.id` + `group.key`
  // (both stable per card) plus the parent's stable handler identities.
  const setCardEl = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) attachCardEl(el, question.id, group.key);
      else detachCardEl(question.id);
    },
    [attachCardEl, detachCardEl, question.id, group.key],
  );
  const setCardFrameEl = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) cardFrameRefs.current.set(question.id, el);
      else cardFrameRefs.current.delete(question.id);
    },
    [cardFrameRefs, question.id],
  );
  const setExpandedWrapperEl = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) expandedWrapperRefs.current.set(question.id, el);
      else expandedWrapperRefs.current.delete(question.id);
    },
    [expandedWrapperRefs, question.id],
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    isLongPressRef.current = false;
    isScrollingRef.current = false;
    setPressedQuestionId(question.id);
    touchStartPosRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    const cardEl = cardFrameRefs.current.get(question.id);
    swipeRef.current = {
      questionId: question.id,
      pollId: group.pollId,
      cardWidth: cardEl?.offsetWidth ?? 0,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      offsetPx: 0,
      swiping: false,
      pastAbstainPoint: false,
    };
    longPressTimerRef.current = setTimeout(() => {
      if (!isScrollingRef.current && !swipeRef.current.swiping) {
        isLongPressRef.current = true;
        if ("vibrate" in navigator) {
          try {
            navigator.vibrate(50);
          } catch {}
        }
        setModalQuestion(question);
        setShowModal(true);
        setPressedQuestionId(null);
      }
    }, 500);
  };

  // Tap toggles expand/collapse. Long-press always opens the follow-up modal
  // regardless of expansion state.
  const toggleExpand = () => {
    setExpandedQuestionId((curr) => (curr === question.id ? null : question.id));
  };

  const handleClick = () => {
    if (touchJustHandledRef.current || swipeJustHandledRef.current) return;
    toggleExpand();
  };

  // The slide-off animation has to complete BEFORE submitSwipeAbstain fires;
  // otherwise the optimistic isAwaiting flip unmounts the reveal layer
  // mid-transition and leaves a still-translated card visible against an
  // empty wrapper. setTimeout matches the 220ms animation duration.
  const finalizeSwipe = () => {
    const cardEl = cardFrameRefs.current.get(question.id);
    if (!cardEl) return;
    const offset = swipeRef.current.offsetPx;
    const cardWidth = swipeRef.current.cardWidth;
    const threshold = cardWidth * SWIPE_ABSTAIN_THRESHOLD_RATIO;
    const shouldCommit = -offset >= threshold && !!swipeRef.current.pollId;

    swipeJustHandledRef.current = true;
    setTimeout(() => {
      swipeJustHandledRef.current = false;
    }, 400);

    if (shouldCommit && swipeRef.current.pollId) {
      const pollId = swipeRef.current.pollId;
      const subs = group.subQuestions;
      cardEl.style.transition = "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)";
      cardEl.style.transform = `translateX(-${cardWidth}px)`;
      if ("vibrate" in navigator) {
        try {
          navigator.vibrate(20);
        } catch {}
      }
      window.setTimeout(() => {
        cardEl.style.transition = "none";
        cardEl.style.transform = "";
        void submitSwipeAbstain(pollId, subs);
      }, 220);
    } else {
      cardEl.style.transition = "transform 200ms cubic-bezier(0.4, 0, 0.2, 1)";
      cardEl.style.transform = "translateX(0)";
      window.setTimeout(() => {
        cardEl.style.transition = "";
        cardEl.style.transform = "";
      }, 200);
    }
    resetSwipeRef();
    touchStartPosRef.current = null;
    isScrollingRef.current = false;
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (
      swipeRef.current.swiping &&
      swipeRef.current.questionId === question.id
    ) {
      finalizeSwipe();
      setPressedQuestionId(null);
      return;
    }
    if (!isScrollingRef.current && !isLongPressRef.current) {
      setPressedQuestionId(null);
      touchJustHandledRef.current = true;
      setTimeout(() => {
        touchJustHandledRef.current = false;
      }, 400);
      toggleExpand();
    } else {
      setPressedQuestionId(null);
    }
    touchStartPosRef.current = null;
    isScrollingRef.current = false;
    if (swipeRef.current.questionId === question.id) {
      resetSwipeRef();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const dx = e.touches[0].clientX - touchStartPosRef.current.x;
    const dy = e.touches[0].clientY - touchStartPosRef.current.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Already swiping: keep transforming the card with the finger.
    if (
      swipeRef.current.swiping &&
      swipeRef.current.questionId === question.id
    ) {
      const cardEl = cardFrameRefs.current.get(question.id);
      if (!cardEl) return;
      // Resist rightward overshoot (rubber-band) so the gesture feels
      // anchored to leftward intent. Leftward motion is unbounded — past the
      // abstain threshold the bold reveal text becomes the "you're committed"
      // signal but the card still tracks the finger.
      const offset = dx > 0 ? dx * 0.3 : dx;
      swipeRef.current.offsetPx = offset;
      cardEl.style.transition = "none";
      cardEl.style.transform = `translateX(${offset}px)`;
      const threshold = swipeRef.current.cardWidth * SWIPE_ABSTAIN_THRESHOLD_RATIO;
      const past = -offset >= threshold;
      if (past && !swipeRef.current.pastAbstainPoint) {
        swipeRef.current.pastAbstainPoint = true;
        setSwipeThresholdQuestionId(question.id);
        if ("vibrate" in navigator) {
          try {
            navigator.vibrate(15);
          } catch {}
        }
      } else if (!past && swipeRef.current.pastAbstainPoint) {
        swipeRef.current.pastAbstainPoint = false;
        setSwipeThresholdQuestionId(null);
      }
      return;
    }

    // Not yet swiping. Cancel long-press / pressed-state on significant motion.
    if (adx > 10 || ady > 10) {
      isScrollingRef.current = true;
      setPressedQuestionId(null);
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
    // Enter swipe mode iff motion is horizontal-dominant + leftward AND the
    // card is currently swipe-eligible. Right-only motion never engages
    // swipe mode (so right-swipe is a non-action).
    if (
      swipeEligible &&
      !swipeRef.current.swiping &&
      swipeRef.current.questionId === question.id &&
      adx > SWIPE_DIRECTION_THRESHOLD_PX &&
      adx > ady * 1.5 &&
      dx < 0
    ) {
      swipeRef.current.swiping = true;
    }
  };

  const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation();

  // Status label is anchor-based: the poll's voting and prephase deadlines
  // are shared across questions (per the poll design), and `isClosed` is
  // enforced poll-atomically by Phase 3.1 close/reopen.
  const statusEl: React.ReactNode = (() => {
    const inSuggestions = isInSuggestionPhase(question, wrapperPrephaseDeadline);
    const inTimeAvailability = isInTimeAvailabilityPhase(question);
    if (isClosed) {
      const closedAt =
        wrapperCloseReason === "deadline" && wrapperResponseDeadline
          ? wrapperResponseDeadline
          : wrapperUpdatedAt;
      return (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Closed {compactDurationSince(closedAt)} ago
        </span>
      );
    }
    if (inSuggestions && wrapperPrephaseDeadline) {
      return <SimpleCountdown deadline={wrapperPrephaseDeadline} label="Suggestions" />;
    }
    if (inSuggestions && question.suggestion_deadline_minutes) {
      return (
        <span className="font-semibold text-blue-600 dark:text-blue-400">
          Taking Suggestions
        </span>
      );
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

  // Returns the type-specific compact pill JSX for one question, or null when
  // there's nothing to show yet (no votes, no suggestions, etc.). Yes/No
  // pills wrap in a stopBubble div because their option cards are tappable;
  // the other pill types are display-only and bubble taps to the card's
  // expand handler.
  const pillForQuestion = (sp: Question): React.ReactNode => {
    const r = questionResultsMap.get(sp.id);
    const inSuggestions = isInSuggestionPhase(sp, wrapperPrephaseDeadline);
    const inTimeAvailability = isInTimeAvailabilityPhase(sp);
    if (sp.question_type === "yes_no") {
      const hasStats = !!r && (r.total_votes || 0) > 0;
      if (!hasStats) return null;
      const userVote = userVoteMap.get(sp.id);
      return (
        <div
          onClick={stopBubble}
          onTouchStart={stopBubble}
          onTouchEnd={stopBubble}
          onTouchMove={stopBubble}
        >
          <QuestionResultsDisplay
            results={r!}
            isQuestionClosed={isClosed}
            hideLoser={true}
            userVoteChoice={userVote?.choice ?? null}
            onVoteChange={
              isClosed
                ? undefined
                : (newChoice) => dispatchYesNoTap(sp.id, newChoice)
            }
          />
        </div>
      );
    }
    if (sp.question_type === "ranked_choice" && r) {
      const hasPreview = inSuggestions
        ? (r.suggestion_counts || []).length > 0
        : (r.total_votes || 0) > 0 && !!r.winner && r.winner !== "tie";
      if (!hasPreview) return null;
      return inSuggestions ? (
        <CompactSuggestionPreview results={r} />
      ) : (
        <CompactRankedChoicePreview
          results={r}
          isQuestionClosed={isClosed}
          categoryIcon={getBuiltInCategoryIcon(sp.category)}
        />
      );
    }
    if (sp.question_type === "time" && r && !inTimeAvailability) {
      const hasPreview = (r.total_votes || 0) > 0 && !!r.winner;
      if (!hasPreview) return null;
      return (
        <CompactTimePreview
          results={r}
          isQuestionClosed={isClosed}
          categoryIcon={getBuiltInCategoryIcon("time")}
        />
      );
    }
    return null;
  };

  let pillEl: React.ReactNode = null;
  if (!isMultiGroup) {
    // Single-question group: preserve the existing per-type clip behavior.
    // yes_no has no clip — the pill is simply omitted when expanded because
    // the full cards take over below the row.
    const anchorPill = pillForQuestion(question);
    if (anchorPill) {
      if (question.question_type === "yes_no") {
        pillEl = !isExpanded ? anchorPill : null;
      } else {
        pillEl = (
          <CompactPreviewClip isExpanded={isExpanded}>
            {anchorPill}
          </CompactPreviewClip>
        );
      }
    }
  } else {
    // Multi-question group: stack one pill per question vertically inside a
    // single CompactPreviewClip so the whole column animates to 0 in lockstep
    // with the heavy expand clip below. Sub-questions without any data yet
    // (no votes / no suggestions) drop their row so the column stays compact.
    const subPills = group.subQuestions
      .map((sp) => {
        const node = pillForQuestion(sp);
        if (!node) return null;
        // w-full + min-w-0 forces each row to fill the column track width,
        // so the inner flex's `justify-end` right-aligns the pill within the
        // available space — without it the row sizes to its pill's
        // max-content, allowing the column to grow beyond its parent's
        // bounds and overlap the status label on the left.
        return <div key={sp.id} className="w-full min-w-0">{node}</div>;
      })
      .filter((n): n is React.ReactElement => n !== null);
    if (subPills.length > 0) {
      pillEl = (
        <CompactPreviewClip isExpanded={isExpanded}>
          <div className="flex flex-col items-stretch gap-1 w-full min-w-0">
            {subPills}
          </div>
        </CompactPreviewClip>
      );
    }
  }

  const allYesNo = group.subQuestions.every(
    (sp) => sp.question_type === "yes_no",
  );
  const usePollSubmit = isMultiGroup && !!group.pollId;
  const useWrapperSubmit =
    !isMultiGroup &&
    !!group.pollId &&
    group.subQuestions[0]?.question_type !== "yes_no";

  return (
    <div
      ref={setCardEl}
      className="ml-0 mr-1.5 mb-3 grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-0.5"
    >
      {/* Poll-title row's left slot: creator's initials in a colored
          circle. The explicit h-7 (from InitialBubble's BASE_CLASS)
          anchors the bubble at the top of row-2 — without it, the grid
          item's default `align-items: stretch` would expand the element
          to the full card height when expanded, vertically centering
          the bubble in the middle of the card. */}
      <InitialBubble
        name={wrapper?.creator_name ?? null}
        className="col-start-1 row-start-2 mt-[4px]"
      />

      {/* Row 1 used to hold the above-card status label; the label now lives
          in the card's footer row (see below). Creator + date moved to row 3
          alongside respondents. Row 1 is intentionally empty. */}

      <div className="col-start-2 row-start-2 min-w-0 relative">
        {/* Swipe-to-abstain reveal layer (covered by the cardFrame until the
            user drags left). Mounted only while swipe-eligible so non-awaiting
            cards can't drag. */}
        {swipeEligible && (
          <div
            className="absolute inset-0 rounded-2xl flex items-center justify-end pr-5 text-amber-600 dark:text-amber-400 pointer-events-none select-none"
            aria-hidden="true"
          >
            <span
              className={`flex flex-col items-center leading-none transition-all duration-200 ${
                isSwipeThresholdActive
                  ? "opacity-100 font-bold"
                  : "opacity-50 font-light"
              }`}
            >
              <span>Abstain</span>
              <svg
                className="w-4 h-4 mt-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 12H5M12 19l-7-7 7-7"
                />
              </svg>
            </span>
          </div>
        )}
        <div
          ref={setCardFrameEl}
          className={`min-w-0 px-2 pt-1.5 ${
            isExpanded ? "pb-1.5" : "pb-0.5"
          } rounded-2xl border shadow-sm ${
            isAwaiting
              ? "border-amber-400 dark:border-amber-500"
              : "border-gray-200 dark:border-gray-800"
          } ${
            isPressed
              ? "bg-blue-100 dark:bg-blue-900/40"
              : "bg-gray-100 dark:bg-gray-900"
          } ${
            !isExpanded
              ? "hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-blue-100 dark:active:bg-blue-900/40"
              : ""
          } ${isPlaceholder ? "card-pending-enter" : ""} transition-colors select-none relative`}
        >
          {/* Compact header — click/touch + long-press live here so they
              work whether the card is collapsed or expanded without
              interfering with interactive elements inside the expanded
              QuestionBallot. */}
          <div
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            className="cursor-pointer"
          >
            <div className="flex items-start gap-2">
              <h3 className="flex-1 min-w-0 font-medium text-lg leading-tight line-clamp-2 text-gray-900 dark:text-white">
                {question.title}
              </h3>
              <div
                className="shrink-0 -mt-0.5 -mr-1"
                onClick={stopBubble}
                onTouchStart={stopBubble}
                onTouchEnd={stopBubble}
                onTouchMove={stopBubble}
              >
                <FloatingCopyLinkButton
                  url={(() => {
                    if (typeof window === "undefined") return "";
                    // Canonical share URL — uses `group_short_id` from the
                    // poll directly (Migration 105: no chain walk needed);
                    // falls back to this poll as root for placeholders.
                    const href = wrapper
                      ? getGroupHrefForPoll(wrapper)
                      : `/g/${question.id}?p=${question.id}`;
                    return `${window.location.origin}${href}`;
                  })()}
                />
              </div>
            </div>
            {/* Footer row: status label on the left and the question-type-
                specific compact pill on the right. The pill collapses to 0
                height when the card is expanded (inverse grid-rows clip for
                ranked_choice / suggestion / time; the yes_no compact pill is
                simply not rendered when expanded since the full cards appear
                below). If the row would be empty (no status AND no pill)
                it's not rendered, so the gap doesn't appear. */}
            {!isPlaceholder && (statusEl || pillEl) && (
              // min-h-7 pins the row to the compact pill's natural height
              // (~26px) so the status text stays at a stable Y whether the
              // pill is showing or clipped to 0 by CompactPreviewClip on
              // expand. items-end aligns the status text with the BOTTOM of
              // the pill column — so when multiple pills stack vertically the
              // status reads alongside the bottom-most pill instead of being
              // centered with the whole stack.
              <div className="min-h-7 flex items-end gap-2 min-w-0">
                <div className="shrink-0 pl-1 text-sm leading-7 text-gray-500 dark:text-gray-400">
                  <ClientOnly fallback={null}>{statusEl}</ClientOnly>
                </div>
                <div className="flex-1 min-w-0 flex justify-end">{pillEl}</div>
              </div>
            )}
          </div>
          {/* /compact header */}

          {/* Expanded full-question content — pre-mounted (clipped) once the
              card enters the viewport so fetches + effects complete before
              expansion. Animates height via grid-template-rows 0fr ↔ 1fr
              with overflow hidden on the child, so the natural expanded
              height is used without JS measurement. */}
          {!isPlaceholder && (isVisible || isExpanded) && (
            <div
              data-question-expand-grid=""
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
              aria-hidden={!isExpanded}
            >
              {/* overflow-y: clip clips the height-animation as `overflow:
                  hidden` did, but overflow-x: visible lets each question's
                  category icon hang to the left of the card (mirroring the
                  poll's icon column). `clip` is required (vs `hidden`) so the
                  per-axis overrides don't get coerced to `auto`. `min-h-0`
                  is required because `overflow: clip` does NOT establish a
                  BFC (unlike `overflow: hidden`), so the grid item's default
                  `min-height: auto` would otherwise prevent it from shrinking
                  to 0 against the `grid-template-rows: 0fr` collapse —
                  leaving the card visually expanded even after the React
                  state has collapsed.
                  See CLAUDE.md → "Group-page scroll strategy" pitfalls. */}
              <div className="overflow-y-clip overflow-x-visible min-h-0 min-w-0" ref={setExpandedWrapperEl}>
                <div className={allYesNo && !usePollSubmit ? "" : "mt-1.5"}>
                  {wrapper?.details && (
                    <QuestionDetails details={wrapper.details} label="Notes: " />
                  )}
                  {group.subQuestions.map((sp, idx) => {
                    // Phase 3.3: every yes_no question uses external
                    // rendering so non-anchor questions also get the
                    // group-page tap-to-change flow.
                    const isYesNo = sp.question_type === "yes_no";
                    const r = isYesNo ? questionResultsMap.get(sp.id) : undefined;
                    const userVote = isYesNo ? userVoteMap.get(sp.id) : undefined;
                    const hangingIcon = (
                      <HangingCategoryIcon question={sp} isClosed={isClosed} />
                    );
                    return (
                      <div
                        key={sp.id}
                        className={`${
                          isMultiGroup && idx > 0
                            ? "mt-4 pt-3 border-t border-gray-200 dark:border-gray-800"
                            : ""
                        }${!isMultiGroup ? " relative" : ""}`}
                      >
                        {/* Single-question polls skip the section title (it
                             duplicates the card's top header) and anchor
                             the icon on the outer section div. Multi-
                             question polls keep an intermediate header div
                             so the icon stays below `pt-3` for idx > 0
                             rows. */}
                        {isMultiGroup ? (
                          <div className="mb-2 relative">
                            {hangingIcon}
                            <div className="text-lg font-medium leading-tight text-gray-900 dark:text-white truncate">
                              {getQuestionSectionTitle(sp)}
                            </div>
                          </div>
                        ) : (
                          hangingIcon
                        )}
                        {isYesNo &&
                          isExpanded &&
                          r &&
                          (() => {
                            // For all-yes_no multi-groups, the displayed
                            // selection prefers a staged choice (taps queued
                            // for the wrapper-level Submit) over the
                            // persisted vote.
                            const stagedChoice = usePollSubmit
                              ? pendingPollChoices.get(sp.id) ?? null
                              : null;
                            const displayedChoice =
                              stagedChoice ?? userVote?.choice ?? null;
                            return (
                              <div
                                className="mt-2"
                                onClick={stopBubble}
                                onTouchStart={stopBubble}
                                onTouchEnd={stopBubble}
                                onTouchMove={stopBubble}
                              >
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
                                              if (prev.get(sp.id) === newChoice)
                                                return prev;
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
                        {(() => {
                          // Yes_no questions render externally via
                          // QuestionResultsDisplay (Phase 3.3) — they don't
                          // have an inline Submit to suppress.
                          const wrapperOwnsSubmit =
                            !!group.pollId &&
                            (useWrapperSubmit || (usePollSubmit && !isYesNo));
                          const wrapperVoterName = wrapperOwnsSubmit
                            ? pollVoterNames.get(group.pollId!) ??
                              getUserName() ??
                              ""
                            : undefined;
                          const setWrapperVoterName = wrapperOwnsSubmit
                            ? (name: string) =>
                                setPollVoterName(group.pollId!, name)
                            : undefined;
                          // Phase 5b: every question has a poll wrapper
                          // post-Phase-4 backfill, so this assertion is safe
                          // in practice.
                          if (!wrapper) return null;
                          return (
                            <QuestionBallot
                              ref={(handle) => {
                                if (handle)
                                  subQuestionBallotRefs.current.set(sp.id, handle);
                                else
                                  subQuestionBallotRefs.current.delete(sp.id);
                              }}
                              question={sp}
                              poll={wrapper}
                              createdDate={formatCreationTimestamp(sp.created_at)}
                              questionId={sp.id}
                              externalYesNoResults={isYesNo}
                              isExpanded={isExpanded}
                              partOfPollGroup={isMultiGroup}
                              wrapperHandlesSubmit={wrapperOwnsSubmit}
                              externalVoterName={wrapperVoterName}
                              setExternalVoterName={setWrapperVoterName}
                              onWrapperSubmitStateChange={
                                wrapperOwnsSubmit
                                  ? handleWrapperSubmitStateChange
                                  : undefined
                              }
                            />
                          );
                        })()}
                      </div>
                    );
                  })}
                  {usePollSubmit &&
                    group.pollId &&
                    !isClosed &&
                    (() => {
                      const pollId = group.pollId;
                      const hasYesNoStaged = group.subQuestions.some(
                        (sp) =>
                          sp.question_type === "yes_no" &&
                          pendingPollChoices.has(sp.id),
                      );
                      const hasNonYesNoReady = group.subQuestions.some(
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
                        <div
                          className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800"
                          onClick={stopBubble}
                          onTouchStart={stopBubble}
                          onTouchEnd={stopBubble}
                          onTouchMove={stopBubble}
                        >
                          <section className="mb-3 rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
                            <CompactNameField
                              name={voterNameVal}
                              setName={(name: string) =>
                                setPollVoterName(pollId, name)
                              }
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
                              // Snapshot prepared items at button-tap so
                              // edits between click and confirm don't leak
                              // into the in-flight batch.
                              const preparedNonYesNo: PreparedNonYesNoEntry[] = [];
                              let stagedCount = 0;
                              let hadValidationError = false;
                              for (const sp of group.subQuestions) {
                                if (sp.question_type === "yes_no") {
                                  if (pendingPollChoices.has(sp.id))
                                    stagedCount++;
                                  continue;
                                }
                                const handle = subQuestionBallotRefs.current.get(
                                  sp.id,
                                );
                                if (!handle) continue;
                                const result = handle.prepareBatchVoteItem();
                                if ("skip" in result) continue;
                                if (!result.ok) {
                                  // Error is surfaced inline via
                                  // QuestionBallot.voteError.
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
                                subQuestions: group.subQuestions,
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
                  {useWrapperSubmit &&
                    group.pollId &&
                    !isClosed &&
                    (() => {
                      const pollId = group.pollId;
                      const sp = group.subQuestions[0]!;
                      const submitState = wrapperSubmitState.get(sp.id);
                      if (!submitState?.visible) return null;
                      const voterNameVal =
                        pollVoterNames.get(pollId) ?? getUserName() ?? "";
                      return (
                        <div
                          className="mt-3"
                          onClick={stopBubble}
                          onTouchStart={stopBubble}
                          onTouchEnd={stopBubble}
                          onTouchMove={stopBubble}
                        >
                          <section className="mb-3 rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
                            <CompactNameField
                              name={voterNameVal}
                              setName={(name: string) =>
                                setPollVoterName(pollId, name)
                              }
                              maxLength={30}
                            />
                          </section>
                          <button
                            type="button"
                            onClick={() => {
                              subQuestionBallotRefs.current
                                .get(sp.id)
                                ?.triggerSubmit();
                            }}
                            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                          >
                            {submitState.label}
                          </button>
                        </div>
                      );
                    })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Creator + pub date on the left, respondents on the right.
          Creator/date takes its natural width (shrink-0) so the respondent
          bubbles get the remainder of the row — replacing the old fixed
          max-w-[75%] respondent cap. Hidden during the placeholder/FLIP
          phase: only the title should be visible until the real poll
          hydrates. */}
      {!isPlaceholder && (
        <div className="col-start-2 row-start-3 mt-0 px-3 flex items-start gap-2 min-w-0">
          <ClientOnly fallback={null}>
            <span className="shrink-0 truncate text-xs text-gray-400 dark:text-gray-500 mt-px">
              {wrapper?.creator_name && <>{wrapper.creator_name} &middot; </>}
              <span
                className="relative cursor-help"
                onClick={() =>
                  setTooltipQuestionId((prev) =>
                    prev === question.id ? null : question.id,
                  )
                }
                onMouseEnter={() => setTooltipQuestionId(question.id)}
                onMouseLeave={() =>
                  setTooltipQuestionId((prev) =>
                    prev === question.id ? null : prev,
                  )
                }
              >
                {relativeTime(question.created_at)}
                {isTooltipActive && (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-100 shadow-lg dark:bg-gray-900"
                  >
                    {formatCreationTimestamp(question.created_at)}
                  </span>
                )}
              </span>
            </span>
          </ClientOnly>
          <ClientOnly fallback={null}>
            {isMultiGroup ? (
              // Poll-level respondent row. Sourced from the poll wrapper
              // (voter_names + anonymous_count) per the Addressability
              // paradigm — never aggregated from question vote fetches
              // client-side. Falls back to empty placeholder until the
              // wrapper resolves.
              <VoterList
                singleLine
                className="flex-1 min-w-0 justify-end mt-[3px]"
                staticVoterNames={wrapper?.voter_names ?? []}
                staticAnonymousCount={wrapper?.anonymous_count ?? 0}
                emptyText="No voters"
              />
            ) : (
              <VoterList
                questionId={question.id}
                singleLine
                className="flex-1 min-w-0 justify-end mt-[3px]"
                filter={
                  isInSuggestionPhase(question, wrapperPrephaseDeadline)
                    ? suggestionPhaseRespondentFilter
                    : undefined
                }
                emptyText={
                  isInSuggestionPhase(question, wrapperPrephaseDeadline)
                    ? "No suggestions yet"
                    : "No voters"
                }
                includeSelf={isInSuggestionPhase(question, wrapperPrephaseDeadline)}
              />
            )}
          </ClientOnly>
        </div>
      )}
    </div>
  );
}

/**
 * Custom equality. Compares only what this card actually renders against, so
 * a vote / expand / press on card A doesn't re-render cards B..N. State Maps
 * are passed directly (not pre-sliced) — the equality fn looks up only this
 * card's question/sub-question/poll-id slices.
 *
 * Stable handlers (setters from useState, useRef-pinned callbacks, refs) are
 * intentionally NOT compared here: their identity is invariant across the
 * component's lifetime. If that assumption breaks (e.g. a parent stops
 * pinning a callback), it'll show up as a stale closure bug, not as missed
 * re-renders — fix it in the parent.
 */
function arePropsEqual(
  prev: GroupCardItemProps,
  next: GroupCardItemProps,
): boolean {
  // Cheap booleans first — most state changes flip exactly one of these for
  // exactly two cards (prev active + new active), so the bulk of cards exit
  // here returning true.
  if (
    prev.isExpanded !== next.isExpanded ||
    prev.isPressed !== next.isPressed ||
    prev.isPlaceholder !== next.isPlaceholder ||
    prev.isAwaiting !== next.isAwaiting ||
    prev.isClosed !== next.isClosed ||
    prev.isVisible !== next.isVisible ||
    prev.isSwipeThresholdActive !== next.isSwipeThresholdActive ||
    prev.isTooltipActive !== next.isTooltipActive
  ) {
    return false;
  }

  // Group identity is recreated on every parent re-render: groupedGroupQuestions
  // is memoized on (groupQuestions, pollWrapperMap), and BOTH inputs get a new
  // identity whenever `group` mutates (vote, hydrate, results refresh). So a
  // naive `prev.group !== next.group` would invalidate every card on every
  // group mutation, defeating the memoization. Instead, compare the parts that
  // actually drive the render — both preserve identity across no-op updates
  // because patchGroupPolls / patchGroupQuestions only allocate new objects
  // for mutated entries:
  //   - poll wrapper identity (Poll object)
  //   - per-question identity (Question objects in subQuestions)
  if (prev.group.pollId !== next.group.pollId) return false;
  if (prev.group.poll !== next.group.poll) return false;
  const prevSubs = prev.group.subQuestions;
  const nextSubs = next.group.subQuestions;
  if (prevSubs.length !== nextSubs.length) return false;
  for (let i = 0; i < nextSubs.length; i++) {
    if (prevSubs[i] !== nextSubs[i]) return false;
  }

  // Per-question slice of state Maps.
  for (let i = 0; i < nextSubs.length; i++) {
    const id = nextSubs[i].id;
    if (prev.questionResultsMap.get(id) !== next.questionResultsMap.get(id))
      return false;
    if (prev.userVoteMap.get(id) !== next.userVoteMap.get(id)) return false;
    if (prev.pendingPollChoices.get(id) !== next.pendingPollChoices.get(id))
      return false;
    const prevSub = prev.wrapperSubmitState.get(id);
    const nextSub = next.wrapperSubmitState.get(id);
    if (prevSub !== nextSub) {
      // wrapperSubmitState entries are objects — compare by value when
      // identity differs. (handleWrapperSubmitStateChange already guards
      // against no-op writes, so different identity ≈ different value, but
      // the field comparison is cheap insurance.)
      if (
        prevSub?.visible !== nextSub?.visible ||
        prevSub?.label !== nextSub?.label
      ) {
        return false;
      }
    }
  }

  // Poll-level slice.
  const pollId = next.group.pollId;
  if (pollId) {
    if (prev.pollVoterNames.get(pollId) !== next.pollVoterNames.get(pollId))
      return false;
    if (prev.pollSubmitting.has(pollId) !== next.pollSubmitting.has(pollId))
      return false;
    if (prev.pollSubmitError.get(pollId) !== next.pollSubmitError.get(pollId))
      return false;
  }

  return true;
}

export const GroupCardItem = React.memo(GroupCardItemImpl, arePropsEqual);

"use client";

/**
 * Per-card render for the group page. Memoized via React.memo with a custom
 * equality function that compares only the slices of state Maps relevant to
 * this card's question/sub-question/poll IDs — so a vote on card A never
 * re-renders cards B..N. Card-local handlers (touch/swipe/click) live inside
 * the component so they close over per-card props instead of being re-created
 * on every parent render.
 *
 * Tapping a card no longer expands it in place — instead it slides to the
 * poll's detail page at `/g/<group>/p/<pollShort>`. The card itself stays
 * compact-only: title + share button + status footer + below-card respondent
 * row. Long-press still opens the FollowUpModal and left-swipe still
 * batched-abstains, both unchanged.
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
  UserYesNoVote,
  YesNoChoice,
} from "@/lib/useGroupVoting";
import {
  getBuiltInCategoryIcon,
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
  compactDurationSince,
  relativeTime,
} from "@/lib/questionListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { isCurrentUserName } from "@/lib/userProfile";
import { isCreatedByThisBrowser } from "@/lib/browserQuestionAccess";
import { slideToPollDetail } from "@/lib/slideOverlay";
import { groupScrollKey, rememberCurrentScroll } from "@/lib/scrollMemory";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import ClientOnly from "@/components/ClientOnly";
import VoterList from "@/components/VoterList";
import InitialBubble from "@/components/InitialBubble";
import QuestionResultsDisplay, {
  CompactRankedChoicePreview,
  CompactSuggestionPreview,
  CompactTimePreview,
} from "@/components/QuestionResults";
import SimpleCountdown from "@/components/SimpleCountdown";
import { haptic } from "@/lib/haptics";

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

export interface GroupCardItemProps {
  // Identity / data ---------------------------------------------------------
  group: GroupCardGroup;
  /** Group route id (groups.short_id / id), used when sliding to the
   *  poll's detail page. */
  groupRouteId: string;

  // Per-card primitives (computed in parent .map) --------------------------
  isPressed: boolean;
  isPlaceholder: boolean;
  isAwaiting: boolean;
  isClosed: boolean;
  isSwipeThresholdActive: boolean;
  isTooltipActive: boolean;

  // State Maps. Pass directly + custom equality slices per-card. -----------
  questionResultsMap: Map<string, QuestionResults>;
  userVoteMap: Map<string, UserYesNoVote>;

  // Refs (stable identity — no need to compare in equality fn) -------------
  cardFrameRefs: MutableRefObject<Map<string, HTMLDivElement>>;
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
  setPressedQuestionId: Dispatch<SetStateAction<string | null>>;
  setSwipeThresholdQuestionId: Dispatch<SetStateAction<string | null>>;
  setTooltipQuestionId: Dispatch<SetStateAction<string | null>>;
  setModalQuestion: Dispatch<SetStateAction<Question | null>>;
  setShowModal: Dispatch<SetStateAction<boolean>>;
}

function GroupCardItemImpl(props: GroupCardItemProps) {
  const {
    group,
    groupRouteId,
    isPressed,
    isPlaceholder,
    isAwaiting,
    isClosed,
    isSwipeThresholdActive,
    isTooltipActive,
    questionResultsMap,
    userVoteMap,
    cardFrameRefs,
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
    setPressedQuestionId,
    setSwipeThresholdQuestionId,
    setTooltipQuestionId,
    setModalQuestion,
    setShowModal,
  } = props;

  const question = group.anchor;
  const isMultiGroup = group.subQuestions.length > 1;
  const wrapper = group.poll;

  // Swap the creator-initials bubble for the user's profile image when
  // this poll is the current browser's. The canonical signal is the
  // localStorage creator_secret (written when the FE creates a poll —
  // see `recordQuestionCreation`). Name-based matching is a fallback
  // for polls created from a different browser that share the user's
  // saved name. The secret check is robust to: (a) polls with empty
  // creator_name (the user uploaded an image but never typed a name),
  // (b) polls where the user typed a slightly different name (e.g.
  // "Sam C." vs "Sam Carey"). Other names render as initials (per the
  // "show only on new participations" scope: we don't lookup other
  // browsers' profile images).
  const myUserImageUrl = useMyUserImageUrl();
  const firstQuestionId = group.subQuestions[0]?.id ?? null;
  const creatorIsMe =
    (firstQuestionId !== null && isCreatedByThisBrowser(firstQuestionId)) ||
    isCurrentUserName(wrapper?.creator_name);
  const creatorImageUrl = creatorIsMe ? myUserImageUrl : null;

  // Wrapper-level reads (Phase 5b). Hoisted so every callsite below can use
  // them without re-deriving.
  const wrapperResponseDeadline = wrapper?.response_deadline ?? null;
  const wrapperPrephaseDeadline = wrapper?.prephase_deadline ?? null;
  const wrapperCloseReason = wrapper?.close_reason ?? null;
  const wrapperUpdatedAt = wrapper?.updated_at ?? question.updated_at;

  // Swipe-to-abstain is allowed when the golden border is on: open poll +
  // anchor un-responded. Multi-question polls where the user has voted on
  // q1 but not q2 are skipped (anchor not awaiting) — by then they've
  // engaged with the poll.
  const swipeEligible = isAwaiting && !isClosed && !!group.pollId;

  // Stable ref-callbacks. Without useCallback the inline arrows would have
  // fresh identity every time THIS card re-renders (e.g. on swipe-threshold
  // / pressed flips); React would call the previous callback with `null`
  // (detaching observers) then the new callback with the element
  // (re-attaching), churning the IntersectionObserver / ResizeObserver
  // wiring on every state flip. Deps are `question.id` + `group.key` (both
  // stable per card) plus the parent's stable handler identities.
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
        haptic.medium();
        setModalQuestion(question);
        setShowModal(true);
        setPressedQuestionId(null);
      }
    }, 500);
  };

  // Tap navigates to the poll's detail page via the overlay-slide (same
  // mechanism as home→group, first frame moves on the next rAF). Long-press
  // still opens the follow-up modal.
  const navigateToDetail = () => {
    const pollShortId = wrapper?.short_id || question.id;
    // Save scroll BEFORE the navigation so back-nav restores here.
    rememberCurrentScroll(groupScrollKey(groupRouteId));
    slideToPollDetail({ groupId: groupRouteId, pollShortId });
  };

  const handleClick = () => {
    if (touchJustHandledRef.current || swipeJustHandledRef.current) return;
    navigateToDetail();
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
      haptic.success();
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
      navigateToDetail();
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
        haptic.light();
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

  // Returns the type-specific compact pill JSX for one question, or null
  // when there's nothing to show yet. Cards are navigation-only now —
  // pill taps fall through to the card click handler that slides to the
  // detail page.
  const pillForQuestion = (sp: Question): React.ReactNode => {
    const r = questionResultsMap.get(sp.id);
    const inSuggestions = isInSuggestionPhase(sp, wrapperPrephaseDeadline);
    const inTimeAvailability = isInTimeAvailabilityPhase(sp);
    if (sp.question_type === "yes_no") {
      const hasStats = !!r && (r.total_votes || 0) > 0;
      if (!hasStats) return null;
      const userVote = userVoteMap.get(sp.id);
      return (
        <QuestionResultsDisplay
          results={r!}
          isQuestionClosed={isClosed}
          hideLoser={true}
          userVoteChoice={userVote?.choice ?? null}
        />
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
    pillEl = pillForQuestion(question);
  } else {
    // Multi-question: stack one pill per question. Sub-questions without
    // any data yet drop their row so the column stays compact. `w-full
    // min-w-0` on each row + `items-stretch` on the column lets the inner
    // pill's `justify-end` right-align within the available track instead
    // of pinning to max-content (which would overflow the status label).
    const subPills = group.subQuestions
      .map((sp) => {
        const node = pillForQuestion(sp);
        if (!node) return null;
        return <div key={sp.id} className="w-full min-w-0">{node}</div>;
      })
      .filter((n): n is React.ReactElement => n !== null);
    if (subPills.length > 0) {
      pillEl = (
        <div className="flex flex-col items-stretch gap-1 w-full min-w-0">
          {subPills}
        </div>
      );
    }
  }

  return (
    <div
      ref={setCardEl}
      className="ml-0 mr-1.5 mb-3 grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-0.5"
    >
      {/* Poll-title row's left slot: the creator's avatar (image when
          this poll is the current browser's AND a profile image is set,
          initials otherwise). The explicit h-7 (from InitialBubble's
          BASE_CLASS) anchors the bubble at the top of row-2 — without
          it, the grid item's default `align-items: stretch` would
          expand the element to the full card height when expanded,
          vertically centering the bubble in the middle of the card. */}
      <InitialBubble
        name={wrapper?.creator_name ?? null}
        imageUrl={creatorImageUrl}
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
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          className={`min-w-0 px-2 pt-1.5 ${
            !isPlaceholder && pillEl ? "pb-0.5" : "pb-1.5"
          } rounded-2xl border shadow-sm cursor-pointer ${
            isAwaiting
              ? "border-amber-400 dark:border-amber-500"
              : "border-gray-200 dark:border-gray-800"
          } ${
            isPressed
              ? "bg-blue-100 dark:bg-blue-900/40"
              : "bg-gray-100 dark:bg-gray-900"
          } hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-blue-100 dark:active:bg-blue-900/40 ${
            isPlaceholder ? "card-pending-enter" : ""
          } transition-colors select-none relative`}
        >
          {/* `-webkit-line-clamp`'s `display: -webkit-box` breaks float
              interactions, so the title is line-clamp-free here. */}
          {!isPlaceholder && statusEl && (
            <div className="float-right shrink-0 pl-2 pt-1 text-sm leading-tight text-gray-500 dark:text-gray-400">
              <ClientOnly fallback={null}>{statusEl}</ClientOnly>
            </div>
          )}
          <h3 className="font-medium text-lg leading-tight text-gray-900 dark:text-white">
            {question.title}
          </h3>
          {/* `clear-both` keeps the pill row below the floated status
              when the title is short enough to leave the status hanging
              mid-card. */}
          {!isPlaceholder && pillEl && (
            <div className="mt-1 min-h-7 flex justify-end clear-both min-w-0">
              <div className="flex-1 min-w-0 flex justify-end">{pillEl}</div>
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
    prev.isPressed !== next.isPressed ||
    prev.isPlaceholder !== next.isPlaceholder ||
    prev.isAwaiting !== next.isAwaiting ||
    prev.isClosed !== next.isClosed ||
    prev.isSwipeThresholdActive !== next.isSwipeThresholdActive ||
    prev.isTooltipActive !== next.isTooltipActive ||
    prev.groupRouteId !== next.groupRouteId
  ) {
    return false;
  }

  // Group identity churns on every parent re-render via the memoized
  // groupedGroupQuestions. Compare only the parts that actually drive this
  // card's render — poll wrapper identity + per-question identity (both
  // preserve identity across no-op patches).
  if (prev.group.pollId !== next.group.pollId) return false;
  if (prev.group.poll !== next.group.poll) return false;
  const prevSubs = prev.group.subQuestions;
  const nextSubs = next.group.subQuestions;
  if (prevSubs.length !== nextSubs.length) return false;
  for (let i = 0; i < nextSubs.length; i++) {
    if (prevSubs[i] !== nextSubs[i]) return false;
  }

  // Per-question slice of the two Maps the card still reads.
  for (let i = 0; i < nextSubs.length; i++) {
    const id = nextSubs[i].id;
    if (prev.questionResultsMap.get(id) !== next.questionResultsMap.get(id))
      return false;
    if (prev.userVoteMap.get(id) !== next.userVoteMap.get(id)) return false;
  }

  return true;
}

export const GroupCardItem = React.memo(GroupCardItemImpl, arePropsEqual);

"use client";

/**
 * Per-row render for the group page. Each poll renders as an edge-to-edge
 * rectangle with a full-bleed bottom divider between rows. Memoized via
 * React.memo with a custom equality function that compares only the slices
 * of state Maps relevant to this row's question/sub-question/poll IDs — so
 * a vote on row A never re-renders rows B..N. Row-local handlers
 * (touch/click) live inside the component so they close over per-row props
 * instead of being re-created on every parent render.
 *
 * Tapping a row slides to the poll's detail page at
 * `/g/<group>/p/<pollShort>`; long-press still opens the FollowUpModal.
 * The swipe-to-abstain gesture and creator avatar were retired with the
 * card chrome — the avatar lives only on the poll detail page now.
 *
 * See CLAUDE.md → "Group-Page Layout Stability" for the rationale and the
 * subscription pattern used for high-frequency state.
 */

import * as React from "react";
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Poll, Question, QuestionResults } from "@/lib/types";
import type {
  UserYesNoVote,
} from "@/lib/useGroupVoting";
import {
  getCategoryIcon,
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
  relativeTime,
} from "@/lib/questionListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { slideToPollDetail } from "@/lib/slideOverlay";
import { groupScrollKey, rememberCurrentScroll } from "@/lib/scrollMemory";
import ClientOnly from "@/components/ClientOnly";
import QuestionResultsDisplay, {
  CompactRankedChoicePreview,
  CompactSuggestionPreview,
  CompactTimePreview,
  CompactSupplyPreview,
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

/** Shared between row bottom-borders, the placeholder height-reservation
 *  div, and the top-of-list sentinel divider in GroupPage. Keep all three
 *  in lockstep so adjacent dividers don't visually diverge. */
export const ROW_DIVIDER_CLASS = "border-gray-300 dark:border-gray-600";

export interface GroupCardItemProps {
  // Identity / data ---------------------------------------------------------
  group: GroupCardGroup;
  /** Group route id (groups.short_id / id), used when sliding to the
   *  poll's detail page. */
  groupRouteId: string;

  // Per-row primitives (computed in parent .map) --------------------------
  isPressed: boolean;
  isPlaceholder: boolean;
  isAwaiting: boolean;
  isClosed: boolean;
  isTooltipActive: boolean;

  // State Maps. Pass directly + custom equality slices per-row. ------------
  questionResultsMap: Map<string, QuestionResults>;
  userVoteMap: Map<string, UserYesNoVote>;

  // Refs (stable identity — no need to compare in equality fn) -------------
  longPressTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  isLongPressRef: MutableRefObject<boolean>;
  touchStartPosRef: MutableRefObject<{ x: number; y: number } | null>;
  isScrollingRef: MutableRefObject<boolean>;
  touchJustHandledRef: MutableRefObject<boolean>;

  // Stable callbacks/setters ------------------------------------------------
  attachCardEl: (el: HTMLElement, anchorId: string, groupKey: string) => void;
  detachCardEl: (anchorId: string) => void;
  setPressedQuestionId: Dispatch<SetStateAction<string | null>>;
  setTooltipQuestionId: Dispatch<SetStateAction<string | null>>;
  setModalQuestion: Dispatch<SetStateAction<Question | null>>;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  /** Gap 1 follow/ignore toggle. `next` is the state to write: 'old' (the ✕,
   *  ignore) or 'new' (the +, re-follow). Stable identity — not compared in
   *  arePropsEqual. The current state is read off `group.poll.viewer_follow_state`. */
  onToggleFollow: (pollId: string, next: "new" | "old") => void;
}

function GroupCardItemImpl(props: GroupCardItemProps) {
  const {
    group,
    groupRouteId,
    isPressed,
    isPlaceholder,
    isAwaiting,
    isClosed,
    isTooltipActive,
    questionResultsMap,
    userVoteMap,
    longPressTimerRef,
    isLongPressRef,
    touchStartPosRef,
    isScrollingRef,
    touchJustHandledRef,
    attachCardEl,
    detachCardEl,
    setPressedQuestionId,
    setTooltipQuestionId,
    setModalQuestion,
    setShowModal,
    onToggleFollow,
  } = props;

  const question = group.anchor;
  const isMultiGroup = group.subQuestions.length > 1;
  const wrapper = group.poll;
  // Gap 1: the viewer's follow/ignore state for this poll. 'old' = ✕'d
  // (filed in Old); anything else = followed.
  const followState: "new" | "old" =
    wrapper?.viewer_follow_state === "old" ? "old" : "new";

  // Wrapper-level reads (Phase 5b). Hoisted so every callsite below can use
  // them without re-deriving.
  const wrapperResponseDeadline = wrapper?.response_deadline ?? null;
  const wrapperPrephaseDeadline = wrapper?.prephase_deadline ?? null;
  const categoryIcon = getCategoryIcon(question);
  // Hoisted: every row reads this 1–3 times (status label, respondent
  // filter, respondent empty-text, includeSelf gate).
  const inSuggestionPhase = isInSuggestionPhase(question, wrapperPrephaseDeadline);

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
  // Tap navigates to the poll's detail page via the overlay-slide (same
  // mechanism as home→group, first frame moves on the next rAF). Long-press
  // still opens the follow-up modal.
  const navigateToDetail = () => {
    const pollShortId = wrapper?.short_id || question.id;
    // Save scroll BEFORE the navigation so back-nav restores here.
    rememberCurrentScroll(groupScrollKey(groupRouteId));
    slideToPollDetail({ groupId: groupRouteId, pollShortId });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    isLongPressRef.current = false;
    isScrollingRef.current = false;
    setPressedQuestionId(question.id);
    touchStartPosRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    longPressTimerRef.current = setTimeout(() => {
      if (!isScrollingRef.current) {
        isLongPressRef.current = true;
        haptic.medium();
        setModalQuestion(question);
        setShowModal(true);
        setPressedQuestionId(null);
      }
    }, 500);
  };

  const handleClick = () => {
    if (touchJustHandledRef.current) return;
    navigateToDetail();
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
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
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const dx = e.touches[0].clientX - touchStartPosRef.current.x;
    const dy = e.touches[0].clientY - touchStartPosRef.current.y;
    // Cancel long-press / pressed-state on significant motion (the user is
    // scrolling, not tapping).
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      isScrollingRef.current = true;
      setPressedQuestionId(null);
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

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
      // The row's title already shows the category icon; don't re-render
      // it inside the compact pill.
      return inSuggestions ? (
        <CompactSuggestionPreview results={r} />
      ) : (
        <CompactRankedChoicePreview results={r} isQuestionClosed={isClosed} />
      );
    }
    if (sp.question_type === "time" && r && !inTimeAvailability) {
      const hasPreview = (r.total_votes || 0) > 0 && !!r.winner;
      if (!hasPreview) return null;
      return <CompactTimePreview results={r} isQuestionClosed={isClosed} />;
    }
    if (sp.question_type === "limited_supply") {
      // Always show "N/M claimed" — falls back to the question's own
      // supply_count when no results have loaded (fresh poll, no votes).
      return (
        <CompactSupplyPreview
          results={r}
          supplyFallback={sp.supply_count}
          isQuestionClosed={isClosed}
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

  // Engagement counts. `views` (= viewed_total) shows in the bottom-LEFT after
  // author·date; `voted` + `suggestions` show in the bottom-RIGHT corner with
  // their phase countdowns. Counts only — viewer identities never leave the
  // API. No respondent bubbles on the group card (poll-detail-only).
  const respondedCount =
    (wrapper?.voter_names?.length ?? 0) + (wrapper?.anonymous_count ?? 0);
  const suggestionCount = wrapper?.suggestion_count ?? 0;
  const viewsCount = wrapper?.viewed_total ?? 0;
  const pluralize = (n: number) => (n === 1 ? "" : "s");

  // Bottom-right corner: a "{N} Suggestions: Xd" prephase part + a "{N} Votes:
  // Xd" voting part, separated by a bullet, then the nav chevron. Only the
  // trailing countdown is colored (blue for suggestions/availability, green
  // for votes) + bold; the label is muted gray. Visibility: suggestions show
  // only while their phase is active (drops once closed/cutoff); votes show
  // only once voting has opened.
  const now = Date.now();
  const inTimeAvailability = isInTimeAvailabilityPhase(question);
  const notOpenYet = inSuggestionPhase || inTimeAvailability; // voting not open
  const prephaseFuture =
    !!wrapperPrephaseDeadline && new Date(wrapperPrephaseDeadline).getTime() > now;
  const votingFuture =
    !!wrapperResponseDeadline && new Date(wrapperResponseDeadline).getTime() > now;

  // Only the timer is colored (+ bold); the "N Suggestions" / "N Votes"
  // label stays the muted metadata gray. Format: "<label>: <bold timer>".
  const countdownSuffix = (deadline: string, colorClass: string) => (
    <>
      {": "}
      <SimpleCountdown deadline={deadline} wide colorClass={colorClass} numberClass="font-bold" />
    </>
  );
  // Muted-gray "{label}{timer}" span (only the timer suffix is colored+bold).
  const metaPart = (label: React.ReactNode, timer: React.ReactNode = null) => (
    <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">
      {label}
      {timer}
    </span>
  );

  // The prephase (suggestions/availability) part shows ONLY while that phase is
  // ACTIVE — `inSuggestionPhase` / `inTimeAvailability` both go false once it
  // closes (cutoff / deadline) or the poll closes, so it drops out and the
  // votes part takes over. `inSuggestionPhase` already implies the prephase
  // deadline is in the future, so its timer is unconditional; the availability
  // branch isn't deadline-gated, so it still checks `prephaseFuture`.
  const BLUE = "text-blue-600 dark:text-blue-400";
  let prephasePart: React.ReactNode = null;
  if (!isClosed) {
    if (inSuggestionPhase) {
      prephasePart = metaPart(
        `${suggestionCount} Suggestion${pluralize(suggestionCount)}`,
        countdownSuffix(wrapperPrephaseDeadline!, BLUE),
      );
    } else if (inTimeAvailability) {
      prephasePart = metaPart(
        "Availability",
        prephaseFuture ? countdownSuffix(wrapperPrephaseDeadline!, BLUE) : null,
      );
    }
  }

  let votesPart: React.ReactNode = null;
  if (!notOpenYet) {
    votesPart = metaPart(
      `${respondedCount} Vote${pluralize(respondedCount)}`,
      !isClosed && votingFuture
        ? countdownSuffix(wrapperResponseDeadline!, "text-green-600 dark:text-green-400")
        : null,
    );
  }

  const chevronGlyph = (
    <svg
      className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );

  const cornerCluster: React.ReactNode = (
    <div className="shrink-0 flex items-center gap-1.5 text-xs whitespace-nowrap">
      {prephasePart}
      {prephasePart && votesPart && (
        <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">&bull;</span>
      )}
      {votesPart}
      {chevronGlyph}
    </div>
  );

  // Edge-to-edge rectangle with a full-bleed `border-b` divider between
  // rows. The awaiting state surfaces as a left-edge amber bar (the old
  // rounded-card amber border doesn't translate to a row layout) so users
  // still see "this poll wants your input" at a glance.
  return (
    <div
      ref={setCardEl}
      className={`relative border-b-2 ${ROW_DIVIDER_CLASS} ${
        isPlaceholder ? "card-pending-enter" : ""
      }`}
    >
      {isAwaiting && !isPlaceholder && (
        <span
          className="absolute inset-y-0 left-0 w-1 bg-amber-400 dark:bg-amber-500"
          aria-hidden="true"
        />
      )}
      <div
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className={`pl-[0.9rem] pr-[0.65rem] pt-[7px] pb-1 cursor-pointer transition-colors select-none ${
          isPressed
            ? "bg-blue-100 dark:bg-blue-900/40"
            : "bg-transparent"
        } hover:bg-gray-100 dark:hover:bg-gray-900 active:bg-blue-100 dark:active:bg-blue-900/40`}
      >
        {/* Top row: icon + title, plus the follow/ignore toggle on the right.
            The status countdown + nav chevron moved to the bottom-right (see
            the metadata row below). */}
        <div className="flex items-start min-w-0">
          <h3 className="flex-1 min-w-0 flex items-start font-medium text-lg leading-tight text-gray-900 dark:text-white">
            <span className="mr-1.5 shrink-0" aria-hidden="true">{categoryIcon}</span>
            <span className="min-w-0">{question.title}</span>
          </h3>
          {!isPlaceholder && group.pollId && (
            <button
              type="button"
              aria-label={followState === "old" ? "Follow this poll" : "Ignore this poll"}
              // Stop the tap/long-press/scroll handlers on the row from firing
              // so toggling follow never navigates or opens the action modal.
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                haptic.light();
                onToggleFollow(group.pollId!, followState === "old" ? "new" : "old");
              }}
              className="shrink-0 -mt-1 -mr-1 ml-1 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-90 transition"
            >
              {followState === "old" ? (
                // green + (re-follow) — canonical plus path (matches PlusOnesInput etc.)
                <svg className="w-5 h-5 text-green-600 dark:text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
              ) : (
                // red ✕ (ignore) — canonical X path (matches GroupList / SignInModal etc.)
                <svg className="w-5 h-5 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Pill row: centered across the FULL rectangle width (not just
            the right column). Renders only when there's a non-empty
            pill so empty groups don't leave a stray gap.
            `transform: scale(1.4)` enlarges the pill (font, padding,
            badges) proportionally by 40%. We tried CSS `zoom` first but
            it didn't render in WebKit even on a fresh browser load —
            switched to `transform` which is universally supported with
            no quirks. The downside is `transform` doesn't reflow, so we
            absorb the ~20% visual overflow with explicit `py-2` on the
            outer flex container — that gives the pill ~8px on top and
            ~8px below to expand into without colliding with the title
            row above or the author/respondents row below. */}
        {!isPlaceholder && pillEl && (
          <div className="mt-1 mb-2 py-2 flex justify-center min-w-0">
            <div
              style={{
                transform: "scale(1.4)",
                transformOrigin: "center",
              }}
            >
              {pillEl}
            </div>
          </div>
        )}

        {/* Bottom row: author · date (left) + the corner cluster (right)
            holding the voted/suggestions emoji counts + status countdown + nav
            chevron. TEMP: 3 corner arrangements via ?variant=a|b|c (see
            cornerCluster above). The author name is the only truncating part;
            the date keeps its hover/tap tooltip. The "seen" stat + respondent
            bubbles live only on the poll detail page now. Skipped during the
            placeholder/FLIP phase. */}
        {!isPlaceholder && (
          <div className={`${pillEl ? "" : "mt-2 "}flex items-center justify-between gap-2 min-w-0`}>
            <ClientOnly fallback={null}>
              <div className="flex items-baseline min-w-0 text-xs text-gray-400 dark:text-gray-500">
                {wrapper?.creator_name && (
                  <>
                    <span className="truncate shrink min-w-0">{wrapper.creator_name}</span>
                    <span className="shrink-0">&nbsp;&middot;&nbsp;</span>
                  </>
                )}
                <span
                  className="shrink-0 relative cursor-help"
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
                <span className="shrink-0 whitespace-nowrap">
                  &nbsp;&middot;&nbsp;{viewsCount} View{pluralize(viewsCount)}
                </span>
              </div>
            </ClientOnly>
            {cornerCluster}
          </div>
        )}
      </div>
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

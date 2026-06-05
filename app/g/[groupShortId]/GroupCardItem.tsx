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
 * Swiping a row LEFT past a threshold toggles the viewer's follow state
 * (New↔Old) — it replaced the inline ✕/+ button. The legacy
 * swipe-to-abstain gesture and creator avatar were retired with the card
 * chrome — the avatar lives only on the poll detail page now.
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
import type { PollTab } from "@/lib/followState";
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

/** Swipe-left-to-toggle-follow geometry. A leftward drag past
 *  SWIPE_TOGGLE_THRESHOLD flips the poll between New and Old (replaces the
 *  inline ✕/+ button). Clamped to SWIPE_MAX so the card can't be yanked off
 *  the screen. Leftward only (dx ≤ 0) so it never collides with the page's
 *  rightward swipe-back gesture (`useSwipeBackGesture` ignores dx ≤ 0). */
const SWIPE_TOGGLE_THRESHOLD = 75;
const SWIPE_MAX = 130;

/** Per-swipe-action backdrop chrome (red Ignore / green Follow / gold Abstain).
 *  Static lookup hoisted to module scope so it isn't re-allocated per render of
 *  every poll row. `active` = past the commit threshold; `idle` = below it. */
const SWIPE_ACTION_UI: Record<
  "ignore" | "refollow" | "abstain",
  { active: string; idle: string; label: string; path: string }
> = {
  ignore: {
    active: "bg-red-500 text-white",
    idle: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
    label: "Ignore",
    path: "M6 18L18 6M6 6l12 12",
  },
  refollow: {
    active: "bg-green-600 text-white",
    idle: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    label: "Follow",
    path: "M12 4v16m8-8H4",
  },
  abstain: {
    active: "bg-amber-500 text-white",
    idle: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    label: "Abstain",
    path: "M20 12H4",
  },
};

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
  /** Followed + still needs the viewer's input → swipe abstains (gold)
   *  instead of ignoring (red). */
  isTodo: boolean;
  /** The currently-selected tab. Used to decide whether a swipe-commit
   *  removes this card from view (→ slide-out exit animation) or leaves it
   *  in place (→ snap back). */
  effectiveTab: PollTab;
  /** Whether the viewer has a usable name. A swipe-to-abstain on a nameless
   *  viewer opens the account gate instead of voting, so the card must NOT
   *  play the exit animation in that case. */
  nameReady: boolean;

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
  /** Gap 1 follow/ignore toggle. `next` is the state to write: 'old' (ignore)
   *  or 'new' (re-follow). Stable identity — not compared in arePropsEqual.
   *  The current state is read off `group.poll.viewer_follow_state`. */
  onToggleFollow: (pollId: string, next: "new" | "old") => void;
  /** Swipe-to-abstain a To Do poll (abstains every still-unanswered
   *  sub-question). Stable identity. Name-gates internally. */
  onAbstain: (pollId: string, subQuestions: Question[]) => void;
}

/** Horizontal left→right arrow drawn in the gap between title and result on
 *  the one-line layout. */
function HorizontalArrow({ className }: { className?: string }) {
  return (
    <svg
      className={`text-gray-400 dark:text-gray-500 ${className ?? ""}`}
      width="26"
      height="14"
      viewBox="0 0 26 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 7 H23 M17 2 L23 7 L17 12" />
    </svg>
  );
}

/** Bent ↳ arrow (down, then 90° turn to the right) drawn just left of the
 *  first result line on the wrapped layout. */
function BentArrow({ className }: { className?: string }) {
  return (
    <svg
      className={`text-gray-400 dark:text-gray-500 ${className ?? ""}`}
      width="15"
      height="19"
      viewBox="0 0 15 19"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 1 V12 H12 M8 8 L12 12 L8 16" />
    </svg>
  );
}

/**
 * Title + result-preview layout for a poll row.
 *
 *  - No result          → plain title at full width.
 *  - 1 result that fits the whole row → ONE LINE: title left, result pushed
 *    right with a horizontal → arrow immediately before it.
 *  - 1 result that fits on the LAST wrapped line of the title → inline on that
 *    line, trailing the title with a horizontal → arrow.
 *  - 1 result that doesn't fit on the last line, OR multiple results → BELOW:
 *    title wraps at ≤90% card width; result(s) drop below it, right-justified
 *    within the right 80%, with a bent ↳ arrow before the first.
 *
 * The mode is measured against hidden clones in a useLayoutEffect (flush-
 * before-paint, so no flash) + a ResizeObserver for width changes:
 *   - a nowrap clone → does it all fit on ONE line? (oneline)
 *   - title-only vs title+arrow+result, both wrapping at full width → does the
 *     result add a line? if not, it fit on the last line (lastline) else below.
 */
type ResultRowMode = "oneline" | "lastline" | "below";

function TitleResultRow({
  icon,
  title,
  results,
}: {
  icon: React.ReactNode;
  title: string;
  results: { id: string; node: React.ReactNode }[];
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fitRef = React.useRef<HTMLDivElement>(null); // nowrap one-line probe
  const titleMeasRef = React.useRef<HTMLDivElement>(null); // title only, wraps
  const inlineMeasRef = React.useRef<HTMLDivElement>(null); // title+→+result, wraps
  const [mode, setMode] = React.useState<ResultRowMode>("below");
  // Only a single result is ever an inline candidate; multiple results always
  // wrap below the title.
  const single = results.length === 1;

  const evaluate = React.useCallback(() => {
    if (!single) {
      setMode("below");
      return;
    }
    const c = containerRef.current;
    const fit = fitRef.current;
    const tm = titleMeasRef.current;
    const im = inlineMeasRef.current;
    if (!c || !fit || !tm || !im) return;
    // 1px slack absorbs sub-pixel rounding.
    if (fit.scrollWidth <= c.clientWidth + 1) {
      setMode("oneline");
    } else if (im.offsetHeight <= tm.offsetHeight + 1) {
      // The result didn't add a line → it fits on the title's last line.
      setMode("lastline");
    } else {
      setMode("below");
    }
  }, [single]);

  // Measure before paint on every render (content can change the natural
  // widths/heights). Cheap: a few layout reads + a guarded setState.
  React.useLayoutEffect(() => {
    evaluate();
  });

  // Re-measure on width changes.
  React.useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => evaluate());
    ro.observe(c);
    return () => ro.disconnect();
  }, [evaluate]);

  const titleInner = (
    <>
      <span className="mr-1.5 shrink-0" aria-hidden="true">{icon}</span>
      <span className="min-w-0">{title}</span>
    </>
  );

  // The title + → + result rendered as a single inline flow (used for both the
  // hidden full-width measurer and the visible "lastline" layout). The arrow +
  // result are kept together as one inline-block unit so they wrap onto the
  // last line as a whole rather than splitting.
  const inlineTitleResult = (
    <h3
      className="font-medium text-lg leading-tight text-gray-900 dark:text-white"
      style={{ maxWidth: "90%" }}
    >
      <span className="mr-1.5" aria-hidden="true">{icon}</span>
      {title}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold align-middle">
        <HorizontalArrow className="ml-1.5 inline-block align-middle" />
        {results[0]?.node}
      </span>
    </h3>
  );

  if (results.length === 0) {
    return (
      <div ref={containerRef} className="min-w-0">
        <h3 className="flex items-start font-medium text-lg leading-tight text-gray-900 dark:text-white">
          {titleInner}
        </h3>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-w-0">
      {/* Hidden measurers (single result only). */}
      {single && (
        <>
          {/* Nowrap one-line probe: scrollWidth = natural single-line width. */}
          <div
            ref={fitRef}
            aria-hidden="true"
            className="invisible absolute left-0 top-0 flex items-center whitespace-nowrap font-medium text-lg leading-tight"
            style={{ pointerEvents: "none" }}
          >
            <span className="mr-1.5">{icon}</span>
            <span>{title}</span>
            <HorizontalArrow className="mx-2" />
            <span className="font-semibold">{results[0].node}</span>
          </div>
          {/* Title-only, wrapping at the 90% title width. */}
          <div
            ref={titleMeasRef}
            aria-hidden="true"
            className="invisible absolute left-0 top-0 font-medium text-lg leading-tight"
            style={{ pointerEvents: "none", maxWidth: "90%" }}
          >
            <span className="mr-1.5">{icon}</span>
            {title}
          </div>
          {/* Title + → + result inline (h3 caps at 90%), wrapping. */}
          <div
            ref={inlineMeasRef}
            aria-hidden="true"
            className="invisible absolute left-0 top-0 w-full"
            style={{ pointerEvents: "none" }}
          >
            {inlineTitleResult}
          </div>
        </>
      )}

      {single && mode === "oneline" ? (
        // One line: title left, then the result pushed right with the
        // horizontal arrow immediately before it.
        <div className="flex items-center min-w-0">
          <h3 className="flex items-center font-medium text-lg leading-tight text-gray-900 dark:text-white whitespace-nowrap">
            {titleInner}
          </h3>
          <div className="flex-1 min-w-0" />
          <div className="shrink-0 flex items-center gap-1.5 text-lg leading-tight whitespace-nowrap font-semibold">
            <HorizontalArrow />
            <span>{results[0].node}</span>
          </div>
        </div>
      ) : single && mode === "lastline" ? (
        // Result fits on the title's last wrapped line: title in the left
        // column (wraps with a hanging indent so continuation lines align under
        // the first line's text), result bottom-aligned to that last line at
        // the right edge (right-justified) with the → arrow just in front.
        <div className="flex items-end min-w-0">
          <h3 className="flex-1 min-w-0 flex items-start font-medium text-lg leading-tight text-gray-900 dark:text-white">
            {titleInner}
          </h3>
          <div className="shrink-0 flex items-center gap-1.5 pl-2 text-lg leading-tight whitespace-nowrap font-semibold">
            <HorizontalArrow />
            <span>{results[0].node}</span>
          </div>
        </div>
      ) : (
        // Below: title ≤90% wide; result(s) below, right-justified within the
        // right 80%, with a bent ↳ arrow before the first result line.
        <div>
          <h3
            className="flex items-start font-medium text-lg leading-tight text-gray-900 dark:text-white"
            style={{ maxWidth: "90%" }}
          >
            {titleInner}
          </h3>
          <div className="mt-1 flex justify-end">
            <div className="flex flex-col items-end gap-0.5 text-right" style={{ maxWidth: "80%" }}>
              {results.map((res, i) => (
                <div
                  key={res.id}
                  className="flex items-start gap-1 max-w-full text-lg leading-tight text-right"
                >
                  {i === 0 && <BentArrow className="shrink-0 mt-px" />}
                  <div className="min-w-0">{res.node}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
    isTodo,
    effectiveTab,
    nameReady,
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
    onAbstain,
  } = props;

  const question = group.anchor;
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

  // Swipe-left-to-toggle-follow state (replaces the inline ✕/+ button).
  // `dragX` (≤ 0) is the live leftward offset of the row content; the action
  // backdrop is revealed in the gap on the right. `dragXRef` mirrors it so
  // handleTouchEnd reads the final offset without a stale closure. `axisRef`
  // locks the gesture to horizontal vs vertical on first significant motion;
  // `swipingRef` gates the commit + suppresses the tap-navigate in touchEnd;
  // `crossedRef` fires the threshold haptic exactly once per crossing.
  const [dragX, setDragX] = React.useState(0);
  const [snapping, setSnapping] = React.useState(false);
  // Commit exit: slide the row fully left + collapse its height to 0 so the
  // cards below animate up to fill the gap; the actual mutation fires on the
  // collapse's transitionEnd, after which the card unmounts (already at 0
  // height / off-screen, so no visible pop).
  const [exiting, setExiting] = React.useState(false);
  const dragXRef = React.useRef(0);
  const axisRef = React.useRef<null | "h" | "v">(null);
  const swipingRef = React.useRef(false);
  const crossedRef = React.useRef(false);
  const swipePastThreshold = dragX <= -SWIPE_TOGGLE_THRESHOLD;

  // What a left-swipe does, by the row's current state:
  //   Old           → re-follow (green "Follow")
  //   To Do         → abstain   (gold "Abstain")
  //   New, non-todo → ignore    (red "Ignore")
  const swipeAction: "refollow" | "abstain" | "ignore" =
    followState === "old" ? "refollow" : isTodo ? "abstain" : "ignore";
  // Does committing remove this card from the CURRENT tab (→ play the slide-out
  // exit)? Ignore/re-follow always cross New↔Old (always a tab change from the
  // current todo/new/old view). Abstain only leaves the To Do tab — on the New
  // tab the card stays (still followed, just now responded), so no exit there.
  const swipeWillExit = swipeAction === "abstain" ? effectiveTab !== "new" : true;
  // The slide-out only plays when the commit will actually proceed. A nameless
  // abstain opens the account gate instead, so the card snaps back rather than
  // collapsing into nothing while the modal is up.
  const swipeCanExit = swipeWillExit && (swipeAction !== "abstain" || nameReady);

  // Fire the committed swipe action (used both for the no-exit path and from
  // the exit-collapse transitionEnd).
  const commitSwipe = () => {
    if (!group.pollId) return;
    if (swipeAction === "abstain") {
      onAbstain(group.pollId, group.subQuestions);
    } else {
      onToggleFollow(group.pollId, swipeAction === "refollow" ? "new" : "old");
    }
  };

  // Animate the content back to rest. Only animate when there's an offset to
  // return from; otherwise no transform transition fires and `snapping` would
  // never be cleared by onTransitionEnd (it would strand a live layer).
  const snapBack = () => {
    if (dragXRef.current !== 0) {
      setSnapping(true);
      setDragX(0);
      dragXRef.current = 0;
    }
  };

  // The slide-out collapse finished (grid-template-rows hit 0fr) → run the
  // mutation. The card then leaves the current tab and unmounts (it's already
  // collapsed + off-screen, so no pop). Guard on the property so the content's
  // own transform transitionEnd (which bubbles here) doesn't double-fire.
  const handleExitEnd = (e: React.TransitionEvent) => {
    if (e.propertyName !== "grid-template-rows") return;
    commitSwipe();
  };

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
    if (exiting) return; // already committing — ignore further touches
    isLongPressRef.current = false;
    isScrollingRef.current = false;
    axisRef.current = null;
    swipingRef.current = false;
    crossedRef.current = false;
    setSnapping(false);
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
    if (swipingRef.current) {
      // A horizontal swipe — never navigate. Commit when the drag crossed the
      // threshold.
      const shouldCommit = dragXRef.current <= -SWIPE_TOGGLE_THRESHOLD;
      if (shouldCommit && group.pollId) {
        haptic.medium();
        if (swipeCanExit) {
          // Slide-out + height-collapse; commitSwipe fires on transitionEnd.
          setExiting(true);
        } else {
          // No exit (abstain on the New tab, or nameless → gate). Fire now and
          // snap the content back.
          commitSwipe();
          snapBack();
        }
      } else {
        // Didn't cross the threshold — snap back, no commit.
        snapBack();
      }
      setPressedQuestionId(null);
    } else if (!isScrollingRef.current && !isLongPressRef.current) {
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
    swipingRef.current = false;
    axisRef.current = null;
    crossedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const dx = e.touches[0].clientX - touchStartPosRef.current.x;
    const dy = e.touches[0].clientY - touchStartPosRef.current.y;
    // Lock the gesture axis on first significant motion (>8px). Once locked,
    // it's no longer a tap — cancel long-press + pressed state.
    if (axisRef.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      } else {
        return;
      }
    }
    isScrollingRef.current = true;
    setPressedQuestionId(null);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    // Horizontal, leftward only, on a real poll row → drive the swipe.
    if (axisRef.current === "h" && !isPlaceholder && group.pollId) {
      swipingRef.current = true;
      const offset = Math.max(-SWIPE_MAX, Math.min(0, dx));
      dragXRef.current = offset;
      setDragX(offset);
      const crossed = offset <= -SWIPE_TOGGLE_THRESHOLD;
      if (crossed && !crossedRef.current) haptic.light();
      crossedRef.current = crossed;
    }
  };

  // Returns the type-specific "result preview" as BUBBLE-LESS text (no pill
  // chrome) at the inherited title font size, or null when there's nothing to
  // show yet. The card lays title + result out on one line (or wrapped) with a
  // connecting arrow — see TitleResultRow. Cards are navigation-only; taps fall
  // through to the card click handler that slides to the detail page.
  const plainResultForQuestion = (sp: Question): React.ReactNode => {
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
          plain={true}
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
        <CompactSuggestionPreview results={r} plain />
      ) : (
        <CompactRankedChoicePreview results={r} isQuestionClosed={isClosed} plain />
      );
    }
    if (sp.question_type === "time" && r && !inTimeAvailability) {
      const hasPreview = (r.total_votes || 0) > 0 && !!r.winner;
      if (!hasPreview) return null;
      return <CompactTimePreview results={r} isQuestionClosed={isClosed} plain />;
    }
    if (sp.question_type === "limited_supply") {
      // Always show "N/M claimed" — falls back to the question's own
      // supply_count when no results have loaded (fresh poll, no votes).
      return (
        <CompactSupplyPreview
          results={r}
          supplyFallback={sp.supply_count}
          isQuestionClosed={isClosed}
          plain
        />
      );
    }
    return null;
  };

  // One result entry per sub-question that has something to show. Single-
  // question polls yield 0 or 1; multi-question polls can yield several.
  const resultEntries: { id: string; node: React.ReactNode }[] = [];
  if (!isPlaceholder) {
    for (const sp of group.subQuestions) {
      const node = plainResultForQuestion(sp);
      if (node) resultEntries.push({ id: sp.id, node });
    }
  }
  const hasResult = resultEntries.length > 0;

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

  // Whether the row is actively sliding (drag in progress OR committing exit).
  // While sliding, the content background is forced neutral (no hover / active
  // / pressed tint) so ONLY the exposed action strip lights up — not the whole
  // row.
  const swiping = dragX !== 0 || exiting;
  const swipeActionUI = SWIPE_ACTION_UI[swipeAction];

  // Edge-to-edge rectangle with a full-bleed `border-b` divider between rows.
  // The awaiting state surfaces as a left-edge amber bar. On commit the whole
  // card collapses its height to 0 (outer grid `1fr → 0fr`) so the rows below
  // animate up to fill the gap; the visual rectangle lives one level in so its
  // border collapses with it.
  return (
    <div
      ref={setCardEl}
      onTransitionEnd={handleExitEnd}
      className="grid"
      style={{
        gridTemplateRows: exiting ? "0fr" : "1fr",
        // Always-on (NOT conditional): a conditional transition that's added in
        // the same commit as the 1fr→0fr change can fail to start, snapping the
        // collapse instantly instead of animating the rows below up. Keeping it
        // declared is cheap — grid-template-rows isn't a composited property, so
        // a stationary row pays nothing for the idle transition. Verified: with
        // this form the collapse animates; the conditional form snapped.
        transition: "grid-template-rows 240ms ease",
      }}
    >
      {/* Collapsing inner track. `min-h-0` lets the grid row shrink below the
          content's min-content; `overflow-hidden` (ONLY while exiting) clips
          the over-tall content during the collapse — left off at rest so the
          date tooltip (which overflows above the row) isn't clipped. */}
      <div className={`min-h-0 ${exiting ? "overflow-hidden" : ""}`}>
        <div
          className={`relative overflow-x-clip border-b-2 ${ROW_DIVIDER_CLASS} ${
            isPlaceholder ? "card-pending-enter" : ""
          }`}
        >
          {/* Swipe-left action backdrop. Its width tracks the EXPOSED strip
              exactly (`width = -dragX`, right-anchored) so only the revealed
              area lights up; on commit it fills the row as the content slides
              off. Right-aligned icon + label emerge from the right edge.
              Saturates + flips to white once past the commit threshold. z-0:
              behind the content (z-10) and the amber bar (z-20). */}
          {(dragX < 0 || exiting) && !isPlaceholder && group.pollId && (
            <div
              aria-hidden="true"
              style={{ width: exiting ? "100%" : `${Math.min(-dragX, SWIPE_MAX)}px` }}
              className={`absolute inset-y-0 right-0 z-0 flex items-center justify-end gap-1.5 pr-6 text-sm font-semibold transition-colors ${
                swipePastThreshold || exiting ? swipeActionUI.active : swipeActionUI.idle
              }`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={swipeActionUI.path} />
              </svg>
              <span>{swipeActionUI.label}</span>
            </div>
          )}
          {isAwaiting && !isPlaceholder && (
            <span
              className="absolute inset-y-0 left-0 z-20 w-1 bg-amber-400 dark:bg-amber-500"
              aria-hidden="true"
            />
          )}
          <div
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            // Clear `snapping` once the snap-back finishes so the row stops being
            // a composited layer at rest. Guard on propertyName so the bg
            // `transition-colors` transitionend doesn't reset it mid-snap.
            onTransitionEnd={(e) => {
              if (e.propertyName === "transform") setSnapping(false);
            }}
            style={{
              transform: exiting
                ? "translateX(-100%)"
                : dragX !== 0 || snapping
                  ? `translateX(${dragX}px)`
                  : undefined,
              transition: exiting
                ? "transform 240ms ease"
                : snapping
                  ? "transform 200ms ease-out"
                  : undefined,
              touchAction: "pan-y",
            }}
            className={`relative z-10 pl-[0.9rem] pr-[0.65rem] pt-[7px] pb-1 cursor-pointer transition-colors select-none ${
              swiping
                ? "bg-background"
                : isPressed
                  ? "bg-blue-100 dark:bg-blue-900/40"
                  : "bg-background"
            } ${swiping ? "" : "hover:bg-gray-100 dark:hover:bg-gray-900 active:bg-blue-100 dark:active:bg-blue-900/40"}`}
          >
        {/* Title + result preview. When both fit on one line they share a
            row (title left, result right) with a horizontal arrow between
            them; otherwise the title wraps (≤80% wide) and the result drops
            below it, right-justified (≤75% wide) behind a bent ↳ arrow. The
            follow/ignore toggle is a left-swipe (see the swipe handlers +
            action backdrop above); the status countdown + nav chevron live in
            the bottom-right metadata row below. */}
        <TitleResultRow
          icon={categoryIcon}
          title={question.title}
          results={resultEntries}
        />

        {/* Bottom row: author · date (left) + the corner cluster (right)
            holding the voted/suggestions emoji counts + status countdown + nav
            chevron. TEMP: 3 corner arrangements via ?variant=a|b|c (see
            cornerCluster above). The author name is the only truncating part;
            the date keeps its hover/tap tooltip. The "seen" stat + respondent
            bubbles live only on the poll detail page now. Skipped during the
            placeholder/FLIP phase. */}
        {!isPlaceholder && (
          <div className={`${hasResult ? "mt-1.5 " : "mt-2 "}flex items-center justify-between gap-2 min-w-0`}>
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
    prev.isTodo !== next.isTodo ||
    prev.effectiveTab !== next.effectiveTab ||
    prev.nameReady !== next.nameReady ||
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

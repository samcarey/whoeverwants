"use client";

import { useEffect, useLayoutEffect, useState, useRef, useMemo, Suspense } from "react";
import { flushSync, createPortal } from "react-dom";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Question } from "@/lib/types";
import { getAccessiblePolls } from "@/lib/simpleQuestionQueries";
import { discoverRelatedQuestions } from "@/lib/questionDiscovery";
import { buildThreadFromPollDown, buildThreadSyncFromCache, buildPollMap, findThreadRootRouteId, pollHasAwaitingQuestion, THREAD_QUERY_PARAM } from "@/lib/threadUtils";
import { apiGetQuestionById, apiGetQuestionByShortId, apiGetQuestionResults, apiGetVotes, apiClosePoll, apiReopenPoll, apiCutoffPollAvailability, apiGetPollById, apiGetPollByShortId, ApiError, QUESTION_VOTES_CHANGED_EVENT } from "@/lib/api";
import type { Poll } from "@/lib/types";
import { useThreadVoting, type PreparedNonYesNoEntry } from "@/lib/useThreadVoting";
import { getUserName } from "@/lib/userProfile";
import CompactNameField from "@/components/CompactNameField";
import type { QuestionResults } from "@/lib/types";
import { addAccessibleQuestionId, getAccessibleQuestionIds, getCreatorSecret } from "@/lib/browserQuestionAccess";
import { getCachedQuestionById, getCachedQuestionByShortId, getCachedAccessiblePolls, getCachedPollById, getCachedPollByShortId } from "@/lib/questionCache";
import {
  POLL_PENDING_EVENT,
  POLL_HYDRATED_EVENT,
  POLL_FAILED_EVENT,
  type PollPendingDetail,
  type PollHydratedDetail,
} from "@/lib/eventChannels";
import { isUuidLike } from "@/lib/questionId";
import { DRAFT_POLL_PORTAL_ID, THREAD_LATEST_QUESTION_ID_ATTR } from "@/lib/threadDomMarkers";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { getCategoryIcon, relativeTime, isInSuggestionPhase, isInTimeAvailabilityPhase, compactDurationSince } from "@/lib/questionListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { loadVotedQuestions, getStoredVoteId, parseYesNoChoice } from "@/lib/votedQuestionsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition } from "@/lib/viewTransitions";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import VoterList from "@/components/VoterList";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import type { ApiVote } from "@/lib/api";
import QuestionBallot, { type QuestionBallotHandle } from "@/components/QuestionBallot";
import QuestionResultsDisplay, { CompactRankedChoicePreview, CompactSuggestionPreview, CompactTimePreview } from "@/components/QuestionResults";
import SimpleCountdown from "@/components/SimpleCountdown";
import ThreadHeader from "@/components/ThreadHeader";
import { forgetQuestion } from "@/lib/forgetQuestion";
import { PENDING_ACTION_COPY, type PendingActionKind } from "./threadActionCopy";

import type { Thread } from "@/lib/threadUtils";

// Stable filter: votes submitted during the suggestion phase (gave suggestions
// or fully abstained from suggestions). Declared at module scope so VoterList
// doesn't re-run its effect on every parent render.
const suggestionPhaseRespondentFilter = (v: ApiVote) =>
  !!(v.suggestions && v.suggestions.length > 0) || !!v.is_abstain;

// Default placeholder height for not-yet-measured groups in the virtualized
// thread list. Tuned to typical compact yes_no card height; the ResizeObserver
// replaces this with the measured value as soon as a group has been mounted
// once. Subsequent unmounts use the measured height, so unmount→remount cycles
// don't shift the document layout.
const ESTIMATED_GROUP_HEIGHT = 110;

const SCROLL_HELPER_BUTTON_CLASS =
  'fixed left-1/2 -translate-x-1/2 z-40 w-[2.475rem] h-[2.475rem] rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md flex items-center justify-center transition-opacity';

function ScrollHelperButton({
  direction,
  onClick,
  style,
  ...rest
}: {
  direction: 'up' | 'down';
  onClick: () => void;
  style: React.CSSProperties;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'style' | 'type' | 'className'>) {
  const path = direction === 'up' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7';
  return (
    <button type="button" onClick={onClick} className={SCROLL_HELPER_BUTTON_CLASS} style={style} {...rest}>
      <svg className="w-[1.35rem] h-[1.35rem]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  );
}

// Inverse grid-rows clip for compact pills in the thread card header:
// full height when collapsed, 0 when expanded, animating in lockstep
// with the heavy-content expand clip below. The pill sits directly at the
// top of the overflow-hidden child so its text center aligns with the
// sibling status text via the parent flex row's items-center.
// Shared cache-driven Thread rebuild for POLL_HYDRATED / POLL_FAILED setThread
// updaters. Returns prev when the rebuild would produce the same poll-id
// sequence (no placeholder swap) so identity-based memos stay stable.
function rebuildThreadFromCacheOrPrev(prev: Thread): Thread {
  if (!prev.rootPollId) return prev;
  const allPolls = getCachedAccessiblePolls() ?? [];
  const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
  const rebuilt = buildThreadFromPollDown(prev.rootPollId, allPolls, voted, abstained);
  if (!rebuilt) return prev;
  if (
    rebuilt.polls.length === prev.polls.length &&
    rebuilt.polls.every((p, i) => p.id === prev.polls[i].id)
  ) {
    return prev;
  }
  return rebuilt;
}

function CompactPreviewClip({ isExpanded, children }: { isExpanded: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${isExpanded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
      aria-hidden={isExpanded}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

interface ThreadContentProps {
  threadId: string;
  initialExpandedQuestionId?: string | null;
}

export function ThreadContent({ threadId, initialExpandedQuestionId = null }: ThreadContentProps) {
  const router = useRouter();
  const { prefetchBatch } = usePrefetch();

  // Initialize voted/abstained sets + thread synchronously from cached data
  // on first render, so the page mounts with full content (no loading flash
  // during view transition slide).
  const [{ thread: initialThread, votedQuestionIds: initialVoted, abstainedQuestionIds: initialAbstained }] = useState(() => {
    if (typeof window === 'undefined') {
      return { thread: null as Thread | null, votedQuestionIds: new Set<string>(), abstainedQuestionIds: new Set<string>() };
    }
    const voted = loadVotedQuestions();
    return {
      thread: buildThreadSyncFromCache(threadId, voted.votedQuestionIds, voted.abstainedQuestionIds),
      votedQuestionIds: voted.votedQuestionIds,
      abstainedQuestionIds: voted.abstainedQuestionIds,
    };
  });

  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(initialVoted);
  const [abstainedQuestionIds, setAbstainedQuestionIds] = useState<Set<string>>(initialAbstained);
  const [thread, setThread] = useState<Thread | null>(initialThread);
  const [loading, setLoading] = useState(!initialThread);
  const [error, setError] = useState(false);

  // Phase 5b: poll-level mutations (close/reopen/cutoff) update the
  // polls array; question mutations (forget) update the questions array.
  const patchThreadPolls = useRef(
    (predicate: (mp: Poll) => boolean, patcher: (mp: Poll) => Partial<Poll>) => {
      setThread((prev) => {
        if (!prev) return prev;
        if (!prev.polls.some(predicate)) return prev;
        return {
          ...prev,
          polls: prev.polls.map((mp) => (predicate(mp) ? { ...mp, ...patcher(mp) } : mp)),
        };
      });
    },
  ).current;
  const patchThreadQuestions = useRef(
    (predicate: (p: Question) => boolean, patcher: (p: Question) => Partial<Question>) => {
      setThread((prev) => {
        if (!prev) return prev;
        if (!prev.questions.some(predicate)) return prev;
        return {
          ...prev,
          questions: prev.questions.map((p) => (predicate(p) ? { ...p, ...patcher(p) } : p)),
        };
      });
    },
  ).current;

  // Set data attribute on body so the bottom bar "+" button can auto-follow-up
  useEffect(() => {
    if (thread) {
      document.body.setAttribute(THREAD_LATEST_QUESTION_ID_ATTR, thread.latestQuestion.id);
    }
    return () => { document.body.removeAttribute(THREAD_LATEST_QUESTION_ID_ATTR); };
  }, [thread]);

  // Signal to the view transition helper that this page's content is
  // rendered AND its initial scroll position has been applied. Without the
  // scroll-applied gate, `navigateWithTransition` captures the destination
  // snapshot before the initial useLayoutEffect fires, so the view
  // transition animates to a scrollY=0 frame that the browser then jumps
  // away from once the layout effect lands. With it, the snapshot includes
  // the final scroll position and the user sees zero motion after the
  // slide-in completes.
  const [initialScrollApplied, setInitialScrollApplied] = useState(false);
  usePageReady(!!thread && !loading && initialScrollApplied);

  // Prefetch question page routes for all questions in this thread. Phase 5b:
  // short_id lives on the poll wrapper, so the friendly URL uses the
  // poll's short_id when available.
  useEffect(() => {
    if (!thread) return;
    const wrapperByQuestionId = new Map<string, string>();
    for (const mp of thread.polls) {
      if (!mp.short_id) continue;
      for (const sp of mp.questions) wrapperByQuestionId.set(sp.id, mp.short_id);
    }
    const hrefs = thread.questions.map(p => `/p/${wrapperByQuestionId.get(p.id) || p.id}`);
    prefetchBatch(hrefs, { priority: "low" });
  }, [thread, prefetchBatch]);

  // Expanded card state — only one card can be expanded at a time.
  // Initialized from the prop so the /p/<id> route can open a card on first render.
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(initialExpandedQuestionId);
  // Which question's creation-time tooltip is currently showing (null = none). Shared
  // across all cards so only one tooltip is visible at a time.
  const [tooltipQuestionId, setTooltipQuestionId] = useState<string | null>(null);
  // Questions whose expanded content has been pre-mounted because the card scrolled
  // into view. We keep the mounted subtree display:none'd until expansion so all
  // data fetches, state init, and child effects happen BEFORE the user taps —
  // the expand then renders at the correct final height with no resize flicker.
  const [visibleQuestionIds, setVisibleQuestionIds] = useState<Set<string>>(() => {
    // Initialize with the pre-expanded question (so its content mounts on first paint).
    return initialExpandedQuestionId ? new Set([initialExpandedQuestionId]) : new Set();
  });
  // Per-question results for the compact winner preview shown above the grid-rows
  // clip. Seeded synchronously from inline question.results so the previews render
  // on first paint — without this, slots mount empty and fill in late when the
  // viewport-intersection fetch resolves, making every card grow and the list
  // slide down on refresh. The viewport observer still runs to refresh stale
  // entries.
  const [questionResultsMap, setQuestionResultsMap] = useState<Map<string, QuestionResults>>(() => {
    const seed = new Map<string, QuestionResults>();
    if (initialThread) {
      for (const p of initialThread.questions) {
        if (p.results) seed.set(p.id, p.results);
      }
    }
    return seed;
  });
  // Voting state + handlers for the thread page. See lib/useThreadVoting.ts.
  // votedQuestionIds / abstainedQuestionIds stay on the page because they're seeded
  // synchronously alongside the cached thread; the hook pushes fresh values
  // back through the setters after every successful vote write.
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
    submitSwipeAbstain,
  } = useThreadVoting({ thread, setVotedQuestionIds, setAbstainedQuestionIds });
  // Prevents the synthetic click from firing after touchend already toggled expansion on mobile
  const touchJustHandled = useRef(false);
  // Refs for each card wrapper so we can scroll the expanded card into view
  // and observe viewport intersection.
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Same key as cardRefs but targets the inner BORDERED frame of each card —
  // the visible "card shape" the user perceives. The FLIP animation applied
  // on submit operates on this element so the actual visible frame morphs
  // (and the surrounding grid wrapper / category-icon column stay still).
  const cardFrameRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Ref to each card's overflow-hidden wrapper — its scrollHeight reports the
  // natural expanded content height (pre-mounted via IntersectionObserver) so
  // we can compute the target scroll position BEFORE the grid-rows animation
  // finishes growing.
  const expandedWrapperRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Phase 3.4 follow-up B: wrapper-level Submit for 1-question non-yes_no
  // polls. Each QuestionBallot exposes triggerSubmit() via this ref;
  // the wrapper Submit calls it, which routes through the same validation
  // + confirmation modal flow the per-question Submit used to invoke.
  const subQuestionBallotRefs = useRef<Map<string, QuestionBallotHandle>>(new Map());
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);

  // === Windowed virtualization ===
  // Only mount cards within ~2 viewport heights of the visible region. Cards
  // outside collapse to a measured-height placeholder div. Bounds DOM weight
  // on long threads and keeps the URL-targeted card's offsetTop stable as
  // cards above mount/unmount: the placeholder takes the same height the
  // card occupied, so swapping placeholder↔card shifts the document layout
  // only by (estimated→actual) on first mount, which the layout-shift
  // compensation effect absorbs into scrollY.
  const groupHeightById = useRef<Map<string, number>>(new Map());
  const groupWindowObserverRef = useRef<IntersectionObserver | null>(null);
  const groupSizeObserverRef = useRef<ResizeObserver | null>(null);
  // Last-render offsetTop of the layout-shift compensation anchor (the
  // URL-targeted card if mounted, else the topmost mounted card). When
  // a render shifts the anchor's offsetTop — e.g. a card above mounts and
  // its actual height differs from the placeholder estimate — we scrollBy
  // the delta so the anchor stays at the same viewport position.
  const compensationAnchorRef = useRef<{ id: string; offsetTop: number } | null>(null);
  // suppressExpand mode (initialExpandedQuestionId === null) pins scrollY to
  // the bottom of the doc as cards above mount and the doc grows. The pin
  // stays active until the user scrolls away from bottom (>50px). Without
  // this, the initial `scrollTo(0, scrollHeight)` runs against a short doc
  // (most groups still placeholders) and saturates at 0; subsequent doc
  // growth doesn't re-apply the bottom-scroll, leaving the user at the top.
  const bottomPinActiveRef = useRef(initialExpandedQuestionId === null);
  const [mountedGroupKeys, setMountedGroupKeys] = useState<Set<string>>(() => {
    if (!initialThread) return new Set();
    const initial = new Set<string>();
    const target = initialExpandedQuestionId
      ? initialThread.questions.find(p => p.id === initialExpandedQuestionId)
      : null;
    const seed = target ?? initialThread.questions[initialThread.questions.length - 1] ?? null;
    if (seed) initial.add(seed.poll_id ?? `solo-${seed.id}`);
    return initial;
  });

  // Long press state
  const [modalQuestion, setModalQuestion] = useState<Question | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Confirmation state for destructive/semi-destructive actions on a question
  // (forget / reopen). Rendered by a single ConfirmationModal that varies its
  // title/message/handler based on `kind`.
  const [pendingAction, setPendingAction] = useState<
    { kind: PendingActionKind; question: Question } | null
  >(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);
  const [pressedQuestionId, setPressedQuestionId] = useState<string | null>(null);

  // Swipe-to-abstain state. Only one card can be swiped at a time, so a
  // single shared ref tracks the active gesture. Per-frame transforms go
  // straight to the cardFrame DOM ref for 60fps; the bold-text state below
  // re-renders only on threshold crossings (driven by `pastAbstainPoint`).
  const swipeRef = useRef<{
    questionId: string | null;
    pollId: string | null;
    cardWidth: number;
    startX: number;
    startY: number;
    offsetPx: number;
    swiping: boolean;
    pastAbstainPoint: boolean;
  }>({
    questionId: null,
    pollId: null,
    cardWidth: 0,
    startX: 0,
    startY: 0,
    offsetPx: 0,
    swiping: false,
    pastAbstainPoint: false,
  });
  // Mirrors `touchJustHandled` for the swipe gesture so the synthesized
  // click after the touchend doesn't toggle expand.
  const swipeJustHandled = useRef(false);
  const [swipeThresholdQuestionId, setSwipeThresholdQuestionId] = useState<string | null>(null);
  const SWIPE_ABSTAIN_THRESHOLD_RATIO = 0.3;
  const SWIPE_DIRECTION_THRESHOLD_PX = 12;
  const resetSwipeRef = () => {
    swipeRef.current.questionId = null;
    swipeRef.current.pollId = null;
    swipeRef.current.swiping = false;
    swipeRef.current.pastAbstainPoint = false;
    swipeRef.current.offsetPx = 0;
    setSwipeThresholdQuestionId(null);
  };

  // On cache hit, defer the background refresh via requestIdleCallback so it
  // doesn't compete with React commit during a view transition.
  useEffect(() => {
    async function fetchThread() {
      try {
        if (!initialThread) setLoading(true);
        setError(false);

        // Step 1: Fetch the question referenced in the URL and register access.
        // Check the in-memory cache first — the home page already fetched all accessible questions.
        let anchorQuestion: Question;
        try {
          const cached = isUuidLike(threadId)
            ? getCachedQuestionById(threadId)
            : getCachedQuestionByShortId(threadId);
          if (cached) {
            anchorQuestion = cached;
          } else if (isUuidLike(threadId)) {
            anchorQuestion = await apiGetQuestionById(threadId);
          } else {
            anchorQuestion = await apiGetQuestionByShortId(threadId);
          }
          addAccessibleQuestionId(anchorQuestion.id);
        } catch {
          setError(true);
          return;
        }

        // Discover children (may add new question IDs), then fetch the updated set.
        // Votes prefetch fires in parallel with getAccessibleQuestions so the votes
        // cache is warm by the time VoterList mounts — bubbles render alongside
        // the cards instead of ~100ms after. apiGetVotes is cache + in-flight
        // coalesced, so the later per-card fetch hits the warm cache.
        try { await discoverRelatedQuestions(); } catch {}
        for (const id of getAccessibleQuestionIds()) {
          void apiGetVotes(id).catch(() => null);
        }
        const polls = await getAccessiblePolls();
        if (!polls) { setError(true); return; }

        // Re-read voted state — discovery or the user voting elsewhere may have changed it.
        const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
        const anchorPollId = anchorQuestion.poll_id;
        if (!anchorPollId) { setError(true); return; }
        const foundThread = buildThreadFromPollDown(anchorPollId, polls, voted, abstained);

        if (!foundThread) {
          setError(true);
          return;
        }

        // Seed inline results BEFORE setThread so the first render with the
        // loaded thread already has compact previews (no slide-down on refresh).
        setQuestionResultsMap((prev) => {
          const additions = foundThread.questions.filter(p => p.results && !prev.has(p.id));
          if (additions.length === 0) return prev;
          const next = new Map(prev);
          for (const p of additions) next.set(p.id, p.results!);
          return next;
        });
        setThread(foundThread);
      } catch (err) {
        console.error('Error loading thread:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    if (initialThread) {
      // `requestIdleCallback` is unsupported in Safari; fall back to setTimeout(0).
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      const schedule = w.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 0) as unknown as number);
      const cancel = w.cancelIdleCallback ?? ((id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
      const id = schedule(() => { void fetchThread(); });
      return () => cancel(id);
    }
    fetchThread();
  }, [threadId]);

  // The first question of a freshly submitted (placeholder) poll, while its
  // card is FLIP-animating from the draft frame to its natural slot. While
  // this is set, the matching card mounts with only its title visible — the
  // status row, voter circles, etc. are suppressed until hydration completes.
  const [pendingPollFirstQuestionId, setPendingPollFirstQuestionId] = useState<string | null>(null);

  // Latest `thread` snapshot for the POLL_PENDING handler. Updated in a
  // separate effect so the listener can stay registered with empty deps
  // — re-attaching on every thread mutation would tear down + re-add the
  // event listener on every vote/hydration/cache refresh.
  const threadRef = useRef(thread);
  useEffect(() => { threadRef.current = thread; }, [thread]);

  // POLL_PENDING_EVENT: a draft was just submitted. Insert the placeholder
  // poll into thread state immediately so the user sees the new card in
  // its sorted position right away. apiCreatePoll is running in parallel;
  // POLL_HYDRATED_EVENT will swap the placeholder for the real Poll once
  // it resolves.
  //
  // The placeholder card mounts with a `card-pending-enter` CSS class that
  // fades it in from translateY(8px) → 0 + opacity 0 → 1 over 300ms.
  // (We previously tried a FLIP morph from the draft card's bbox to the
  // new card's natural slot, but the cardFrame is a CSS Grid item with
  // default `min-height: auto` resolving to min-content, which clamped the
  // height transition; even after pinning min-height: 0 with a double-rAF
  // dance, the morph was inconsistent across browsers. A simple fade-in
  // on the new card is reliable and reads as "something just appeared".)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollPendingDetail>).detail;
      const newPoll = detail?.poll;
      if (!newPoll) return;

      const polls = getCachedAccessiblePolls();
      if (!polls) return;

      const t = threadRef.current;
      const threadPollIds = new Set(t?.polls.map((p) => p.id) ?? []);
      const isFollowUp = newPoll.follow_up_to && threadPollIds.has(newPoll.follow_up_to);
      const isOwnRoot = t && newPoll.id === t.rootPollId;
      if (!isFollowUp && !isOwnRoot) return;

      const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
      const rebuilt = t?.rootPollId
        ? buildThreadFromPollDown(t.rootPollId, polls, voted, abstained)
        : null;
      if (!rebuilt) return;

      const firstQuestionId = newPoll.questions[0]?.id ?? null;
      flushSync(() => {
        setPendingPollFirstQuestionId(firstQuestionId);
        setThread(rebuilt);
      });
    };
    window.addEventListener(POLL_PENDING_EVENT, handler);
    return () => window.removeEventListener(POLL_PENDING_EVENT, handler);
  }, []);

  // POLL_HYDRATED_EVENT: the API call has resolved with the real Poll.
  // Replace the placeholder fields in thread state with the real ones in
  // place — keep the SAME placeholder id as the React key so the card's
  // DOM node doesn't unmount/re-mount mid-FLIP. Once the placeholder is
  // gone (its id was 'pending-...'), the real Poll's id takes over for
  // subsequent operations.
  //
  // Fallback: if the placeholder isn't in the thread (POLL_PENDING bailed
  // out, e.g., follow_up_to wasn't recognized at the time), still add the
  // real poll if it belongs to this thread — without that, the user sees
  // the form clear with no new poll appearing despite a successful API
  // create.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollHydratedDetail>).detail;
      const placeholderId = detail?.placeholderId;
      const realPoll = detail?.poll;
      if (!placeholderId || !realPoll) return;
      setThread((prev) => {
        if (!prev) return prev;
        // Rebuild from the cache (which submit handler has already
        // updated). Hand-mapping prev.polls leaves the new poll invisible
        // when POLL_PENDING bailed (Firefox iOS listener race).
        const threadPollIds = new Set(prev.polls.map(p => p.id));
        const isFollowUp = realPoll.follow_up_to && threadPollIds.has(realPoll.follow_up_to);
        const isOwnRoot = realPoll.id === prev.rootPollId;
        const hasPlaceholder = prev.polls.some(p => p.id === placeholderId);
        if (!hasPlaceholder && !isFollowUp && !isOwnRoot) return prev;
        return rebuildThreadFromCacheOrPrev(prev);
      });
      setPendingPollFirstQuestionId(null);
    };
    window.addEventListener(POLL_HYDRATED_EVENT, handler);
    return () => window.removeEventListener(POLL_HYDRATED_EVENT, handler);
  }, []);

  // POLL_FAILED_EVENT: apiCreatePoll rejected. Rebuild from cache (the
  // submit handler has already evicted the placeholder before dispatching).
  useEffect(() => {
    const handler = () => {
      setThread((prev) => {
        if (!prev) return prev;
        // Skip rebuild when no placeholder is present — POLL_FAILED on a
        // brand-new-thread submit fires while we're on a different thread.
        if (!prev.polls.some(p => p.id.startsWith('pending-'))) return prev;
        return rebuildThreadFromCacheOrPrev(prev);
      });
      setPendingPollFirstQuestionId(null);
    };
    window.addEventListener(POLL_FAILED_EVENT, handler);
    return () => window.removeEventListener(POLL_FAILED_EVENT, handler);
  }, []);

  // Measure the fixed thread header so we can apply matching padding-top on the scroll list
  // (the header is position:fixed and out of flow, so the list doesn't naturally reserve space).
  // Re-measure when `thread` flips loaded — the header is rendered behind a
  // `if (loading) return <Spinner/>` early return, so the measured ref only
  // exists once `thread` is non-null.
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([thread]);


  // Set up a shared IntersectionObserver so cards pre-mount their expanded
  // content when they scroll into view. rootMargin prefetches slightly early.
  // Runs once; callback refs on each card attach/detach the observer.
  useEffect(() => {
    if (!thread || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible: string[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.questionId;
            if (id) newlyVisible.push(id);
          }
        });
        if (newlyVisible.length === 0) return;
        setVisibleQuestionIds((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const id of newlyVisible) {
            if (!next.has(id)) {
              next.add(id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      // root:null → observe relative to the viewport.
      { root: null, rootMargin: '200px 0px' },
    );
    intersectionObserverRef.current = observer;
    // Attach to any cards already mounted (ref callbacks may have fired before this effect).
    cardRefs.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      intersectionObserverRef.current = null;
    };
    // Only re-create when a thread first arrives — not on every mutation
    // (forget/reopen). Card ref callbacks attach each new card to the live
    // observer automatically.
  }, [!!thread]);

  // Fetch results + viewer's own vote for every yes_no question that has entered
  // the viewport. Both calls are coalesced + cache-backed. Results drive the
  // winner preview; the user's vote drives the Your-Vote badge + tap-to-
  // change flow. The setState guards compare by field content (not identity)
  // because apiGetQuestionResults always allocates a fresh result object even
  // when the underlying data is unchanged.
  useEffect(() => {
    if (!thread) return;
    let cancelled = false;

    const maybeFetch = async (questionId: string, questionType: string) => {
      // Fetch results for every type that has a compact preview (yes_no,
      // ranked_choice, time). For ranked_choice the "suggestion phase"
      // variant reuses the same results (suggestion_counts field populated
      // pre-cutoff). User-vote fetching is yes_no-only; other types drive
      // their compact strip off the shared results alone.
      const wantsResults =
        questionType === 'yes_no' ||
        questionType === 'ranked_choice' ||
        questionType === 'time';
      if (!wantsResults) return;
      const voteId = questionType === 'yes_no' ? getStoredVoteId(questionId) : null;
      const [results, votes] = await Promise.all([
        apiGetQuestionResults(questionId).catch(() => null),
        voteId ? apiGetVotes(questionId).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (results) {
        setQuestionResultsMap((prev) => {
          const existing = prev.get(questionId);
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
          next.set(questionId, results);
          return next;
        });
      }
      if (voteId && votes) {
        const mine = votes.find((v) => v.id === voteId);
        if (!mine) return;
        const choice = parseYesNoChoice(mine);
        const voterName = mine.voter_name ?? null;
        setUserVoteMap((prev) => {
          const existing = prev.get(questionId);
          if (existing && existing.voteId === voteId && existing.choice === choice && existing.voterName === voterName) {
            return prev;
          }
          const next = new Map(prev);
          next.set(questionId, { choice, voteId, voterName });
          return next;
        });
      }
    };

    // For multi-question groups, anchor visibility implies the whole
    // group is on-screen — fetch results for every sibling so each
    // question's preview is populated, not just the anchor's. Compute
    // anchor ids per poll once.
    const anchorByPoll = new Map<string, string>();
    for (const question of thread.questions) {
      if (!question.poll_id) continue;
      const cur = anchorByPoll.get(question.poll_id);
      if (!cur) {
        anchorByPoll.set(question.poll_id, question.id);
        continue;
      }
      const curQuestion = thread.questions.find((p) => p.id === cur);
      if ((question.question_index ?? 0) < (curQuestion?.question_index ?? 0)) {
        anchorByPoll.set(question.poll_id, question.id);
      }
    }
    for (const question of thread.questions) {
      const anchorId = question.poll_id
        ? (anchorByPoll.get(question.poll_id) ?? question.id)
        : question.id;
      if (!visibleQuestionIds.has(anchorId)) continue;
      void maybeFetch(question.id, question.question_type);
    }

    const onVotesChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId?: string } | undefined;
      const questionId = detail?.questionId;
      if (!questionId) return;
      const question = thread.questions.find((p) => p.id === questionId);
      if (!question) return;
      void maybeFetch(question.id, question.question_type);
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);
    };
  }, [thread, visibleQuestionIds]);

  // ===================================================================
  // Thread-page scroll strategy (single source of truth — keep cohesive)
  // ===================================================================
  // Three scroll surfaces all serve the same goal: keep the viewer's
  // attention on whichever poll most likely wants their input next. The
  // "awaiting set" = open polls the viewer has neither voted on nor
  // abstained from.
  //
  // 1. INITIAL load (`useLayoutEffect` below, fires once per mount):
  //    - URL targets a specific poll → scroll its expanded card's top
  //      flush with the bottom of the fixed header.
  //    - URL is the empty thread route → land at the document bottom
  //      so the always-on draft poll form is visible.
  //    Runs synchronously before paint via a fire-once `useRef` guard so
  //    the first painted frame is already at the destination — never an
  //    "in-place then scroll" two-frame flicker. Cleanup intentionally
  //    omitted; useRef persists across StrictMode mount→cleanup→mount,
  //    and a cleanup that reset the ref would re-fire on every
  //    dep-change (e.g. async accessible-polls refresh) and re-scroll
  //    against a now-taller page.
  //
  // 2. TAP-EXPAND (`useEffect` further below, fires after initial layout
  //    has settled): smoothly scrolls (rAF, ease-out cubic, 300ms —
  //    matching the grid-rows expand transition) only enough to keep the
  //    just-expanded card onscreen — align top to header if cut off
  //    above, or trim the bottom overshoot otherwise (capped by
  //    available slack so the top never disappears behind the header).
  //
  // 3. SCROLL-HELPER ARROWS (mutually exclusive, up takes precedence):
  //    Two fixed buttons portaled into `#floating-fab-portal`. Both
  //    point at a single awaiting card and align that card's top flush
  //    with the bottom of the fixed header on tap.
  //
  //      - UP (just below header) shows when:
  //          • no awaiting poll has ANY part visible in the viewport, AND
  //          • at least one awaiting poll sits wholly above it.
  //        Targets the OLDEST above-the-fold awaiting poll (= first in
  //        DOM order, since awaiting cards sort by created_at ASC at the
  //        bottom of the thread list).
  //
  //      - DOWN (above the bottom safe-area inset) shows when:
  //          • no awaiting poll is FULLY visible, AND
  //          • no awaiting poll has any part above the viewport
  //            (otherwise the user should scroll up, not down), AND
  //          • at least one awaiting poll has its bottom below the
  //            viewport bottom (wholly below or bottom-clipped).
  //        Targets the FIRST such below-the-fold awaiting poll.
  //
  //    The visibility evaluator is wired to scroll/resize AND a
  //    body-subtree MutationObserver because vote-driven re-renders flip
  //    a card's awaiting state without firing scroll, and CSS expand
  //    transitions move card rects without firing resize. All reads are
  //    rAF-coalesced so a mutation burst doesn't trigger N forced
  //    layouts via getBoundingClientRect().
  //
  // ===================================================================
  // Initial-load scroll (path 1).
  // ===================================================================
  const hasHandledInitialExpandRef = useRef(false);
  useLayoutEffect(() => {
    if (!thread || loading) return;
    if (headerHeight === 0) return;
    if (hasHandledInitialExpandRef.current) return;
    hasHandledInitialExpandRef.current = true;
    if (initialExpandedQuestionId) {
      const card = cardRefs.current.get(initialExpandedQuestionId);
      if (card) {
        const cardTopY = card.getBoundingClientRect().top;
        const targetDelta = cardTopY - headerHeight;
        if (targetDelta !== 0) {
          window.scrollTo(0, window.scrollY + targetDelta);
        }
      }
    } else {
      // No expand → land at the bottom of the document so the draft poll
      // form is in view. With the thread-like content paddingBottom trimmed
      // to 0.5rem the bottom scroll position leaves only a thin margin below
      // the form.
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
    setInitialScrollApplied(true);
    // No cleanup return: useRef persists across React StrictMode's
    // mount→cleanup→mount cycle, so the ref check above guarantees fire-once
    // semantics. A cleanup that reset the ref would fire on every dep change
    // (e.g. `thread` updating from an async accessible-polls refresh) and
    // re-apply the scroll against the new — taller — page, producing a
    // visible "settle further down" jump after the user already saw the
    // page in the right position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, loading, headerHeight, initialExpandedQuestionId]);

  // ===================================================================
  // Tap-expand smooth scroll (path 2 — see strategy block above). Only
  // fires when expandedQuestionId changes AFTER the initial layout has
  // settled; the initial-expand path above handles the first render.
  // ===================================================================
  useEffect(() => {
    if (!expandedQuestionId) return;
    if (headerHeight === 0) return;
    if (expandedQuestionId === initialExpandedQuestionId) return;
    const card = cardRefs.current.get(expandedQuestionId);
    if (!card) return;

    const wrapper = expandedWrapperRefs.current.get(expandedQuestionId);
    const expandedContentHeight = wrapper?.scrollHeight ?? 0;
    const wrapperCurrent = wrapper?.getBoundingClientRect().height ?? 0;
    const compactHeight = card.getBoundingClientRect().height - wrapperCurrent;
    const visibleTopY = headerHeight;
    const visibleBottomY = window.innerHeight;
    const cardTopY = card.getBoundingClientRect().top;
    const finalCardBottomY = cardTopY + compactHeight + expandedContentHeight;
    const BOTTOM_GAP = 12;

    let targetDelta = 0;
    if (cardTopY < visibleTopY) {
      targetDelta = cardTopY - visibleTopY;
    } else if (finalCardBottomY + BOTTOM_GAP > visibleBottomY) {
      const overshoot = finalCardBottomY + BOTTOM_GAP - visibleBottomY;
      const slack = cardTopY - visibleTopY;
      targetDelta = Math.min(overshoot, slack);
    }
    if (targetDelta === 0) return;

    const startScrollY = window.scrollY;
    const targetScrollY = startScrollY + targetDelta;
    const DURATION = 300; // matches the grid-rows CSS transition
    const startTime = performance.now();
    let rafId: number | null = null;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      window.scrollTo(0, startScrollY + (targetScrollY - startScrollY) * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [expandedQuestionId, headerHeight, initialExpandedQuestionId]);

  // Listen for question:updated events (fired when close/reopen happens from within
  // a card). Merge the updates into our local thread state so downstream UI —
  // e.g. whether the modal should offer a Reopen button — reflects reality.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId: string; updates: Partial<Question> };
      if (!detail?.questionId) return;
      setThread((prev) => {
        if (!prev || !prev.questions.some((p) => p.id === detail.questionId)) return prev;
        return {
          ...prev,
          questions: prev.questions.map((p) =>
            p.id === detail.questionId ? { ...p, ...detail.updates } : p,
          ),
        };
      });
      setModalQuestion((prev) => (prev && prev.id === detail.questionId ? { ...prev, ...detail.updates } : prev));
    };
    window.addEventListener('question:updated', handler);
    return () => window.removeEventListener('question:updated', handler);
  }, []);

  // Re-read votedQuestions from localStorage when a vote is submitted anywhere in
  // the app. The golden border reads from these sets, so it clears immediately
  // on vote. loadVotedQuestions always allocates new Sets, so compare contents
  // before committing — otherwise every event triggers a re-render even when
  // this user's vote on this thread didn't change.
  useEffect(() => {
    const setsEqual = (a: Set<string>, b: Set<string>) => {
      if (a.size !== b.size) return false;
      for (const x of a) if (!b.has(x)) return false;
      return true;
    };
    const handler = () => {
      const fresh = loadVotedQuestions();
      setVotedQuestionIds((prev) => (setsEqual(prev, fresh.votedQuestionIds) ? prev : fresh.votedQuestionIds));
      setAbstainedQuestionIds((prev) => (setsEqual(prev, fresh.abstainedQuestionIds) ? prev : fresh.abstainedQuestionIds));
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
  }, []);

  // Dismiss the creation-time tooltip on any outside click/tap. Attachment is
  // deferred by one tick so the opening event doesn't close it immediately.
  useEffect(() => {
    if (!tooltipQuestionId) return;
    const close = () => setTooltipQuestionId(null);
    const t = setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('touchstart', close, { passive: true });
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', close);
      document.removeEventListener('touchstart', close);
    };
  }, [tooltipQuestionId]);

  // Awaiting questions (open + not voted/abstained) get sorted to the bottom and
  // wear a golden border. The border uses the live predicate so it clears
  // immediately on vote; the sort order captures this at thread-load only so
  // the card doesn't jump positions underneath the user.
  // Phase 5b: open/closed is poll-level — every question inherits its
  // wrapper's is_closed + response_deadline.
  const now = new Date();
  const pollByQuestionId = useMemo(() => {
    const map = new Map<string, Poll>();
    if (!thread) return map;
    for (const mp of thread.polls) {
      for (const sp of mp.questions) map.set(sp.id, mp);
    }
    return map;
  }, [thread]);
  const wrapperFor = (question: Question): Poll | null =>
    pollByQuestionId.get(question.id) ?? (question.poll_id ? pollWrapperMap.get(question.poll_id) ?? null : null);
  const isQuestionOpen = (question: Question) => {
    const mp = wrapperFor(question);
    if (!mp) return true;
    return mp.response_deadline ? new Date(mp.response_deadline) > now && !mp.is_closed : !mp.is_closed;
  };
  const isAwaitingResponse = (question: Question) =>
    isQuestionOpen(question) && !votedQuestionIds.has(question.id) && !abstainedQuestionIds.has(question.id);

  // Defined above the early returns so the hook call order is stable.
  const threadQuestions = useMemo(() => {
    if (!thread) return [] as Question[];
    const awaitingAtLoad = new Set(thread.questions.filter(isAwaitingResponse).map((p) => p.id));
    return [...thread.questions].sort((a, b) => {
      const aAwaiting = awaitingAtLoad.has(a.id);
      const bAwaiting = awaitingAtLoad.has(b.id);
      if (aAwaiting !== bAwaiting) return aAwaiting ? 1 : -1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  // Phase 5b: poll wrappers ride along on the thread state directly
  // (returned in bulk from /api/questions/accessible). Build a quick id → wrapper
  // map for the existing callsites that look one up. Voter aggregates stay
  // fresh via the QUESTION_VOTES_CHANGED_EVENT handler below, which refetches
  // affected wrappers and merges them back into thread.polls.
  const pollWrapperMap = useMemo(
    () => (thread ? buildPollMap(thread.polls) : new Map<string, Poll>()),
    [thread],
  );

  // Phase 3.2: group sibling questions of a poll into a single visual
  // card group. 1-question wrappers (the post-Phase-4 norm) render identically
  // to today — anchor === only question, no section labels, no aggregation.
  // Multi-question wrappers render one card with stacked question sections
  // inside the expand clip and a poll-level respondent row below.
  //
  // Phase 5b: each group also carries the wrapper Poll so callsites can
  // read wrapper-level fields (is_closed, response_deadline, ...) directly
  // instead of looking them up via the cache.
  const groupedThreadQuestions = useMemo(() => {
    type Group = {
      key: string;
      pollId: string | null;
      poll: Poll | null;
      subQuestions: Question[];
      anchor: Question;
    };
    const groups: Group[] = [];
    const seen = new Set<string>();
    for (const question of threadQuestions) {
      const groupKey = question.poll_id ?? `solo-${question.id}`;
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      const subQuestions = question.poll_id
        ? threadQuestions
            .filter((p) => p.poll_id === question.poll_id)
            .sort((a, b) => (a.question_index ?? 0) - (b.question_index ?? 0))
        : [question];
      const poll = question.poll_id
        ? (pollWrapperMap.get(question.poll_id) ?? null)
        : null;
      groups.push({
        key: groupKey,
        pollId: question.poll_id ?? null,
        poll,
        subQuestions,
        anchor: subQuestions[0],
      });
    }
    return groups;
  }, [threadQuestions, pollWrapperMap]);

  // === Virtualization helpers (anchor + observer wiring) ===
  // The URL-targeted group is the layout-shift compensation anchor + the
  // initial mount seed. When the URL signals "no expand" (suppressExpand →
  // null), fall back to the last group so the document stays pinned to the
  // bottom while cards above mount.
  const anchorGroupKey = useMemo(() => {
    if (groupedThreadQuestions.length === 0) return null;
    if (initialExpandedQuestionId) {
      const found = groupedThreadQuestions.find(g =>
        g.subQuestions.some(p => p.id === initialExpandedQuestionId)
      );
      if (found) return found.key;
    }
    return groupedThreadQuestions[groupedThreadQuestions.length - 1].key;
  }, [groupedThreadQuestions, initialExpandedQuestionId]);

  // Maintain mountedGroupKeys against churn: drop keys that no longer exist
  // (forget, error reload), always keep the anchor mounted. Window expansion
  // additions come from the IntersectionObserver below.
  useEffect(() => {
    if (groupedThreadQuestions.length === 0) return;
    const validKeys = new Set(groupedThreadQuestions.map(g => g.key));
    setMountedGroupKeys(prev => {
      const next = new Set<string>();
      for (const k of prev) if (validKeys.has(k)) next.add(k);
      if (anchorGroupKey) next.add(anchorGroupKey);
      if (next.size === prev.size) {
        let same = true;
        for (const k of next) if (!prev.has(k)) { same = false; break; }
        if (same) return prev;
      }
      return next;
    });
  }, [groupedThreadQuestions, anchorGroupKey]);

  // ResizeObserver: keep groupHeightById in sync with each rendered group's
  // actual height (mounted card OR placeholder). Placeholders use these
  // measurements so unmounting a card doesn't shift the document.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      let anyChanged = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.dataset.groupKey;
        if (!key) continue;
        const h = el.offsetHeight;
        if (h <= 0) continue;
        if (groupHeightById.current.get(key) === h) continue;
        groupHeightById.current.set(key, h);
        anyChanged = true;
      }
      // Re-apply bottom-pin on layout-only changes (e.g. async content
      // landing in a card grows it without a React re-render). Without this,
      // the pin only fires on React renders and the user is left at the
      // pre-growth scroll position when the doc keeps growing post-layout.
      if (anyChanged && bottomPinActiveRef.current) {
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        console.log('[ro-pin]', { anyChanged, scrollY: window.scrollY, max, scrollHeight: document.documentElement.scrollHeight });
        if (Math.abs(window.scrollY - max) > 0.5) {
          window.scrollTo(0, max);
        }
      }
    });
    groupSizeObserverRef.current = ro;
    cardRefs.current.forEach(el => {
      if (el.dataset.groupKey) ro.observe(el);
    });
    return () => {
      ro.disconnect();
      groupSizeObserverRef.current = null;
    };
  }, []);

  // ===================================================================
  // Window IntersectionObserver: tracks which group wrappers are within
  // ±2 viewport heights of the visible region. Activated only after the
  // initial scroll lands so the observer's first measurements reflect the
  // user's intended scroll position rather than the pre-scroll scrollY=0.
  // ===================================================================
  useEffect(() => {
    if (!thread || !initialScrollApplied) return;
    if (typeof IntersectionObserver === 'undefined' || typeof window === 'undefined') return;
    const buffer = window.innerHeight * 2;
    const observer = new IntersectionObserver(
      (entries) => {
        let additions: Set<string> | null = null;
        let removals: Set<string> | null = null;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.groupKey;
          if (!key) continue;
          if (entry.isIntersecting) {
            (additions ??= new Set()).add(key);
          } else {
            (removals ??= new Set()).add(key);
          }
        }
        if (!additions && !removals) return;
        setMountedGroupKeys((prev) => {
          let changed = false;
          const next = new Set(prev);
          if (additions) for (const k of additions) if (!next.has(k)) { next.add(k); changed = true; }
          if (removals) for (const k of removals) {
            if (k === anchorGroupKey) continue;  // anchor stays mounted always
            if (next.has(k)) { next.delete(k); changed = true; }
          }
          return changed ? next : prev;
        });
      },
      { root: null, rootMargin: `${buffer}px 0px` },
    );
    groupWindowObserverRef.current = observer;
    cardRefs.current.forEach(el => {
      if (el.dataset.groupKey) observer.observe(el);
    });
    return () => {
      observer.disconnect();
      groupWindowObserverRef.current = null;
    };
  }, [!!thread, initialScrollApplied, anchorGroupKey]);

  // ===================================================================
  // Layout-shift compensation: keep the URL-targeted (or topmost-mounted)
  // card's offsetTop stable across mount/unmount/measurement-change cycles
  // by scroll-compensating any change. Without this, cards mounting above
  // the anchor with H_actual ≠ H_estimate would shift the anchor's viewport
  // position. Runs after every render; user scrolls between renders aren't
  // disturbed because we only react to anchor offsetTop deltas, not scrollY.
  // ===================================================================
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !thread) return;
    if (initialExpandedQuestionId === null) {
      // Bottom-pin mode: as cards mount and the doc grows, keep scrollY at
      // max so the user lands on the draft form even when the initial
      // scroll-to-scrollHeight saturated against a still-short doc. The pin
      // disables when the user scrolls >50px above bottom.
      if (!bottomPinActiveRef.current) return;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      console.log('[layout-pin]', { scrollY: window.scrollY, max, scrollHeight: document.documentElement.scrollHeight });
      if (Math.abs(window.scrollY - max) > 0.5) {
        window.scrollTo(0, max);
      }
      return;
    }
    let urlAnchorEl: HTMLDivElement | null = null;
    let topMostId: string | null = null;
    let topMostTop = Infinity;
    cardRefs.current.forEach((el, id) => {
      if (!el.isConnected) return;
      if (id === initialExpandedQuestionId) urlAnchorEl = el;
      if (el.offsetTop < topMostTop) {
        topMostTop = el.offsetTop;
        topMostId = id;
      }
    });
    const pickedId = urlAnchorEl ? initialExpandedQuestionId : topMostId;
    const pickedTop = urlAnchorEl ? (urlAnchorEl as HTMLElement).offsetTop : topMostTop;
    if (!pickedId || !isFinite(pickedTop)) {
      compensationAnchorRef.current = null;
      return;
    }
    const prev = compensationAnchorRef.current;
    if (prev && prev.id === pickedId) {
      const delta = pickedTop - prev.offsetTop;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy(0, delta);
      }
    }
    // After (potential) compensation, offsetTop relative to doc is unchanged
    // (we only adjusted scrollY). Capture for the next render's diff.
    compensationAnchorRef.current = { id: pickedId, offsetTop: pickedTop };
  });

  // Disable bottom-pin once the user scrolls away from the bottom. We only
  // care about scroll events that originate from user gestures — our own
  // scrollTo(0, max) calls leave scrollY at exactly max, so the threshold
  // doesn't trip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      if (!bottomPinActiveRef.current) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY < max - 50) {
        bottomPinActiveRef.current = false;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Refetch on vote-change events: when any question's votes change, the
  // wrapper's voter_names may have shifted. Refresh affected poll
  // wrappers — cheap because the request is small and cached. Updates flow
  // through patchThreadPolls so the derived map stays in sync.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId?: string } | undefined;
      if (!detail?.questionId || !thread) return;
      const question = thread.questions.find((p) => p.id === detail.questionId);
      const mid = question?.poll_id;
      if (!mid) return;
      void apiGetPollById(mid).then((wrapper) => {
        patchThreadPolls(
          (mp) => mp.id === mid,
          () => ({
            voter_names: wrapper.voter_names,
            anonymous_count: wrapper.anonymous_count,
            questions: wrapper.questions,
          }),
        );
      }).catch(() => null);
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
  }, [thread, patchThreadPolls]);

  // Sync the URL to reflect which card is expanded, using shallow history.replaceState
  // so Next.js doesn't unmount/remount on URL change. Sharing the URL reopens the
  // same expanded card. Collapsing leaves the URL on the just-collapsed poll —
  // the user's mental model is "I'm viewing this poll".
  useEffect(() => {
    if (typeof window === 'undefined' || !thread || !expandedQuestionId) return;
    const expandedQuestion = thread.questions.find((p) => p.id === expandedQuestionId);
    const wrapper = expandedQuestion ? wrapperFor(expandedQuestion) : null;
    const routeId = wrapper?.short_id || expandedQuestionId;
    const nextPath = `/p/${routeId}/`;
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(window.history.state, '', nextPath + window.location.search + window.location.hash);
    }
  // wrapperFor reads pollByQuestionId/pollWrapperMap which both derive
  // from `thread`, so the existing thread dep covers wrapper lookups too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedQuestionId, thread]);

  // ===================================================================
  // Scroll-helper arrow visibility (path 3 — see strategy block above).
  // ===================================================================
  const [scrollHelpers, setScrollHelpers] = useState<{
    showUp: boolean;
    showDown: boolean;
    upTargetId: string | null;
    downTargetId: string | null;
  }>({ showUp: false, showDown: false, upTargetId: null, downTargetId: null });

  useEffect(() => {
    if (!thread || typeof window === 'undefined') return;
    let rafId: number | null = null;
    const evaluate = () => {
      rafId = null;
      const viewportTop = headerHeight;
      const viewportBottom = window.innerHeight;
      let upTargetId: string | null = null;
      let downTargetId: string | null = null;
      let anyInView = false;
      let anyFullyVisible = false;
      let anyAbove = false; // wholly above OR top-clipped (partially above)
      // threadQuestions sorts awaiting cards last by created_at ASC, so the
      // FIRST wholly-above match is the oldest above-the-fold awaiting card,
      // and the FIRST below-the-fold match is the closest one beneath the
      // viewport (oldest among those still to be reached).
      for (const group of groupedThreadQuestions) {
        const question = group.anchor;
        if (!isAwaitingResponse(question)) continue;
        const card = cardRefs.current.get(question.id);
        if (!card) continue;
        const r = card.getBoundingClientRect();
        const wholeAbove = r.bottom <= viewportTop;
        const wholeBelow = r.top >= viewportBottom;
        if (wholeAbove) {
          if (upTargetId === null) upTargetId = question.id;
          anyAbove = true;
        } else if (wholeBelow) {
          if (downTargetId === null) downTargetId = question.id;
        } else {
          anyInView = true;
          const topClipped = r.top < viewportTop;
          const bottomClipped = r.bottom > viewportBottom;
          if (!topClipped && !bottomClipped) anyFullyVisible = true;
          if (topClipped) anyAbove = true;
          if (bottomClipped && !topClipped && downTargetId === null) {
            downTargetId = question.id;
          }
        }
      }
      const showUp = !anyInView && upTargetId !== null;
      // Down arrow is suppressed when up shows (up takes precedence) and
      // when any awaiting poll sits above — scrolling down wouldn't help
      // reach them.
      const showDown =
        !showUp && !anyFullyVisible && !anyAbove && downTargetId !== null;
      setScrollHelpers((prev) => (
        prev.showUp === showUp &&
        prev.showDown === showDown &&
        prev.upTargetId === upTargetId &&
        prev.downTargetId === downTargetId
          ? prev
          : { showUp, showDown, upTargetId, downTargetId }
      ));
    };
    // rAF-coalesce: a body-subtree MutationObserver fires on every DOM
    // mutation (vote-driven re-renders, expand/collapse animations,
    // countdown text updates). Without coalescing each burst would force a
    // layout via getBoundingClientRect on every awaiting card.
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(evaluate);
    };
    evaluate();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Body subtree catches vote-driven DOM changes that flip a card's
    // awaiting state plus expand/collapse height transitions that move
    // card rects without firing scroll/resize.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, groupedThreadQuestions, headerHeight, votedQuestionIds, abstainedQuestionIds]);

  // Both arrows use the same action: align the target card's top flush
  // with the bottom of the fixed header. For wholly-above / wholly-below
  // cards this brings them just below the header; for bottom-clipped
  // partial-below cards this scrolls down by the exact amount needed to
  // reveal the rest (which lands the bottom at viewport bottom when the
  // card fits in the viewport).
  const scrollAwaitingToHeader = (id: string | null) => {
    if (!id) return;
    const card = cardRefs.current.get(id);
    if (!card) return;
    const targetY = window.scrollY + card.getBoundingClientRect().top - headerHeight;
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  };

  // Portal target for the scroll-helper buttons. Resolved after mount to
  // avoid SSR mismatches; the buttons render outside the responsive-scaling
  // container so `position: fixed` is relative to the real viewport.
  const [scrollHelperPortal, setScrollHelperPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setScrollHelperPortal(document.getElementById('floating-fab-portal'));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading thread...</p>
        </div>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Thread Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This thread may not exist or you don&apos;t have access.</p>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <ThreadHeader
        headerRef={headerRef}
        title={thread.title}
        participantNames={thread.participantNames}
        anonymousCount={thread.anonymousRespondentCount}
        subtitle={`${thread.questions.length} ${thread.questions.length === 1 ? 'question' : 'questions'}`}
        onTitleClick={() => navigateWithTransition(router, `/p/${threadId}/info`, 'forward')}
      />

      {/* paddingTop reserves space for the fixed header above. */}
      <div className="pb-2" style={{ paddingTop: `calc(${headerHeight}px + 0.5rem)` }}>
        {groupedThreadQuestions.map((group) => {
            // Virtualized window: groups outside ±2 viewport heights of the
            // visible region render as a measured-height placeholder div. The
            // anchor (URL-targeted card or last group when suppressExpand) is
            // always in mountedGroupKeys so its compact-form measurements feed
            // the layout-shift compensation effect from the very first paint.
            if (!mountedGroupKeys.has(group.key)) {
              const measured = groupHeightById.current.get(group.key);
              const placeholderHeight = measured ?? ESTIMATED_GROUP_HEIGHT;
              const anchorId = group.anchor.id;
              return (
                <div
                  key={`placeholder-${group.key}`}
                  ref={(el) => {
                    if (el) {
                      el.dataset.questionId = anchorId;
                      el.dataset.groupKey = group.key;
                      cardRefs.current.set(anchorId, el);
                      groupSizeObserverRef.current?.observe(el);
                      groupWindowObserverRef.current?.observe(el);
                      intersectionObserverRef.current?.observe(el);
                    } else {
                      const prev = cardRefs.current.get(anchorId);
                      if (prev) {
                        intersectionObserverRef.current?.unobserve(prev);
                        groupSizeObserverRef.current?.unobserve(prev);
                        groupWindowObserverRef.current?.unobserve(prev);
                      }
                      cardRefs.current.delete(anchorId);
                    }
                  }}
                  className="ml-0 mr-1.5 mb-3"
                  style={{ height: placeholderHeight }}
                  aria-hidden="true"
                />
              );
            }
            const question = group.anchor;
            const isMultiGroup = group.subQuestions.length > 1;
            const wrapper = group.poll;
            const isOpen = isQuestionOpen(question);
            const isClosed = !isOpen;
            const isAwaiting = isAwaitingResponse(question);
            // Wrapper-level reads (Phase 5b). Hoisted here so every callsite
            // inside this card iteration can use them without re-deriving.
            const wrapperResponseDeadline = wrapper?.response_deadline ?? null;
            const wrapperPrephaseDeadline = wrapper?.prephase_deadline ?? null;
            const wrapperCloseReason = wrapper?.close_reason ?? null;
            const wrapperUpdatedAt = wrapper?.updated_at ?? question.updated_at;

            const isExpanded = expandedQuestionId === question.id;
            // Swipe-to-abstain is only allowed when the golden border is on:
            // open poll, anchor un-responded, card collapsed. Multi-question
            // polls where the user has voted on q1 but not q2 are skipped
            // (anchor not awaiting) — by then they've engaged with the poll.
            const swipeEligible = isAwaiting && !isExpanded && !isClosed && !!group.pollId;

            const handleTouchStart = (e: React.TouchEvent) => {
              isLongPress.current = false;
              isScrolling.current = false;
              setPressedQuestionId(question.id);
              touchStartPos.current = {
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
              longPressTimer.current = setTimeout(() => {
                if (!isScrolling.current && !swipeRef.current.swiping) {
                  isLongPress.current = true;
                  if ('vibrate' in navigator) {
                    try { navigator.vibrate(50); } catch {}
                  }
                  setModalQuestion(question);
                  setShowModal(true);
                  setPressedQuestionId(null);
                }
              }, 500);
            };

            // Tap toggles expand/collapse. Long-press always opens the follow-up
            // modal regardless of expansion state.
            const toggleExpand = () => {
              setExpandedQuestionId((curr) => (curr === question.id ? null : question.id));
            };

            const handleClick = () => {
              if (touchJustHandled.current || swipeJustHandled.current) return;
              toggleExpand();
            };

            // The slide-off animation has to complete BEFORE submitSwipeAbstain
            // fires; otherwise the optimistic isAwaiting flip unmounts the
            // reveal layer mid-transition and leaves a still-translated card
            // visible against an empty wrapper. setTimeout matches the 220ms
            // animation duration.
            const finalizeSwipe = () => {
              const cardEl = cardFrameRefs.current.get(question.id);
              if (!cardEl) return;
              const offset = swipeRef.current.offsetPx;
              const cardWidth = swipeRef.current.cardWidth;
              const threshold = cardWidth * SWIPE_ABSTAIN_THRESHOLD_RATIO;
              const shouldCommit = -offset >= threshold && !!swipeRef.current.pollId;

              swipeJustHandled.current = true;
              setTimeout(() => { swipeJustHandled.current = false; }, 400);

              if (shouldCommit && swipeRef.current.pollId) {
                const pollId = swipeRef.current.pollId;
                const subs = group.subQuestions;
                cardEl.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';
                cardEl.style.transform = `translateX(-${cardWidth}px)`;
                if ('vibrate' in navigator) {
                  try { navigator.vibrate(20); } catch {}
                }
                window.setTimeout(() => {
                  cardEl.style.transition = 'none';
                  cardEl.style.transform = '';
                  void submitSwipeAbstain(pollId, subs);
                }, 220);
              } else {
                cardEl.style.transition = 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)';
                cardEl.style.transform = 'translateX(0)';
                window.setTimeout(() => {
                  cardEl.style.transition = '';
                  cardEl.style.transform = '';
                }, 200);
              }
              resetSwipeRef();
              touchStartPos.current = null;
              isScrolling.current = false;
            };

            const handleTouchEnd = () => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
              if (swipeRef.current.swiping && swipeRef.current.questionId === question.id) {
                finalizeSwipe();
                setPressedQuestionId(null);
                return;
              }
              if (!isScrolling.current && !isLongPress.current) {
                setPressedQuestionId(null);
                touchJustHandled.current = true;
                setTimeout(() => { touchJustHandled.current = false; }, 400);
                toggleExpand();
              } else {
                setPressedQuestionId(null);
              }
              touchStartPos.current = null;
              isScrolling.current = false;
              if (swipeRef.current.questionId === question.id) {
                resetSwipeRef();
              }
            };

            const handleTouchMove = (e: React.TouchEvent) => {
              if (!touchStartPos.current) return;
              const dx = e.touches[0].clientX - touchStartPos.current.x;
              const dy = e.touches[0].clientY - touchStartPos.current.y;
              const adx = Math.abs(dx);
              const ady = Math.abs(dy);

              // Already swiping: keep transforming the card with the finger.
              if (swipeRef.current.swiping && swipeRef.current.questionId === question.id) {
                const cardEl = cardFrameRefs.current.get(question.id);
                if (!cardEl) return;
                // Resist rightward overshoot (rubber-band) so the gesture
                // feels anchored to leftward intent. Leftward motion is
                // unbounded — past the abstain threshold the bold reveal
                // text becomes the "you're committed" signal but the card
                // still tracks the finger.
                const offset = dx > 0 ? dx * 0.3 : dx;
                swipeRef.current.offsetPx = offset;
                cardEl.style.transition = 'none';
                cardEl.style.transform = `translateX(${offset}px)`;
                const threshold = swipeRef.current.cardWidth * SWIPE_ABSTAIN_THRESHOLD_RATIO;
                const past = -offset >= threshold;
                if (past && !swipeRef.current.pastAbstainPoint) {
                  swipeRef.current.pastAbstainPoint = true;
                  setSwipeThresholdQuestionId(question.id);
                  if ('vibrate' in navigator) {
                    try { navigator.vibrate(15); } catch {}
                  }
                } else if (!past && swipeRef.current.pastAbstainPoint) {
                  swipeRef.current.pastAbstainPoint = false;
                  setSwipeThresholdQuestionId(null);
                }
                return;
              }

              // Not yet swiping. Cancel long-press / pressed-state on
              // significant motion (matches pre-swipe behavior).
              if (adx > 10 || ady > 10) {
                isScrolling.current = true;
                setPressedQuestionId(null);
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }
              // Enter swipe mode iff motion is horizontal-dominant + leftward
              // AND the card is currently swipe-eligible. Right-only motion
              // never engages swipe mode (so right-swipe is a non-action).
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

            // Suppress the status row + voter circles + countdown for a
            // freshly-submitted placeholder card while it FLIP-animates into
            // its slot. Once POLL_HYDRATED_EVENT swaps the placeholder for
            // the real Poll, this flag clears and the card paints normally.
            const isPlaceholder = pendingPollFirstQuestionId === question.id
              || (question.poll_id?.startsWith('pending-') ?? false);

            return (
              <div
                key={question.id}
                ref={(el) => {
                  if (el) {
                    el.dataset.questionId = question.id;
                    el.dataset.groupKey = group.key;
                    cardRefs.current.set(question.id, el);
                    intersectionObserverRef.current?.observe(el);
                    groupSizeObserverRef.current?.observe(el);
                    groupWindowObserverRef.current?.observe(el);
                  } else {
                    const prev = cardRefs.current.get(question.id);
                    if (prev) {
                      intersectionObserverRef.current?.unobserve(prev);
                      groupSizeObserverRef.current?.unobserve(prev);
                      groupWindowObserverRef.current?.unobserve(prev);
                    }
                    cardRefs.current.delete(question.id);
                  }
                }}
                className="ml-0 mr-1.5 mb-3 grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-0.5"
              >
                {/* mt-[4px] sits closer to cap-to-baseline centering (5px)
                     than line-box centering (9px); emoji glyphs feel slightly
                     low at the pure line-box center, so we bias upward. */}
                <div className="col-start-1 row-start-2 flex items-center justify-center text-lg leading-none h-7 mt-[4px]">
                  {getCategoryIcon(question, isClosed)}
                </div>

                {/* Row 1 used to hold the above-card status label; the
                     label now lives in the card's footer row (see below).
                     Creator + date moved to row 3 alongside respondents
                     (commit d44c6f4 on main). Row 1 is intentionally empty. */}

                <div className="col-start-2 row-start-2 min-w-0 relative">
                {/* Swipe-to-abstain reveal layer (covered by the cardFrame
                     until the user drags left). Mounted only while
                     swipe-eligible so non-awaiting cards can't drag. */}
                {swipeEligible && (
                  <div
                    className="absolute inset-0 rounded-2xl flex items-center justify-end pr-5 text-amber-600 dark:text-amber-400 pointer-events-none select-none"
                    aria-hidden="true"
                  >
                    <span
                      className={`flex flex-col items-center leading-none transition-all duration-200 ${swipeThresholdQuestionId === question.id ? 'opacity-100 font-bold' : 'opacity-50 font-light'}`}
                    >
                      <span>Abstain</span>
                      <svg className="w-4 h-4 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                    </span>
                  </div>
                )}
                <div
                  ref={(el) => {
                    if (el) cardFrameRefs.current.set(question.id, el);
                    else cardFrameRefs.current.delete(question.id);
                  }}
                  className={`min-w-0 px-2 pt-1.5 ${isExpanded ? 'pb-1.5' : 'pb-0.5'} rounded-2xl border shadow-sm ${isAwaiting ? 'border-amber-400 dark:border-amber-500' : 'border-gray-200 dark:border-gray-800'} ${pressedQuestionId === question.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-900'} ${!isExpanded ? 'hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-blue-100 dark:active:bg-blue-900/40' : ''} ${isPlaceholder ? 'card-pending-enter' : ''} transition-colors select-none relative`}
                >
                  {/* Compact header — click/touch + long-press live here so they work
                       whether the card is collapsed or expanded without interfering
                       with interactive elements inside the expanded QuestionBallot. */}
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
                      onClick={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                    >
                      <FloatingCopyLinkButton
                        url={(() => {
                          if (typeof window === 'undefined') return '';
                          // Phase 5b: short_id lives on the poll wrapper.
                          const shortId = wrapper?.short_id || question.id;
                          return `${window.location.origin}/p/${shortId}/`;
                        })()}
                      />
                    </div>
                  </div>
                  {/* Footer row: status label on the left (countdown /
                       "Closed X ago" / "Taking Suggestions" / "Collecting
                       Availability" / etc.) and the question-type-specific
                       compact pill on the right. The pill collapses to 0
                       height when the card is expanded (inverse grid-rows
                       clip for ranked_choice / suggestion / time; the
                       yes_no compact pill is simply not rendered when
                       expanded since the full cards appear below). If the
                       row would be empty (no status AND no pill) it's not
                       rendered, so the gap doesn't appear. */}
                  {!isPlaceholder && (() => {
                    const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation();

                    // Status label is anchor-based: the poll's voting
                    // and prephase deadlines are shared across questions
                    // (per the poll design), and `isClosed` is enforced
                    // poll-atomically by Phase 3.1 close/reopen.
                    const statusEl: React.ReactNode = (() => {
                      const inSuggestions = isInSuggestionPhase(question, wrapperPrephaseDeadline);
                      const inTimeAvailability = isInTimeAvailabilityPhase(question);
                      if (isClosed) {
                        const closedAt = wrapperCloseReason === 'deadline' && wrapperResponseDeadline
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
                        return <span className="font-semibold text-blue-600 dark:text-blue-400">Taking Suggestions</span>;
                      }
                      if (inTimeAvailability) {
                        if (wrapperPrephaseDeadline) {
                          return <SimpleCountdown deadline={wrapperPrephaseDeadline} label="Availability" />;
                        }
                        return <span className="font-semibold text-blue-600 dark:text-blue-400">Collecting Availability</span>;
                      }
                      if (wrapperResponseDeadline) {
                        return <SimpleCountdown deadline={wrapperResponseDeadline} label="Voting" colorClass="text-green-600 dark:text-green-400" />;
                      }
                      return null;
                    })();

                    // Returns the type-specific compact pill JSX for one question,
                    // or null when there's nothing to show yet (no votes, no
                    // suggestions, etc.). Yes/No pills wrap in a stopBubble
                    // div because their option cards are tappable; the other
                    // pill types are display-only and bubble taps to the
                    // card's expand handler.
                    const pillForQuestion = (sp: Question): React.ReactNode => {
                      const r = questionResultsMap.get(sp.id);
                      const inSuggestions = isInSuggestionPhase(sp, wrapperPrephaseDeadline);
                      const inTimeAvailability = isInTimeAvailabilityPhase(sp);
                      if (sp.question_type === 'yes_no') {
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
                                  : (newChoice) => setPendingVoteChange({ questionId: sp.id, newChoice })
                              }
                            />
                          </div>
                        );
                      }
                      if (sp.question_type === 'ranked_choice' && r) {
                        const hasPreview = inSuggestions
                          ? (r.suggestion_counts || []).length > 0
                          : (r.total_votes || 0) > 0 && !!r.winner && r.winner !== 'tie';
                        if (!hasPreview) return null;
                        return inSuggestions ? (
                          <CompactSuggestionPreview results={r} />
                        ) : (
                          <CompactRankedChoicePreview results={r} isQuestionClosed={isClosed} />
                        );
                      }
                      if (sp.question_type === 'time' && r && !inTimeAvailability) {
                        const hasPreview = (r.total_votes || 0) > 0 && !!r.winner;
                        if (!hasPreview) return null;
                        return <CompactTimePreview results={r} isQuestionClosed={isClosed} />;
                      }
                      return null;
                    };

                    let pillEl: React.ReactNode = null;
                    if (!isMultiGroup) {
                      // Single-question group: preserve the existing
                      // per-type clip behavior. yes_no has no clip — the
                      // pill is simply omitted when expanded because the
                      // full cards take over below the row.
                      const anchorPill = pillForQuestion(question);
                      if (anchorPill) {
                        if (question.question_type === 'yes_no') {
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
                      // Multi-question group: stack one pill per question
                      // vertically inside a single CompactPreviewClip so
                      // the whole column animates to 0 in lockstep with
                      // the heavy expand clip below. Sub-questions without
                      // any data yet (no votes / no suggestions) drop
                      // their row so the column stays compact.
                      const subPills = group.subQuestions.map((sp) => {
                        const node = pillForQuestion(sp);
                        if (!node) return null;
                        return <div key={sp.id}>{node}</div>;
                      }).filter((n): n is React.ReactElement => n !== null);
                      if (subPills.length > 0) {
                        pillEl = (
                          <CompactPreviewClip isExpanded={isExpanded}>
                            <div className="flex flex-col items-end gap-1">
                              {subPills}
                            </div>
                          </CompactPreviewClip>
                        );
                      }
                    }

                    if (!statusEl && !pillEl) return null;
                    return (
                      // min-h-7 pins the row to the compact pill's natural
                      // height (~26px) so items-center keeps the status text
                      // at the same Y whether the pill is showing or clipped
                      // to 0 by CompactPreviewClip when the card expands.
                      <div className="min-h-7 flex items-center gap-2 min-w-0">
                        <div className="shrink-0 pl-1 text-sm text-gray-500 dark:text-gray-400">
                          <ClientOnly fallback={null}>{statusEl}</ClientOnly>
                        </div>
                        <div className="flex-1 min-w-0 flex justify-end">
                          {pillEl}
                        </div>
                      </div>
                    );
                  })()}
                  </div>{/* /compact header */}

                  {/* Expanded full-question content — pre-mounted (clipped) once the card
                       enters the viewport so fetches + effects complete before expansion.
                       Animates height via grid-template-rows 0fr ↔ 1fr with overflow
                       hidden on the child, so the natural expanded height is used
                       without JS measurement. */}
                  {(visibleQuestionIds.has(question.id) || isExpanded) && (() => {
                    // For yes_no questions the thread view renders the whole
                    // voting + results UI externally (via YesNoResults inline
                    // before QuestionBallot), so QuestionBallot returns null
                    // for its yes_no branch. Drop the mt-1.5 wrapper gap when
                    // every question is yes_no so nothing empty sits under
                    // the external block.
                    const allYesNo = group.subQuestions.every((sp) => sp.question_type === 'yes_no');
                    const usePollSubmit = isMultiGroup && !!group.pollId;
                    const useWrapperSubmit = !isMultiGroup && !!group.pollId && group.subQuestions[0]?.question_type !== 'yes_no';
                    const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation();
                    return (
                      <div
                        data-question-expand-grid=""
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                        aria-hidden={!isExpanded}
                      >
                        <div
                          className="overflow-hidden"
                          ref={(el) => {
                            if (el) expandedWrapperRefs.current.set(question.id, el);
                            else expandedWrapperRefs.current.delete(question.id);
                          }}
                        >
                          <div className={allYesNo && !usePollSubmit ? '' : 'mt-1.5'}>
                            {group.subQuestions.map((sp, idx) => {
                              // Phase 3.3: every yes_no question uses external
                              // rendering so non-anchor questions also get the
                              // thread-page tap-to-change flow.
                              const isYesNo = sp.question_type === 'yes_no';
                              const r = isYesNo ? questionResultsMap.get(sp.id) : undefined;
                              const userVote = isYesNo ? userVoteMap.get(sp.id) : undefined;
                              return (
                                <div
                                  key={sp.id}
                                  className={isMultiGroup && idx > 0 ? 'mt-4 pt-3 border-t border-gray-200 dark:border-gray-800' : ''}
                                >
                                  {isMultiGroup && (
                                    // Per-question section label inside the
                                    // grouped card. Shows the category icon
                                    // + the question's `details` (its
                                    // disambiguation context); falls back to
                                    // category when details is empty.
                                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                      <span className="text-base leading-none">{getCategoryIcon(sp, isClosed)}</span>
                                      <span className="truncate">
                                        {(sp.details && sp.details.trim()) || sp.category || sp.question_type.replace('_', '/')}
                                      </span>
                                    </div>
                                  )}
                                  {isYesNo && isExpanded && r && (() => {
                                    // For all-yes_no multi-groups, the displayed
                                    // selection prefers a staged choice (taps
                                    // queued for the wrapper-level Submit) over
                                    // the persisted vote.
                                    const stagedChoice = usePollSubmit
                                      ? pendingPollChoices.get(sp.id) ?? null
                                      : null;
                                    const displayedChoice = stagedChoice ?? userVote?.choice ?? null;
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
                                                    setPendingVoteChange({ questionId: sp.id, newChoice });
                                                  }
                                                }
                                          }
                                        />
                                      </div>
                                    );
                                  })()}
                                  {(() => {
                                    // Yes_no questions render externally via QuestionResultsDisplay
                                    // (Phase 3.3) — they don't have an inline Submit to suppress.
                                    const wrapperOwnsSubmit = !!group.pollId && (
                                      useWrapperSubmit ||
                                      (usePollSubmit && !isYesNo)
                                    );
                                    const wrapperVoterName = wrapperOwnsSubmit
                                      ? (pollVoterNames.get(group.pollId!) ?? getUserName() ?? '')
                                      : undefined;
                                    const setWrapperVoterName = wrapperOwnsSubmit
                                      ? ((name: string) => setPollVoterName(group.pollId!, name))
                                      : undefined;
                                    // Phase 5b: every question has a poll
                                    // wrapper post-Phase-4 backfill, so this
                                    // assertion is safe in practice.
                                    if (!wrapper) return null;
                                    return (
                                      <QuestionBallot
                                        ref={(handle) => {
                                          if (handle) subQuestionBallotRefs.current.set(sp.id, handle);
                                          else subQuestionBallotRefs.current.delete(sp.id);
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
                                        onWrapperSubmitStateChange={wrapperOwnsSubmit ? handleWrapperSubmitStateChange : undefined}
                                      />
                                    );
                                  })()}
                                </div>
                              );
                            })}
                            {usePollSubmit && group.pollId && !isClosed && (() => {
                              const pollId = group.pollId;
                              const hasYesNoStaged = group.subQuestions.some((sp) => sp.question_type === 'yes_no' && pendingPollChoices.has(sp.id));
                              const hasNonYesNoReady = group.subQuestions.some(
                                (sp) => sp.question_type !== 'yes_no' && wrapperSubmitState.get(sp.id)?.visible === true,
                              );
                              const hasStagedChange = hasYesNoStaged || hasNonYesNoReady;
                              const submitting = pollSubmitting.has(pollId);
                              const submitError = pollSubmitError.get(pollId);
                              const voterNameVal = pollVoterNames.get(pollId) ?? getUserName() ?? '';
                              return (
                                <div
                                  className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800"
                                  onClick={stopBubble}
                                  onTouchStart={stopBubble}
                                  onTouchEnd={stopBubble}
                                  onTouchMove={stopBubble}
                                >
                                  <div className="mb-3 empty:hidden">
                                    <CompactNameField
                                      name={voterNameVal}
                                      setName={(name: string) => setPollVoterName(pollId, name)}
                                      disabled={submitting}
                                      maxLength={30}
                                    />
                                  </div>
                                  {submitError && (
                                    <div className="mb-3 p-2 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
                                      {submitError}
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Snapshot prepared items at button-tap
                                      // so edits between click and confirm
                                      // don't leak into the in-flight batch.
                                      const preparedNonYesNo: PreparedNonYesNoEntry[] = [];
                                      let stagedCount = 0;
                                      let hadValidationError = false;
                                      for (const sp of group.subQuestions) {
                                        if (sp.question_type === 'yes_no') {
                                          if (pendingPollChoices.has(sp.id)) stagedCount++;
                                          continue;
                                        }
                                        const handle = subQuestionBallotRefs.current.get(sp.id);
                                        if (!handle) continue;
                                        const result = handle.prepareBatchVoteItem();
                                        if ('skip' in result) continue;
                                        if (!result.ok) {
                                          // Error is surfaced inline via QuestionBallot.voteError.
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
                                    {submitting ? 'Submitting...' : 'Submit Vote'}
                                  </button>
                                </div>
                              );
                            })()}
                            {useWrapperSubmit && group.pollId && !isClosed && (() => {
                              const pollId = group.pollId;
                              const sp = group.subQuestions[0]!;
                              const submitState = wrapperSubmitState.get(sp.id);
                              if (!submitState?.visible) return null;
                              const voterNameVal = pollVoterNames.get(pollId) ?? getUserName() ?? '';
                              return (
                                <div
                                  className="mt-3"
                                  onClick={stopBubble}
                                  onTouchStart={stopBubble}
                                  onTouchEnd={stopBubble}
                                  onTouchMove={stopBubble}
                                >
                                  <div className="mb-3 empty:hidden">
                                    <CompactNameField
                                      name={voterNameVal}
                                      setName={(name: string) => setPollVoterName(pollId, name)}
                                      maxLength={30}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      subQuestionBallotRefs.current.get(sp.id)?.triggerSubmit();
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
                    );
                  })()}
                </div>
                </div>

                {/* Creator + pub date on the left, respondents on the right.
                     Creator/date takes its natural width (shrink-0) so the
                     respondent bubbles get the remainder of the row — replacing
                     the old fixed max-w-[75%] respondent cap.
                     Hidden during the placeholder/FLIP phase: only the title
                     should be visible until the real poll hydrates. */}
                {!isPlaceholder && (
                <div className="col-start-2 row-start-3 mt-0 px-3 flex items-start gap-2 min-w-0">
                  <ClientOnly fallback={null}>
                    <span className="shrink-0 truncate text-xs text-gray-400 dark:text-gray-500 mt-px">
                      {wrapper?.creator_name && <>{wrapper.creator_name} &middot; </>}
                      <span
                        className="relative cursor-help"
                        onClick={() => setTooltipQuestionId((prev) => (prev === question.id ? null : question.id))}
                        onMouseEnter={() => setTooltipQuestionId(question.id)}
                        onMouseLeave={() => setTooltipQuestionId((prev) => (prev === question.id ? null : prev))}
                      >
                        {relativeTime(question.created_at)}
                        {tooltipQuestionId === question.id && (
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
                      // Poll-level respondent row. Sourced from the
                      // poll wrapper (voter_names + anonymous_count) per
                      // the Addressability paradigm — never aggregated from
                      // question vote fetches client-side. Falls back to
                      // empty placeholder until the wrapper resolves.
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
                        filter={isInSuggestionPhase(question, wrapperPrephaseDeadline) ? suggestionPhaseRespondentFilter : undefined}
                        emptyText={isInSuggestionPhase(question, wrapperPrephaseDeadline) ? 'No suggestions yet' : 'No voters'}
                      />
                    )}
                  </ClientOnly>
                </div>
                )}
              </div>
            );
          })}

        {/* Render target for the in-progress draft poll card while the
            create-poll panel is open. Filled by CreateQuestionContent. */}
        <div id={DRAFT_POLL_PORTAL_ID} />
      </div>

      {/* Thread-aware long-press modal — Copy + Forget, plus Reopen when
           the poll is closed and the current browser is the creator (or dev). */}
      {modalQuestion && (() => {
        const modalWrapper = wrapperFor(modalQuestion);
        if (!modalWrapper) return null;
        const isModalClosed = !!modalWrapper.is_closed;
        return (
          <FollowUpModal
            isOpen={showModal}
            question={modalQuestion}
            poll={modalWrapper}
            totalVotes={questionResultsMap.get(modalQuestion.id)?.total_votes}
            onClose={() => setShowModal(false)}
            onDelete={() => setPendingAction({ kind: 'forget', question: modalQuestion })}
            onReopen={
              isModalClosed &&
              (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'reopen', question: modalQuestion })
                : undefined
            }
            onCloseQuestion={
              !isModalClosed &&
              (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'close', question: modalQuestion })
                : undefined
            }
            onCutoffAvailability={
              !isModalClosed &&
              isInTimeAvailabilityPhase(modalQuestion) &&
              (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'cutoff-availability', question: modalQuestion })
                : undefined
            }
          />
        );
      })()}

      {/* Single confirmation for forget + reopen + close — all three share
           the same lifecycle (tap → confirm/cancel → optimistic state update).
           Per-kind copy lives in PENDING_ACTION_COPY above. */}
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
          setPendingAction(null);
          if (action.kind === 'forget') {
            forgetQuestion(action.question.id);
            // If the forgotten question was expanded, collapse it so the URL doesn't
            // still point at /p/<deletedId>.
            setExpandedQuestionId((curr) => (curr === action.question.id ? null : curr));
            setThread((prev) => {
              if (!prev) return prev;
              const remaining = prev.questions.filter((p) => p.id !== action.question.id);
              if (remaining.length === 0) {
                router.push('/');
                return prev;
              }
              return { ...prev, questions: remaining };
            });
          } else if (action.kind === 'reopen') {
            try {
              const secret = getCreatorSecret(action.question.id) || 'dev-override';
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error('Cannot reopen question without poll_id');
                return;
              }
              const updated = await apiReopenPoll(pollId, secret);
              patchThreadPolls(
                (mp) => mp.id === pollId,
                () => ({
                  is_closed: false,
                  close_reason: null,
                  response_deadline: updated.response_deadline ?? null,
                }),
              );
            } catch (err) {
              console.error('Failed to reopen question:', err);
            }
          } else if (action.kind === 'close') {
            try {
              const secret = getCreatorSecret(action.question.id) || '';
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error('Cannot close question without poll_id');
                return;
              }
              await apiClosePoll(pollId, secret);
              patchThreadPolls(
                (mp) => mp.id === pollId,
                () => ({ is_closed: true, close_reason: 'manual' }),
              );
            } catch (err) {
              console.error('Failed to close question:', err);
            }
          } else if (action.kind === 'cutoff-availability') {
            try {
              const secret = getCreatorSecret(action.question.id);
              if (!secret) {
                console.error('Missing creator secret for cutoff-availability');
                return;
              }
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error('Cannot cutoff availability without poll_id');
                return;
              }
              const wrapper = await apiCutoffPollAvailability(pollId, secret);
              const updated = wrapper.questions.find((sp) => sp.id === action.question.id) ?? null;
              // Wrapper-level prephase_deadline + per-question options.
              patchThreadPolls(
                (mp) => mp.id === pollId,
                () => ({
                  prephase_deadline: wrapper.prephase_deadline ?? null,
                }),
              );
              if (updated) {
                patchThreadQuestions(
                  (p) => p.id === action.question.id,
                  (p) => ({ options: updated.options ?? p.options }),
                );
              }
              // Refresh the compact preview — the availability phase just ended so
              // time-slot results are now meaningful.
              const refreshed = await apiGetQuestionResults(action.question.id).catch(() => null);
              if (refreshed) {
                setQuestionResultsMap((prev) => {
                  const existing = prev.get(action.question.id);
                  if (
                    existing &&
                    existing.total_votes === refreshed.total_votes &&
                    existing.yes_count === refreshed.yes_count &&
                    existing.no_count === refreshed.no_count &&
                    existing.winner === refreshed.winner &&
                    (existing.suggestion_counts?.length ?? 0) === (refreshed.suggestion_counts?.length ?? 0)
                  ) {
                    return prev;
                  }
                  const next = new Map(prev);
                  next.set(action.question.id, refreshed);
                  return next;
                });
              }
            } catch (err) {
              console.error('Failed to end availability phase:', err);
            }
          }
        }}
        onCancel={() => setPendingAction(null)}
      />
      )}

      {/* Yes/No vote-change confirmation — triggered by tapping a non-chosen
          option (or the Abstain link) on the external YesNoResults card.
          Only fires for non-multi-group cards; all-yes_no multi-groups stage
          instead and confirm via the wrapper-level modal below. */}
      <ConfirmationModal
        isOpen={!!pendingVoteChange}
        title="Change vote?"
        message={
          pendingVoteChange
            ? (() => {
                const current = userVoteMap.get(pendingVoteChange.questionId)?.choice;
                const label = (c: 'yes' | 'no' | 'abstain' | null | undefined) =>
                  c === 'abstain' ? 'Abstain' : c === 'yes' ? 'Yes' : c === 'no' ? 'No' : '';
                return `Change your vote from ${label(current)} to ${label(pendingVoteChange.newChoice)}?`;
              })()
            : ''
        }
        confirmText={voteChangeSubmitting ? 'Saving…' : 'Change vote'}
        cancelText="Cancel"
        confirmButtonClass="bg-blue-600 hover:bg-blue-700 text-white"
        onConfirm={confirmVoteChange}
        onCancel={() => setPendingVoteChange(null)}
      />

      {/* Wrapper-level Submit confirmation. subQuestions + stagedCount are
          snapshotted at button-tap time so the modal stays consistent if
          groupedThreadQuestions re-derives mid-confirmation. */}
      <ConfirmationModal
        isOpen={!!pendingPollSubmit}
        title="Submit vote"
        message={
          pendingPollSubmit
            ? pendingPollSubmit.stagedCount === 1
              ? 'Submit your vote on this question?'
              : `Submit your vote across ${pendingPollSubmit.stagedCount} questions?`
            : ''
        }
        confirmText={pendingPollSubmit && pollSubmitting.has(pendingPollSubmit.pollId) ? 'Submitting…' : 'Submit Vote'}
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

      {/* Scroll-helper buttons — rendered via the floating-fab-portal so
          `position: fixed` is relative to the real viewport (outside the
          responsive-scaling container's transform on desktop). */}
      {scrollHelperPortal && createPortal(
        <>
          {scrollHelpers.showUp && (
            <ScrollHelperButton
              direction="up"
              onClick={() => scrollAwaitingToHeader(scrollHelpers.upTargetId)}
              aria-label="Scroll to next poll awaiting your response"
              style={{ top: `calc(${headerHeight}px + 0.5rem)` }}
            />
          )}
          {scrollHelpers.showDown && (
            <ScrollHelperButton
              direction="down"
              onClick={() => scrollAwaitingToHeader(scrollHelpers.downTargetId)}
              aria-label="Scroll to next poll awaiting your response"
              style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
            />
          )}
        </>,
        scrollHelperPortal,
      )}
    </>
  );
}

// Resolves the URL param `/p/<shortId>/` (poll short_id, poll uuid, or question
// uuid) to the thread root + the poll the URL points at, then renders
// ThreadContent with that poll's first question expanded.
function PollPageInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const shortId = params.shortId as string;
  // The `thread=1` query param is set by the home page's ThreadList when it
  // picks a URL via the thread-level rule (oldest open+unresponded poll, or
  // newest as fallback). Without the flag, the URL is treated as a direct
  // share and the linked poll is always expanded; with the flag, we suppress
  // the auto-expand when nothing about the linked poll is actionable
  // (voted on AND closed).
  const fromThreadList = searchParams.get(THREAD_QUERY_PARAM) !== null;

  // Memo on shortId — without it the IIFE allocates a new object every render,
  // and the useEffect below (which depends on resolvedInitial) would refire
  // on every parent re-render even when the URL hasn't changed.
  const resolvedInitial = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!shortId) return null;
    let poll: Poll | null = null;
    let question: Question | null = null;
    if (isUuidLike(shortId)) {
      poll = getCachedPollById(shortId);
      if (poll) {
        question = poll.questions[0] ?? null;
      } else {
        const cachedQuestion = getCachedQuestionById(shortId);
        if (cachedQuestion) {
          question = cachedQuestion;
          if (cachedQuestion.poll_id) {
            poll = getCachedPollById(cachedQuestion.poll_id);
          }
        }
      }
    } else {
      poll = getCachedPollByShortId(shortId);
      if (poll) question = poll.questions[0] ?? null;
    }
    if (!question || !poll) return null;
    const byPoll = buildPollMap([poll, ...(getCachedAccessiblePolls() ?? [])]);
    const rootRouteId = findThreadRootRouteId(poll, (mid) => byPoll.get(mid) ?? null);
    return { question, rootRouteId };
  }, [shortId]);

  const [resolved, setResolved] = useState<{ question: Question; rootRouteId: string } | null>(resolvedInitial);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!shortId) {
      router.replace("/");
      return;
    }
    if (resolvedInitial) {
      addAccessibleQuestionId(resolvedInitial.question.id);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const isUuid = isUuidLike(shortId);
        let poll: Poll | null = await (isUuid
          ? apiGetPollById(shortId)
          : apiGetPollByShortId(shortId)
        ).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        });
        let question: Question | null = poll?.questions[0] ?? null;
        if (!poll && isUuid) {
          question = await apiGetQuestionById(shortId).catch(() => null);
          if (question?.poll_id) {
            poll = await apiGetPollById(question.poll_id).catch(() => null);
          }
        }
        if (!question || !poll) {
          if (!cancelled) setError(true);
          return;
        }
        addAccessibleQuestionId(question.id);
        try { await discoverRelatedQuestions(); } catch {}
        const accessible = (await getAccessiblePolls()) ?? [];
        const byPoll = buildPollMap([poll, ...accessible]);
        const rootRouteId = findThreadRootRouteId(poll, (mid) => byPoll.get(mid) ?? null);
        if (!cancelled) setResolved({ question, rootRouteId });
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [shortId, router, resolvedInitial]);

  // When the URL came from the home thread-list (`?thread=1`), the picker
  // returns either (a) the oldest awaiting poll, or (b) the newest poll as a
  // fallback when nothing is awaiting. In case (b) — every poll responded to,
  // or every poll closed — we want to skip auto-expand so ThreadContent's
  // "no initial expand → scroll to bottom of document" path lands the user
  // on the draft poll form instead of an irrelevant expanded card.
  // `pollHasAwaitingQuestion(linkedPoll)` distinguishes the two cases: it
  // returns true iff the linked poll itself is open with at least one
  // unresponded question, which is exactly case (a).
  const suppressExpand = useMemo(() => {
    if (!resolved) return false;
    if (!fromThreadList) return false;
    if (typeof window === 'undefined') return false;
    const cachedPoll = resolved.question.poll_id
      ? getCachedPollById(resolved.question.poll_id)
      : null;
    if (!cachedPoll) return false;
    const { votedQuestionIds, abstainedQuestionIds } = loadVotedQuestions();
    return !pollHasAwaitingQuestion(cachedPoll, votedQuestionIds, abstainedQuestionIds);
  }, [fromThreadList, resolved]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Poll Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This poll may have been removed or the link is incorrect.</p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading poll...</p>
        </div>
      </div>
    );
  }

  return (
    <ThreadContent
      threadId={resolved.rootRouteId}
      initialExpandedQuestionId={suppressExpand ? null : resolved.question.id}
    />
  );
}

export default function PollPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-64 mx-auto mb-4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mx-auto mb-8"></div>
            <div className="space-y-3">
              <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
              <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            </div>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading poll...</p>
        </div>
      </div>
    }>
      <PollPageInner />
    </Suspense>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo, Suspense } from "react";
import { flushSync, createPortal } from "react-dom";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Question } from "@/lib/types";
import { getMyThreads } from "@/lib/simpleQuestionQueries";
import { buildThreadFromPollDown, buildThreadSyncFromCache, buildPollMap, findChainRoot, isPendingPollId, POLL_QUERY_PARAM } from "@/lib/threadUtils";
import { apiGetQuestionResults, apiGetThreadByRouteId, apiGetVotes, apiClosePoll, apiReopenPoll, apiCutoffPollAvailability, apiGetPollById, apiGetPollByShortId, apiGrantPollAccess, apiLeaveThread, ApiError, QUESTION_VOTES_CHANGED_EVENT } from "@/lib/api";
import type { Poll } from "@/lib/types";
import { useThreadVoting } from "@/lib/useThreadVoting";
import type { QuestionResults } from "@/lib/types";
import { addAccessibleQuestionId, getCreatorSecret } from "@/lib/browserQuestionAccess";
import { getCachedAccessiblePolls, getCachedPollById, getCachedPollByShortId, getCachedPollForShortId } from "@/lib/questionCache";
import {
  POLL_PENDING_EVENT,
  POLL_HYDRATED_EVENT,
  POLL_FAILED_EVENT,
  type PollPendingDetail,
  type PollHydratedDetail,
  type PollFailedDetail,
} from "@/lib/eventChannels";
import { isUuidLike } from "@/lib/questionId";
import { DRAFT_POLL_PORTAL_ID, THREAD_LATEST_QUESTION_ID_ATTR } from "@/lib/threadDomMarkers";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { isInTimeAvailabilityPhase } from "@/lib/questionListUtils";
import { loadVotedQuestions, getStoredVoteId, parseYesNoChoice } from "@/lib/votedQuestionsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition } from "@/lib/viewTransitions";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import { type QuestionBallotHandle } from "@/components/QuestionBallot";
import ThreadHeader from "@/components/ThreadHeader";
import { forgetQuestion } from "@/lib/forgetQuestion";
import { PENDING_ACTION_COPY, type PendingActionKind } from "./threadActionCopy";
import { ThreadCardItem, type SwipeState, type ThreadCardGroup } from "./ThreadCardItem";

import type { Thread } from "@/lib/threadUtils";

// Default placeholder height for not-yet-measured groups in the virtualized
// thread list. Tuned to typical compact yes_no card height; the ResizeObserver
// replaces this with the measured value as soon as a group has been mounted
// once. Subsequent unmounts use the measured height, so unmount→remount cycles
// don't shift the document layout.
const ESTIMATED_GROUP_HEIGHT = 110;

// Group key for `groupedThreadQuestions` — questions of the same poll share
// poll_id; legacy (non-poll) questions get a unique `solo-` prefix so they
// don't collide. Used in the .map() loop's key + virtualization mountedKeys.
const groupKeyFor = (q: { id: string; poll_id?: string | null }): string =>
  q.poll_id ?? `solo-${q.id}`;

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
// Shared cache-driven Thread rebuild for POLL_PENDING / POLL_HYDRATED /
// POLL_FAILED setThread updaters. Returns prev when the rebuild would produce
// the same poll-id sequence (no placeholder swap) so identity-based memos stay
// stable.
//
// `mutate` lets callers add a just-arrived poll (placeholder or real) and/or
// drop a placeholder being replaced. Without explicit add/remove, leaving the
// placeholder AND the real poll both in scope would yield a thread containing
// both as children of the parent.
//
// `prev.polls` is always merged into the rebuild source. This is the
// resilience fallback for stale `accessiblePollsCache`: the cache has a 60s
// TTL, and the submit handler's `cacheAccessiblePolls([...getCached() ?? [],
// new])` pattern wipes every other poll out of the cache when the cache
// happened to be stale (idle >60s). Without prev.polls in the merge, the
// `buildThreadFromPollDown(rootPollId, ...)` call fails to find rootPollId and
// the new poll never lands in the thread.
function rebuildThreadFromCacheOrPrev(
  prev: Thread,
  mutate?: { add?: Poll; remove?: string },
): Thread {
  if (!prev.rootPollId) return prev;
  const cached = getCachedAccessiblePolls() ?? [];
  const byId = new Map<string, Poll>();
  for (const p of prev.polls) byId.set(p.id, p);
  for (const p of cached) byId.set(p.id, p);
  if (mutate?.remove) byId.delete(mutate.remove);
  if (mutate?.add) byId.set(mutate.add.id, mutate.add);
  const polls = Array.from(byId.values());
  const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
  const rebuilt = buildThreadFromPollDown(prev.rootPollId, polls, voted, abstained);
  if (!rebuilt) return prev;
  if (
    rebuilt.polls.length === prev.polls.length &&
    rebuilt.polls.every((p, i) => p.id === prev.polls[i].id)
  ) {
    return prev;
  }
  return rebuilt;
}

interface ThreadContentProps {
  threadId: string;
  /** Poll short_id from `?p=<id>`. Forwarded to apiGetThreadByRouteId so
   *  the server inline-grants poll_access for cold-load direct links —
   *  same Phase C.3 race fix as ThreadPageInner's first call. */
  initialPollShortId?: string | null;
  initialExpandedQuestionId?: string | null;
}

export function ThreadContent({ threadId, initialExpandedQuestionId = null, initialPollShortId = null }: ThreadContentProps) {
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

  // Prefetch `/t/<root>?p=<poll>` for every poll in the thread so taps land
  // on a warm cache. The path stays constant (thread root); only `?p=` varies.
  useEffect(() => {
    if (!thread) return;
    const wrapperByQuestionId = new Map<string, string>();
    for (const mp of thread.polls) {
      if (!mp.short_id) continue;
      for (const sp of mp.questions) wrapperByQuestionId.set(sp.id, mp.short_id);
    }
    const hrefs = thread.questions.map(p => {
      const pollShort = wrapperByQuestionId.get(p.id);
      return pollShort ? `/t/${threadId}?${POLL_QUERY_PARAM}=${pollShort}` : `/t/${threadId}`;
    });
    prefetchBatch(hrefs, { priority: "low" });
  }, [thread, prefetchBatch, threadId]);

  // Expanded card state — only one card can be expanded at a time.
  // Initialized from the prop so the `/t/<root>?p=<id>` route can open a card on first render.
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
    submitYesNoChoice,
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
  // on long threads; placeholders take the same height the card occupied so
  // mount/unmount cycles don't shift the document layout.
  const groupHeightById = useRef<Map<string, number>>(new Map());
  const groupSizeObserverRef = useRef<ResizeObserver | null>(null);
  // Shared ref-callback wiring for both placeholder and real card divs:
  // both register in cardRefs (so the existing scroll-helper logic that
  // iterates cardRefs works regardless of mount state) and observe via the
  // visibleQuestionIds + groupSize observers. useCallback with empty deps —
  // identity must be stable across renders since these are passed into the
  // React.memo'd ThreadCardItem; a fresh closure per render would force every
  // card to re-render on every parent state change.
  const attachCardEl = useCallback((el: HTMLElement, anchorId: string, groupKey: string) => {
    el.dataset.questionId = anchorId;
    el.dataset.groupKey = groupKey;
    cardRefs.current.set(anchorId, el as HTMLDivElement);
    intersectionObserverRef.current?.observe(el);
    groupSizeObserverRef.current?.observe(el);
  }, []);
  const detachCardEl = useCallback((anchorId: string) => {
    const prev = cardRefs.current.get(anchorId);
    if (prev) {
      intersectionObserverRef.current?.unobserve(prev);
      groupSizeObserverRef.current?.unobserve(prev);
    }
    cardRefs.current.delete(anchorId);
  }, []);
  // Both anchor modes (card-anchor and bottom-pin) keep their pin active
  // until the user explicitly interacts (wheel, touch, keyboard). The earlier
  // delta-based approach (track prev offsetTop, scrollBy diff) couldn't
  // distinguish a real user scroll from the browser's silent scrollY clamp
  // when the doc shrinks; gating on real input events sidesteps that.
  const userInteractedRef = useRef(false);
  const [mountedGroupKeys, setMountedGroupKeys] = useState<Set<string>>(() => {
    if (!initialThread) return new Set();
    // Seed with the URL-anchored group only — keeps initial paint cheap
    // (one card rendered) even for very long threads. The progressive-fill
    // effect below mounts the rest in idle-time batches around the anchor.
    const initial = new Set<string>();
    const target = initialExpandedQuestionId
      ? initialThread.questions.find(p => p.id === initialExpandedQuestionId)
      : null;
    const seed = target ?? initialThread.questions[initialThread.questions.length - 1] ?? null;
    if (seed) initial.add(groupKeyFor(seed));
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
  const swipeRef = useRef<SwipeState>({
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
  // Stable callback identity for ThreadCardItem props — empty deps because
  // every reference inside is itself stable (refs + useState dispatcher).
  const resetSwipeRef = useCallback(() => {
    swipeRef.current.questionId = null;
    swipeRef.current.pollId = null;
    swipeRef.current.swiping = false;
    swipeRef.current.pastAbstainPoint = false;
    swipeRef.current.offsetPx = 0;
    setSwipeThresholdQuestionId(null);
  }, []);

  // On cache hit, defer the background refresh via requestIdleCallback so it
  // doesn't compete with React commit during a view transition.
  useEffect(() => {
    async function fetchThread() {
      try {
        if (!initialThread) setLoading(true);
        setError(false);

        // Phase B.3: one round-trip — apiGetThreadByRouteId resolves the
        // route id to a thread_id and returns every poll in that thread,
        // with full inline-results / voter aggregates. The legacy
        // discoverRelatedQuestions + getAccessiblePolls pair walked the
        // follow_up_to chain client-side; the server walks polls.thread_id
        // directly now.
        //
        // Votes prefetch fires in parallel so the votes cache is warm by
        // the time VoterList mounts — bubbles render alongside the cards
        // instead of ~100ms after. apiGetVotes is cache + in-flight
        // coalesced, so the later per-card fetch hits the warm cache.
        let polls: Poll[];
        try {
          polls = await apiGetThreadByRouteId(threadId, { pollShortId: initialPollShortId });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) { setError(true); return; }
          throw err;
        }
        const anchorPoll = findChainRoot(polls);
        if (!anchorPoll) { setError(true); return; }
        // Persist any newly-discovered question_ids to localStorage so a
        // forget-and-re-discover cycle still works on direct navigation.
        for (const mp of polls) {
          for (const sp of mp.questions) addAccessibleQuestionId(sp.id);
        }
        for (const mp of polls) {
          for (const sp of mp.questions) void apiGetVotes(sp.id).catch(() => null);
        }

        // Re-read voted state — discovery or the user voting elsewhere may have changed it.
        const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
        const foundThread = buildThreadFromPollDown(anchorPoll.id, polls, voted, abstained);

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

      const t = threadRef.current;
      if (!t) return;

      // Recognize the placeholder as belonging to this thread either by its
      // resolved follow_up_to (parent poll id) or by being the thread's own
      // root. The follow_up_to may be null when create-poll's lookup hit a
      // stale `accessiblePollsCache` — the rebuild's prev.polls fallback
      // covers that, so we don't need to bail here.
      const threadPollIds = new Set(t.polls.map((p) => p.id));
      const isFollowUp = newPoll.follow_up_to && threadPollIds.has(newPoll.follow_up_to);
      const isOwnRoot = newPoll.id === t.rootPollId;
      if (!isFollowUp && !isOwnRoot) return;

      flushSync(() => {
        setPendingPollFirstQuestionId(newPoll.questions[0]?.id ?? null);
        setThread((prev) => prev ? rebuildThreadFromCacheOrPrev(prev, { add: newPoll }) : prev);
        // Mount the new card eagerly. Without this, the validation effect
        // resets mountedGroupKeys to (prev ∩ validKeys + anchor), which
        // doesn't include this freshly-added group key. The card would
        // render as a gray placeholder div until progressive fill walked
        // the queue to it (~270ms on a long thread, since the new card
        // sits at the chronological end far from the URL anchor).
        setMountedGroupKeys((prev) => {
          if (prev.has(newPoll.id)) return prev;
          const next = new Set(prev);
          next.add(newPoll.id);
          return next;
        });
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

      // Optimistic in-place rebuild from prev.polls + cache + realPoll.
      // prev.polls is the resilience fallback for stale `accessiblePollsCache`
      // (60s TTL) — the submit handler's `cacheAccessiblePolls([...getCached()
      // ?? [], realPoll])` writes only [realPoll] when the cache was stale,
      // and without prev.polls in the merge `buildThreadFromPollDown` can't
      // find rootPollId and bails.
      //
      // `optimisticWillAdd` mirrors the bail check inside the updater: when
      // the placeholder is in thread state OR realPoll's parent is recognized
      // OR realPoll IS the root, the rebuild succeeds and lands realPoll.
      // When false the optimistic bails to prev and the async refresh below
      // is the only path that brings the new poll in. Computed from
      // threadRef.current (kept in sync via a [thread] useEffect) instead of
      // inside the updater because setState is async — reading the flag
      // synchronously after setThread would see the pre-write value.
      const t = threadRef.current;
      const threadPollIds = new Set(t?.polls.map(p => p.id) ?? []);
      const optimisticWillAdd =
        !!t && (
          (!!realPoll.follow_up_to && threadPollIds.has(realPoll.follow_up_to)) ||
          realPoll.id === t.rootPollId ||
          t.polls.some(p => p.id === placeholderId)
        );
      setThread((prev) => {
        if (!prev) return prev;
        const prevPollIds = new Set(prev.polls.map(p => p.id));
        const isFollowUp = realPoll.follow_up_to && prevPollIds.has(realPoll.follow_up_to);
        const isOwnRoot = realPoll.id === prev.rootPollId;
        const hasPlaceholder = prev.polls.some(p => p.id === placeholderId);
        if (!hasPlaceholder && !isFollowUp && !isOwnRoot) return prev;
        return rebuildThreadFromCacheOrPrev(prev, { add: realPoll, remove: placeholderId });
      });
      setPendingPollFirstQuestionId(null);
      // Mount the real card eagerly (same reason as POLL_PENDING — see
      // comment there). Drop the placeholder's key in the same setState so
      // mountedGroupKeys stays consistent with thread state.
      setMountedGroupKeys((prev) => {
        if (!prev.has(placeholderId) && prev.has(realPoll.id)) return prev;
        const next = new Set(prev);
        next.delete(placeholderId);
        next.add(realPoll.id);
        return next;
      });

      // Optimistic-rebuild fallback: when the new poll's parent isn't in
      // prev.polls (e.g. the parent was discovered AFTER thread state was
      // built — accessiblePollsCache got invalidated, so the cache fallback
      // can't fill it in either), the in-place rebuild leaves the new poll
      // out of the chain. Re-fetch the accessible-polls list (which respects
      // localStorage's full set, including any newly-discovered ancestors)
      // and rebuild from a fresh source. Skip when the optimistic rebuild
      // already landed the realPoll — saves a cache-fetch + redundant
      // setState per submit on the happy path.
      if (optimisticWillAdd) return;
      void (async () => {
        try {
          await getMyThreads();
          setThread((prev) => prev ? rebuildThreadFromCacheOrPrev(prev, { add: realPoll, remove: placeholderId }) : prev);
        } catch {
          // Optimistic rebuild has already fired; nothing else to do.
        }
      })();
    };
    window.addEventListener(POLL_HYDRATED_EVENT, handler);
    return () => window.removeEventListener(POLL_HYDRATED_EVENT, handler);
  }, []);

  // POLL_FAILED_EVENT: apiCreatePoll rejected. Rebuild from cache (the
  // submit handler has already evicted the placeholder before dispatching).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollFailedDetail>).detail;
      const placeholderId = detail?.placeholderId;
      setThread((prev) => {
        if (!prev) return prev;
        // Skip rebuild when no placeholder is present — POLL_FAILED on a
        // brand-new-thread submit fires while we're on a different thread.
        if (!prev.polls.some(p => isPendingPollId(p.id))) return prev;
        return rebuildThreadFromCacheOrPrev(prev, placeholderId ? { remove: placeholderId } : undefined);
      });
      setPendingPollFirstQuestionId(null);
      if (placeholderId) {
        setMountedGroupKeys((prev) => {
          if (!prev.has(placeholderId)) return prev;
          const next = new Set(prev);
          next.delete(placeholderId);
          return next;
        });
      }
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
      if (isPendingPollId(questionId)) return;
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
  // Four scroll surfaces all serve the same goal: keep the viewer's
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
  // 1b. ANCHOR PIN (`applyScrollAdjustmentRef`, called from layout effect
  //    AND ResizeObserver): until the user first interacts (wheel,
  //    touchstart, keydown), each layout settling re-applies the path-1
  //    target. Without this, cards above the URL anchor mounting from
  //    placeholder→card with a different actual height would slide the
  //    anchor away from the top, and async content (draft form, fonts)
  //    would shift the bottom-pin'd page off the bottom. Gating on user
  //    interaction (rather than scrollY deltas) avoids fighting the
  //    browser's silent scrollY clamp when the doc shrinks — that clamp
  //    fires a scroll event indistinguishable from a user gesture, but
  //    no wheel/touch/keydown happens.
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

  // Strict chronological order (oldest → newest, newest at bottom). No
  // awaiting/closed grouping — voting on a card never reshuffles the list,
  // so the sort can read live state directly. Defined above the early
  // returns so the hook call order is stable.
  const threadQuestions = useMemo(() => {
    if (!thread) return [] as Question[];
    return [...thread.questions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
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
      const groupKey = groupKeyFor(question);
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

  // Drop mountedGroupKeys entries for groups that no longer exist (forget,
  // error reload). Always include the anchor. Progressive fill below adds
  // the rest of the keys.
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

  // Progressive fill: after first paint, mount remaining groups in idle-time
  // batches, prioritizing the cards closest to the anchor so the user sees
  // surrounding content fill in first. Batches of N groups per idle tick keep
  // each setState's re-render bounded; once all are mounted, no more setState
  // fires, so subsequent scroll is steady. For very long threads this still
  // loads everything (memory grows linearly with thread size); cards are
  // already extracted into a React.memo'd ThreadCardItem, so a future
  // bounded-memory scroll-window can swap this fill for IO-driven
  // mount/unmount when threads hit hundreds of polls. See CLAUDE.md
  // "Thread-Page Layout Stability".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (groupedThreadQuestions.length === 0) return;
    if (mountedGroupKeys.size >= groupedThreadQuestions.length) return;
    const anchorIdx = anchorGroupKey
      ? groupedThreadQuestions.findIndex(g => g.key === anchorGroupKey)
      : 0;
    // Build a queue ordered by distance from anchor.
    const queue: string[] = [];
    const len = groupedThreadQuestions.length;
    for (let d = 1; queue.length < len; d++) {
      const before = anchorIdx - d;
      const after = anchorIdx + d;
      if (after < len) queue.push(groupedThreadQuestions[after].key);
      if (before >= 0) queue.push(groupedThreadQuestions[before].key);
      if (before < 0 && after >= len) break;
    }
    const BATCH = 4;
    let cancelled = false;
    let cursor = 0;
    const ric: ((cb: () => void) => number) =
      (window as any).requestIdleCallback?.bind(window)
      ?? ((cb: () => void) => window.setTimeout(cb, 16));
    const tick = () => {
      if (cancelled) return;
      const batch = queue.slice(cursor, cursor + BATCH).filter(k => !mountedGroupKeys.has(k));
      cursor += BATCH;
      if (batch.length > 0) {
        setMountedGroupKeys(prev => {
          const next = new Set(prev);
          for (const k of batch) next.add(k);
          return next;
        });
      }
      if (cursor < queue.length) ric(tick);
    };
    const handle = ric(tick);
    return () => {
      cancelled = true;
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(handle);
    };
    // We deliberately omit mountedGroupKeys from deps so this effect runs
    // once per groupedThreadQuestions change rather than on each batch
    // setState; the cursor + filter handle resumption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedThreadQuestions, anchorGroupKey]);

  // ResizeObserver: keep groupHeightById in sync with each rendered group's
  // actual height (mounted card OR placeholder). Placeholders use these
  // measurements so unmounting a card doesn't shift the document.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      let layoutDirty = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (el === document.documentElement) {
          // The doc itself resized — usually means content below the cards
          // (draft poll portal filling in, async-loaded images/fonts) just
          // landed. Trigger pin recheck regardless of card-height changes.
          layoutDirty = true;
          continue;
        }
        const key = el.dataset.groupKey;
        if (!key) continue;
        // Use borderBoxSize to avoid the forced layout that el.offsetHeight
        // triggers per entry — during iOS URL-bar transitions every observed
        // card fires at once, and 26 forced layouts back-to-back stutters
        // the scroll. Round to 1px so sub-pixel jitter doesn't churn.
        const blockSize = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const h = Math.round(blockSize);
        if (h <= 0) continue;
        if (groupHeightById.current.get(key) === h) continue;
        groupHeightById.current.set(key, h);
        layoutDirty = true;
      }
      // Re-apply scroll adjustment on layout-only changes (async content
      // filling cards, draft form mounting, fonts/images settling). Without
      // this, neither bottom-pin nor card-anchor compensation re-fires when
      // doc size changes outside React's render cycle.
      if (layoutDirty) {
        applyScrollAdjustmentRef.current();
      }
    });
    groupSizeObserverRef.current = ro;
    cardRefs.current.forEach(el => {
      if (el.dataset.groupKey) ro.observe(el);
    });
    // Also observe the document element so post-card growth (the draft poll
    // portal filling in, async-mounted images, fonts loading) triggers
    // bottom-pin re-application even though those don't go through cards.
    const docEl = document.documentElement;
    if (docEl) ro.observe(docEl);
    return () => {
      ro.disconnect();
      groupSizeObserverRef.current = null;
    };
  }, []);

  // ===================================================================
  // Layout-shift compensation + bottom-pin. One unified function called
  // from both useLayoutEffect (every render) and the ResizeObserver (every
  // layout change, including async growth that doesn't trigger a render).
  //
  // - Card-anchor mode (initialExpandedQuestionId set): track the URL
  //   anchor's offsetTop. When it changes — e.g. cards above mount with
  //   H_actual ≠ H_estimate — scrollBy the delta so the anchor stays at
  //   the same viewport position. User scrolls between calls aren't
  //   disturbed because we only react to offsetTop deltas, not scrollY.
  //
  // - Bottom-pin mode (initialExpandedQuestionId null, suppressExpand):
  //   as the doc grows, keep scrollY at max so the user lands on the
  //   draft form. The pin disables once the user scrolls >50px above
  //   bottom.
  // ===================================================================
  const applyScrollAdjustmentRef = useRef<() => void>(() => {});
  applyScrollAdjustmentRef.current = () => {
    if (typeof window === 'undefined' || !thread) return;
    if (userInteractedRef.current) return;
    if (initialExpandedQuestionId === null) {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (Math.abs(window.scrollY - max) > 0.5) {
        window.scrollTo(0, max);
      }
      return;
    }
    if (headerHeight === 0) return;
    const card = cardRefs.current.get(initialExpandedQuestionId);
    if (!card || !card.isConnected) return;
    const desiredScrollY = card.offsetTop - headerHeight;
    if (Math.abs(window.scrollY - desiredScrollY) > 0.5) {
      window.scrollTo(0, Math.max(0, desiredScrollY));
    }
  };
  useLayoutEffect(() => {
    applyScrollAdjustmentRef.current();
  });

  // Disable both pins on first user interaction. We listen to wheel /
  // touchstart / keydown rather than scroll because programmatic scrolls
  // (our own scrollTo, browser clamp on doc shrink) also fire scroll events
  // and would falsely disable the pin during initial layout settling.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const disable = () => { userInteractedRef.current = true; };
    // pointerdown covers mouse + touch + pen on every platform (including
    // iOS where touchstart sometimes doesn't bubble during scroll-engaged
    // gestures). Keep wheel + keydown for trackpads and keyboard scrolls.
    window.addEventListener('pointerdown', disable, { passive: true, capture: true });
    window.addEventListener('wheel', disable, { passive: true, capture: true });
    window.addEventListener('keydown', disable, { passive: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', disable, { capture: true } as any);
      window.removeEventListener('wheel', disable, { capture: true } as any);
      window.removeEventListener('keydown', disable, { capture: true } as any);
    };
  }, []);

  // Refetch on vote-change events: when any question's votes change, the
  // wrapper's voter_names may have shifted, AND `prephase_deadline` may
  // have flipped from null → real timestamp (the deferred suggestion /
  // availability timer starts on the first qualifying vote). Refresh
  // affected poll wrappers — cheap because the request is small and
  // cached. Updates flow through patchThreadPolls so the derived map stays
  // in sync. Without `prephase_deadline` in the patch, the thread card's
  // status row stays stuck on "Taking Suggestions" / "Collecting
  // Availability" until a manual refresh.
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
            prephase_deadline: wrapper.prephase_deadline,
            updated_at: wrapper.updated_at,
          }),
        );
      }).catch(() => null);
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, handler);
  }, [thread, patchThreadPolls]);

  // Sync `?p=` to the expanded card via shallow replaceState — sharing the
  // URL reopens the same card. Collapse leaves `?p=` on the just-collapsed
  // poll so refresh doesn't surprise-collapse what the user was viewing.
  useEffect(() => {
    if (typeof window === 'undefined' || !thread || !expandedQuestionId) return;
    const wrapper = pollByQuestionId.get(expandedQuestionId) ?? null;
    const routeId = wrapper?.short_id || expandedQuestionId;
    const params = new URLSearchParams(window.location.search);
    if (params.get(POLL_QUERY_PARAM) === routeId) return;
    params.set(POLL_QUERY_PARAM, routeId);
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', next);
  }, [expandedQuestionId, pollByQuestionId]);

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
      // threadQuestions is in strict chronological order (created_at ASC),
      // so iterating in order: the FIRST wholly-above awaiting match is
      // the oldest above-the-fold awaiting card, and the FIRST
      // below-the-fold match is the closest one beneath the viewport
      // (oldest among those still to be reached).
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
        onTitleClick={() => navigateWithTransition(router, `/t/${threadId}/info`, 'forward')}
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
                  ref={(el) => { el ? attachCardEl(el, anchorId, group.key) : detachCardEl(anchorId); }}
                  className="mr-1.5 mb-3"
                  style={{ height: placeholderHeight }}
                  aria-hidden="true"
                />
              );
            }
            const question = group.anchor;
            const isClosed = !isQuestionOpen(question);
            const isAwaiting = isAwaitingResponse(question);
            const isExpanded = expandedQuestionId === question.id;
            const isPressed = pressedQuestionId === question.id;
            // A freshly-submitted placeholder card while it FLIP-animates
            // into its slot. Once POLL_HYDRATED_EVENT swaps the placeholder
            // for the real Poll, this flag clears and the card paints
            // normally.
            const isPlaceholder = pendingPollFirstQuestionId === question.id
              || isPendingPollId(question.poll_id);
            const isVisible = visibleQuestionIds.has(question.id);
            const isSwipeThresholdActive = swipeThresholdQuestionId === question.id;
            const isTooltipActive = tooltipQuestionId === question.id;
            return (
              <ThreadCardItem
                key={question.id}
                group={group as ThreadCardGroup}
                isExpanded={isExpanded}
                isPressed={isPressed}
                isPlaceholder={isPlaceholder}
                isAwaiting={isAwaiting}
                isClosed={isClosed}
                isVisible={isVisible}
                isSwipeThresholdActive={isSwipeThresholdActive}
                isTooltipActive={isTooltipActive}
                questionResultsMap={questionResultsMap}
                userVoteMap={userVoteMap}
                pendingPollChoices={pendingPollChoices}
                wrapperSubmitState={wrapperSubmitState}
                pollVoterNames={pollVoterNames}
                pollSubmitting={pollSubmitting}
                pollSubmitError={pollSubmitError}
                cardFrameRefs={cardFrameRefs}
                expandedWrapperRefs={expandedWrapperRefs}
                subQuestionBallotRefs={subQuestionBallotRefs}
                longPressTimerRef={longPressTimer}
                isLongPressRef={isLongPress}
                touchStartPosRef={touchStartPos}
                isScrollingRef={isScrolling}
                swipeRef={swipeRef}
                swipeJustHandledRef={swipeJustHandled}
                touchJustHandledRef={touchJustHandled}
                attachCardEl={attachCardEl}
                detachCardEl={detachCardEl}
                resetSwipeRef={resetSwipeRef}
                submitSwipeAbstain={submitSwipeAbstain}
                setExpandedQuestionId={setExpandedQuestionId}
                setPressedQuestionId={setPressedQuestionId}
                setSwipeThresholdQuestionId={setSwipeThresholdQuestionId}
                setTooltipQuestionId={setTooltipQuestionId}
                setModalQuestion={setModalQuestion}
                setShowModal={setShowModal}
                setPendingVoteChange={setPendingVoteChange}
                submitYesNoChoice={submitYesNoChoice}
                setPollVoterName={setPollVoterName}
                setPendingPollChoices={setPendingPollChoices}
                setPendingPollSubmit={setPendingPollSubmit}
                handleWrapperSubmitStateChange={handleWrapperSubmitStateChange}
              />
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
            // If the forgotten question was expanded, collapse it so the URL `?p=`
            // doesn't still point at the deleted poll.
            setExpandedQuestionId((curr) => (curr === action.question.id ? null : curr));
            const remaining = thread ? thread.questions.filter((p) => p.id !== action.question.id) : [];
            if (thread && remaining.length === 0) {
              // Drop the server-side `thread_members` row so the thread
              // doesn't reappear via Phase C.3 membership-based visibility
              // on the next /api/threads/mine call. Fire-and-forget.
              void apiLeaveThread(threadId);
              router.push('/');
            } else {
              setThread((prev) => (prev ? { ...prev, questions: prev.questions.filter((p) => p.id !== action.question.id) } : prev));
            }
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

      {/* First-time votes on single-question polls bypass this modal entirely
          (see ThreadCardItem.dispatchYesNoTap); multi-group cards stage into
          pendingPollChoices and confirm via the wrapper-level modal below. */}
      {(() => {
        const current = pendingVoteChange
          ? userVoteMap.get(pendingVoteChange.questionId)?.choice
          : undefined;
        const label = (c: 'yes' | 'no' | 'abstain' | null | undefined) =>
          c === 'abstain' ? 'Abstain' : c === 'yes' ? 'Yes' : c === 'no' ? 'No' : '';
        const isChange = !!current;
        return (
          <ConfirmationModal
            isOpen={!!pendingVoteChange}
            title={isChange ? 'Change vote?' : 'Submit vote?'}
            message={
              pendingVoteChange
                ? isChange
                  ? `Change your vote from ${label(current)} to ${label(pendingVoteChange.newChoice)}?`
                  : `Submit your vote: ${label(pendingVoteChange.newChoice)}?`
                : ''
            }
            confirmText={
              voteChangeSubmitting
                ? 'Saving…'
                : isChange
                  ? 'Change vote'
                  : 'Submit vote'
            }
            cancelText="Cancel"
            confirmButtonClass="bg-blue-600 hover:bg-blue-700 text-white"
            onConfirm={confirmVoteChange}
            onCancel={() => setPendingVoteChange(null)}
          />
        );
      })()}

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

// Resolves `/t/<threadShortId>?p=<pollShortId>` to the thread root + the
// optional poll to expand. The path id is unambiguously a poll short_id /
// poll uuid (the thread root); legacy `/p/<id>` URLs with arbitrary ids
// resolve via the `/p/[shortId]` redirect before reaching this component.
function ThreadPageInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const threadShortId = params.threadShortId as string;
  const pollParam = searchParams.get(POLL_QUERY_PARAM);

  const rootInitial = useMemo<Poll | null>(() => {
    if (typeof window === "undefined" || !threadShortId) return null;
    if (isUuidLike(threadShortId)) return getCachedPollById(threadShortId);
    // Phase B.4: thread route id can be `threads.short_id` (preferred) OR
    // `polls.short_id` (legacy /t/<root-poll-short-id> fallback). Look up
    // both forms before falling back to the async fetch.
    const accessible = getCachedAccessiblePolls() ?? [];
    const matches = accessible.filter(mp => mp.thread_short_id === threadShortId);
    return findChainRoot(matches) ?? getCachedPollByShortId(threadShortId);
  }, [threadShortId]);

  const [rootPoll, setRootPoll] = useState<Poll | null>(rootInitial);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!threadShortId) {
      router.replace("/");
      return;
    }
    if (rootInitial) {
      const firstQ = rootInitial.questions[0]?.id;
      if (firstQ) addAccessibleQuestionId(firstQ);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Phase B.4: prefer the thread endpoint which resolves any route id
        // form (threads.short_id, threads.id, polls.short_id, polls.id) in
        // one call. Fall back to the per-poll endpoint when the thread
        // endpoint 404s (older deploys, network glitches) so we don't lose
        // resolution on partially-rolled-out backends.
        const polls = await apiGetThreadByRouteId(threadShortId, { pollShortId: pollParam }).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        });
        const root = polls ? findChainRoot(polls) : null;
        if (root && polls) {
          for (const mp of polls) {
            for (const sp of mp.questions) addAccessibleQuestionId(sp.id);
          }
          if (!cancelled) setRootPoll(root);
          return;
        }
        // Last-ditch fallback: per-poll lookup for very old URL forms whose
        // resolution path didn't survive the threads-endpoint cutover.
        const isUuid = isUuidLike(threadShortId);
        const poll = await (isUuid
          ? apiGetPollById(threadShortId)
          : apiGetPollByShortId(threadShortId)
        ).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        });
        if (!poll) {
          if (!cancelled) setError(true);
          return;
        }
        const firstQ = poll.questions[0]?.id;
        if (firstQ) addAccessibleQuestionId(firstQ);
        if (!cancelled) setRootPoll(poll);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [threadShortId, router, rootInitial]);

  // `?p=<id>` → resolve to the cached Poll once, drive both the
  // initial-expand target AND the Phase C.2 access grant from it.
  const targetPoll = useMemo<Poll | null>(() => {
    if (typeof window === "undefined" || !pollParam || !rootPoll) return null;
    return getCachedPollForShortId(pollParam);
  }, [pollParam, rootPoll]);

  const initialExpandedQuestionId = targetPoll?.questions[0]?.id ?? null;

  // Phase C.2: idempotent server-side via ON CONFLICT, but the useRef
  // guard avoids the duplicate POST that fires when `rootPoll` churns
  // post-mount (e.g. cache-hit initial paint then async refresh resets
  // the same value).
  const grantedPollIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!targetPoll) return;
    if (grantedPollIdsRef.current.has(targetPoll.id)) return;
    grantedPollIdsRef.current.add(targetPoll.id);
    void apiGrantPollAccess(targetPoll.id);
  }, [targetPoll]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Thread Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This thread may have been removed or the link is incorrect.</p>
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

  if (!rootPoll) {
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

  // Phase B.4: prefer threads.short_id (the canonical /t/<id> form) so any
  // FE-built URL based on the resolved Poll matches the route id the user
  // landed with. Falls back to the URL's threadShortId for placeholder
  // polls and pre-B.4 cached polls without thread_short_id.
  const threadRouteId = rootPoll.thread_short_id || rootPoll.short_id || threadShortId;

  return (
    <ThreadContent
      threadId={threadRouteId}
      initialExpandedQuestionId={initialExpandedQuestionId}
      initialPollShortId={pollParam}
    />
  );
}

export default function ThreadPage() {
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
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading thread...</p>
        </div>
      </div>
    }>
      <ThreadPageInner />
    </Suspense>
  );
}

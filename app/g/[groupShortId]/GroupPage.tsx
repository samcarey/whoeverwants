"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo, Suspense } from "react";
import { flushSync, createPortal } from "react-dom";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Question } from "@/lib/types";
import { getMyGroups } from "@/lib/simpleQuestionQueries";
import { buildEmptyGroup, buildGroupFromPollDown, buildGroupSyncFromCache, buildPollMap, findChainRoot, isPendingPollId, POLL_QUERY_PARAM } from "@/lib/groupUtils";
// POLL_QUERY_PARAM is still used by `GroupPageInner` to redirect legacy
// `?p=<pollShort>` URLs to the new `/g/<group>/p/<pollShort>` route.
import { mergePollListPreservingIdentity, mergeQuestionResultsMap } from "@/lib/groupRefresh";
import { apiGetQuestionResults, apiGetGroupByRouteId, apiGetGroupSummary, apiGetVotes, apiClosePoll, apiReopenPoll, apiCutoffPollAvailability, apiCutoffPollSuggestions, apiGetPollById, apiGetPollByShortId, apiLeaveGroup, ApiError, QUESTION_VOTES_CHANGED_EVENT } from "@/lib/api";
import type { Poll } from "@/lib/types";
import { useGroupVoting } from "@/lib/useGroupVoting";
import type { QuestionResults } from "@/lib/types";
import { addAccessibleQuestionId, getCreatorSecret } from "@/lib/browserQuestionAccess";
import { getCachedAccessiblePolls, getCachedGroupSummary, getCachedPollById, getCachedPollByShortId } from "@/lib/questionCache";
import {
  POLL_PENDING_EVENT,
  POLL_HYDRATED_EVENT,
  POLL_FAILED_EVENT,
  type PollPendingDetail,
  type PollHydratedDetail,
  type PollFailedDetail,
} from "@/lib/eventChannels";
import { isUuidLike } from "@/lib/questionId";
import { DRAFT_POLL_PORTAL_ID, GROUP_ID_ATTR } from "@/lib/groupDomMarkers";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { isInTimeAvailabilityPhase, isInSuggestionPhase } from "@/lib/questionListUtils";
import { loadVotedQuestions, getStoredVoteId, parseYesNoChoice } from "@/lib/votedQuestionsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { slideToGroupInfo, useIsSlideOverlayGroupActive } from "@/lib/slideOverlay";
import { getRememberedScroll, groupScrollKey, rememberCurrentScroll } from "@/lib/scrollMemory";
import { navigateWithTransition } from "@/lib/viewTransitions";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import GroupHeader from "@/components/GroupHeader";
import { forgetQuestion } from "@/lib/forgetQuestion";
import { haptic } from "@/lib/haptics";
import { PENDING_ACTION_COPY, type PendingActionKind } from "./groupActionCopy";
import { GroupCardItem, ROW_DIVIDER_CLASS, type GroupCardGroup } from "./GroupCardItem";

import type { Group } from "@/lib/groupUtils";

// Default placeholder height for not-yet-measured groups in the virtualized
// group list. Tuned to typical compact yes_no card height; the ResizeObserver
// replaces this with the measured value as soon as a group has been mounted
// once. Subsequent unmounts use the measured height, so unmount→remount cycles
// don't shift the document layout.
const ESTIMATED_GROUP_HEIGHT = 110;

// Group key for `groupedGroupQuestions` — questions of the same poll share
// poll_id; legacy (non-poll) questions get a unique `solo-` prefix so they
// don't collide. Used in the .map() loop's key + virtualization mountedKeys.
const groupKeyFor = (q: { id: string; poll_id?: string | null }): string =>
  q.poll_id ?? `solo-${q.id}`;

// Bottom-pin keeps `window.scrollY` at max for this many ms after initial
// mount — the polls list keeps resizing as placeholders → real cards swap
// in and async results load, so a one-shot scroll-to-bottom would leave
// the bubble bar drifting off-screen. Capped + gated on user-interaction
// (see `applyScrollAdjustmentRef`) to avoid the iOS feedback loop
// documented in PR #375 that retired the unbounded version.
const BOTTOM_PIN_DURATION_MS = 800;

// Debounce window for "scroll has stopped." Below this iOS momentum
// scrolling can briefly pause and reads as idle; above it the arrows
// feel laggy to appear after a true stop.
const SCROLL_STOPPED_DEBOUNCE_MS = 150;

const SCROLL_HELPER_BUTTON_CLASS_BASE =
  'fixed left-1/2 -translate-x-1/2 w-[2.475rem] h-[2.475rem] rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md flex items-center justify-center transition-opacity';

function ScrollHelperButton({
  direction,
  onClick,
  style,
  elevated,
  ...rest
}: {
  direction: 'up' | 'down';
  onClick: () => void;
  style: React.CSSProperties;
  /** When true, render above the slide overlay (z-70) instead of at the
   *  default z-40 so the arrows aren't hidden by the overlay's opaque
   *  background during a group-kind slide. */
  elevated?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'style' | 'type' | 'className'>) {
  const path = direction === 'up' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7';
  const className = `${SCROLL_HELPER_BUTTON_CLASS_BASE} ${elevated ? 'z-[70]' : 'z-40'}`;
  return (
    <button type="button" onClick={onClick} className={className} style={style} {...rest}>
      <svg className="w-[1.35rem] h-[1.35rem]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  );
}

// Shared cache-driven Group rebuild for POLL_PENDING / POLL_HYDRATED /
// POLL_FAILED setGroup updaters. Returns prev when the rebuild would produce
// the same poll-id sequence (no placeholder swap) so identity-based memos stay
// stable.
//
// `mutate.add` / `mutate.remove` let callers explicitly swap a placeholder
// poll for the real one; without it, leaving both in scope yields a group
// containing both as children of the same parent.
//
// `prev.polls` is always merged into the rebuild source — resilience against
// a stale `accessiblePollsCache` (60s TTL); without it,
// `buildGroupFromPollDown` can't find rootPollId when the cache is stale and
// the new poll never lands in the group.
function rebuildGroupFromCacheOrPrev(
  prev: Group,
  mutate?: { add?: Poll; remove?: string },
): Group {
  const cached = getCachedAccessiblePolls() ?? [];
  const byId = new Map<string, Poll>();
  for (const p of prev.polls) byId.set(p.id, p);
  for (const p of cached) byId.set(p.id, p);
  if (mutate?.remove) byId.delete(mutate.remove);
  if (mutate?.add) byId.set(mutate.add.id, mutate.add);
  // accessiblePollsCache may carry polls from sibling groups — filter to
  // this group only so the rebuild doesn't cross-contaminate.
  const groupId = prev.groupId;
  const polls = Array.from(byId.values()).filter((p) =>
    groupId ? p.group_id === groupId : p.id === prev.rootPollId,
  );
  if (polls.length === 0) return prev;
  // Fall through to polls[0] when prev.rootPollId is null (empty → first
  // poll) OR was just removed in this rebuild (POLL_HYDRATED swapping the
  // lone placeholder root for the real poll). Anchoring on a missing id
  // makes buildGroupFromPollDown return null and the rebuild bails to prev.
  const anchorPollId =
    prev.rootPollId && polls.some((p) => p.id === prev.rootPollId)
      ? prev.rootPollId
      : polls[0].id;
  const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
  const rebuilt = buildGroupFromPollDown(anchorPollId, polls, voted, abstained);
  if (!rebuilt) return prev;
  if (
    rebuilt.polls.length === prev.polls.length &&
    rebuilt.polls.every((p, i) => p.id === prev.polls[i].id)
  ) {
    return prev;
  }
  return rebuilt;
}

interface GroupContentProps {
  groupId: string;
  /** Visual offset (px) for the cards-wrapper transform, used by
   *  `SlideOverlayHost` to pre-position the destination during a group
   *  slide. Does NOT apply to the fixed GroupHeader. See `SlideToGroupDetail.overlayCardsOffset`. */
  overlayCardsOffset?: number;
}

export function GroupContent({ groupId, overlayCardsOffset }: GroupContentProps) {
  const router = useRouter();
  const { prefetchBatch } = usePrefetch();

  // Initialize voted/abstained sets + group synchronously from cached data
  // on first render, so the page mounts with full content (no loading flash
  // during view transition slide).
  const [{ group: initialGroup, votedQuestionIds: initialVoted, abstainedQuestionIds: initialAbstained }] = useState(() => {
    if (typeof window === 'undefined') {
      return { group: null as Group | null, votedQuestionIds: new Set<string>(), abstainedQuestionIds: new Set<string>() };
    }
    const voted = loadVotedQuestions();
    return {
      group: buildGroupSyncFromCache(groupId, voted.votedQuestionIds, voted.abstainedQuestionIds),
      votedQuestionIds: voted.votedQuestionIds,
      abstainedQuestionIds: voted.abstainedQuestionIds,
    };
  });

  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(initialVoted);
  const [abstainedQuestionIds, setAbstainedQuestionIds] = useState<Set<string>>(initialAbstained);
  const [group, setGroup] = useState<Group | null>(initialGroup);
  const [loading, setLoading] = useState(!initialGroup);
  const [error, setError] = useState(false);

  // Phase 5b: poll-level mutations (close/reopen/cutoff) update the
  // polls array; question mutations (forget) update the questions array.
  const patchGroupPolls = useRef(
    (predicate: (mp: Poll) => boolean, patcher: (mp: Poll) => Partial<Poll>) => {
      setGroup((prev) => {
        if (!prev) return prev;
        if (!prev.polls.some(predicate)) return prev;
        return {
          ...prev,
          polls: prev.polls.map((mp) => (predicate(mp) ? { ...mp, ...patcher(mp) } : mp)),
        };
      });
    },
  ).current;
  const patchGroupQuestions = useRef(
    (predicate: (p: Question) => boolean, patcher: (p: Question) => Partial<Question>) => {
      setGroup((prev) => {
        if (!prev) return prev;
        if (!prev.questions.some(predicate)) return prev;
        return {
          ...prev,
          questions: prev.questions.map((p) => (predicate(p) ? { ...p, ...patcher(p) } : p)),
        };
      });
    },
  ).current;

  // Set data attribute on body so the create-poll form attaches new
  // polls to this group (Migration 105: group_id is the addressable
  // unit; the legacy follow_up_to chain pointer is gone).
  //
  // No removeAttribute cleanup: the slide-overlay handoff briefly mounts
  // two GroupContent instances for the same group; the overlay's unmount
  // cleanup would otherwise null body.data-group-id while the real-route
  // instance is still active, and the next submit would mint a fresh
  // group. See CLAUDE.md "overlay-slide unmount cleanups" pitfall.
  useEffect(() => {
    if (group?.groupId) {
      document.body.setAttribute(GROUP_ID_ATTR, group.groupId);
    }
  }, [group?.groupId]);

  // Signal to the view transition helper that this page's content is
  // rendered AND its initial scroll position has been applied. Without the
  // scroll-applied gate, `navigateWithTransition` captures the destination
  // snapshot before the initial useLayoutEffect fires, so the view
  // transition animates to a scrollY=0 frame that the browser then jumps
  // away from once the layout effect lands. With it, the snapshot includes
  // the final scroll position and the user sees zero motion after the
  // slide-in completes.
  const [initialScrollApplied, setInitialScrollApplied] = useState(false);
  usePageReady(!!group && !loading && initialScrollApplied);

  // Prefetch each poll's detail page route so taps land on a warm cache.
  // Re-fires only when the poll-id set changes (not on every 5s wrapper
  // refresh, which produces a fresh Group identity but the same hrefs).
  const prefetchKey = useMemo(
    () => (group ? group.polls.map(mp => mp.short_id ?? "").join(",") : ""),
    [group],
  );
  useEffect(() => {
    if (!group) return;
    const hrefs: string[] = [];
    for (const mp of group.polls) {
      if (mp.short_id) hrefs.push(`/g/${groupId}/p/${mp.short_id}`);
    }
    prefetchBatch(hrefs, { priority: "low" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchKey, prefetchBatch, groupId]);

  // Which question's creation-time tooltip is currently showing (null = none).
  // Shared across all cards so only one tooltip is visible at a time.
  const [tooltipQuestionId, setTooltipQuestionId] = useState<string | null>(null);
  // Questions whose card has scrolled into view. Drives the lazy fetch of
  // per-question results that populate compact pills.
  const [visibleQuestionIds, setVisibleQuestionIds] = useState<Set<string>>(() => new Set());
  // Per-question results for the compact winner preview shown above the grid-rows
  // clip. Seeded synchronously from inline question.results so the previews render
  // on first paint — without this, slots mount empty and fill in late when the
  // viewport-intersection fetch resolves, making every card grow and the list
  // slide down on refresh. The viewport observer still runs to refresh stale
  // entries.
  const [questionResultsMap, setQuestionResultsMap] = useState<Map<string, QuestionResults>>(() => {
    const seed = new Map<string, QuestionResults>();
    if (initialGroup) {
      for (const p of initialGroup.questions) {
        if (p.results) seed.set(p.id, p.results);
      }
    }
    return seed;
  });
  // Group page only needs the userVoteMap (read by compact yes/no pills).
  // Full vote flows (taps, edits, multi-question Submit) live on the poll
  // detail page now. votedQuestionIds / abstainedQuestionIds remain here
  // because they're seeded synchronously alongside the cached group and
  // drive the awaiting-response sort + golden-border predicate.
  const {
    userVoteMap,
    setUserVoteMap,
  } = useGroupVoting({ group, setVotedQuestionIds, setAbstainedQuestionIds });
  // Prevents the synthetic click from firing after touchend already toggled expansion on mobile
  const touchJustHandled = useRef(false);
  // Refs for each card wrapper so we can scroll the expanded card into view
  // and observe viewport intersection.
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);

  // === Windowed virtualization ===
  // Only mount cards within ~2 viewport heights of the visible region. Cards
  // outside collapse to a measured-height placeholder div. Bounds DOM weight
  // on long groups; placeholders take the same height the card occupied so
  // mount/unmount cycles don't shift the document layout.
  const groupHeightById = useRef<Map<string, number>>(new Map());
  const groupSizeObserverRef = useRef<ResizeObserver | null>(null);
  // Shared ref-callback wiring for both placeholder and real card divs:
  // both register in cardRefs (so the existing scroll-helper logic that
  // iterates cardRefs works regardless of mount state) and observe via the
  // visibleQuestionIds + groupSize observers. useCallback with empty deps —
  // identity must be stable across renders since these are passed into the
  // React.memo'd GroupCardItem; a fresh closure per render would force every
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
    if (!initialGroup) return new Set();
    const initial = new Set<string>();
    // When a saved scroll position is being restored (back-nav from a
    // poll detail page), mount every card up-front so `scrollHeight`
    // matches the original page and `window.scrollTo(0, Y)` lands at
    // the exact position the user left. The default anchor-only mount
    // would short the doc height and clamp the restored scroll into a
    // wrong spot. React.memo on `GroupCardItem` keeps subsequent
    // updates from re-rendering siblings on each vote/state change.
    const restoring =
      typeof window !== "undefined" &&
      getRememberedScroll(groupScrollKey(groupId)) !== undefined;
    if (restoring) {
      for (const q of initialGroup.questions) initial.add(groupKeyFor(q));
      return initial;
    }
    // Seed with the last poll so the first paint already has the
    // bottom-pin's nearest neighbor mounted (no placeholder→card swap right
    // after mount). Progressive fill below mounts the rest in idle-time
    // batches.
    const target = initialGroup.questions[initialGroup.questions.length - 1] ?? null;
    if (target) initial.add(groupKeyFor(target));
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

  // On cache hit, defer the background refresh via requestIdleCallback so it
  // doesn't compete with React commit during a view transition.
  useEffect(() => {
    async function fetchGroup() {
      try {
        if (!initialGroup) setLoading(true);
        setError(false);

        // Phase B.3: one round-trip — apiGetGroupByRouteId resolves the
        // route id to a group_id and returns every poll in that group,
        // with full inline-results / voter aggregates. The legacy
        // discoverRelatedQuestions + getAccessiblePolls pair walked the
        // follow_up_to chain client-side; the server walks polls.group_id
        // directly now.
        //
        // Votes prefetch fires in parallel so the votes cache is warm by
        // the time VoterList mounts — bubbles render alongside the cards
        // instead of ~100ms after. apiGetVotes is cache + in-flight
        // coalesced, so the later per-card fetch hits the warm cache.
        let polls: Poll[];
        try {
          polls = await apiGetGroupByRouteId(groupId);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) { setError(true); return; }
          throw err;
        }
        // No visible polls — fall back to the summary endpoint for header
        // metadata so we can still render the chrome + bubble bar.
        if (polls.length === 0) {
          const summary = await apiGetGroupSummary(groupId);
          if (!summary) { setError(true); return; }
          setGroup(buildEmptyGroup(summary));
          return;
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
        const foundGroup = buildGroupFromPollDown(anchorPoll.id, polls, voted, abstained);

        if (!foundGroup) {
          setError(true);
          return;
        }

        // Seed inline results BEFORE setGroup so the first render with the
        // loaded group already has compact previews (no slide-down on refresh).
        setQuestionResultsMap((prev) => {
          const additions = foundGroup.questions.filter(p => p.results && !prev.has(p.id));
          if (additions.length === 0) return prev;
          const next = new Map(prev);
          for (const p of additions) next.set(p.id, p.results!);
          return next;
        });
        setGroup(foundGroup);
      } catch (err) {
        console.error('Error loading group:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    if (initialGroup) {
      // `requestIdleCallback` is unsupported in Safari; fall back to setTimeout(0).
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      const schedule = w.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 0) as unknown as number);
      const cancel = w.cancelIdleCallback ?? ((id: number) => clearTimeout(id as unknown as NodeJS.Timeout));
      const id = schedule(() => { void fetchGroup(); });
      return () => cancel(id);
    }
    fetchGroup();
  }, [groupId]);

  // The first question of a freshly submitted (placeholder) poll, while its
  // card is FLIP-animating from the draft frame to its natural slot. While
  // this is set, the matching card mounts with only its title visible — the
  // status row, voter circles, etc. are suppressed until hydration completes.
  const [pendingPollFirstQuestionId, setPendingPollFirstQuestionId] = useState<string | null>(null);

  // Latest `group` snapshot for the POLL_PENDING handler. Updated in a
  // separate effect so the listener can stay registered with empty deps
  // — re-attaching on every group mutation would tear down + re-add the
  // event listener on every vote/hydration/cache refresh.
  const groupRef = useRef(group);
  useEffect(() => { groupRef.current = group; }, [group]);

  // POLL_PENDING_EVENT: a draft was just submitted. Insert the placeholder
  // poll into group state immediately so the user sees the new card in
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

      const t = groupRef.current;
      if (!t) return;

      // Migration 105: a placeholder belongs to this group when its
      // `group_id` matches. (Pre-105 we walked `follow_up_to` to a
      // parent poll; that's gone.) Solo placeholders without a group_id
      // are root polls of a fresh group and only land here if they
      // happen to match `t.rootPollId`.
      const sameGroup = newPoll.group_id && t.groupId && newPoll.group_id === t.groupId;
      const isOwnRoot = newPoll.id === t.rootPollId;
      if (!sameGroup && !isOwnRoot) return;

      flushSync(() => {
        setPendingPollFirstQuestionId(newPoll.questions[0]?.id ?? null);
        setGroup((prev) => prev ? rebuildGroupFromCacheOrPrev(prev, { add: newPoll }) : prev);
        // Mount the new card eagerly. Without this, the validation effect
        // resets mountedGroupKeys to (prev ∩ validKeys + anchor), which
        // doesn't include this freshly-added group key. The card would
        // render as a gray placeholder div until progressive fill walked
        // the queue to it (~270ms on a long group, since the new card
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
  // Replace the placeholder fields in group state with the real ones in
  // place — keep the SAME placeholder id as the React key so the card's
  // DOM node doesn't unmount/re-mount mid-FLIP. Once the placeholder is
  // gone (its id was 'pending-...'), the real Poll's id takes over for
  // subsequent operations.
  //
  // Fallback: if the placeholder isn't in the group (POLL_PENDING bailed
  // out, e.g., follow_up_to wasn't recognized at the time), still add the
  // real poll if it belongs to this group — without that, the user sees
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
      // and without prev.polls in the merge `buildGroupFromPollDown` can't
      // find rootPollId and bails.
      //
      // `optimisticWillAdd` mirrors the bail check inside the updater: when
      // the placeholder is in group state OR realPoll's parent is recognized
      // OR realPoll IS the root, the rebuild succeeds and lands realPoll.
      // When false the optimistic bails to prev and the async refresh below
      // is the only path that brings the new poll in. Computed from
      // groupRef.current (kept in sync via a [group] useEffect) instead of
      // inside the updater because setState is async — reading the flag
      // synchronously after setGroup would see the pre-write value.
      const t = groupRef.current;
      const optimisticWillAdd =
        !!t && (
          (!!realPoll.group_id && realPoll.group_id === t.groupId) ||
          realPoll.id === t.rootPollId ||
          t.polls.some(p => p.id === placeholderId)
        );
      setGroup((prev) => {
        if (!prev) return prev;
        const sameGroup = realPoll.group_id && prev.groupId && realPoll.group_id === prev.groupId;
        const isOwnRoot = realPoll.id === prev.rootPollId;
        const hasPlaceholder = prev.polls.some(p => p.id === placeholderId);
        if (!hasPlaceholder && !sameGroup && !isOwnRoot) return prev;
        return rebuildGroupFromCacheOrPrev(prev, { add: realPoll, remove: placeholderId });
      });
      setPendingPollFirstQuestionId(null);
      // Mount the real card eagerly (same reason as POLL_PENDING — see
      // comment there). Drop the placeholder's key in the same setState so
      // mountedGroupKeys stays consistent with group state.
      setMountedGroupKeys((prev) => {
        if (!prev.has(placeholderId) && prev.has(realPoll.id)) return prev;
        const next = new Set(prev);
        next.delete(placeholderId);
        next.add(realPoll.id);
        return next;
      });

      // Optimistic-rebuild fallback: when the new poll's parent isn't in
      // prev.polls (e.g. the parent was discovered AFTER group state was
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
          await getMyGroups();
          setGroup((prev) => prev ? rebuildGroupFromCacheOrPrev(prev, { add: realPoll, remove: placeholderId }) : prev);
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
      setGroup((prev) => {
        if (!prev) return prev;
        // Skip rebuild when no placeholder is present — POLL_FAILED on a
        // brand-new-group submit fires while we're on a different group.
        if (!prev.polls.some(p => isPendingPollId(p.id))) return prev;
        return rebuildGroupFromCacheOrPrev(prev, placeholderId ? { remove: placeholderId } : undefined);
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

  // ===================================================================
  // Real-time refresh: periodically re-fetch the group so other users'
  // newly-created polls and votes appear without a manual reload.
  //
  // Tab-visible only (skipped when document.hidden) — a hidden tab's
  // refresh would just consume battery and bandwidth; the visibility
  // listener fires an immediate refresh on re-show so the user always
  // lands on fresh state.
  //
  // No-op when ANY placeholder poll is in group state (a local create is
  // mid-flight): POLL_PENDING / POLL_HYDRATED owns that timeline and we
  // don't want to race it. Same for an in-flight refresh — `inFlight`
  // gates re-entry.
  //
  // Identity-preserving merge: `mergePollListPreservingIdentity` reuses
  // prev `Poll` references for polls whose content didn't change, so the
  // GroupCardItem `arePropsEqual` slice-by-reference check short-circuits
  // and unchanged cards skip re-render. New polls land at the bottom of
  // the chronological list (server already sorts ASC by created_at). Vote
  // updates flow through `voter_names` / `anonymous_count` on the poll
  // and `results` on each question — the group page's existing compact-
  // preview pipeline picks up both via the matching state Maps.
  //
  // We pace via recursive setTimeout (5s after the previous response
  // resolved) rather than setInterval so a slow network doesn't pile up
  // overlapping fetches.
  // ===================================================================
  useEffect(() => {
    if (!group || error) return;
    if (typeof document === 'undefined') return;

    const REFRESH_INTERVAL_MS = 5000;
    let cancelled = false;
    let inFlight = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== 'visible') return;
      const t = groupRef.current;
      if (!t) return;
      // A locally-submitted poll is being hydrated — let POLL_HYDRATED own
      // the resolution rather than racing with our merge.
      if (t.polls.some((p) => isPendingPollId(p.id))) return;

      inFlight = true;
      try {
        const polls = await apiGetGroupByRouteId(groupId);
        if (cancelled) return;

        // Update inline-results map first so any card that re-renders via
        // the group-state replace below sees the fresh results in the
        // same render tick.
        setQuestionResultsMap((prev) => mergeQuestionResultsMap(prev, polls));

        setGroup((prev) => {
          if (!prev) return prev;
          const merge = mergePollListPreservingIdentity(prev.polls, polls);
          if (!merge.changed) return prev;
          // Rebuild the Group struct using the merged poll list. The
          // anchor must be a poll that exists in `merge.polls` — pick the
          // chronological root from the merged set rather than `prev` to
          // handle the (rare) case where the previous root was deleted.
          const mergedRoot = findChainRoot(merge.polls);
          if (!mergedRoot) return prev;
          // Defer loadVotedQuestions to the changed-content branch so
          // no-op ticks (the steady-state majority) don't pay the
          // localStorage parse + Set allocation.
          const { votedQuestionIds: voted, abstainedQuestionIds: abstained } = loadVotedQuestions();
          const rebuilt = buildGroupFromPollDown(mergedRoot.id, merge.polls, voted, abstained);
          if (!rebuilt) return prev;
          return rebuilt;
        });
      } catch {
        // Transient errors (network, server) — let the next tick retry.
      } finally {
        inFlight = false;
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      timerId = setTimeout(async () => {
        if (cancelled) return;
        await refresh();
        if (!cancelled) scheduleNext();
      }, REFRESH_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        // Refresh immediately on re-show so the user lands on fresh state
        // rather than waiting for the next interval tick.
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    scheduleNext();

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // `groupRef` is updated on every `group` change so we don't need
    // `group` in the deps; gating on `!!group` ensures we don't start
    // until the initial load lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, !!group, error]);

  // Measure the fixed group header so we can apply matching padding-top on the scroll list
  // (the header is position:fixed and out of flow, so the list doesn't naturally reserve space).
  // Re-measure when `group` flips loaded — the header is rendered behind a
  // `if (loading) return <Spinner/>` early return, so the measured ref only
  // exists once `group` is non-null.
  //
  // Seed initialValue=80 so the polls' paddingTop starts at the right value
  // on first render; the actual GroupHeader is ~80px tall on iOS mobile
  // browsers (env(safe-area-inset-top)=0). ResizeObserver corrects any drift
  // on the next tick. Without the seed, iOS Firefox paints one frame with
  // pollsPad=0 (the initial state) before the useLayoutEffect re-render
  // lands with pollsPad=80 — visible as polls flickering down by one header
  // height. useLayoutEffect's setState is supposed to batch with the
  // initial commit, but on iOS Firefox the first paint can run with the
  // pre-effect state.
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([group], 80);

  // Swipe-back gesture: dragging rightward on the content slides the page
  // off to the right with home revealed underneath (the destination renders
  // after router.push). Refs (not state) drive the transform during the
  // gesture so per-frame motion doesn't trigger React re-renders.
  // `touch-action: pan-y` on the wrapper hands horizontal pans to us while
  // letting the browser handle vertical scroll natively — so we never
  // preventDefault on touchmove (per CLAUDE.md: that permanently kills iOS
  // scroll for the touch sequence).
  const swipeWrapperRef = useRef<HTMLDivElement | null>(null);
  const swipeStateRef = useRef<{
    startX: number;
    startY: number;
    swiping: boolean;
    ignored: boolean;
    startTime: number;
    committing: boolean;
  } | null>(null);

  const applySwipeTransform = useCallback(
    (translateX: number, transitionMs: number) => {
      const transform = translateX === 0 ? '' : `translate3d(${translateX}px, 0, 0)`;
      const transition =
        transitionMs > 0
          ? `transform ${transitionMs}ms cubic-bezier(0.32, 0.72, 0, 1)`
          : 'none';
      const wrapper = swipeWrapperRef.current;
      const header = headerRef.current;
      if (wrapper) {
        wrapper.style.transform = transform;
        wrapper.style.transition = transition;
      }
      if (header) {
        header.style.transform = transform;
        header.style.transition = transition;
      }
    },
    [headerRef],
  );

  const clearSwipeTransform = useCallback(() => {
    const wrapper = swipeWrapperRef.current;
    const header = headerRef.current;
    if (wrapper) {
      wrapper.style.transform = '';
      wrapper.style.transition = '';
    }
    if (header) {
      header.style.transform = '';
      header.style.transition = '';
    }
  }, [headerRef]);

  const handleSwipeTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeStateRef.current = null;
      return;
    }
    if (swipeStateRef.current?.committing) return;
    swipeStateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      swiping: false,
      ignored: false,
      startTime: Date.now(),
      committing: false,
    };
  };

  const handleSwipeTouchMove = (e: React.TouchEvent) => {
    const st = swipeStateRef.current;
    if (!st || st.ignored || st.committing) return;
    if (e.touches.length !== 1) {
      if (st.swiping) applySwipeTransform(0, 200);
      st.ignored = true;
      return;
    }
    const dx = e.touches[0].clientX - st.startX;
    const dy = e.touches[0].clientY - st.startY;
    if (!st.swiping) {
      // Decide direction once motion crosses the threshold. Require horizontal
      // motion to be dominant AND rightward; anything else (vertical scroll,
      // leftward drag) is not our gesture.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
        st.ignored = true;
        return;
      }
      st.swiping = true;
    }
    // Cap at 0 so the user can't pull the page past its starting edge.
    const offset = Math.max(0, dx);
    applySwipeTransform(offset, 0);
  };

  const handleSwipeTouchEnd = (e: React.TouchEvent) => {
    const st = swipeStateRef.current;
    if (!st || !st.swiping || st.ignored || st.committing) {
      swipeStateRef.current = null;
      return;
    }
    const endX = e.changedTouches[0]?.clientX ?? st.startX;
    const dx = endX - st.startX;
    const dt = Date.now() - st.startTime;
    const offset = Math.max(0, dx);
    const velocity = dx / Math.max(1, dt); // px/ms, positive = rightward speed
    const vw = window.innerWidth;
    const shouldCommit =
      offset >= vw * 0.3 || velocity >= 0.5;
    if (shouldCommit) {
      st.committing = true;
      rememberCurrentScroll(groupScrollKey(groupId));
      // Block taps on cards while the page slides off — otherwise a tap
      // landing on a card mid-slide can race router.push and navigate to
      // the poll detail page instead of home.
      const wrapper = swipeWrapperRef.current;
      if (wrapper) wrapper.style.pointerEvents = 'none';
      const remaining = vw - offset;
      const duration = Math.max(
        140,
        Math.min(360, remaining / Math.max(0.4, velocity)),
      );
      applySwipeTransform(vw, duration);
      window.setTimeout(() => {
        router.push('/');
      }, duration);
    } else {
      applySwipeTransform(0, 220);
      window.setTimeout(() => {
        clearSwipeTransform();
        swipeStateRef.current = null;
      }, 240);
    }
  };

  const handleSwipeTouchCancel = () => {
    const st = swipeStateRef.current;
    swipeStateRef.current = null;
    if (st?.swiping && !st.committing) {
      applySwipeTransform(0, 200);
      window.setTimeout(() => {
        clearSwipeTransform();
      }, 220);
    }
  };

  // Set up a shared IntersectionObserver so cards pre-mount their expanded
  // content when they scroll into view. rootMargin prefetches slightly early.
  // Runs once; callback refs on each card attach/detach the observer.
  useEffect(() => {
    if (!group || typeof IntersectionObserver === 'undefined') return;
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
    // Only re-create when a group first arrives — not on every mutation
    // (forget/reopen). Card ref callbacks attach each new card to the live
    // observer automatically.
  }, [!!group]);

  // Fetch results + viewer's own vote for every yes_no question that has entered
  // the viewport. Both calls are coalesced + cache-backed. Results drive the
  // winner preview; the user's vote drives the Your-Vote badge + tap-to-
  // change flow. The setState guards compare by field content (not identity)
  // because apiGetQuestionResults always allocates a fresh result object even
  // when the underlying data is unchanged.
  useEffect(() => {
    if (!group) return;
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
    for (const question of group.questions) {
      if (!question.poll_id) continue;
      const cur = anchorByPoll.get(question.poll_id);
      if (!cur) {
        anchorByPoll.set(question.poll_id, question.id);
        continue;
      }
      const curQuestion = group.questions.find((p) => p.id === cur);
      if ((question.question_index ?? 0) < (curQuestion?.question_index ?? 0)) {
        anchorByPoll.set(question.poll_id, question.id);
      }
    }
    for (const question of group.questions) {
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
      const question = group.questions.find((p) => p.id === questionId);
      if (!question) return;
      void maybeFetch(question.id, question.question_type);
    };
    window.addEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(QUESTION_VOTES_CHANGED_EVENT, onVotesChanged);
    };
  }, [group, visibleQuestionIds]);

  // ===================================================================
  // Group-page scroll strategy (single source of truth — keep cohesive)
  // ===================================================================
  // The initial scroll always lands the viewer at the document bottom so
  // the bubble bar (the create-poll launcher) is visible. Past
  // iterations tried to anchor the viewer at the oldest "awaiting"
  // poll, but that produced a visible jump on load when the chosen
  // anchor and the bubble-bar end of the page differed. The
  // scroll-helper arrows below still steer users toward awaiting cards
  // once they're scrolling.
  //
  // 1. INITIAL load (`useLayoutEffect` below, fires once per mount).
  //    Scrolls to `document.scrollHeight - innerHeight`. Runs
  //    synchronously before paint via a fire-once `useRef` guard so the
  //    first painted frame is already at the destination — never an
  //    "in-place then scroll" two-frame flicker. Cleanup intentionally
  //    omitted; useRef persists across StrictMode
  //    mount→cleanup→mount, and a cleanup that reset the ref would
  //    re-fire on every dep-change (e.g. async accessible-polls
  //    refresh) and re-scroll against a now-taller page.
  //
  // 1b. BOTTOM PIN (`applyScrollAdjustmentRef`, called from layout effect
  //    AND ResizeObserver): until the user first interacts (wheel,
  //    touchstart, keydown), each layout settling re-applies the
  //    bottom-pin so async content (placeholders → real cards, results
  //    loads, fonts) doesn't drift the bubble bar off-screen. Bounded
  //    by `BOTTOM_PIN_DURATION_MS` to cap iOS's `visualViewport`
  //    feedback loop from PR #375 (where unbounded re-pin against a
  //    growing scrollHeight drove scrollY into a hundreds-of-pixels
  //    oscillation, dragging the fixed header off the viewport).
  //    Gating on user interaction (rather than scrollY deltas) avoids
  //    fighting the browser's silent scrollY clamp when the doc
  //    shrinks — that clamp fires a scroll event indistinguishable
  //    from a user gesture, but no wheel/touch/keydown happens.
  //
  // 2. TAP-EXPAND (`useEffect` further below, fires after initial layout
  //    has settled): smoothly scrolls (rAF, ease-out cubic, 300ms —
  //    matching the grid-rows expand transition) only enough to keep the
  //    just-expanded card onscreen — align top to header if cut off
  //    above, or trim the bottom overshoot otherwise (capped by
  //    available slack so the top never disappears behind the header).
  //
  // 3. SCROLL-HELPER ARROWS (independent; both can show simultaneously):
  //    Two fixed buttons portaled into `#floating-fab-portal`.
  //
  //      - UP (just below header) shows when at least one awaiting poll
  //        is not completely in view above the viewport — i.e. wholly
  //        above (r.bottom <= viewportTop) OR top-clipped
  //        (r.top < viewportTop && r.bottom > viewportTop). Targets the
  //        OLDEST such poll (first in DOM order, since awaiting cards
  //        sort by created_at ASC at the bottom of the group list) and
  //        aligns its top flush with the bottom of the fixed header.
  //
  //      - DOWN (above the bottom safe-area inset) shows whenever the
  //        document can scroll further down (scrollY < maxScroll).
  //        Targets the FIRST awaiting poll that is wholly below or
  //        bottom-clipped (aligning its top flush with the header); if
  //        none, scrolls to the document bottom.
  //
  //    The visibility evaluator is wired to scroll/resize AND a
  //    body-subtree MutationObserver because vote-driven re-renders flip
  //    a card's awaiting state without firing scroll, and CSS expand
  //    transitions move card rects without firing resize. All reads are
  //    rAF-coalesced so a mutation burst doesn't trigger N forced
  //    layouts via getBoundingClientRect().
  //
  //    OFF→ON transitions are suppressed while the user is actively
  //    scrolling: if an arrow isn't visible when scrolling starts, it
  //    stays hidden until scroll has completely stopped (150ms debounce
  //    on the scroll listener). Already-visible arrows keep updating
  //    normally so they can hide or retarget mid-scroll.
  //
  // ===================================================================
  // Initial-load scroll (path 1). Always lands the viewer at the
  // document bottom so the bubble bar is visible.
  // ===================================================================
  const hasHandledInitialExpandRef = useRef(false);
  // Wall-clock deadline (ms since epoch) for the bottom-pin. Set during
  // the initial-load effect; the pin no-ops past it.
  const bottomPinDeadlineRef = useRef(0);
  // Hard upper bound for the restore-scroll rAF loop. iOS Safari +
  // Next.js App Router reset scrollY ~30-40ms after our layoutEffect's
  // scrollTo, so we need a re-application window to outlast that.
  const restorePinDeadlineRef = useRef(0);
  // Target scrollY for the restore-scroll rAF loop. Cleared when the
  // loop converges (3 stable frames), the deadline passes, or the
  // user interacts.
  const restoreTargetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!group || loading) return;
    if (headerHeight === 0) return;
    if (hasHandledInitialExpandRef.current) return;
    hasHandledInitialExpandRef.current = true;

    // Back-nav path: restore the scroll position saved when the user
    // navigated away (tap on a poll card). Skip bottom-pin entirely so
    // async content settling doesn't drag the viewport off-target.
    // `mountedGroupKeys` is initialized with every card up-front in
    // this case (see the useState initializer above), so scrollHeight
    // already reflects the full document and the requested scrollY
    // lands without clamping.
    const remembered = getRememberedScroll(groupScrollKey(groupId));
    if (remembered !== undefined) {
      restoreTargetRef.current = remembered;
      // Pin against the target for a bounded window — iOS Safari +
      // Next.js App Router's scroll-to-top fires ~30-40ms after our
      // initial scrollTo, so we need re-application opportunities for
      // longer than that. 800ms matches BOTTOM_PIN_DURATION_MS.
      restorePinDeadlineRef.current = Date.now() + BOTTOM_PIN_DURATION_MS;
      window.scrollTo(0, remembered);
      setInitialScrollApplied(true);
      return;
    }

    bottomPinDeadlineRef.current = Date.now() + BOTTOM_PIN_DURATION_MS;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (max > 0) window.scrollTo(0, max);
    setInitialScrollApplied(true);
    // No cleanup return: useRef persists across React StrictMode's
    // mount→cleanup→mount cycle, so the ref check above guarantees fire-once
    // semantics. A cleanup that reset the ref would fire on every dep change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, loading, headerHeight]);

  // Re-apply the restored scroll until it sticks. iOS Safari + Next.js
  // App Router reset scrollY ~30-40ms after our initial scrollTo, so a
  // single useLayoutEffect scrollTo isn't enough. Re-apply each frame
  // until scrollY matches target for 3 consecutive frames (~50ms past
  // the iOS reset), or until the deadline passes, or until the user
  // interacts. Layout-change re-application is left to the existing
  // ResizeObserver path that already calls `applyScrollAdjustmentRef`.
  useEffect(() => {
    if (!group || loading) return;
    if (restoreTargetRef.current == null) return;
    let rafId: number | null = null;
    let stableFrames = 0;
    const tick = () => {
      rafId = null;
      if (userInteractedRef.current || Date.now() >= restorePinDeadlineRef.current) {
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
  }, [group, loading]);

  // Listen for question:updated events (fired when close/reopen happens from within
  // a card). Merge the updates into our local group state so downstream UI —
  // e.g. whether the modal should offer a Reopen button — reflects reality.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId: string; updates: Partial<Question> };
      if (!detail?.questionId) return;
      setGroup((prev) => {
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
  // this user's vote on this group didn't change.
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
  // immediately on vote; the sort order captures this at group-load only so
  // the card doesn't jump positions underneath the user.
  // Phase 5b: open/closed is poll-level — every question inherits its
  // wrapper's is_closed + response_deadline.
  const now = new Date();
  const pollByQuestionId = useMemo(() => {
    const map = new Map<string, Poll>();
    if (!group) return map;
    for (const mp of group.polls) {
      for (const sp of mp.questions) map.set(sp.id, mp);
    }
    return map;
  }, [group]);
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
  const groupQuestions = useMemo(() => {
    if (!group) return [] as Question[];
    return [...group.questions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [group]);

  // Phase 5b: poll wrappers ride along on the group state directly
  // (returned in bulk from /api/questions/accessible). Build a quick id → wrapper
  // map for the existing callsites that look one up. Voter aggregates stay
  // fresh via the QUESTION_VOTES_CHANGED_EVENT handler below, which refetches
  // affected wrappers and merges them back into group.polls.
  const pollWrapperMap = useMemo(
    () => (group ? buildPollMap(group.polls) : new Map<string, Poll>()),
    [group],
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
  const groupedGroupQuestions = useMemo(() => {
    type Group = {
      key: string;
      pollId: string | null;
      poll: Poll | null;
      subQuestions: Question[];
      anchor: Question;
    };
    const groups: Group[] = [];
    const seen = new Set<string>();
    for (const question of groupQuestions) {
      const groupKey = groupKeyFor(question);
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      const subQuestions = question.poll_id
        ? groupQuestions
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
  }, [groupQuestions, pollWrapperMap]);

  // === Virtualization helpers (anchor + observer wiring) ===
  // Anchor = the last group, so the document stays pinned to the bottom
  // while cards above mount via progressive fill (matches the initial-load
  // bottom-pin target).
  const anchorGroupKey = useMemo(() => {
    if (groupedGroupQuestions.length === 0) return null;
    return groupedGroupQuestions[groupedGroupQuestions.length - 1].key;
  }, [groupedGroupQuestions]);

  // Drop mountedGroupKeys entries for groups that no longer exist (forget,
  // error reload). Always include the anchor. Progressive fill below adds
  // the rest of the keys.
  useEffect(() => {
    if (groupedGroupQuestions.length === 0) return;
    const validKeys = new Set(groupedGroupQuestions.map(g => g.key));
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
  }, [groupedGroupQuestions, anchorGroupKey]);

  // Progressive fill: after first paint, mount remaining groups in idle-time
  // batches, prioritizing the cards closest to the anchor so the user sees
  // surrounding content fill in first. Batches of N groups per idle tick keep
  // each setState's re-render bounded; once all are mounted, no more setState
  // fires, so subsequent scroll is steady. For very long groups this still
  // loads everything (memory grows linearly with group size); cards are
  // already extracted into a React.memo'd GroupCardItem, so a future
  // bounded-memory scroll-window can swap this fill for IO-driven
  // mount/unmount when groups hit hundreds of polls. See CLAUDE.md
  // "Group-Page Layout Stability".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (groupedGroupQuestions.length === 0) return;
    if (mountedGroupKeys.size >= groupedGroupQuestions.length) return;
    const anchorIdx = anchorGroupKey
      ? groupedGroupQuestions.findIndex(g => g.key === anchorGroupKey)
      : 0;
    // Build a queue ordered by distance from anchor.
    const queue: string[] = [];
    const len = groupedGroupQuestions.length;
    for (let d = 1; queue.length < len; d++) {
      const before = anchorIdx - d;
      const after = anchorIdx + d;
      if (after < len) queue.push(groupedGroupQuestions[after].key);
      if (before >= 0) queue.push(groupedGroupQuestions[before].key);
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
    // once per groupedGroupQuestions change rather than on each batch
    // setState; the cursor + filter handle resumption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedGroupQuestions, anchorGroupKey]);

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
      // filling cards, bubble bar mounting, fonts/images settling). Without
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
    // Also observe the document element so post-card growth (the bubble bar
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
  // Bottom-pin. One unified function called from both useLayoutEffect
  // (every render) and the ResizeObserver (every layout change,
  // including async growth that doesn't trigger a render).
  //
  // As the doc grows (placeholders → real cards, results loads, fonts),
  // keep scrollY at max so the user lands on the bubble bar. Disables
  // on first user interaction (or after BOTTOM_PIN_DURATION_MS).
  // ===================================================================
  const applyScrollAdjustmentRef = useRef<() => void>(() => {});
  applyScrollAdjustmentRef.current = () => {
    if (typeof window === 'undefined' || !group) return;
    if (userInteractedRef.current) return;
    if (headerHeight === 0) return;
    // While a saved scroll is being restored, the rAF loop above owns
    // re-application. Don't let the bottom-pin fight it.
    if (restoreTargetRef.current !== null) return;
    // Bounded bottom-pin. Re-fire while async content settles
    // (placeholders → real cards, results loads grow scrollHeight) so
    // the bubble bar stays at the bottom of the viewport. Deadline
    // bound + userInteracted gate cap the iOS visualViewport feedback
    // loop that the unbounded PR #375 version produced.
    if (Date.now() > bottomPinDeadlineRef.current) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (max > 0 && Math.abs(window.scrollY - max) > 0.5) {
      window.scrollTo(0, max);
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
  // cached. Updates flow through patchGroupPolls so the derived map stays
  // in sync. Without `prephase_deadline` in the patch, the group card's
  // status row stays stuck on "Taking Suggestions" / "Collecting
  // Availability" until a manual refresh.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { questionId?: string } | undefined;
      if (!detail?.questionId || !group) return;
      const question = group.questions.find((p) => p.id === detail.questionId);
      const mid = question?.poll_id;
      if (!mid) return;
      void apiGetPollById(mid).then((wrapper) => {
        patchGroupPolls(
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
  }, [group, patchGroupPolls]);

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
    if (!group || typeof window === 'undefined') return;
    let rafId: number | null = null;
    let isScrolling = false;
    let scrollStoppedTimer: number | null = null;
    // Mirror of the React state, kept in sync inside the setter below so
    // `evaluate` can short-circuit before doing the DOM scan when both
    // arrows are hidden during a scroll (off→on is suppressed anyway).
    let currentShowUp = false;
    let currentShowDown = false;
    const evaluate = () => {
      rafId = null;
      if (isScrolling && !currentShowUp && !currentShowDown) return;
      const viewportTop = headerHeight;
      const viewportBottom = window.innerHeight;
      let upTargetId: string | null = null;
      let downTargetId: string | null = null;
      // groupQuestions is in strict chronological order (created_at ASC),
      // so iterating in order: the FIRST not-fully-in-view-above match is
      // the oldest such awaiting card, and the FIRST below-the-fold match
      // is the closest one beneath the viewport.
      for (const group of groupedGroupQuestions) {
        const question = group.anchor;
        if (!isAwaitingResponse(question)) continue;
        const card = cardRefs.current.get(question.id);
        if (!card) continue;
        const r = card.getBoundingClientRect();
        if (r.top < viewportTop && upTargetId === null) {
          upTargetId = question.id;
        }
        if (r.bottom > viewportBottom && r.top >= viewportTop && downTargetId === null) {
          downTargetId = question.id;
        }
        if (upTargetId !== null && downTargetId !== null) break;
      }
      const showUp = upTargetId !== null;
      // Down arrow shows whenever the page can scroll further down,
      // independent of awaiting polls. 1px epsilon for sub-pixel scrollY
      // values on iOS.
      const maxScroll = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const showDown = window.scrollY < maxScroll - 1;
      setScrollHelpers((prev) => {
        const nextShowUp = isScrolling && !prev.showUp ? false : showUp;
        const nextShowDown = isScrolling && !prev.showDown ? false : showDown;
        currentShowUp = nextShowUp;
        currentShowDown = nextShowDown;
        return (
          prev.showUp === nextShowUp &&
          prev.showDown === nextShowDown &&
          prev.upTargetId === upTargetId &&
          prev.downTargetId === downTargetId
            ? prev
            : { showUp: nextShowUp, showDown: nextShowDown, upTargetId, downTargetId }
        );
      });
    };
    // rAF-coalesce: a body-subtree MutationObserver fires on every DOM
    // mutation (vote-driven re-renders, expand/collapse animations,
    // countdown text updates). Without coalescing each burst would force a
    // layout via getBoundingClientRect on every awaiting card.
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(evaluate);
    };
    const onScroll = () => {
      isScrolling = true;
      if (scrollStoppedTimer !== null) window.clearTimeout(scrollStoppedTimer);
      scrollStoppedTimer = window.setTimeout(() => {
        isScrolling = false;
        scrollStoppedTimer = null;
        schedule();
      }, SCROLL_STOPPED_DEBOUNCE_MS);
      schedule();
    };
    evaluate();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // Body subtree catches vote-driven DOM changes that flip a card's
    // awaiting state plus expand/collapse height transitions that move
    // card rects without firing scroll/resize.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (scrollStoppedTimer !== null) window.clearTimeout(scrollStoppedTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, groupedGroupQuestions, headerHeight, votedQuestionIds, abstainedQuestionIds]);

  // When an awaiting card is targeted: align its top flush with the
  // bottom of the fixed header. For wholly-above / wholly-below cards
  // this brings them just below the header; for bottom-clipped
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

  // Elevate the arrow z-index above the slide overlay (z-60) when a
  // group-kind overlay is mounted. The slide overlay covers the viewport
  // with an opaque background at z-60; without this elevation the arrows
  // (default z-40) would be hidden behind the overlay throughout the
  // slide and only appear after unmount — visible as "arrows only appear
  // after the transition". Bumped only for group-kind overlays so that
  // slides FROM group to a subroute (info / edit-title / pollDetail /
  // pollInfo) still let the source's arrows get progressively covered by
  // the incoming overlay as it slides over them.
  const elevateArrowsForOverlay = useIsSlideOverlayGroupActive();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading group...</p>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Group Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This group may not exist or you don&apos;t have access.</p>
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
      <GroupHeader
        headerRef={headerRef}
        title={group.title}
        participantNames={group.participantNames}
        anonymousCount={group.anonymousRespondentCount}
        imageUrl={group.imageUrl}
        onTitleClick={() => {
          rememberCurrentScroll(groupScrollKey(groupId));
          slideToGroupInfo({ groupId });
        }}
        onBack={() => {
          // Save scroll BEFORE the navigation so re-entry restores it.
          rememberCurrentScroll(groupScrollKey(groupId));
          navigateWithTransition(router, '/', 'back');
        }}
        backIconVariant="menu"
      />

      {/* paddingTop reserves space for the fixed header above. The card
          sits flush with the header (gap=0) so both the slide overlay
          and the real route render the same offsetTop without needing
          to scroll. Earlier the default was 0.5rem with the expectation
          that the real route's initial-scroll effect would compensate
          by 8px — but on short-content groups (single small card)
          docHeight equals viewport so scroll is clamped to 0, leaving
          the card 8px lower than the overlay's. The overlay would then
          unmount and the user saw a small downward jump. Keep the
          `--group-card-gap` custom property — the overlay (and any
          future callers) can still override it. */}
      {/* The cards wrapper (sibling of the fixed header above) is the
          surface we transform during a slide overlay's pre-position —
          transforming the overlay itself would drag the fixed header
          with the content per the WebKit contain:strict quirk. */}
      {/* Swipe-back wrapper. Owns its own transform (set imperatively by
          the touch handlers via swipeWrapperRef); the inner cards div keeps
          its own transform for overlayCardsOffset so the two don't conflict
          across React re-renders. `touch-action: pan-y` hands horizontal
          pans to the app while leaving vertical scroll to the browser. */}
      <div
        ref={swipeWrapperRef}
        onTouchStart={handleSwipeTouchStart}
        onTouchMove={handleSwipeTouchMove}
        onTouchEnd={handleSwipeTouchEnd}
        onTouchCancel={handleSwipeTouchCancel}
        className="touch-pan-y"
        style={{ willChange: 'transform' }}
      >
      <div
        className="pb-2"
        style={{
          paddingTop: `calc(${headerHeight}px + var(--group-card-gap, 0px))`,
          // Negative horizontal margin cancels the outer template wrapper's
          // `paddingLeft/Right: max(0.35rem, env(safe-area-inset-*))` so the
          // edge-to-edge poll rectangles + dividers butt against the body's
          // safe-area content edge. Tailwind v4's `-mx-4` on the template's
          // inner wrapper is shadowed by the adjacent `mx-auto` (same
          // specificity, `mx-auto` lands later in the generated CSS and
          // wins), so we can't rely on that path. The 0.35rem overhang on
          // desktop is well inside the inner template's `sm:px-4` (1rem)
          // padding, so it doesn't escape the centered max-w-4xl bounds.
          marginLeft: 'calc(-1 * max(0.35rem, env(safe-area-inset-left, 0px)))',
          marginRight: 'calc(-1 * max(0.35rem, env(safe-area-inset-right, 0px)))',
          transform: overlayCardsOffset
            ? `translate3d(0, ${-overlayCardsOffset}px, 0)`
            : undefined,
          willChange: overlayCardsOffset ? 'transform' : undefined,
        }}
      >
        {/* Top divider above the first poll — pairs with each card's
            `border-b-2` so the rectangles are bracketed top + bottom.
            Rendered only when there's at least one poll so empty groups
            don't show a stray line above the bubble bar. */}
        {groupedGroupQuestions.length > 0 && (
          <div
            className={`border-t-2 ${ROW_DIVIDER_CLASS}`}
            aria-hidden="true"
          />
        )}
        {groupedGroupQuestions.map((group) => {
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
                  className={`border-b-2 ${ROW_DIVIDER_CLASS}`}
                  style={{ height: placeholderHeight }}
                  aria-hidden="true"
                />
              );
            }
            const question = group.anchor;
            const isClosed = !isQuestionOpen(question);
            const isAwaiting = isAwaitingResponse(question);
            const isPressed = pressedQuestionId === question.id;
            // A freshly-submitted placeholder card while it fade-in-animates
            // into its slot. Once POLL_HYDRATED_EVENT swaps the placeholder
            // for the real Poll, this flag clears and the card paints
            // normally.
            const isPlaceholder = pendingPollFirstQuestionId === question.id
              || isPendingPollId(question.poll_id);
            const isTooltipActive = tooltipQuestionId === question.id;
            return (
              <GroupCardItem
                key={question.id}
                group={group as GroupCardGroup}
                groupRouteId={groupId}
                isPressed={isPressed}
                isPlaceholder={isPlaceholder}
                isAwaiting={isAwaiting}
                isClosed={isClosed}
                isTooltipActive={isTooltipActive}
                questionResultsMap={questionResultsMap}
                userVoteMap={userVoteMap}
                longPressTimerRef={longPressTimer}
                isLongPressRef={isLongPress}
                touchStartPosRef={touchStartPos}
                isScrollingRef={isScrolling}
                touchJustHandledRef={touchJustHandled}
                attachCardEl={attachCardEl}
                detachCardEl={detachCardEl}
                setPressedQuestionId={setPressedQuestionId}
                setTooltipQuestionId={setTooltipQuestionId}
                setModalQuestion={setModalQuestion}
                setShowModal={setShowModal}
              />
            );
          })}

        <div id={DRAFT_POLL_PORTAL_ID} />
      </div>
      </div>

      {/* Group-aware long-press modal — Copy + Forget, plus Reopen when
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
            onCutoffSuggestions={
              !isModalClosed &&
              isInSuggestionPhase(modalQuestion, modalWrapper.prephase_deadline ?? null) &&
              (!!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'cutoff-suggestions', question: modalQuestion })
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
          haptic.medium();
          setPendingAction(null);
          if (action.kind === 'forget') {
            forgetQuestion(action.question.id);
            const remaining = group ? group.questions.filter((p) => p.id !== action.question.id) : [];
            if (group && remaining.length === 0) {
              // Drop the server-side `group_members` row so the group
              // doesn't reappear via Phase C.3 membership-based visibility
              // on the next /api/groups/mine call. Fire-and-forget.
              void apiLeaveGroup(groupId);
              router.push('/');
            } else {
              setGroup((prev) => (prev ? { ...prev, questions: prev.questions.filter((p) => p.id !== action.question.id) } : prev));
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
              patchGroupPolls(
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
              patchGroupPolls(
                (mp) => mp.id === pollId,
                () => ({ is_closed: true, close_reason: 'manual' }),
              );
            } catch (err) {
              console.error('Failed to close question:', err);
            }
          } else if (action.kind === 'cutoff-suggestions' || action.kind === 'cutoff-availability') {
            const apiFn = action.kind === 'cutoff-suggestions'
              ? apiCutoffPollSuggestions
              : apiCutoffPollAvailability;
            try {
              const secret = getCreatorSecret(action.question.id);
              if (!secret) {
                console.error(`Missing creator secret for ${action.kind}`);
                return;
              }
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error(`Cannot ${action.kind} without poll_id`);
                return;
              }
              const wrapper = await apiFn(pollId, secret);
              patchGroupPolls(
                (mp) => mp.id === pollId,
                () => ({ prephase_deadline: wrapper.prephase_deadline ?? null }),
              );
              for (const sp of wrapper.questions) {
                if (sp.options) {
                  const newOptions = sp.options;
                  patchGroupQuestions(
                    (p) => p.id === sp.id,
                    () => ({ options: newOptions }),
                  );
                }
              }
              // Refresh per-question compact preview results in parallel —
              // cutoff-suggestions can fan out across N sibling questions of
              // a multi-question poll.
              const refreshes = await Promise.all(
                wrapper.questions.map((sp) =>
                  apiGetQuestionResults(sp.id)
                    .then((r) => ({ id: sp.id, results: r }))
                    .catch(() => null),
                ),
              );
              setQuestionResultsMap((prev) => {
                let next = prev;
                for (const r of refreshes) {
                  if (!r) continue;
                  const existing = prev.get(r.id);
                  if (
                    existing &&
                    existing.total_votes === r.results.total_votes &&
                    existing.yes_count === r.results.yes_count &&
                    existing.no_count === r.results.no_count &&
                    existing.winner === r.results.winner &&
                    (existing.suggestion_counts?.length ?? 0) === (r.results.suggestion_counts?.length ?? 0)
                  ) continue;
                  if (next === prev) next = new Map(prev);
                  next.set(r.id, r.results);
                }
                return next;
              });
            } catch (err) {
              console.error(`Failed to ${action.kind}:`, err);
            }
          }
        }}
        onCancel={() => setPendingAction(null)}
      />
      )}

      {/* Scroll-helper buttons — rendered via the floating-fab-portal so
          `position: fixed` is relative to the real viewport (outside the
          responsive-scaling container's transform on desktop). The
          buttons elevate above the slide overlay (z-70) while a
          group-kind overlay is mounted, so they don't get hidden by the
          overlay's opaque background during the slide. */}
      {scrollHelperPortal && createPortal(
        <>
          {scrollHelpers.showUp && (
            <ScrollHelperButton
              direction="up"
              onClick={() => scrollAwaitingToHeader(scrollHelpers.upTargetId)}
              aria-label="Scroll to next poll awaiting your response"
              elevated={elevateArrowsForOverlay}
              style={{ top: `calc(${headerHeight}px + 0.5rem)` }}
            />
          )}
          {scrollHelpers.showDown && (
            <ScrollHelperButton
              direction="down"
              onClick={() => {
                if (scrollHelpers.downTargetId) {
                  scrollAwaitingToHeader(scrollHelpers.downTargetId);
                } else {
                  const max = Math.max(
                    0,
                    document.documentElement.scrollHeight - window.innerHeight,
                  );
                  window.scrollTo({ top: max, behavior: 'smooth' });
                }
              }}
              aria-label={
                scrollHelpers.downTargetId
                  ? 'Scroll to next poll awaiting your response'
                  : 'Scroll to bottom'
              }
              elevated={elevateArrowsForOverlay}
              style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
            />
          )}
        </>,
        scrollHelperPortal,
      )}
    </>
  );
}

// Resolves `/g/<groupShortId>?p=<pollShortId>` to the group root + the
// optional poll to expand. The path id is unambiguously a poll short_id /
// poll uuid (the group root); legacy `/p/<id>` URLs with arbitrary ids
// resolve via the `/p/[shortId]` redirect before reaching this component.
function GroupPageInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const groupShortId = params.groupShortId as string;
  const pollParam = searchParams.get(POLL_QUERY_PARAM);

  const rootInitial = useMemo<Poll | null>(() => {
    if (typeof window === "undefined" || !groupShortId) return null;
    if (isUuidLike(groupShortId)) return getCachedPollById(groupShortId);
    // Phase B.4: group route id can be `groups.short_id` (preferred) OR
    // `polls.short_id` (legacy /g/<root-poll-short-id> fallback). Look up
    // both forms before falling back to the async fetch.
    const accessible = getCachedAccessiblePolls() ?? [];
    const matches = accessible.filter(mp => mp.group_short_id === groupShortId);
    return findChainRoot(matches) ?? getCachedPollByShortId(groupShortId);
  }, [groupShortId]);

  const [rootPoll, setRootPoll] = useState<Poll | null>(rootInitial);
  const [error, setError] = useState(false);
  // Group resolved with zero visible polls; GroupContent mounts via
  // useGroup's summary-fallback path.
  //
  // When the home new group button just minted this group, `apiCreateGroup` cached
  // the summary — read it synchronously so the wrapper skips the loading
  // spinner entirely and `GroupContent` mounts on first paint. Without
  // this, the slide overlay unmounts onto a brief spinner before the
  // async fetch resolves ("page disappears and reappears").
  const [isEmptyGroup, setIsEmptyGroup] = useState(
    () => !rootInitial && !!groupShortId && !!getCachedGroupSummary(groupShortId),
  );

  useEffect(() => {
    if (!groupShortId) {
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
        // Phase B.4: prefer the group endpoint which resolves any route id
        // form (groups.short_id, groups.id, polls.short_id, polls.id) in
        // one call. Fall back to the per-poll endpoint when the group
        // endpoint 404s (older deploys, network glitches) so we don't lose
        // resolution on partially-rolled-out backends.
        const polls = await apiGetGroupByRouteId(groupShortId).catch((err: unknown) => {
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
        // Zero visible polls but group exists — short-circuit to the empty
        // state via the summary endpoint before falling through to per-poll
        // lookup.
        if (Array.isArray(polls)) {
          const summary = await apiGetGroupSummary(groupShortId);
          if (summary) {
            if (!cancelled) setIsEmptyGroup(true);
            return;
          }
        }
        // Last-ditch fallback: per-poll lookup for very old URL forms whose
        // resolution path didn't survive the groups-endpoint cutover.
        const isUuid = isUuidLike(groupShortId);
        const poll = await (isUuid
          ? apiGetPollById(groupShortId)
          : apiGetPollByShortId(groupShortId)
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
  }, [groupShortId, router, rootInitial]);

  // Legacy `?p=<id>` URLs (back when poll cards expanded in place) redirect
  // to the new poll detail page at `/g/<group>/p/<pollShort>`. Wait until
  // the group root has resolved so we know the canonical group route id.
  useEffect(() => {
    if (!pollParam) return;
    if (typeof window === "undefined") return;
    if (!rootPoll) return;
    const targetGroupId = rootPoll.group_short_id || rootPoll.short_id || groupShortId;
    router.replace(`/g/${targetGroupId}/p/${pollParam}`);
  }, [pollParam, rootPoll, groupShortId, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Group Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This group may have been removed or the link is incorrect.</p>
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

  if (!rootPoll && !isEmptyGroup) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading group...</p>
        </div>
      </div>
    );
  }

  // Phase B.4: prefer groups.short_id (the canonical /g/<id> form) so any
  // FE-built URL based on the resolved Poll matches the route id the user
  // landed with. Falls back to the URL's groupShortId for placeholder
  // polls and pre-B.4 cached polls without group_short_id. Empty groups
  // pass the URL's groupShortId through (no rootPoll to read from).
  const groupRouteId =
    rootPoll?.group_short_id || rootPoll?.short_id || groupShortId;

  return <GroupContent groupId={groupRouteId} />;
}

export default function GroupPage() {
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
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading group...</p>
        </div>
      </div>
    }>
      <GroupPageInner />
    </Suspense>
  );
}

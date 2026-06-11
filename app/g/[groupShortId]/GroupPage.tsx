"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo, Suspense } from "react";
import { flushSync, createPortal } from "react-dom";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Question } from "@/lib/types";
import { getMyGroups } from "@/lib/simpleQuestionQueries";
import { buildEmptyGroup, buildGroupFromPollDown, buildGroupSyncFromCache, buildPollMap, findChainRoot, isPendingPollId, POLL_QUERY_PARAM } from "@/lib/groupUtils";
// POLL_QUERY_PARAM is still used by `GroupPageInner` to redirect legacy
// `?p=<pollShort>` URLs to the new `/g/<group>/p/<pollShort>` route.
import { mergePollListPreservingIdentity, mergeQuestionResultsMap } from "@/lib/groupRefresh";
import { apiGetQuestionResults, apiGetGroupByRouteId, apiGetGroupMembers, apiGetGroupSummary, apiGetVotes, apiClosePoll, apiReopenPoll, apiCutoffPollAvailability, apiCutoffPollSuggestions, apiCancelRecurrence, apiGetPollById, apiGetPollByShortId, apiSetPollFollowState, ApiError, QUESTION_VOTES_CHANGED_EVENT } from "@/lib/api";
import RecurrenceCancelSheet from "@/components/RecurrenceCancelSheet";
import { formatLocalDateISO as formatRecurrenceDateISO } from "@/lib/recurrence";
import type { Poll } from "@/lib/types";
import { useGroupVoting } from "@/lib/useGroupVoting";
import type { QuestionResults } from "@/lib/types";
import { isPollCreatedByViewer } from "@/lib/browserQuestionAccess";
import { getCachedAccessiblePolls, getCachedGroupSummary, getCachedPollById, getCachedPollByShortId } from "@/lib/questionCache";
import {
  POLL_PENDING_EVENT,
  POLL_HYDRATED_EVENT,
  POLL_FAILED_EVENT,
  SHOW_HOME_BACKDROP_EVENT,
  HIDE_HOME_BACKDROP_EVENT,
  HIDE_GROUP_BACKDROP_EVENT,
  GROUP_MEMBERS_CHANGED_EVENT,
  type GroupMembersChangedDetail,
  type PollPendingDetail,
  type PollHydratedDetail,
  type PollFailedDetail,
} from "@/lib/eventChannels";
import { isUuidLike } from "@/lib/questionId";
import { GROUP_ID_ATTR, DRAFT_POLL_PORTAL_ID, PANEL_HEIGHT_VAR } from "@/lib/groupDomMarkers";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { useDeadlineTick } from "@/lib/useDeadlineTick";
import { useSwipeBackGesture } from "@/lib/useSwipeBackGesture";
import { setSwipeScrollbarLock } from "@/lib/scrollbarLock";
import { isInTimeAvailabilityPhase, isInSuggestionPhase } from "@/lib/questionListUtils";
import { loadVotedQuestions, getStoredVoteId, parseYesNoChoice } from "@/lib/votedQuestionsStorage";
import { computePollUnread, useUnreadReactivity } from "@/lib/unread";
import { classifyPollTab, type PollTab } from "@/lib/followState";
import { usePrefetch } from "@/lib/prefetch";
import { slideToGroupInfo, slideToGroupInviteMembers, slideToGroupScheduled, useIsSlideOverlayGroupActive, SLIDE_DURATION_MS } from "@/lib/slideOverlay";
import { startInviteCreation, stashInviteCreation } from "@/lib/inviteCreation";
import { getRememberedScroll, groupScrollKey, rememberCurrentScroll } from "@/lib/scrollMemory";
import { isScrollRestoring, setScrollRestoring } from "@/lib/scrollRestoreState";
import { navigateWithTransition } from "@/lib/viewTransitions";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import AccountGateModal from "@/components/AccountGateModal";
import { getUserName } from "@/lib/userProfile";
import { isValidUserName } from "@/lib/nameValidation";
import GroupHeader from "@/components/GroupHeader";
import { forgetQuestion } from "@/lib/forgetQuestion";
import { haptic } from "@/lib/haptics";
import { PENDING_ACTION_COPY, type PendingActionKind } from "./groupActionCopy";
import { GroupCardItem, ROW_DIVIDER_CLASS, type GroupCardGroup } from "./GroupCardItem";
import { GroupNotFound as GroupNotFoundFallback } from "@/components/GroupLoadState";

import type { Group } from "@/lib/groupUtils";

// Default placeholder height for not-yet-measured groups in the virtualized
// group list. Tuned to typical compact yes_no card height; the ResizeObserver
// replaces this with the measured value as soon as a group has been mounted
// once. Subsequent unmounts use the measured height, so unmount→remount cycles
// don't shift the document layout.
const ESTIMATED_GROUP_HEIGHT = 110;

// The three follow/ignore lists, rendered inline in this order. Each gets a
// labeled header with a divider line under it; empty lists are skipped.
const SECTION_DEFS: { tab: PollTab; label: string }[] = [
  { tab: "todo", label: "To Do" },
  { tab: "new", label: "Relevant" },
  { tab: "old", label: "Old" },
];

// Group key for `groupedGroupQuestions` — questions of the same poll share
// poll_id; legacy (non-poll) questions get a unique `solo-` prefix so they
// don't collide. Used in the .map() loop's key + virtualization mountedKeys.
const groupKeyFor = (q: { id: string; poll_id?: string | null }): string =>
  q.poll_id ?? `solo-${q.id}`;

// Scroll-restore (back-nav) re-application window. Measured from the first
// time the pin actually runs, not from when the layoutEffect arms it — the
// slide-back animation + mounting every card can starve requestAnimationFrame
// for hundreds of ms, and an arm-time deadline would expire before the loop
// ever re-applied (leaving the page at Next.js' scroll-to-0 → top of the
// list). The window is interaction-gated (any real pointer/wheel/key disables
// it immediately), so a generous value is safe — it just holds the restored
// position until the user takes over or Next's reset is long past.
const RESTORE_PIN_DURATION_MS = 2500;

// Debounce window for "scroll has stopped." Below this iOS momentum
// scrolling can briefly pause and reads as idle; above it the arrow
// feels laggy to appear after a true stop.
const SCROLL_STOPPED_DEBOUNCE_MS = 150;

const SCROLL_HELPER_BUTTON_CLASS_BASE =
  'fixed left-1/2 -translate-x-1/2 w-[2.475rem] h-[2.475rem] rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md flex items-center justify-center transition-opacity';

const ScrollHelperButton = React.forwardRef<
  HTMLButtonElement,
  {
    onClick: () => void;
    style: React.CSSProperties;
    /** When true, render above the slide overlay (z-70) instead of at the
     *  default z-40 so the arrow isn't hidden by the overlay's opaque
     *  background during a group-kind slide. */
    elevated?: boolean;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'style' | 'type' | 'className'>
>(({ onClick, style, elevated, ...rest }, ref) => {
  const className = `${SCROLL_HELPER_BUTTON_CLASS_BASE} ${elevated ? 'z-[70]' : 'z-40'}`;
  return (
    <button ref={ref} type="button" onClick={onClick} className={className} style={style} {...rest}>
      <svg className="w-[1.35rem] h-[1.35rem]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
});
ScrollHelperButton.displayName = 'ScrollHelperButton';

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
  /** True when this instance is rendered inside the slide overlay (vs the
   *  real route). The overlay is position:fixed, so it can NOT use
   *  `window.scrollTo` for positioning — scroll positioning happens via
   *  the cards-wrapper transform (only for a saved-scroll restore). A
   *  fresh-nav overlay uses no transform and shows the top, matching the
   *  real route's fresh-visit scroll-to-top. */
  inOverlay?: boolean;
}

export function GroupContent({ groupId, overlayCardsOffset, inOverlay }: GroupContentProps) {
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

  // Read-state model: the gold "unread" bar + scroll-helper arrows reflect
  // whether each poll is unread under the user's badge settings (see
  // lib/unread.ts). `pollViewsTick` is a bare re-render trigger — the unread
  // helper reads the localStorage view store directly, so a bump on
  // POLL_VIEWED_CHANGED_EVENT is enough to recompute (e.g. clear the bar the
  // instant the user opens a poll).
  const { badgeSettings, pollViewsTick } = useUnreadReactivity();

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

  // Gap 1: ✕ (ignore → 'old') / + (re-follow → 'new'). Optimistically patch
  // the poll's follow state so it moves tabs instantly, then persist; revert on
  // failure. Stable ref-callback so it doesn't churn GroupCardItem's memo.
  const handleToggleFollow = useRef(
    (pollId: string, next: "new" | "old") => {
      const prevState = next === "old" ? "new" : "old";
      patchGroupPolls((mp) => mp.id === pollId, () => ({ viewer_follow_state: next }));
      apiSetPollFollowState(pollId, next).catch(() => {
        patchGroupPolls((mp) => mp.id === pollId, () => ({ viewer_follow_state: prevState }));
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

  // The create-poll bar's access gating is structural: GroupContent only
  // renders the `#draft-poll-portal` (below) in its loaded-with-access main
  // return. The loading spinner and the no-access wall (`error || !group`)
  // return early WITHOUT the portal, so the bar can't appear there.

  // "No one else is here yet" CTAs: when the viewer is this group's admin
  // AND its only member (a freshly-created group), float two big buttons —
  // Add People / Create Invite Link — just above the create-poll search bar.
  // `participantNames`/`anonymousRespondentCount` (poll voters, viewer
  // excluded) are a cheap client-side pre-filter: any OTHER participant means
  // the group can't be solo, so the roster round-trip only fires on
  // quiet/fresh groups.
  const maybeSoloGroup =
    !!group &&
    group.participantNames.length === 0 &&
    group.anonymousRespondentCount === 0;
  const [soloAdmin, setSoloAdmin] = useState(false);
  useEffect(() => {
    if (!maybeSoloGroup) {
      setSoloAdmin(false);
      return;
    }
    let cancelled = false;
    const load = () => {
      apiGetGroupMembers(groupId)
        .then((roster) => {
          if (cancelled) return;
          setSoloAdmin(
            roster.viewer_is_admin &&
              roster.members.length + roster.anonymous_count <= 1,
          );
        })
        .catch(() => {
          if (!cancelled) setSoloAdmin(false);
        });
    };
    load();
    // The Add People screen slides back over this still-mounted page, so a
    // remount can't be relied on — refetch when it reports a membership
    // change so the CTAs dismiss once someone is added.
    const onMembersChanged = (e: Event) => {
      const detail = (e as CustomEvent<GroupMembersChangedDetail>).detail;
      if (detail?.routeId === groupId) load();
    };
    // Someone may redeem the invite link while this tab is backgrounded.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener(GROUP_MEMBERS_CHANGED_EVENT, onMembersChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(GROUP_MEMBERS_CHANGED_EVENT, onMembersChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [groupId, maybeSoloGroup]);

  const handleEmptyStateAddPeople = () => {
    haptic.medium();
    rememberCurrentScroll(groupScrollKey(groupId));
    // "Push the Add people button on /info for them": slide to /info first so
    // the history/back chain matches the manual path (invite-members' back
    // returns to /info), then chain into the invite-members slide once the
    // first slide lands. The overlay host is built for consecutive events —
    // it clears the pending unmount + replaces its state, and slide 1's
    // router.push has committed /info underneath by then.
    slideToGroupInfo({ groupId });
    window.setTimeout(
      () => slideToGroupInviteMembers({ groupId }),
      SLIDE_DURATION_MS + 80,
    );
  };

  const handleEmptyStateCreateInvite = () => {
    haptic.medium();
    rememberCurrentScroll(groupScrollKey(groupId));
    // Mint + register the clipboard write INSIDE this tap's user-activation
    // window (iOS rejects async clipboard writes outside it), stash the
    // in-flight creation, and slide to /info — InviteLinksSection adopts the
    // stash and shows the fresh row in its auto-"Copied!" state.
    stashInviteCreation(groupId, startInviteCreation(groupId));
    slideToGroupInfo({ groupId });
  };

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
    submitPollAbstain,
  } = useGroupVoting({ group, setVotedQuestionIds, setAbstainedQuestionIds });

  // Swipe-to-abstain (To Do cards) needs a name like any vote. Stash the
  // abstain as a retry thunk + open the account gate when the viewer is
  // nameless; replay it on save. `nameReady` is read by each card so it only
  // plays the slide-out exit animation when the abstain will actually proceed
  // (no name → gate modal instead, card snaps back).
  const [pendingNameRetry, setPendingNameRetry] = useState<(() => void) | null>(null);
  const nameReady = isValidUserName(getUserName());
  // Stable identity (cards don't compare handlers) but always calls the latest
  // closure — submitPollAbstain is recreated each render.
  const swipeAbstainImplRef = useRef<(pollId: string, subs: Question[]) => void>(() => {});
  swipeAbstainImplRef.current = (pollId: string, subQuestions: Question[]) => {
    if (!isValidUserName(getUserName())) {
      setPendingNameRetry(() => () => void submitPollAbstain(pollId, subQuestions));
      return;
    }
    void submitPollAbstain(pollId, subQuestions);
  };
  const handleSwipeAbstain = useRef(
    (pollId: string, subQuestions: Question[]) => swipeAbstainImplRef.current(pollId, subQuestions),
  ).current;
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
  // both register in cardRefs (so the tap-expand + restore-pin scroll logic
  // that iterates cardRefs works regardless of mount state) and observe via the
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
  // The saved-scroll restore pin stays active until the user explicitly
  // interacts (wheel, touch, keyboard). The earlier
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
    // Seed with the newest poll — the display sorts newest-first, so this is
    // the card at the TOP of the list, which is what a fresh visit lands on
    // (no placeholder→card swap at the top on first paint). The anchor effect
    // + progressive fill mount the rest downward in idle-time batches.
    const target = initialGroup.questions[initialGroup.questions.length - 1] ?? null;
    if (target) initial.add(groupKeyFor(target));
    return initial;
  });

  // Long press state
  const [modalQuestion, setModalQuestion] = useState<Question | null>(null);
  const [showModal, setShowModal] = useState(false);
  // The recurring poll whose cancel sheet is open (long-press → "Cancel
  // recurring…"). Null when the sheet is closed.
  const [recurrenceSheetPoll, setRecurrenceSheetPoll] = useState<Poll | null>(null);
  const [recurrenceSheetBusy, setRecurrenceSheetBusy] = useState(false);
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
        // Warm the votes cache only for yes_no questions the viewer has
        // already voted on — the sole remaining per-question votes consumer
        // is the userVoteMap pill-highlight in `maybeFetch` below. Respondent
        // bubbles now render from the poll wrapper's static voter_names, so
        // the old blanket "fetch every question's votes" prefetch is gone.
        for (const mp of polls) {
          for (const sp of mp.questions) {
            if (sp.question_type === 'yes_no' && getStoredVoteId(sp.id)) {
              void apiGetVotes(sp.id).catch(() => null);
            }
          }
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

  // The first question of a freshly submitted (placeholder) poll, while
  // hydration is pending. While
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
  // DOM node doesn't unmount/re-mount mid-hydration. Once the placeholder is
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
  // off to the right with the home backdrop revealed underneath. While the
  // gesture is active, HomeBackdropHost (at layout level) mounts the cached
  // groups list so the user sees home from the first pixel of motion. The
  // backdrop dismisses itself once home's mount effect dispatches HIDE.
  //
  // The backdrop stays at its final position (no parallax) — an earlier
  // iOS-style parallax variant was retired because shifting the title left
  // made it visually collide with the (statically positioned) settings
  // gear at the viewport's left edge.
  const upArrowRef = useRef<HTMLButtonElement | null>(null);
  // The create-poll search bar is portaled into `#draft-poll-portal`, which
  // GroupContent renders as a body-level sibling of the swipe wrapper (so the
  // bar's fixed full-screen focused picker still layers above the header /
  // commit badge). Body-level means the gesture transform wouldn't reach it,
  // so add the portal node to `extraTargets` — then a group→home swipe slides
  // the bar off with the page (mirroring the header). During a slide OVERLAY
  // the bar inherits the overlay's transform instead (it's portaled into the
  // overlay's `contain: strict` GroupContent), so no per-frame work is needed
  // there.
  const barPortalRef = useRef<HTMLDivElement | null>(null);
  const { swipeWrapperRef, touchHandlers: swipeTouchHandlers } = useSwipeBackGesture({
    headerRef,
    extraTargets: [upArrowRef, barPortalRef],
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    // No scroll save here: returning home intentionally resets every group's
    // scroll (home's mount clears it via clearGroupScroll), so this group
    // re-opens at the bottom rather than restoring this position.
    onCommit: () => router.push('/'),
  });

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
        questionType === 'time' ||
        questionType === 'limited_supply';
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
  // On a fresh visit (and after going home then back — both have no saved
  // scroll), the initial scroll lands the viewer at the TOP of the group.
  // Top is a stable target: content grows downward as cards/results load,
  // so scrollY=0 needs no pin and Next.js' own scroll-to-0 cooperates.
  // Only a saved-scroll RESTORE (within-group back, group↔poll round-trip)
  // needs the re-application pin (see the persistent restore-pin below).
  // The scroll-to-top arrow below lets users jump back up once they've
  // scrolled down.
  //
  // 1. INITIAL load (`useLayoutEffect` below, fires once per mount).
  //    Fresh visit → `window.scrollTo(0, 0)`. Back-nav with a saved scroll
  //    → restore that scrollY (and arm the restore-pin). Runs synchronously
  //    before paint via a fire-once `useRef` guard so the first painted
  //    frame is already at the destination — never an "in-place then
  //    scroll" two-frame flicker. Cleanup intentionally omitted; useRef
  //    persists across StrictMode mount→cleanup→mount, and a cleanup that
  //    reset the ref would re-fire on every dep-change (e.g. async
  //    accessible-polls refresh) and re-scroll against a now-taller page.
  //
  // 2. TAP-EXPAND (`useEffect` further below, fires after initial layout
  //    has settled): smoothly scrolls (rAF, ease-out cubic, 300ms —
  //    matching the grid-rows expand transition) only enough to keep the
  //    just-expanded card onscreen — align top to header if cut off
  //    above, or trim the bottom overshoot otherwise (capped by
  //    available slack so the top never disappears behind the header).
  //
  // 3. SCROLL-TO-TOP ARROW: a single fixed button (just below the header)
  //    portaled into `#floating-fab-portal`. Shows whenever the page is
  //    scrolled down from the very top (scrollY > 1); tapping it smooth-
  //    scrolls back to the top. The visibility evaluator is wired to
  //    scroll/resize; reads are rAF-coalesced.
  //
  //    OFF→ON is suppressed while the user is actively scrolling: the
  //    arrow only surfaces once scroll has completely stopped (150ms
  //    debounce). ON→OFF (reaching the top) is never suppressed.
  //
  // ===================================================================
  // Initial-load scroll (path 1). Fresh visit → top; back-nav → restore.
  // ===================================================================
  const hasHandledInitialExpandRef = useRef(false);
  // Hard upper bound for the restore-scroll rAF loop. iOS Safari +
  // Next.js App Router reset scrollY ~30-40ms after our layoutEffect's
  // scrollTo, so we need a re-application window to outlast that.
  const restorePinDeadlineRef = useRef(0);
  // Target scrollY for the restore-scroll pin. Cleared when the deadline
  // passes or the user interacts.
  const restoreTargetRef = useRef<number | null>(null);
  // Kicks the persistent restore-pin's rAF loop. Set by the persistent
  // effect; called by the layoutEffect when it arms a restore on a commit
  // after the persistent effect already mounted.
  const kickRestorePinRef = useRef<() => void>(() => {});
  // Minimum document height to apply during the restore window. The
  // initial render has `scrollHeight ≈ innerHeight` (cards mounted as
  // shell components with empty data), but `window.scrollTo(remembered)`
  // is silently clamped to scrollHeight-innerHeight = 0. As async card
  // data arrives, the doc grows, but scrollY can't reach `remembered`
  // until growth exceeds it — leaving the bubble bar pushed below the
  // visible viewport for hundreds of ms. Setting `minHeight =
  // remembered + innerHeight` on the cards-wrapper forces document
  // scrollHeight high enough that scrollTo(remembered) is reachable
  // from the first paint. Cleared once the rAF loop bails. The
  // overshoot is invisible to the user — they're at scrollY=remembered
  // = scrollHeight-innerHeight, so the wrapper's bottom edge is
  // exactly at viewport bottom; any extra height we forced sits below
  // the actual content but never enters the viewport.
  //
  // Seeded SYNCHRONOUSLY in the useState initializer so the very
  // first render already commits with the larger minHeight. A
  // useLayoutEffect that calls setRestoreMinHeight after the initial
  // render is too late — the initial render's small wrapper would
  // commit, document.scrollHeight would drop, and Next.js'
  // scroll-to-top would clamp scrollY to 0 before the effect's
  // imperative write could catch up.
  const [restoreMinHeight, setRestoreMinHeight] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const remembered = getRememberedScroll(groupScrollKey(groupId));
    if (remembered === undefined) return null;
    return remembered + window.innerHeight;
  });
  useLayoutEffect(() => {
    if (!group || loading) return;
    if (headerHeight === 0) return;
    if (hasHandledInitialExpandRef.current) return;
    hasHandledInitialExpandRef.current = true;

    // Skip document-level scroll machinery when rendered inside the
    // slide overlay. The overlay is position:fixed + contain:strict,
    // so its wrapper's minHeight does NOT contribute to
    // documentElement.scrollHeight. Calling window.scrollTo(0,
    // remembered) from here lands on a still-short doc (only the
    // home page contributes) and iOS Safari deferred-clamps the
    // scrollY back to 0 a few frames later — even after the real
    // route's wrapper grows the doc. The clamp persists, the rAF
    // loop fights it, and the visible polls/bubble bar at the
    // bottom flicker right after the overlay unmounts. Overlay
    // positioning is driven entirely by the cards-wrapper transform
    // (saved-scroll restore via `overlayCardsOffset`; a fresh-nav
    // overlay uses no transform and shows the top);
    // document scroll is irrelevant for it.
    if (inOverlay) return;

    // Back-nav path: restore the scroll position saved when the user
    // navigated away (tap on a poll card), re-applied via the restore pin
    // so async content settling doesn't drag the viewport off-target.
    // `mountedGroupKeys` is initialized with every card up-front in
    // this case (see the useState initializer above), so scrollHeight
    // already reflects the full document and the requested scrollY
    // lands without clamping.
    const remembered = getRememberedScroll(groupScrollKey(groupId));
    if (remembered !== undefined) {
      restoreTargetRef.current = remembered;
      // Tell scroll-driven chrome (bubble bar, scroll arrows) that the
      // upcoming scroll jumps are a programmatic restore, not the user
      // scrolling — otherwise the restore's downward jump hides the bubble
      // bar and flickers the arrows.
      setScrollRestoring(true);
      // Arm (don't start) the pin window. The rAF loop below starts the
      // RESTORE_PIN_DURATION_MS countdown on its first tick that actually
      // runs — measuring from here would let the slide-back animation +
      // card-mount work consume the entire window before the loop ever
      // re-applies after Next.js' scroll-to-0. 0 is the "armed, not
      // started" sentinel.
      restorePinDeadlineRef.current = 0;
      // Document scrollHeight is already large enough — restoreMinHeight
      // is seeded in the useState initializer so the initial render
      // committed with the grown wrapper. scrollTo lands at the target
      // without clamping.
      window.scrollTo(0, remembered);
      // Start the persistent pin's rAF loop. On the mount commit the
      // persistent effect runs after this layoutEffect and kicks itself; this
      // call covers the case where the restore is armed on a later commit
      // (group/headerHeight settled after first paint).
      kickRestorePinRef.current();
      setInitialScrollApplied(true);
      return;
    }

    // Fresh visit (no saved scroll): land at the top. Top is stable as
    // content grows downward, so there's no pin to fight Next.js'
    // scroll-to-0 — they agree.
    window.scrollTo(0, 0);
    setInitialScrollApplied(true);
    // No cleanup return: useRef persists across React StrictMode's
    // mount→cleanup→mount cycle, so the ref check above guarantees fire-once
    // semantics. A cleanup that reset the ref would fire on every dep change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, loading, headerHeight]);

  // (The fresh-nav overlay shows the TOP of the group — no transform — to
  // match the real route's fresh-visit scroll-to-top. Only a saved-scroll
  // restore drives the cards-wrapper transform, via `overlayCardsOffset`.)

  // Persistent restore-pin. Re-applies the saved scroll target until it
  // sticks, defeating Next.js App Router's post-commit scroll-to-0 (it fires
  // ~30-40ms after the back commit, sometimes repeatedly while the route
  // settles). Two defenses:
  //   1. A synchronous `scroll` listener — Next's scrollTo(0) fires a `scroll`
  //      event, and re-applying the target from inside the handler snaps the
  //      position back BEFORE the next paint, regardless of rAF starvation.
  //   2. An rAF loop — catches resets that don't emit a `scroll` event and
  //      enforces the bounded window.
  // CRITICAL: this effect has EMPTY deps so the listener is installed once and
  // never torn down. An earlier version keyed it on [group, loading]; the
  // frequent setGroup churn (5s refresh, vote events) tore the listener down
  // and re-ran the effect, leaving gaps with no listener attached — and Next's
  // scroll-to-0 firing inside such a gap stranded the page at the top of the
  // list. repin() is a no-op whenever restoreTargetRef is null (normal
  // browsing), so a permanently-attached listener costs one null check per
  // scroll event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let rafId: number | null = null;
    let reentryGuard = false;
    const endRestore = () => {
      restoreTargetRef.current = null;
      setRestoreMinHeight(null);
      // Hand scroll-driven chrome (bubble bar, arrows) back to normal: the
      // programmatic restore jumps are done.
      setScrollRestoring(false);
    };
    const repin = () => {
      const target = restoreTargetRef.current;
      if (target == null) return;
      // User took over — respect their scroll, stop re-applying. pointerdown
      // / wheel / keydown set this flag (capture phase) before the scroll
      // event they cause, so a real user scroll is never fought.
      if (userInteractedRef.current) {
        endRestore();
        return;
      }
      // Start the bounded window on the first time we actually run (armed as
      // 0 in the layoutEffect) so the full window is real re-application time
      // rather than wall-clock that elapsed while rAF was starved.
      if (restorePinDeadlineRef.current === 0) {
        restorePinDeadlineRef.current = Date.now() + RESTORE_PIN_DURATION_MS;
      }
      if (!reentryGuard && Math.abs(window.scrollY - target) > 0.5) {
        // reentryGuard stops our own scrollTo's `scroll` event from
        // recursing through the listener within this synchronous frame.
        reentryGuard = true;
        window.scrollTo(0, target);
        reentryGuard = false;
      }
      if (Date.now() >= restorePinDeadlineRef.current) {
        endRestore();
      }
    };
    const tick = () => {
      rafId = null;
      repin();
      if (restoreTargetRef.current != null) rafId = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (rafId == null && restoreTargetRef.current != null) {
        rafId = requestAnimationFrame(tick);
      }
    };
    kickRestorePinRef.current = kick;
    const onScroll = () => repin();
    window.addEventListener('scroll', onScroll, { passive: true });
    // The layoutEffect that arms a restore runs BEFORE this effect on the
    // mount commit, so kick here to start the loop for that case.
    kick();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      kickRestorePinRef.current = () => {};
      // Unmounting mid-restore (e.g. navigating away again) must not leave the
      // flag stuck true for the next group page's chrome.
      setScrollRestoring(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Re-render when the soonest unexpired poll deadline crosses, so the per-card
  // status flips from "Voting: <countdown>" → "Closed Xm ago" without waiting
  // for the 5s refresh tick. The SimpleCountdown's imperative per-second DOM
  // updates otherwise display "Voting: Expired" in the gap.
  useDeadlineTick(
    group?.polls.flatMap((mp) =>
      mp.is_closed ? [] : [mp.response_deadline, mp.prephase_deadline],
    ) ?? [],
  );
  const wrapperFor = (question: Question): Poll | null =>
    pollByQuestionId.get(question.id) ?? (question.poll_id ? pollWrapperMap.get(question.poll_id) ?? null : null);
  const isQuestionOpen = (question: Question) => {
    const mp = wrapperFor(question);
    if (!mp) return true;
    return mp.response_deadline ? new Date(mp.response_deadline) > now && !mp.is_closed : !mp.is_closed;
  };
  // Gold "unread" bar (and the scroll-helper arrows) reflect read state per
  // the user's badge settings, computed at the poll level. Default rule:
  // opening the poll clears it; "stay unread until I respond" mode clears
  // only on a vote/abstain. Falls back to the legacy "open + un-actioned"
  // predicate when no wrapper poll is resolvable (placeholder / no poll_id).
  const isCardUnread = (question: Question): boolean => {
    const mp = wrapperFor(question);
    if (!mp) {
      return isQuestionOpen(question)
        && !votedQuestionIds.has(question.id)
        && !abstainedQuestionIds.has(question.id);
    }
    return computePollUnread(mp, badgeSettings, votedQuestionIds, abstainedQuestionIds, now.getTime());
  };

  // Strict chronological order (oldest → newest, newest at bottom). No
  // awaiting/closed grouping — voting on a card never reshuffles the list,
  // so the sort can read live state directly. Defined above the early
  // returns so the hook call order is stable.
  const groupQuestions = useMemo(() => {
    if (!group) return [] as Question[];
    // Reverse-chronological: latest poll on top of the group list (all tabs).
    return [...group.questions].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
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

  // === Gap 1: per-poll follow/ignore lists (To Do · New · Old) ===
  // Each poll classifies into exactly ONE of three lists, rendered inline in
  // order (To Do, then New, then Old) — not behind tabs. A resolved wrapper
  // drives it via `classifyPollTab`; a not-yet-resolved wrapper (cache cold)
  // is treated as followed — To Do when the anchor still wants input, else New.
  const classifyEntry = (g: { poll: Poll | null; anchor: Question; subQuestions: Question[] }): PollTab => {
    if (g.poll) {
      return classifyPollTab(g.poll, votedQuestionIds, abstainedQuestionIds, now.getTime());
    }
    const responded = g.subQuestions.some(
      (q) => votedQuestionIds.has(q.id) || abstainedQuestionIds.has(q.id),
    );
    return isQuestionOpen(g.anchor) && !responded ? "todo" : "new";
  };
  // Split the polls into the three ordered lists. `sections` drops any empty
  // list (so its header divider is skipped); `visibleGroupedQuestions` is the
  // flat concatenation in section order, which the virtualization + anchor +
  // scroll-helper machinery below operates on.
  const { sections, visibleGroupedQuestions } = useMemo(() => {
    const byTab: Record<PollTab, GroupCardGroup[]> = { todo: [], new: [], old: [] };
    for (const g of groupedGroupQuestions) {
      byTab[classifyEntry(g)].push(g as GroupCardGroup);
    }
    const built = SECTION_DEFS
      .map((d) => ({ ...d, groups: byTab[d.tab] }))
      .filter((s) => s.groups.length > 0);
    return { sections: built, visibleGroupedQuestions: built.flatMap((s) => s.groups) };
    // classifyEntry reads votedQuestionIds/abstainedQuestionIds + the polls'
    // follow state (carried on groupedGroupQuestions); pollViewsTick is a
    // re-render nudge after a vote/view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedGroupQuestions, votedQuestionIds, abstainedQuestionIds, pollViewsTick]);

  // === Virtualization helpers (anchor + observer wiring) ===
  // Anchor = the first (top) group, since a fresh visit lands at the top.
  // The top card mounts first and progressive fill mounts the rest downward.
  // (A back-nav restore mounts every card up-front in the mountedGroupKeys
  // initializer, so the anchor only shapes the fresh-visit fill order.)
  const anchorGroupKey = useMemo(() => {
    if (visibleGroupedQuestions.length === 0) return null;
    return visibleGroupedQuestions[0].key;
  }, [visibleGroupedQuestions]);

  // Drop mountedGroupKeys entries for groups that no longer exist (forget,
  // error reload). Always include the anchor. Progressive fill below adds
  // the rest of the keys.
  useEffect(() => {
    if (visibleGroupedQuestions.length === 0) return;
    const validKeys = new Set(visibleGroupedQuestions.map(g => g.key));
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
  }, [visibleGroupedQuestions, anchorGroupKey]);

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
    if (visibleGroupedQuestions.length === 0) return;
    if (mountedGroupKeys.size >= visibleGroupedQuestions.length) return;
    const anchorIdx = anchorGroupKey
      ? visibleGroupedQuestions.findIndex(g => g.key === anchorGroupKey)
      : 0;
    // Build a queue ordered by distance from anchor.
    const queue: string[] = [];
    const len = visibleGroupedQuestions.length;
    for (let d = 1; queue.length < len; d++) {
      const before = anchorIdx - d;
      const after = anchorIdx + d;
      if (after < len) queue.push(visibleGroupedQuestions[after].key);
      if (before >= 0) queue.push(visibleGroupedQuestions[before].key);
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
  }, [visibleGroupedQuestions, anchorGroupKey]);

  // ResizeObserver: keep groupHeightById in sync with each rendered group's
  // actual height (mounted card OR placeholder). Placeholders use these
  // measurements so unmounting a card doesn't shift the document.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
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

  // Disable the restore pin on first user interaction. We listen to wheel /
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
  // wrapper's voter_names / anonymous_count may have shifted. Refresh
  // affected poll wrappers — cheap because the request is small and
  // cached. Updates flow through patchGroupPolls so the derived map stays
  // in sync. `prephase_deadline` is carried through too so a concurrent
  // suggestions/availability cutoff is reflected without a manual refresh.
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
  // Scroll-to-top arrow visibility (path 3 — see strategy block above).
  // ===================================================================
  const [scrollHelpers, setScrollHelpers] = useState<{ showUp: boolean }>({
    showUp: false,
  });

  useEffect(() => {
    if (!group || typeof window === 'undefined') return;
    let rafId: number | null = null;
    let isScrolling = false;
    let scrollStoppedTimer: number | null = null;
    const evaluate = () => {
      rafId = null;
      // The up arrow (scroll-to-top) shows whenever the page is scrolled
      // down from the very top. 1px epsilon for sub-pixel scrollY on iOS.
      const showUp = window.scrollY > 1;
      setScrollHelpers((prev) => {
        // Suppress OFF→ON while the user is mid-scroll OR a back-nav scroll
        // restore is replaying programmatic jumps, so the arrow only surfaces
        // once the scroll has settled. ON→OFF (reaching the top) is never
        // suppressed.
        const suppressOn = isScrolling || isScrollRestoring();
        const nextShowUp = suppressOn && !prev.showUp ? false : showUp;
        return prev.showUp === nextShowUp ? prev : { showUp: nextShowUp };
      });
    };
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(evaluate);
    };
    const onScroll = () => {
      // A back-nav scroll restore fires programmatic scroll events; don't let
      // them trip the mid-scroll suppression (which would flicker the arrow
      // off then on once the restore settles). Still re-evaluate so it
      // reflects the restored position.
      if (isScrollRestoring()) {
        schedule();
        return;
      }
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
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (scrollStoppedTimer !== null) window.clearTimeout(scrollStoppedTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    // Phase F: GroupNotFoundFallback surfaces the "Request to join"
    // CTA for signed-in non-members of private groups. Passing
    // routeId from `groupId` (the URL path id) lets it POST against
    // the correct group on tap.
    return <GroupNotFoundFallback routeId={groupId} />;
  }

  // Cards-wrapper transform offset for the slide overlay's saved-scroll
  // restore. Undefined for a fresh-nav overlay (shows the top, no transform)
  // and in the real route (it positions via window scroll).
  const cardsTransformOffset = overlayCardsOffset;

  // Show the To Do/New/Old follow tabs whenever the group has polls — either
  // visible ones, or polls that are all hidden from this viewer pre-join
  // (`hasHiddenPolls`), so a late joiner to an all-closed group sees the tabs
  // + an empty message instead of a blank page. A genuinely-new empty group
  // (no polls at all) keeps the create-first-poll flow with no tabs.
  const showFollowTabs = groupedGroupQuestions.length > 0 || group.hasHiddenPolls;

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title={group.title}
        participantNames={group.participantNames}
        anonymousCount={group.anonymousRespondentCount}
        participantNameCounts={group.participantNameCounts}
        imageUrl={group.imageUrl}
        onTitleClick={() => {
          rememberCurrentScroll(groupScrollKey(groupId));
          slideToGroupInfo({ groupId });
        }}
        onBack={() => {
          // No scroll save: returning home resets this group's scroll (home's
          // mount clears it), so re-entry lands at the bottom (the default).
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
      {/* Home backdrop is rendered by <HomeBackdropHost /> at the layout
          level (see components/HomeBackdropHost.tsx). GroupContent
          dispatches SHOW_HOME_BACKDROP_EVENT on swipe lock and
          HIDE_HOME_BACKDROP_EVENT on snap-back/cancel; the home page's
          mount effect dispatches HIDE so the backdrop dismisses itself
          once home has rendered. Living outside this component is what
          eliminates the blank frame between router.push commit and home's
          first paint. */}

      {/* z-index:1 + opaque background keeps the home backdrop hidden
          behind the page until the swipe moves the wrapper sideways.
          Inner cards div keeps its own transform for overlayCardsOffset
          so the two don't conflict across React re-renders. */}
      <div
        ref={swipeWrapperRef}
        {...swipeTouchHandlers}
        className="touch-pan-y"
        style={{
          willChange: 'transform',
          position: 'relative',
          zIndex: 1,
          background: 'var(--background)',
          minHeight: restoreMinHeight !== null ? `${restoreMinHeight}px` : '100dvh',
          // Negative horizontal margins cancel the outer template wrapper's
          // `paddingLeft/Right: max(0.35rem, env(safe-area-inset-*))` so the
          // edge-to-edge poll rectangles + dividers butt against the body's
          // safe-area content edge. Tailwind v4's `-mx-4` on the template's
          // inner wrapper is shadowed by the adjacent `mx-auto` (same
          // specificity, `mx-auto` lands later in the generated CSS and
          // wins), so we can't rely on that path. The 0.35rem overhang on
          // desktop is well inside the inner template's `sm:px-4` (1rem)
          // padding, so it doesn't escape the centered max-w-4xl bounds.
          // Lives on the swipeWrapper (not on the inner cards-wrapper) so
          // the wrapper's `background: var(--background)` paints into
          // those safe-area strips too — otherwise during a swipe-back the
          // HomeBackdropHost (z=0, full viewport) is visible through them
          // beneath the negative-margin extension of the cards, showing
          // home content in a thin column between each card's left-edge
          // yellow bar and the rest of the rectangle background.
          marginLeft: 'calc(-1 * max(0.35rem, env(safe-area-inset-left, 0px)))',
          marginRight: 'calc(-1 * max(0.35rem, env(safe-area-inset-right, 0px)))',
        }}
      >
      <div
        style={{
          paddingTop: `calc(${headerHeight}px + var(--group-card-gap, 0px))`,
          // Reserve exactly the panel's measured height so the last card
          // sits flush against the panel's top edge at scroll-bottom.
          // Fallback covers a 3-row bubble bar + heading + safe-area
          // inset for the first paint before the ResizeObserver fires.
          paddingBottom: `var(${PANEL_HEIGHT_VAR}, 12rem)`,
          // Saved-scroll restore uses `overlayCardsOffset`; a fresh-nav
          // overlay has no offset (shows the top, matching the real route's
          // fresh-visit scroll-to-top). Undefined means no transform.
          transform: cardsTransformOffset
            ? `translate3d(0, ${-cardsTransformOffset}px, 0)`
            : undefined,
          willChange: cardsTransformOffset ? 'transform' : undefined,
        }}
      >
        {/* Solo-group CTAs — the creator is the only member, so surface the
            two ways to bring people in, inline at the top of the scroll
            above any polls. Subtle tinted pills (hemisphere sides via
            rounded-full), distinct hues so the two actions read apart. */}
        {soloAdmin && (
          <div className="flex justify-center gap-2.5 px-[0.9rem] pt-1.5 pb-2.5">
            <button
              type="button"
              onClick={handleEmptyStateAddPeople}
              className="flex-1 max-w-[13rem] h-9 rounded-full bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 active:scale-[0.98] flex items-center justify-center gap-1.5 transition-transform"
              aria-label="Add people to this group"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3M9 12a4 4 0 100-8 4 4 0 000 8zm0 0c-2.761 0-5 2.239-5 5v1h7" />
              </svg>
              <span className="text-sm font-medium">Add People</span>
            </button>
            <button
              type="button"
              onClick={handleEmptyStateCreateInvite}
              className="flex-1 max-w-[13rem] h-9 rounded-full bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 active:scale-[0.98] flex items-center justify-center gap-1.5 transition-transform"
              aria-label="Create an invite link"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
              </svg>
              <span className="text-sm font-medium">Create Invite Link</span>
            </button>
          </div>
        )}

        {/* "Scheduled ›" — inline at the very top of the scroll, right-
            justified, just above the To Do section. Opens the group's
            Scheduled subroute listing upcoming recurring-poll instances. */}
        {showFollowTabs && (
          <button
            type="button"
            onClick={() => {
              rememberCurrentScroll(groupScrollKey(groupId));
              slideToGroupScheduled({ groupId });
            }}
            className="w-full flex items-center justify-end gap-0.5 pr-[0.65rem] py-0 leading-none text-[15px] font-medium text-gray-500 dark:text-gray-400 active:opacity-70"
            aria-label="View scheduled polls"
          >
            Scheduled
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Gap 1: the three follow/ignore lists (To Do · New · Old) rendered
            inline in order, each headed by a label with a divider line under
            it. Empty lists are skipped (no header) since `sections` already
            drops them. Sections after the first get top spacing (`mt-6`) so
            there's a gap under each section before the next header. Cards keep
            their own `border-b` (half-thickness vs the `border-b-2` section
            header underline). */}
        {sections.map((section, sectionIdx) => (
          <React.Fragment key={section.tab}>
            <div
              className={`border-b-2 ${ROW_DIVIDER_CLASS} pl-[0.9rem] pr-[0.65rem] pt-0.5 pb-1 text-[19.2px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400`}
            >
              {section.label}
            </div>
            {section.groups.map((group) => {
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
                    className={`border-b ${ROW_DIVIDER_CLASS}`}
                    style={{ height: placeholderHeight }}
                    aria-hidden="true"
                  />
                );
              }
              const question = group.anchor;
              const isClosed = !isQuestionOpen(question);
              const isAwaiting = isCardUnread(question);
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
                  // To Do = followed + still needs the viewer's input. Drives
                  // the swipe action: To Do → abstain (gold), other followed →
                  // ignore (red), Old → re-follow (green). Within a section
                  // every card classifies to `section.tab`.
                  isTodo={section.tab === "todo"}
                  effectiveTab={section.tab}
                  nameReady={nameReady}
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
                  onToggleFollow={handleToggleFollow}
                  onAbstain={handleSwipeAbstain}
                />
              );
            })}
            {/* Inter-section gap lives BELOW the last poll of a section (not
                above the next header), so headers sit tight to whatever
                precedes them — incl. the "Scheduled" link above the first. */}
            {sectionIdx < sections.length - 1 && (
              <div aria-hidden className="h-[0.9rem]" />
            )}
          </React.Fragment>
        ))}
        {/* Short empty-state when the group has polls but none are visible to
            this viewer — every poll is hidden pre-join (`hasHiddenPolls`). */}
        {showFollowTabs && visibleGroupedQuestions.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            Nothing to show
          </div>
        )}
      </div>
      </div>
      {/* Create-poll search bar portal target. CreateQuestionContent (in the
          root layout) portals the fixed search pill + ➕ into here. Rendered
          as a body-level sibling of the swipe wrapper — NOT inside it — so
          the bar's focused full-screen picker still stacks above the fixed
          header (z-20) and commit badge (z-30) in the viewport context.
          Because it lives inside THIS GroupContent, it rides the page's
          motion: a slide overlay's `contain: strict` box (slides in with the
          group), the swipe-back backdrop (revealed under the sliding poll
          page), and `barPortalRef` in the swipe `extraTargets` (slides off on
          a group→home swipe).

          `relative z-40` is load-bearing for that last case: the swipe
          gesture sets a `transform` on this div, which makes it a NEW stacking
          context — and a static div would land at z-auto, BELOW the z-0 home
          backdrop that mounts at swipe start, so the bar would paint behind it
          and vanish instantly instead of sliding off. `position: relative`
          doesn't trap the fixed bar (only transform/contain do), so the
          overlay-slide + backdrop-reveal cases are unchanged; it just pins the
          stacking level above the backdrop. The bar reserves matching bottom
          space on the cards wrapper above via the --bubble-bar-panel-height
          CSS var (written by CreateQuestionContent after it measures the
          bar). */}
      <div id={DRAFT_POLL_PORTAL_ID} ref={barPortalRef} className="relative z-40" />
      {/* End create-poll bar portal target. */}

      {/* Group-aware long-press modal — Copy + Forget, plus Reopen when
           the poll is closed and the current browser is the creator (or dev). */}
      {modalQuestion && (() => {
        const modalWrapper = wrapperFor(modalQuestion);
        if (!modalWrapper) return null;
        const isModalClosed = !!modalWrapper.is_closed;
        // Server-computed creator flag (migration 123 retired the secret).
        const isCreatorOrDev =
          isPollCreatedByViewer(modalWrapper) ||
          process.env.NODE_ENV === 'development';
        return (
          <FollowUpModal
            isOpen={showModal}
            question={modalQuestion}
            poll={modalWrapper}
            totalVotes={questionResultsMap.get(modalQuestion.id)?.total_votes}
            onClose={() => setShowModal(false)}
            onDelete={() => setPendingAction({ kind: 'forget', question: modalQuestion })}
            onReopen={
              isModalClosed && isCreatorOrDev
                ? () => setPendingAction({ kind: 'reopen', question: modalQuestion })
                : undefined
            }
            onCloseQuestion={
              !isModalClosed && isCreatorOrDev
                ? () => setPendingAction({ kind: 'close', question: modalQuestion })
                : undefined
            }
            onCutoffAvailability={
              !isModalClosed &&
              isInTimeAvailabilityPhase(modalQuestion) &&
              isCreatorOrDev
                ? () => setPendingAction({ kind: 'cutoff-availability', question: modalQuestion })
                : undefined
            }
            onCutoffSuggestions={
              !isModalClosed &&
              isInSuggestionPhase(modalQuestion, modalWrapper.prephase_deadline ?? null) &&
              isCreatorOrDev
                ? () => setPendingAction({ kind: 'cutoff-suggestions', question: modalQuestion })
                : undefined
            }
            onCancelRecurring={
              (modalWrapper.recurrence || modalWrapper.recurrence_anchor_id) && isCreatorOrDev
                ? () => setRecurrenceSheetPoll(modalWrapper)
                : undefined
            }
          />
        );
      })()}

      {/* Cancel-recurring sheet for an OPEN recurring poll (long-press →
          "Cancel recurring…"). "This poll" closes the open instance; "stop
          repeating" also ends the series on the anchor. */}
      {recurrenceSheetPoll && (() => {
        const sheetPoll = recurrenceSheetPoll;
        const anchorId = sheetPoll.recurrence_anchor_id || sheetPoll.id;
        const closeThisPoll = async () => {
          await apiClosePoll(sheetPoll.id, 'cancelled');
          patchGroupPolls(
            (mp) => mp.id === sheetPoll.id,
            () => ({ is_closed: true, close_reason: 'cancelled' }),
          );
        };
        const finish = () => { setRecurrenceSheetPoll(null); setRecurrenceSheetBusy(false); };
        return (
          <RecurrenceCancelSheet
            isOpen={true}
            pollTitle={sheetPoll.questions[0]?.title || sheetPoll.title || 'Poll'}
            occurrenceLabel={null}
            busy={recurrenceSheetBusy}
            onCancelOccurrence={async () => {
              setRecurrenceSheetBusy(true);
              try { await closeThisPoll(); } catch (e) { console.error('cancel occurrence failed', e); }
              finish();
            }}
            onCancelSeries={async () => {
              setRecurrenceSheetBusy(true);
              try {
                await closeThisPoll();
                await apiCancelRecurrence(anchorId, 'series', formatRecurrenceDateISO(new Date()));
              } catch (e) { console.error('cancel series failed', e); }
              finish();
            }}
            onClose={finish}
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
            // Forget is per-poll browser state only — it must never touch
            // group membership. An earlier special case called apiLeaveGroup
            // when the forgotten poll was the group's last, which silently
            // removed the user from the whole group (it vanished from home
            // and private groups 404'd). Groups are first-class now, so an
            // empty-looking group is a valid state; leaving a group is the
            // home list's bulk-forget flow, not a side effect of this.
            setGroup((prev) => (prev ? { ...prev, questions: prev.questions.filter((p) => p.id !== action.question.id) } : prev));
          } else if (action.kind === 'reopen') {
            try {
              // Identity-based authorization server-side (migration 123).
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error('Cannot reopen question without poll_id');
                return;
              }
              const updated = await apiReopenPoll(pollId);
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
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error('Cannot close question without poll_id');
                return;
              }
              await apiClosePoll(pollId);
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
              // Identity-based authorization server-side (migration 123).
              const pollId = action.question.poll_id;
              if (!pollId) {
                console.error(`Cannot ${action.kind} without poll_id`);
                return;
              }
              const wrapper = await apiFn(pollId);
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

      {/* Name gate for swipe-to-abstain (abstaining is a vote → needs a name). */}
      <AccountGateModal
        isOpen={!!pendingNameRetry}
        message="to abstain"
        onSubmit={() => {
          const retry = pendingNameRetry;
          setPendingNameRetry(null);
          if (retry) retry();
        }}
        onCancel={() => setPendingNameRetry(null)}
      />

      {/* Scroll-to-top button — rendered via the floating-fab-portal so
          `position: fixed` is relative to the real viewport (outside the
          responsive-scaling container's transform on desktop). The
          button elevates above the slide overlay (z-70) while a
          group-kind overlay is mounted, so it doesn't get hidden by the
          overlay's opaque background during the slide. */}
      {!inOverlay && scrollHelperPortal && createPortal(
        scrollHelpers.showUp ? (
          <ScrollHelperButton
            ref={upArrowRef}
            onClick={scrollToTop}
            aria-label="Scroll to top"
            elevated={elevateArrowsForOverlay}
            // Float just below the fixed header. (The section header dividers
            // scroll inline, so there's no sticky chrome to clear.)
            style={{ top: `calc(${headerHeight}px + 0.5rem)` }}
          />
        ) : null,
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

  // Dismiss the poll→group swipe-back backdrop on mount. The backdrop
  // persists across the router.push that commits the swipe so there's no
  // blank frame between PollDetail's unmount and this page's first paint;
  // once we render, we tell the host to unmount. PollDetail has already
  // unmounted by this point, so this is the last place that can reset the
  // commit-badge transform and the html/body scrollbar lock.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const badge = document.getElementById('commit-badge-portal');
    if (badge) {
      badge.style.transform = '';
      badge.style.transition = '';
    }
    setSwipeScrollbarLock(false);
    window.dispatchEvent(new Event(HIDE_GROUP_BACKDROP_EVENT));
  }, []);

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
    // A legacy `?p=` URL redirects to the path form below — don't bother
    // resolving the group root we're about to navigate away from.
    if (pollParam) {
      return;
    }
    if (rootInitial) {
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
        if (!cancelled) setRootPoll(poll);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [groupShortId, router, rootInitial, pollParam]);

  // Legacy `?p=<pollShort>` query URLs (old shares, already-delivered
  // notifications, bookmarks) redirect to the canonical path form. Fire
  // immediately using the URL's own group route id — the poll detail route
  // resolves it the same way, so there's no need to wait for the group root
  // to load. The early return below renders a bare loading frame instead of
  // GroupContent, which is what kills the group-list flash users saw before.
  useEffect(() => {
    if (!pollParam || typeof window === "undefined") return;
    router.replace(`/g/${groupShortId}/p/${pollParam}`);
  }, [pollParam, groupShortId, router]);

  if (pollParam) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Loading poll…</p>
      </div>
    );
  }

  if (error) {
    // Phase F: same join-request affordance as the GroupContent error
    // branch above. `groupShortId` here is the URL path id from
    // useParams() — handed to GroupNotFoundFallback as `routeId`.
    return <GroupNotFoundFallback routeId={groupShortId} />;
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

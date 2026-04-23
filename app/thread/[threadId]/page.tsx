"use client";

import { useEffect, useLayoutEffect, useState, useRef, useMemo, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { Poll } from "@/lib/types";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { buildThreadFromPollDown, buildThreadSyncFromCache } from "@/lib/threadUtils";
import { apiGetPollById, apiGetPollByShortId, apiGetPollResults, apiGetVotes, apiEditVote, apiSubmitVote, apiReopenPoll, apiClosePoll, POLL_VOTES_CHANGED_EVENT } from "@/lib/api";
import { getUserName } from "@/lib/userProfile";
import type { PollResults } from "@/lib/types";
import { addAccessiblePollId, getCreatorSecret } from "@/lib/browserPollAccess";
import { getCachedPollById, getCachedPollByShortId, getCachedPollResults, invalidatePoll } from "@/lib/pollCache";
import { isUuidLike, normalizePath } from "@/lib/pollId";
import { getCategoryIcon, relativeTime, isInSuggestionPhase, isInTimeAvailabilityPhase, getResultBadge, BADGE_COLORS } from "@/lib/pollListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { loadVotedPolls, setVotedPollFlag, getStoredVoteId, setStoredVoteId, parseYesNoChoice } from "@/lib/votedPollsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import RespondentCircles from "@/components/RespondentCircles";
import VoterList from "@/components/VoterList";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import type { ApiVote } from "@/lib/api";
import PollPageClient from "@/app/p/[shortId]/PollPageClient";
import PollResultsDisplay, { CompactRankedChoicePreview, CompactSuggestionPreview, CompactTimePreview } from "@/components/PollResults";
import SimpleCountdown from "@/components/SimpleCountdown";
import { forgetPoll } from "@/lib/forgetPoll";

import type { Thread } from "@/lib/threadUtils";

// Stable filter: votes submitted during the suggestion phase (gave suggestions
// or fully abstained from suggestions). Declared at module scope so VoterList
// doesn't re-run its effect on every parent render.
const suggestionPhaseRespondentFilter = (v: ApiVote) =>
  !!(v.suggestions && v.suggestions.length > 0) || !!v.is_abstain;

type PendingActionKind = 'forget' | 'reopen' | 'close';

const PENDING_ACTION_COPY: Record<PendingActionKind, {
  title: string;
  message: string;
  confirmText: string;
  confirmButtonClass: string;
}> = {
  forget: {
    title: 'Forget poll',
    message: "This will remove the poll from your browser's history. You won't see it in your poll list anymore, and any vote data stored locally will be deleted. You can still access it again with the direct link.",
    confirmText: 'Forget Poll',
    confirmButtonClass: 'bg-yellow-500 hover:bg-yellow-600 text-white',
  },
  reopen: {
    title: 'Reopen Poll',
    message: 'Are you sure you want to reopen this poll? This will allow voting to resume and results will be hidden until the poll is closed again.',
    confirmText: 'Reopen Poll',
    confirmButtonClass: 'bg-green-600 hover:bg-green-700 text-white',
  },
  close: {
    title: 'Close Poll',
    message: 'Are you sure you want to close this poll? This action cannot be undone and voting will end immediately.',
    confirmText: 'Close Poll',
    confirmButtonClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
};

// Inverse grid-rows clip for compact pills in the thread card header:
// full height when collapsed, 0 when expanded, animating in lockstep
// with the heavy-content expand clip below. mt-2 lives inside the
// overflow-hidden child so the margin is clipped along with the pill —
// moving it to the outer wrapper would leave an 8px gap when expanded.
function CompactPreviewClip({ isExpanded, children }: { isExpanded: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${isExpanded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
      aria-hidden={isExpanded}
    >
      <div className="overflow-hidden">
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

interface ThreadContentProps {
  threadId: string;
  initialExpandedPollId?: string | null;
}

export function ThreadContent({ threadId, initialExpandedPollId = null }: ThreadContentProps) {
  const router = useRouter();
  const { prefetchBatch } = usePrefetch();

  // Initialize voted/abstained sets + thread synchronously from cached data
  // on first render, so the page mounts with full content (no loading flash
  // during view transition slide).
  const [{ thread: initialThread, votedPollIds: initialVoted, abstainedPollIds: initialAbstained }] = useState(() => {
    if (typeof window === 'undefined') {
      return { thread: null as Thread | null, votedPollIds: new Set<string>(), abstainedPollIds: new Set<string>() };
    }
    const voted = loadVotedPolls();
    return {
      thread: buildThreadSyncFromCache(threadId, voted.votedPollIds, voted.abstainedPollIds),
      votedPollIds: voted.votedPollIds,
      abstainedPollIds: voted.abstainedPollIds,
    };
  });

  const [votedPollIds, setVotedPollIds] = useState<Set<string>>(initialVoted);
  const [abstainedPollIds, setAbstainedPollIds] = useState<Set<string>>(initialAbstained);
  const [thread, setThread] = useState<Thread | null>(initialThread);
  const [loading, setLoading] = useState(!initialThread);
  const [error, setError] = useState(false);

  // Set data attribute on body so the bottom bar "+" button can auto-follow-up
  useEffect(() => {
    if (thread) {
      document.body.setAttribute('data-thread-latest-poll-id', thread.latestPoll.id);
    }
    return () => { document.body.removeAttribute('data-thread-latest-poll-id'); };
  }, [thread]);

  // Signal to the view transition helper that this page's content is rendered.
  // Uses useLayoutEffect so the attribute is set before paint (and before the
  // view transition callback detects it and captures the "new" snapshot).
  useLayoutEffect(() => {
    if (thread && !loading) {
      const path = normalizePath(window.location.pathname);
      document.documentElement.setAttribute('data-page-ready', path);
      return () => {
        if (document.documentElement.getAttribute('data-page-ready') === path) {
          document.documentElement.removeAttribute('data-page-ready');
        }
      };
    }
  }, [thread, loading]);

  // Prefetch poll page routes for all polls in this thread
  useEffect(() => {
    if (!thread) return;
    const hrefs = thread.polls.map(p => `/p/${p.short_id || p.id}`);
    prefetchBatch(hrefs, { priority: "low" });
  }, [thread, prefetchBatch]);

  // Expanded card state — only one card can be expanded at a time.
  // Initialized from the prop so the /p/<id> route can open a card on first render.
  const [expandedPollId, setExpandedPollId] = useState<string | null>(initialExpandedPollId);
  // Which poll's creation-time tooltip is currently showing (null = none). Shared
  // across all cards so only one tooltip is visible at a time.
  const [tooltipPollId, setTooltipPollId] = useState<string | null>(null);
  // Polls whose expanded content has been pre-mounted because the card scrolled
  // into view. We keep the mounted subtree display:none'd until expansion so all
  // data fetches, state init, and child effects happen BEFORE the user taps —
  // the expand then renders at the correct final height with no resize flicker.
  const [visiblePollIds, setVisiblePollIds] = useState<Set<string>>(() => {
    // Initialize with the pre-expanded poll (so its content mounts on first paint).
    return initialExpandedPollId ? new Set([initialExpandedPollId]) : new Set();
  });
  // Per-poll results for the compact winner preview shown above the grid-rows
  // clip. Fetched lazily when a card enters the viewport. Cache-backed so this
  // is zero-cost after the first load per poll.
  const [pollResultsMap, setPollResultsMap] = useState<Map<string, PollResults>>(() => new Map());
  // Current viewer's yes_no vote state per poll (resolved from the stored
  // voteId in localStorage + the poll's vote list). Drives the Your-Vote
  // badge + tap-to-change flow on the external YesNoResults. voterName is
  // preserved so edits round-trip cleanly.
  type UserYesNoVote = { choice: 'yes' | 'no' | 'abstain' | null; voteId: string; voterName: string | null };
  const [userVoteMap, setUserVoteMap] = useState<Map<string, UserYesNoVote>>(() => new Map());
  // Pending vote change awaiting confirmation. { pollId, newChoice }.
  const [pendingVoteChange, setPendingVoteChange] = useState<
    { pollId: string; newChoice: 'yes' | 'no' | 'abstain' } | null
  >(null);
  const [voteChangeSubmitting, setVoteChangeSubmitting] = useState(false);
  // Prevents the synthetic click from firing after touchend already toggled expansion on mobile
  const touchJustHandled = useRef(false);
  // Refs for each card wrapper so we can scroll the expanded card into view
  // and observe viewport intersection.
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Ref to each card's overflow-hidden wrapper — its scrollHeight reports the
  // natural expanded content height (pre-mounted via IntersectionObserver) so
  // we can compute the target scroll position BEFORE the grid-rows animation
  // finishes growing.
  const expandedWrapperRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);

  // Long press state
  const [modalPoll, setModalPoll] = useState<Poll | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Confirmation state for destructive/semi-destructive actions on a poll
  // (forget / reopen). Rendered by a single ConfirmationModal that varies its
  // title/message/handler based on `kind`.
  const [pendingAction, setPendingAction] = useState<
    { kind: PendingActionKind; poll: Poll } | null
  >(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);
  const [pressedPollId, setPressedPollId] = useState<string | null>(null);

  // Fetch the referenced poll, register access, discover children, build thread.
  // If we already have a synchronous cache-built thread, this runs in the
  // background to refresh with fresh data (discoverRelatedPolls, new votes, etc.)
  // without showing a loading state.
  useEffect(() => {
    async function fetchThread() {
      try {
        if (!initialThread) setLoading(true);
        setError(false);

        // Step 1: Fetch the poll referenced in the URL and register access.
        // Check the in-memory cache first — the home page already fetched all accessible polls.
        let anchorPoll: Poll;
        try {
          const cached = isUuidLike(threadId)
            ? getCachedPollById(threadId)
            : getCachedPollByShortId(threadId);
          if (cached) {
            anchorPoll = cached;
          } else if (isUuidLike(threadId)) {
            anchorPoll = await apiGetPollById(threadId);
          } else {
            anchorPoll = await apiGetPollByShortId(threadId);
          }
          addAccessiblePollId(anchorPoll.id);
        } catch {
          setError(true);
          return;
        }

        // Discover children (may add new poll IDs), then fetch the updated set.
        try { await discoverRelatedPolls(); } catch {}
        const polls = await getAccessiblePolls();
        if (!polls) { setError(true); return; }

        // Re-read voted state — discovery or the user voting elsewhere may have changed it.
        const { votedPollIds: voted, abstainedPollIds: abstained } = loadVotedPolls();
        const foundThread = buildThreadFromPollDown(anchorPoll.id, polls, voted, abstained);

        if (!foundThread) {
          setError(true);
          return;
        }

        setThread(foundThread);
      } catch (err) {
        console.error('Error loading thread:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchThread();
  }, [threadId]);

  // Measure the fixed thread header so we can apply matching padding-top on the scroll list
  // (the header is position:fixed and out of flow, so the list doesn't naturally reserve space).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread]);

  // Auto-scroll to the bottom once on initial load so newest polls are visible.
  // Waits for headerHeight > 0 (paddingTop applies once the fixed header is
  // measured, otherwise scrollHeight lags). Gated on a ref so subsequent
  // thread-state mutations (poll:updated events, re-fetches) can't re-fire it
  // — that yanked the user back to the bottom mid-scroll.
  // Skipped when entering on an expanded poll (/p/<id>/) — the expand-scroll
  // effect below positions that card flush with the top bar instead.
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (thread && !loading && headerHeight > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      if (initialExpandedPollId) return;
      requestAnimationFrame(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
    }
  }, [thread, loading, headerHeight, initialExpandedPollId]);

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
            const id = (entry.target as HTMLElement).dataset.pollId;
            if (id) newlyVisible.push(id);
          }
        });
        if (newlyVisible.length === 0) return;
        setVisiblePollIds((prev) => {
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

  // Fetch results + viewer's own vote for every yes_no poll that has entered
  // the viewport. Both calls are coalesced + cache-backed. Results drive the
  // winner preview; the user's vote drives the Your-Vote badge + tap-to-
  // change flow. The setState guards compare by field content (not identity)
  // because apiGetPollResults always allocates a fresh result object even
  // when the underlying data is unchanged.
  useEffect(() => {
    if (!thread) return;
    let cancelled = false;

    const maybeFetch = async (pollId: string, pollType: string) => {
      // Fetch results for every type that has a compact preview (yes_no,
      // ranked_choice, time). For ranked_choice the "suggestion phase"
      // variant reuses the same results (suggestion_counts field populated
      // pre-cutoff). User-vote fetching is yes_no-only; other types drive
      // their compact strip off the shared results alone.
      const wantsResults =
        pollType === 'yes_no' ||
        pollType === 'ranked_choice' ||
        pollType === 'time';
      if (!wantsResults) return;
      const voteId = pollType === 'yes_no' ? getStoredVoteId(pollId) : null;
      const [results, votes] = await Promise.all([
        apiGetPollResults(pollId).catch(() => null),
        voteId ? apiGetVotes(pollId).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (results) {
        setPollResultsMap((prev) => {
          const existing = prev.get(pollId);
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
          next.set(pollId, results);
          return next;
        });
      }
      if (voteId && votes) {
        const mine = votes.find((v) => v.id === voteId);
        if (!mine) return;
        const choice = parseYesNoChoice(mine);
        const voterName = mine.voter_name ?? null;
        setUserVoteMap((prev) => {
          const existing = prev.get(pollId);
          if (existing && existing.voteId === voteId && existing.choice === choice && existing.voterName === voterName) {
            return prev;
          }
          const next = new Map(prev);
          next.set(pollId, { choice, voteId, voterName });
          return next;
        });
      }
    };

    for (const poll of thread.polls) {
      if (!visiblePollIds.has(poll.id)) continue;
      void maybeFetch(poll.id, poll.poll_type);
    }

    const onVotesChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pollId?: string } | undefined;
      const pollId = detail?.pollId;
      if (!pollId) return;
      const poll = thread.polls.find((p) => p.id === pollId);
      if (!poll) return;
      void maybeFetch(poll.id, poll.poll_type);
    };
    window.addEventListener(POLL_VOTES_CHANGED_EVENT, onVotesChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(POLL_VOTES_CHANGED_EVENT, onVotesChanged);
    };
  }, [thread, visiblePollIds]);

  const confirmVoteChange = async () => {
    if (!pendingVoteChange) return;
    const { pollId, newChoice } = pendingVoteChange;
    const current = userVoteMap.get(pollId);
    setVoteChangeSubmitting(true);
    try {
      let resultVoteId: string;
      let resultVoterName: string | null;
      if (current) {
        const updated = await apiEditVote(pollId, current.voteId, {
          yes_no_choice: newChoice === 'abstain' ? null : newChoice,
          is_abstain: newChoice === 'abstain',
          voter_name: current.voterName,
        });
        resultVoteId = current.voteId;
        resultVoterName = updated.voter_name ?? current.voterName;
      } else {
        const savedName = getUserName();
        const submitted = await apiSubmitVote(pollId, {
          vote_type: 'yes_no',
          yes_no_choice: newChoice === 'abstain' ? null : newChoice,
          is_abstain: newChoice === 'abstain',
          voter_name: savedName && savedName.trim() ? savedName.trim() : null,
        });
        resultVoteId = submitted.id;
        resultVoterName = submitted.voter_name ?? null;
        setStoredVoteId(pollId, resultVoteId);
      }
      invalidatePoll(pollId);
      setUserVoteMap((prev) => {
        const next = new Map(prev);
        next.set(pollId, { choice: newChoice, voteId: resultVoteId, voterName: resultVoterName });
        return next;
      });
      setVotedPollFlag(pollId, newChoice === 'abstain' ? 'abstained' : true);
      const fresh = loadVotedPolls();
      setVotedPollIds(fresh.votedPollIds);
      setAbstainedPollIds(fresh.abstainedPollIds);
      window.dispatchEvent(new CustomEvent(POLL_VOTES_CHANGED_EVENT, { detail: { pollId } }));
      setPendingVoteChange(null);
    } catch (err) {
      console.error('Vote submit/change failed:', err);
    } finally {
      setVoteChangeSubmitting(false);
    }
  };

  // When a card expands, adjust scroll so the expanded card fits on screen
  // without disturbing the user's view more than necessary:
  //   1. On initial mount with an expanded poll (/p/<id>/ or after creating a
  //      poll), always align the card top flush with the bottom of the top
  //      bar — that's the entry target the user navigated to.
  //   2. Otherwise, if the compact header is hidden behind the fixed top bar,
  //      scroll up so it sits flush with the bar.
  //   3. Otherwise, if the card's bottom (after expansion) extends below the
  //      bottom bar, scroll down just enough to reveal it — but never far
  //      enough to push the compact header above the top bar.
  //
  // The scroll runs concurrently with the 300ms grid-rows expand animation:
  // we manually rAF-animate scrollTop with the same easing, which keeps the
  // two visuals synchronized and sidesteps the scrollTo-clamping issue (the
  // list's scrollHeight grows proportionally as the card expands, so each
  // intermediate target is always within bounds).
  const hasHandledInitialExpandRef = useRef(false);
  useEffect(() => {
    if (!expandedPollId) return;
    // Wait for the fixed-header height measurement so visibleTopY is correct
    // before we compute the target scroll position.
    if (headerHeight === 0) return;
    const card = cardRefs.current.get(expandedPollId);
    if (!card) return;

    // Measure once, up front, using the overflow-hidden wrapper's scrollHeight
    // (which reflects the natural content size regardless of grid-row state).
    const wrapper = expandedWrapperRefs.current.get(expandedPollId);
    const expandedContentHeight = wrapper?.scrollHeight ?? 0;
    const wrapperCurrent = wrapper?.getBoundingClientRect().height ?? 0;
    const compactHeight = card.getBoundingClientRect().height - wrapperCurrent;
    // Visible area is [headerHeight, innerHeight]. The floating "+" overlays the
    // bottom-right corner but doesn't consume horizontal flow, so we don't shrink
    // the usable area for it — an expanded card's bottom may sit under the FAB,
    // which is acceptable.
    const visibleTopY = headerHeight;
    const visibleBottomY = window.innerHeight;
    const cardTopY = card.getBoundingClientRect().top;
    const finalCardBottomY = cardTopY + compactHeight + expandedContentHeight;

    const isInitialExpand =
      !hasHandledInitialExpandRef.current &&
      expandedPollId === initialExpandedPollId;

    const BOTTOM_GAP = 12;

    let targetDelta = 0;
    if (isInitialExpand) {
      targetDelta = cardTopY - visibleTopY;
      hasHandledInitialExpandRef.current = true;
    } else if (cardTopY < visibleTopY) {
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
      // ease-out cubic — matches the feel of the CSS transition
      const eased = 1 - Math.pow(1 - t, 3);
      window.scrollTo(0, startScrollY + (targetScrollY - startScrollY) * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [expandedPollId, headerHeight]);

  // Listen for poll:updated events (fired when close/reopen happens from within
  // a card). Merge the updates into our local thread state so downstream UI —
  // e.g. whether the modal should offer a Reopen button — reflects reality.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pollId: string; updates: Partial<Poll> };
      if (!detail?.pollId) return;
      setThread((prev) => {
        if (!prev || !prev.polls.some((p) => p.id === detail.pollId)) return prev;
        return {
          ...prev,
          polls: prev.polls.map((p) =>
            p.id === detail.pollId ? { ...p, ...detail.updates } : p,
          ),
        };
      });
      setModalPoll((prev) => (prev && prev.id === detail.pollId ? { ...prev, ...detail.updates } : prev));
    };
    window.addEventListener('poll:updated', handler);
    return () => window.removeEventListener('poll:updated', handler);
  }, []);

  // Re-read votedPolls from localStorage when a vote is submitted anywhere in
  // the app. The golden border reads from these sets, so it clears immediately
  // on vote. loadVotedPolls always allocates new Sets, so compare contents
  // before committing — otherwise every event triggers a re-render even when
  // this user's vote on this thread didn't change.
  useEffect(() => {
    const setsEqual = (a: Set<string>, b: Set<string>) => {
      if (a.size !== b.size) return false;
      for (const x of a) if (!b.has(x)) return false;
      return true;
    };
    const handler = () => {
      const fresh = loadVotedPolls();
      setVotedPollIds((prev) => (setsEqual(prev, fresh.votedPollIds) ? prev : fresh.votedPollIds));
      setAbstainedPollIds((prev) => (setsEqual(prev, fresh.abstainedPollIds) ? prev : fresh.abstainedPollIds));
    };
    window.addEventListener(POLL_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(POLL_VOTES_CHANGED_EVENT, handler);
  }, []);

  // Dismiss the creation-time tooltip on any outside click/tap. Attachment is
  // deferred by one tick so the opening event doesn't close it immediately.
  useEffect(() => {
    if (!tooltipPollId) return;
    const close = () => setTooltipPollId(null);
    const t = setTimeout(() => {
      document.addEventListener('click', close);
      document.addEventListener('touchstart', close, { passive: true });
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', close);
      document.removeEventListener('touchstart', close);
    };
  }, [tooltipPollId]);

  // Awaiting polls (open + not voted/abstained) get sorted to the bottom and
  // wear a golden border. The border uses the live predicate so it clears
  // immediately on vote; the sort order captures this at thread-load only so
  // the card doesn't jump positions underneath the user.
  const now = new Date();
  const isPollOpen = (poll: Poll) =>
    poll.response_deadline ? new Date(poll.response_deadline) > now && !poll.is_closed : !poll.is_closed;
  const isAwaitingResponse = (poll: Poll) =>
    isPollOpen(poll) && !votedPollIds.has(poll.id) && !abstainedPollIds.has(poll.id);

  // Defined above the early returns so the hook call order is stable.
  const threadPolls = useMemo(() => {
    if (!thread) return [] as Poll[];
    const awaitingAtLoad = new Set(thread.polls.filter(isAwaitingResponse).map((p) => p.id));
    return [...thread.polls].sort((a, b) => {
      const aAwaiting = awaitingAtLoad.has(a.id);
      const bAwaiting = awaitingAtLoad.has(b.id);
      if (aAwaiting !== bAwaiting) return aAwaiting ? 1 : -1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);

  // Sync the URL to reflect which card is expanded, using shallow history.replaceState
  // so Next.js doesn't unmount/remount on URL change. Sharing the URL reopens the
  // same expanded card.
  useEffect(() => {
    if (typeof window === 'undefined' || !thread) return;
    let nextPath: string;
    if (expandedPollId) {
      const expandedPoll = thread.polls.find((p) => p.id === expandedPollId);
      const routeId = expandedPoll?.short_id || expandedPollId;
      nextPath = `/p/${routeId}/`;
    } else {
      nextPath = `/thread/${threadId}/`;
    }
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(window.history.state, '', nextPath + window.location.search + window.location.hash);
    }
  }, [expandedPollId, thread, threadId]);

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
      {/* Fixed thread header. top:0 + padding-top:env(safe-area-inset-top) fills
          the notch zone with the header background (otherwise items are visible
          there when the document scrolls). headerRef is on the inner content
          div so offsetHeight stays content-only; the sibling content below
          reserves exactly that much padding-top. */}
      <div
        className="fixed left-0 right-0 top-0 z-20 bg-background touch-none"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div ref={headerRef} className="max-w-4xl mx-auto pl-2 pr-4 py-2 flex items-center gap-2 overflow-hidden">
          <button
            onClick={() => {
              if (hasAppHistory()) {
                navigateBackWithTransition();
              } else {
                navigateWithTransition(router, '/', 'back');
              }
            }}
            className="w-10 h-10 -mr-1.5 flex items-center justify-center shrink-0"
            aria-label="Go back"
          >
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <RespondentCircles
            names={thread.participantNames}
            anonymousCount={thread.anonymousRespondentCount}
          />
          <button
            type="button"
            onClick={() => navigateWithTransition(router, `/thread/${threadId}/info`, 'forward')}
            className="min-w-0 flex-1 text-left active:opacity-60 transition-opacity"
            aria-label="Thread details"
          >
            <h1 className="font-semibold text-lg text-gray-900 dark:text-white truncate">
              {thread.title}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {thread.polls.length} {thread.polls.length === 1 ? 'poll' : 'polls'}
            </p>
          </button>
        </div>
      </div>

      {/* paddingTop reserves space for the fixed header above. */}
      <div className="pb-2" style={{ paddingTop: `calc(${headerHeight}px + 0.5rem)` }}>
        {threadPolls.map((poll) => {
            const isOpen = isPollOpen(poll);
            const isClosed = !isOpen;
            const isAwaiting = isAwaitingResponse(poll);

            const handleTouchStart = (e: React.TouchEvent) => {
              isLongPress.current = false;
              isScrolling.current = false;
              setPressedPollId(poll.id);
              touchStartPos.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
              };
              longPressTimer.current = setTimeout(() => {
                if (!isScrolling.current) {
                  isLongPress.current = true;
                  if ('vibrate' in navigator) {
                    try { navigator.vibrate(50); } catch {}
                  }
                  setModalPoll(poll);
                  setShowModal(true);
                  setPressedPollId(null);
                }
              }, 500);
            };

            // Tap toggles expand/collapse. Long-press always opens the follow-up
            // modal regardless of expansion state.
            const toggleExpand = () => {
              setExpandedPollId((curr) => (curr === poll.id ? null : poll.id));
            };

            const handleClick = () => {
              if (touchJustHandled.current) return;
              toggleExpand();
            };

            const handleTouchEnd = () => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
              if (!isScrolling.current && !isLongPress.current) {
                setPressedPollId(null);
                touchJustHandled.current = true;
                setTimeout(() => { touchJustHandled.current = false; }, 400);
                toggleExpand();
              } else {
                setPressedPollId(null);
              }
              touchStartPos.current = null;
              isScrolling.current = false;
            };

            const handleTouchMove = (e: React.TouchEvent) => {
              if (!touchStartPos.current) return;
              const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
              const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
              if (deltaX > 10 || deltaY > 10) {
                isScrolling.current = true;
                setPressedPollId(null);
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }
            };

            const isExpanded = expandedPollId === poll.id;

            return (
              <div
                key={poll.id}
                ref={(el) => {
                  if (el) {
                    el.dataset.pollId = poll.id;
                    cardRefs.current.set(poll.id, el);
                    intersectionObserverRef.current?.observe(el);
                  } else {
                    const prev = cardRefs.current.get(poll.id);
                    if (prev) intersectionObserverRef.current?.unobserve(prev);
                    cardRefs.current.delete(poll.id);
                  }
                }}
                className="ml-0 mr-1.5 mb-3 grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-0.5"
              >
                {/* mt-[4px] sits closer to cap-to-baseline centering (5px)
                     than line-box centering (9px); emoji glyphs feel slightly
                     low at the pure line-box center, so we bias upward. */}
                <div className="col-start-1 row-start-2 flex items-center justify-center text-lg leading-none h-7 mt-[4px]">
                  {getCategoryIcon(poll)}
                </div>

                {/* Outside the card so taps on the header don't trigger the
                     card's expand/long-press handlers. */}
                <div className="col-start-2 row-start-1 flex items-center gap-2 px-3 min-w-0">
                  <div className="flex items-center gap-1 min-w-0 flex-1 text-xs text-gray-400 dark:text-gray-500">
                    <ClientOnly fallback={null}>
                      <span className="truncate">
                        {poll.creator_name && <>{poll.creator_name} &middot; </>}
                        <span
                          className="relative cursor-help"
                          onClick={() => setTooltipPollId((prev) => (prev === poll.id ? null : poll.id))}
                          onMouseEnter={() => setTooltipPollId(poll.id)}
                          onMouseLeave={() => setTooltipPollId((prev) => (prev === poll.id ? null : prev))}
                        >
                          {relativeTime(poll.created_at)}
                          {tooltipPollId === poll.id && (
                            <span
                              role="tooltip"
                              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-100 shadow-lg dark:bg-gray-900"
                            >
                              {formatCreationTimestamp(poll.created_at)}
                            </span>
                          )}
                        </span>
                      </span>
                    </ClientOnly>
                  </div>
                  <div className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
                    <ClientOnly fallback={null}>
                      {(() => {
                        if (isClosed) {
                          // Ranked choice (incl. suggestion polls after cutoff)
                          // renders the winner inside the card via
                          // CompactRankedChoicePreview — skip the above-card
                          // badge to avoid duplicating it.
                          if (poll.poll_type === 'ranked_choice') return null;
                          // Skip the above-card badge for polls with no voters;
                          // the in-card preview already shows an empty state.
                          if (poll.results && poll.results.total_votes === 0) return null;
                          const badge = getResultBadge(poll);
                          return (
                            <div className="flex items-center gap-1">
                              <span className="text-xs leading-none">{badge.emoji}</span>
                              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full truncate ${BADGE_COLORS[badge.color]}`}>
                                {badge.text}
                              </span>
                            </div>
                          );
                        }
                        const inSuggestions = isInSuggestionPhase(poll);
                        if (inSuggestions && poll.suggestion_deadline) {
                          return <SimpleCountdown deadline={poll.suggestion_deadline} label="Suggestions" />;
                        }
                        if (inSuggestions && poll.suggestion_deadline_minutes) {
                          return <span className="font-semibold text-blue-600 dark:text-blue-400">Taking Suggestions</span>;
                        }
                        // Time polls in the availability phase get a label
                        // in the same slot + format as "Taking Suggestions".
                        if (isInTimeAvailabilityPhase(poll)) {
                          if (poll.suggestion_deadline) {
                            return <SimpleCountdown deadline={poll.suggestion_deadline} label="Availability" />;
                          }
                          return <span className="font-semibold text-blue-600 dark:text-blue-400">Collecting Availability</span>;
                        }
                        if (poll.response_deadline) {
                          return <SimpleCountdown deadline={poll.response_deadline} label="Voting" colorClass="text-green-600 dark:text-green-400" />;
                        }
                        return null;
                      })()}
                    </ClientOnly>
                  </div>
                </div>

                <div
                  className={`col-start-2 row-start-2 min-w-0 px-2 pt-1.5 ${isExpanded ? 'pb-0.5' : 'pb-2'} rounded-2xl border shadow-sm ${isAwaiting ? 'border-amber-400 dark:border-amber-500' : 'border-gray-200 dark:border-gray-800'} ${pressedPollId === poll.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-900'} ${!isExpanded ? 'hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-blue-100 dark:active:bg-blue-900/40' : ''} transition-colors select-none relative`}
                >
                  {/* Compact header — click/touch + long-press live here so they work
                       whether the card is collapsed or expanded without interfering
                       with interactive elements inside the expanded PollPageClient. */}
                  <div
                    onClick={handleClick}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchMove}
                    className="cursor-pointer"
                  >
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 min-w-0 font-medium text-lg leading-tight line-clamp-2 text-gray-900 dark:text-white">
                      {poll.title}
                    </h3>
                    <div
                      className="shrink-0 -mt-0.5 -mr-1"
                      onClick={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                    >
                      <FloatingCopyLinkButton
                        url={typeof window !== 'undefined' ? `${window.location.origin}/p/${poll.short_id || poll.id}/` : ''}
                      />
                    </div>
                  </div>
                  {/* Yes/No results rendered here — above the expand clip —
                       so the winner card stays in a stable DOM position
                       across expand/collapse (no remount → no flicker). The
                       YesNoResults component animates the loser's reveal via
                       its own grid-rows transition when hideLoser toggles.
                       PollPageClient below suppresses its own YesNoResults
                       rendering (externalYesNoResults) to avoid duplication. */}
                  {poll.poll_type === 'yes_no' && (() => {
                    const r = pollResultsMap.get(poll.id);
                    if (!r) return null;
                    const userVote = userVoteMap.get(poll.id);
                    // Stop propagation so that tapping an option card or the
                    // Abstain link doesn't bubble up to the compact-header
                    // tap handler and toggle expand/collapse.
                    const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation();
                    return (
                      <div
                        className="mt-2"
                        onClick={stopBubble}
                        onTouchStart={stopBubble}
                        onTouchEnd={stopBubble}
                        onTouchMove={stopBubble}
                      >
                        <PollResultsDisplay
                          results={r}
                          isPollClosed={isClosed}
                          hideLoser={!isExpanded}
                          userVoteChoice={userVote?.choice ?? null}
                          onVoteChange={
                            isClosed
                              ? undefined
                              : (newChoice) => setPendingVoteChange({ pollId: poll.id, newChoice })
                          }
                        />
                      </div>
                    );
                  })()}
                  {/* Compact pill (lower-right of the compact card) wrapped
                       in an inverse grid-rows clip that collapses to 0
                       height as the card expands — see "Compact Preview
                       Strips" in CLAUDE.md. */}
                  {poll.poll_type === 'ranked_choice' && (() => {
                    const r = pollResultsMap.get(poll.id);
                    if (!r) return null;
                    const inSuggestions = isInSuggestionPhase(poll);
                    return (
                      <CompactPreviewClip isExpanded={isExpanded}>
                        {inSuggestions ? (
                          <CompactSuggestionPreview results={r} />
                        ) : (
                          <CompactRankedChoicePreview results={r} isPollClosed={isClosed} />
                        )}
                      </CompactPreviewClip>
                    );
                  })()}
                  {poll.poll_type === 'time' && (() => {
                    // In availability phase the label lives in the above-
                    // card strip — skip the in-card strip entirely.
                    if (isInTimeAvailabilityPhase(poll)) return null;
                    const r = pollResultsMap.get(poll.id);
                    if (!r) return null;
                    return (
                      <CompactPreviewClip isExpanded={isExpanded}>
                        <CompactTimePreview results={r} isPollClosed={isClosed} />
                      </CompactPreviewClip>
                    );
                  })()}
                  </div>{/* /compact header */}

                  {/* Expanded full-poll content — pre-mounted (clipped) once the card
                       enters the viewport so fetches + effects complete before expansion.
                       Animates height via grid-template-rows 0fr ↔ 1fr with overflow
                       hidden on the child, so the natural expanded height is used
                       without JS measurement. */}
                  {(visiblePollIds.has(poll.id) || isExpanded) && (() => {
                    // For yes_no polls the thread view renders the whole
                    // voting + results UI externally (via YesNoResults), so
                    // PollPageClient returns null for its yes_no branch.
                    // Drop the mt-3 wrapper gap here so nothing empty sits
                    // under the external block.
                    const pollPageClientEmpty = poll.poll_type === 'yes_no';
                    return (
                      <div
                        data-poll-expand-grid=""
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                        aria-hidden={!isExpanded}
                      >
                        <div
                          className="overflow-hidden"
                          ref={(el) => {
                            if (el) expandedWrapperRefs.current.set(poll.id, el);
                            else expandedWrapperRefs.current.delete(poll.id);
                          }}
                        >
                          <div className={pollPageClientEmpty ? '' : 'mt-3'}>
                            <PollPageClient
                              poll={poll}
                              createdDate={formatCreationTimestamp(poll.created_at)}
                              pollId={poll.id}
                              externalYesNoResults={poll.poll_type === 'yes_no'}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="col-start-2 row-start-3 mt-1.5 flex justify-end">
                  <ClientOnly fallback={null}>
                    <VoterList
                      pollId={poll.id}
                      singleLine
                      className="max-w-[75%]"
                      filter={isInSuggestionPhase(poll) ? suggestionPhaseRespondentFilter : undefined}
                    />
                  </ClientOnly>
                </div>
              </div>
            );
          })}
      </div>

      {/* Thread-aware long-press modal — Copy + Forget, plus Reopen when
           the poll is closed and the current browser is the creator (or dev). */}
      {modalPoll && (
        <FollowUpModal
          isOpen={showModal}
          poll={modalPoll}
          totalVotes={pollResultsMap.get(modalPoll.id)?.total_votes}
          onClose={() => setShowModal(false)}
          showForkButton={false}
          onDelete={() => setPendingAction({ kind: 'forget', poll: modalPoll })}
          onReopen={
            modalPoll.is_closed &&
            (!!getCreatorSecret(modalPoll.id) || process.env.NODE_ENV === 'development')
              ? () => setPendingAction({ kind: 'reopen', poll: modalPoll })
              : undefined
          }
          onClosePoll={
            !modalPoll.is_closed &&
            (!!getCreatorSecret(modalPoll.id) || process.env.NODE_ENV === 'development')
              ? () => setPendingAction({ kind: 'close', poll: modalPoll })
              : undefined
          }
        />
      )}

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
            forgetPoll(action.poll.id);
            // If the forgotten poll was expanded, collapse it so the URL doesn't
            // still point at /p/<deletedId>.
            setExpandedPollId((curr) => (curr === action.poll.id ? null : curr));
            setThread((prev) => {
              if (!prev) return prev;
              const remaining = prev.polls.filter((p) => p.id !== action.poll.id);
              if (remaining.length === 0) {
                router.push('/');
                return prev;
              }
              return { ...prev, polls: remaining };
            });
          } else if (action.kind === 'reopen') {
            try {
              const secret = getCreatorSecret(action.poll.id) || 'dev-override';
              const updated = await apiReopenPoll(action.poll.id, secret);
              invalidatePoll(action.poll.id);
              setThread((prev) =>
                prev
                  ? {
                      ...prev,
                      polls: prev.polls.map((p) =>
                        p.id === action.poll.id
                          ? { ...p, is_closed: false, response_deadline: updated.response_deadline ?? p.response_deadline }
                          : p,
                      ),
                    }
                  : prev,
              );
            } catch (err) {
              console.error('Failed to reopen poll:', err);
            }
          } else {
            try {
              const secret = getCreatorSecret(action.poll.id) || '';
              await apiClosePoll(action.poll.id, secret);
              invalidatePoll(action.poll.id);
              setThread((prev) =>
                prev
                  ? {
                      ...prev,
                      polls: prev.polls.map((p) =>
                        p.id === action.poll.id
                          ? { ...p, is_closed: true, close_reason: 'manual' }
                          : p,
                      ),
                    }
                  : prev,
              );
            } catch (err) {
              console.error('Failed to close poll:', err);
            }
          }
        }}
        onCancel={() => setPendingAction(null)}
      />
      )}

      {/* Yes/No vote-change confirmation — triggered by tapping a non-chosen
          option (or the Abstain link) on the external YesNoResults card. */}
      <ConfirmationModal
        isOpen={!!pendingVoteChange}
        title="Change vote?"
        message={
          pendingVoteChange
            ? (() => {
                const current = userVoteMap.get(pendingVoteChange.pollId)?.choice;
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
    </>
  );
}

function ThreadPageInner() {
  const params = useParams();
  const threadId = params.threadId as string;
  return <ThreadContent threadId={threadId} />;
}

export default function ThreadPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading thread...</p>
        </div>
      </div>
    }>
      <ThreadPageInner />
    </Suspense>
  );
}

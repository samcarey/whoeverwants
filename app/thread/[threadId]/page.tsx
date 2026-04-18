"use client";

import { useEffect, useLayoutEffect, useState, useRef, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { Poll } from "@/lib/types";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { buildThreadFromPollDown } from "@/lib/threadUtils";
import { apiGetPollById, apiGetPollByShortId, apiReopenPoll } from "@/lib/api";
import { addAccessiblePollId, getCreatorSecret } from "@/lib/browserPollAccess";
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls, invalidatePoll } from "@/lib/pollCache";
import { isUuidLike, normalizePath } from "@/lib/pollId";
import { getCategoryIcon, relativeTime, isInSuggestionPhase, getResultBadge, BADGE_COLORS } from "@/lib/pollListUtils";
import { loadVotedPolls } from "@/lib/votedPollsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import RespondentCircles from "@/components/RespondentCircles";
import PollPageClient from "@/app/p/[shortId]/PollPageClient";
import { forgetPoll } from "@/lib/forgetPoll";

import type { Thread } from "@/lib/threadUtils";

const SimpleCountdown = ({ deadline, label, colorClass = "text-blue-600 dark:text-blue-400" }: { deadline: string; label: string; colorClass?: string }) => {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isClient, setIsClient] = useState(false);
  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => {
    if (!isClient) return;
    const updateCountdown = () => {
      const now = new Date().getTime();
      const deadlineTime = new Date(deadline).getTime();
      const difference = deadlineTime - now;
      if (difference <= 0) { setTimeLeft("Expired"); return; }
      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);
      let timeString = "";
      if (days > 0) timeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
      else if (hours > 0) timeString = `${hours}h ${minutes}m ${seconds}s`;
      else if (minutes > 0) timeString = `${minutes}m ${seconds}s`;
      else timeString = `${seconds}s`;
      setTimeLeft(timeString);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [deadline, isClient]);
  return <>{label && `${label}: `}<span className={`font-mono font-semibold ${colorClass}`}>{timeLeft}</span></>;
};

/** Attempt to build the thread synchronously from in-memory caches.
 *  Returns null if any required data is missing — the normal async fetch path
 *  will then run. Called during initial render so the page mounts with real
 *  content (no loading spinner flash) when we came from home or another page
 *  that already populated the cache. */
function buildThreadSync(
  threadId: string,
  voted: Set<string>,
  abstained: Set<string>
): Thread | null {
  if (typeof window === 'undefined') return null;
  const anchor = isUuidLike(threadId) ? getCachedPollById(threadId) : getCachedPollByShortId(threadId);
  if (!anchor) return null;
  const polls = getCachedAccessiblePolls();
  if (!polls) return null;
  return buildThreadFromPollDown(anchor.id, polls, voted, abstained);
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
      thread: buildThreadSync(threadId, voted.votedPollIds, voted.abstainedPollIds),
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
  // Delete confirmation — set to the poll that's about to be forgotten
  const [pollPendingDelete, setPollPendingDelete] = useState<Poll | null>(null);
  // Reopen confirmation — set to the poll that's about to be reopened
  const [pollPendingReopen, setPollPendingReopen] = useState<Poll | null>(null);
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

  // Auto-scroll to the bottom on load so newest polls are visible. Use direct scrollTop,
  // not scrollIntoView — the latter traverses overflow-hidden ancestors and pushes safe-area
  // padding off-screen on iOS PWA. headerHeight is a dep because scrollHeight grows with the
  // list's paddingTop, so the target offset changes once the header is measured.
  const scrollListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thread && !loading) {
      requestAnimationFrame(() => {
        const el = scrollListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [thread, loading, headerHeight]);

  // Set up a shared IntersectionObserver so cards pre-mount their expanded
  // content when they scroll into view. rootMargin prefetches slightly early.
  // Runs once; callback refs on each card attach/detach the observer.
  useEffect(() => {
    const list = scrollListRef.current;
    if (!list || typeof IntersectionObserver === 'undefined') return;
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
      { root: list, rootMargin: '200px 0px' },
    );
    intersectionObserverRef.current = observer;
    // Attach to any cards already mounted (ref callbacks may have fired before this effect).
    cardRefs.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      intersectionObserverRef.current = null;
    };
  }, [thread]);

  // When a card expands, adjust scroll so the expanded card fits on screen
  // without disturbing the user's view more than necessary:
  //   1. If the compact header is currently hidden behind the fixed top bar,
  //      scroll up so it sits flush with the bar.
  //   2. Otherwise, if the card's bottom (after expansion) extends below the
  //      bottom bar, scroll down just enough to reveal it — but never far
  //      enough to push the compact header above the top bar.
  //
  // The scroll runs concurrently with the 300ms grid-rows expand animation:
  // we manually rAF-animate scrollTop with the same easing, which keeps the
  // two visuals synchronized and sidesteps the scrollTo-clamping issue (the
  // list's scrollHeight grows proportionally as the card expands, so each
  // intermediate target is always within bounds).
  useEffect(() => {
    if (!expandedPollId) return;
    const card = cardRefs.current.get(expandedPollId);
    const list = scrollListRef.current;
    if (!card || !list) return;

    // Measure once, up front, using the overflow-hidden wrapper's scrollHeight
    // (which reflects the natural content size regardless of grid-row state).
    const wrapper = expandedWrapperRefs.current.get(expandedPollId);
    const expandedContentHeight = wrapper?.scrollHeight ?? 0;
    const wrapperCurrent = wrapper?.getBoundingClientRect().height ?? 0;
    const compactHeight = card.getBoundingClientRect().height - wrapperCurrent;
    const bottomBarEl = typeof document !== 'undefined' ? document.getElementById('bottom-bar-portal') : null;
    const bottomBarHeight = bottomBarEl ? bottomBarEl.offsetHeight : 0;
    const listRect = list.getBoundingClientRect();
    const visibleTopY = listRect.top + headerHeight;
    const visibleBottomY = listRect.bottom - bottomBarHeight;
    const cardTopY = card.getBoundingClientRect().top;
    const finalCardBottomY = cardTopY + compactHeight + expandedContentHeight;

    let targetDelta = 0;
    if (cardTopY < visibleTopY) {
      targetDelta = cardTopY - visibleTopY;
    } else if (finalCardBottomY > visibleBottomY) {
      const overshoot = finalCardBottomY - visibleBottomY;
      const slack = cardTopY - visibleTopY;
      targetDelta = Math.min(overshoot, slack);
    }

    if (targetDelta === 0) return;

    const startScrollTop = list.scrollTop;
    const targetScrollTop = startScrollTop + targetDelta;
    const DURATION = 300; // matches the grid-rows CSS transition
    const startTime = performance.now();
    let rafId: number | null = null;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / DURATION, 1);
      // ease-out cubic — matches the feel of the CSS transition
      const eased = 1 - Math.pow(1 - t, 3);
      list.scrollTop = startScrollTop + (targetScrollTop - startScrollTop) * eased;
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
      setThread((prev) =>
        prev
          ? {
              ...prev,
              polls: prev.polls.map((p) =>
                p.id === detail.pollId ? { ...p, ...detail.updates } : p,
              ),
            }
          : prev,
      );
      setModalPoll((prev) => (prev && prev.id === detail.pollId ? { ...prev, ...detail.updates } : prev));
    };
    window.addEventListener('poll:updated', handler);
    return () => window.removeEventListener('poll:updated', handler);
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
      <div className="h-full flex items-center justify-center">
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
      <div className="h-full flex items-center justify-center">
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

  const now = new Date();
  const isPollOpen = (poll: Poll) =>
    poll.response_deadline ? new Date(poll.response_deadline) > now && !poll.is_closed : !poll.is_closed;

  // Unvoted open polls sort to bottom so they're visible on auto-scroll
  const threadPolls = [...thread.polls].sort((a, b) => {
    const aNeedsAction = isPollOpen(a) && !votedPollIds.has(a.id) && !abstainedPollIds.has(a.id);
    const bNeedsAction = isPollOpen(b) && !votedPollIds.has(b.id) && !abstainedPollIds.has(b.id);
    if (aNeedsAction !== bNeedsAction) return aNeedsAction ? 1 : -1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Thread header — position:fixed so it stays locked to the safe area top even if
          ancestor containers (.pwa-safe-top / .safari-scroll-container) end up with a stray
          scrollTop on iOS PWA. Viewport-relative because .responsive-scaling-container has
          no transform on mobile. */}
      <div
        ref={headerRef}
        className="fixed left-0 right-0 z-20 bg-background touch-none"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-4xl mx-auto pl-2 pr-4 py-2 flex items-center gap-2 overflow-hidden">
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
          <div className="min-w-0">
            <h1 className="font-semibold text-lg text-gray-900 dark:text-white truncate">
              {thread.title}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {thread.polls.length} {thread.polls.length === 1 ? 'poll' : 'polls'}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable poll list — auto-scrolls to bottom on load.
          paddingTop reserves space for the fixed header above. */}
      <div
        ref={scrollListRef}
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{ paddingTop: `${headerHeight}px` }}
      >
        <div className="py-2">
        {threadPolls.map((poll) => {
            const isVoted = votedPollIds.has(poll.id) || abstainedPollIds.has(poll.id);
            const isOpen = isPollOpen(poll);
            const isClosed = !isOpen;

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

            // Tap expands the card when collapsed; when already expanded, tap is a
            // no-op (only the corner chevron collapses). Long-press always opens the
            // follow-up modal regardless of expansion state.
            const expand = () => {
              if (expandedPollId !== poll.id) setExpandedPollId(poll.id);
            };

            const handleClick = () => {
              if (touchJustHandled.current) return;
              expand();
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
                expand();
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
                className="mx-1.5 mb-1.5"
              >
                <div
                  className={`px-2 py-2 rounded-2xl ${pressedPollId === poll.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-200 dark:bg-gray-700'} ${!isExpanded ? 'hover:bg-gray-300 dark:hover:bg-gray-600 active:bg-blue-100 dark:active:bg-blue-900/40' : ''} transition-colors select-none relative`}
                >
                  {/* Compact header — click/touch + long-press live here so they work
                       whether the card is collapsed or expanded without interfering
                       with interactive elements inside the expanded PollPageClient. */}
                  <div
                    onClick={handleClick}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchMove}
                    className={!isExpanded ? 'cursor-pointer' : ''}
                  >
                  {/* Status line: category icon (left) · countdown/badge (center) ·
                       collapse arrow (right, expanded only). */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm w-8 shrink-0">{getCategoryIcon(poll)}</span>
                    <span className="flex-1 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 min-w-0">
                      <ClientOnly fallback={<>Loading...</>}>
                        {(() => {
                          if (isClosed) {
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
                          if (poll.response_deadline) {
                            return <SimpleCountdown deadline={poll.response_deadline} label="Voting" colorClass="text-green-600 dark:text-green-400" />;
                          }
                          return null;
                        })()}
                      </ClientOnly>
                    </span>
                    <div className="w-8 h-8 shrink-0 flex items-center justify-end">
                      {isExpanded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedPollId(null); }}
                          className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                          aria-label="Collapse"
                        >
                          <svg className="w-7 h-7 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="font-medium text-lg line-clamp-2 text-gray-900 dark:text-white">
                    {poll.title}
                  </h3>

                  {/* Metadata */}
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      <ClientOnly fallback={null}>
                        <>
                          {poll.creator_name && <>{poll.creator_name} &middot; </>}
                          <span
                            className="relative cursor-help"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTooltipPollId((prev) => (prev === poll.id ? null : poll.id));
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                            onTouchMove={(e) => e.stopPropagation()}
                            onMouseEnter={() => setTooltipPollId(poll.id)}
                            onMouseLeave={() =>
                              setTooltipPollId((prev) => (prev === poll.id ? null : prev))
                            }
                          >
                            {relativeTime(poll.created_at)}
                            {tooltipPollId === poll.id && (
                              <span
                                role="tooltip"
                                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-100 shadow-lg dark:bg-gray-900"
                              >
                                {(() => {
                                  const dt = new Date(poll.created_at);
                                  const t = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                                  return `@ ${t} ${dt.toLocaleDateString("en-US", { year: "2-digit", month: "numeric", day: "numeric" })}`;
                                })()}
                              </span>
                            )}
                          </span>
                        </>
                      </ClientOnly>
                    </div>
                    {!isVoted && isOpen && (
                      <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                        Not voted
                      </span>
                    )}
                    {isOpen && (
                      <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                        {(poll.response_count ?? 0) > 0
                          ? `${poll.response_count} ${poll.response_count === 1 ? 'response' : 'responses'}`
                          : 'No responses yet'}
                      </span>
                    )}
                  </div>
                  </div>{/* /compact header */}

                  {/* Expanded full-poll content — pre-mounted (clipped) once the card
                       enters the viewport so fetches + effects complete before expansion.
                       Animates height via grid-template-rows 0fr ↔ 1fr with overflow
                       hidden on the child, so the natural expanded height is used
                       without JS measurement. */}
                  {(visiblePollIds.has(poll.id) || isExpanded) && (
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
                        <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
                          <PollPageClient
                            poll={poll}
                            createdDate={(() => {
                              const dt = new Date(poll.created_at);
                              const t = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                              return `@ ${t} ${dt.toLocaleDateString("en-US", { year: "2-digit", month: "numeric", day: "numeric" })}`;
                            })()}
                            pollId={poll.id}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Thread-aware long-press modal — Copy + Forget, plus Reopen when
           the poll is closed and the current browser is the creator (or dev). */}
      {modalPoll && (
        <FollowUpModal
          isOpen={showModal}
          poll={modalPoll}
          onClose={() => setShowModal(false)}
          showForkButton={false}
          onDelete={() => setPollPendingDelete(modalPoll)}
          onReopen={
            modalPoll.is_closed &&
            (!!getCreatorSecret(modalPoll.id) || process.env.NODE_ENV === 'development')
              ? () => setPollPendingReopen(modalPoll)
              : undefined
          }
        />
      )}

      {/* Delete confirmation — forgets the poll from browser storage. */}
      <ConfirmationModal
        isOpen={!!pollPendingDelete}
        title="Forget poll"
        message="This will remove the poll from your browser's history. You won't see it in your poll list anymore, and any vote data stored locally will be deleted. You can still access it again with the direct link."
        confirmText="Forget Poll"
        cancelText="Cancel"
        confirmButtonClass="bg-yellow-500 hover:bg-yellow-600 text-white"
        onConfirm={() => {
          const target = pollPendingDelete;
          if (!target) return;
          forgetPoll(target.id);
          setPollPendingDelete(null);
          // If the forgotten poll was expanded, collapse it so the URL doesn't
          // still point at /p/<deletedId>.
          setExpandedPollId((curr) => (curr === target.id ? null : curr));
          // Optimistic thread update — filter out the forgotten poll. If it was
          // the last poll in the thread, navigate home.
          setThread((prev) => {
            if (!prev) return prev;
            const remaining = prev.polls.filter((p) => p.id !== target.id);
            if (remaining.length === 0) {
              router.push('/');
              return prev;
            }
            return { ...prev, polls: remaining };
          });
        }}
        onCancel={() => setPollPendingDelete(null)}
      />

      {/* Reopen confirmation */}
      <ConfirmationModal
        isOpen={!!pollPendingReopen}
        title="Reopen Poll"
        message="Are you sure you want to reopen this poll? This will allow voting to resume and results will be hidden until the poll is closed again."
        confirmText="Reopen Poll"
        cancelText="Cancel"
        confirmButtonClass="bg-green-600 hover:bg-green-700 text-white"
        onConfirm={async () => {
          const target = pollPendingReopen;
          if (!target) return;
          setPollPendingReopen(null);
          try {
            const secret = getCreatorSecret(target.id) || 'dev-override';
            const updated = await apiReopenPoll(target.id, secret);
            invalidatePoll(target.id);
            // Optimistically flip is_closed on the poll within the thread.
            setThread((prev) =>
              prev
                ? {
                    ...prev,
                    polls: prev.polls.map((p) =>
                      p.id === target.id
                        ? { ...p, is_closed: false, response_deadline: updated.response_deadline ?? p.response_deadline }
                        : p,
                    ),
                  }
                : prev,
            );
          } catch (err) {
            console.error('Failed to reopen poll:', err);
          }
        }}
        onCancel={() => setPollPendingReopen(null)}
      />
    </div>
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
      <div className="h-full flex items-center justify-center">
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

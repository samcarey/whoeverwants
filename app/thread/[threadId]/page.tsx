"use client";

import { useEffect, useLayoutEffect, useState, useRef, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { Poll } from "@/lib/types";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { buildThreadFromPollDown } from "@/lib/threadUtils";
import { apiGetPollById, apiGetPollByShortId } from "@/lib/api";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import { getCachedPollById, getCachedPollByShortId, getCachedAccessiblePolls } from "@/lib/pollCache";
import { isUuidLike, normalizePath } from "@/lib/pollId";
import { getCategoryIcon, relativeTime, isInSuggestionPhase, getResultBadge, BADGE_COLORS } from "@/lib/pollListUtils";
import { loadVotedPolls } from "@/lib/votedPollsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";
import RespondentCircles from "@/components/RespondentCircles";
import PollPageClient from "@/app/p/[shortId]/PollPageClient";

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

function ThreadContent() {
  const router = useRouter();
  const params = useParams();
  const { prefetchBatch } = usePrefetch();
  const threadId = params.threadId as string;

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

  // Expanded card state — only one card can be expanded at a time
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);
  // Prevents the synthetic click from firing after touchend already toggled expansion on mobile
  const touchJustHandled = useRef(false);
  // Refs for each card wrapper so we can scroll the expanded card into view
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Long press state
  const [modalPoll, setModalPoll] = useState<Poll | null>(null);
  const [showModal, setShowModal] = useState(false);
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

  // When a card expands, scroll it so its top sits flush with the bottom of the
  // fixed header. Use getBoundingClientRect rather than offsetTop to avoid depending
  // on offsetParent positioning, which varies with parent layout. Two rAFs let React
  // commit the expanded DOM before we measure.
  useEffect(() => {
    if (!expandedPollId) return;
    const card = cardRefs.current.get(expandedPollId);
    const list = scrollListRef.current;
    if (!card || !list) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cardRect = card.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        list.scrollTop += cardRect.top - listRect.top - headerHeight;
      });
    });
  }, [expandedPollId, headerHeight]);

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

            const toggleExpanded = () => {
              setExpandedPollId((current) => (current === poll.id ? null : poll.id));
            };

            const handleClick = () => {
              if (touchJustHandled.current) return;
              toggleExpanded();
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
                toggleExpanded();
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
                  if (el) cardRefs.current.set(poll.id, el);
                  else cardRefs.current.delete(poll.id);
                }}
                className="mx-1.5 mb-1.5"
              >
                <div
                  onClick={isExpanded ? undefined : handleClick}
                  onTouchStart={isExpanded ? undefined : handleTouchStart}
                  onTouchEnd={isExpanded ? undefined : handleTouchEnd}
                  onTouchMove={isExpanded ? undefined : handleTouchMove}
                  className={`px-2 py-2 rounded-2xl ${pressedPollId === poll.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-200 dark:bg-gray-700'} ${!isExpanded ? 'hover:bg-gray-300 dark:hover:bg-gray-600 active:bg-blue-100 dark:active:bg-blue-900/40 cursor-pointer' : ''} transition-colors select-none relative`}
                >
                  {/* Status line */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{getCategoryIcon(poll)}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
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
                  </div>

                  {/* Title */}
                  <h3 className="font-medium text-lg line-clamp-2 text-gray-900 dark:text-white">
                    {poll.title}
                  </h3>

                  {/* Metadata */}
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      <ClientOnly fallback={null}>
                        <>{poll.creator_name && <>{poll.creator_name} &middot; </>}{relativeTime(poll.created_at)}</>
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

                  {/* Expanded full-poll content */}
                  {isExpanded && (
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
                      <div className="flex justify-center mt-4">
                        <button
                          onClick={() => setExpandedPollId(null)}
                          className="w-12 h-12 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                          aria-label="Collapse"
                        >
                          <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Thread-aware follow-up modal (Blank + Copy only, no Fork) */}
      {modalPoll && (
        <FollowUpModal
          isOpen={showModal}
          poll={modalPoll}
          onClose={() => setShowModal(false)}
          showForkButton={false}
        />
      )}
    </div>
  );
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
      <ThreadContent />
    </Suspense>
  );
}

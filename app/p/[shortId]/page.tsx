"use client";

import { useEffect, useState, useRef, useMemo, Suspense } from "react";
import { flushSync } from "react-dom";
import { useRouter, useParams } from "next/navigation";
import { Question } from "@/lib/types";
import { getAccessiblePolls } from "@/lib/simpleQuestionQueries";
import { discoverRelatedQuestions } from "@/lib/questionDiscovery";
import { buildThreadFromPollDown, buildThreadSyncFromCache, buildPollMap, findThreadRootRouteId } from "@/lib/threadUtils";
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
  type PollPendingDetail,
  type PollHydratedDetail,
} from "@/lib/eventChannels";
import { isUuidLike } from "@/lib/questionId";
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

// Inverse grid-rows clip for compact pills in the thread card header:
// full height when collapsed, 0 when expanded, animating in lockstep
// with the heavy-content expand clip below. The pill sits directly at the
// top of the overflow-hidden child so its text center aligns with the
// sibling status text via the parent flex row's items-center.
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
      document.body.setAttribute('data-thread-latest-question-id', thread.latestQuestion.id);
    }
    return () => { document.body.removeAttribute('data-thread-latest-question-id'); };
  }, [thread]);

  // Signal to the view transition helper that this page's content is rendered.
  usePageReady(!!thread && !loading);

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
  // poll into thread state immediately, find the freshly mounted card in the
  // DOM, and run a FLIP animation from the draft card's captured bbox to
  // the natural collapsed-card position. apiCreatePoll is running in
  // parallel; POLL_HYDRATED_EVENT will swap the placeholder for the real
  // Poll in-place.
  //
  // /p/ (empty placeholder) case: the destination ThreadContent has not yet
  // mounted, so it picks up the placeholder via cache on its initial render
  // and runs the FLIP itself. The early return below skips this listener
  // for that case.
  useEffect(() => {
    let rafId = 0;
    let rafId2 = 0;
    let timeoutId = 0;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollPendingDetail>).detail;
      const newPoll = detail?.poll;
      const fromBbox = detail?.fromBbox;
      if (!newPoll || !fromBbox) return;

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

      // FLIP the bordered frame (not the outer grid) so the visible card
      // shape morphs and the surrounding category-icon column stays still.
      // width/height (not `transform: scale`) so the title sits at its
      // natural size in the morphing container.
      //
      // Two-rAF dance: the first rAF measures the natural position +
      // commits the "from" state inline (no transition); the second rAF
      // (next frame) installs the transition + writes the "to" state.
      // Single-rAF + `void offsetWidth` worked in some browsers but
      // wasn't firing the transition reliably here — the new card's
      // height stayed at the inline "to" value visually with no easing,
      // looking like an instant snap. The double-rAF pattern is the
      // standard FLIP idiom and lets the browser commit the from-state
      // paint before the transition starts.
      if (!firstQuestionId) return;
      rafId = requestAnimationFrame(() => {
        const card = cardFrameRefs.current.get(firstQuestionId);
        if (!card) return;
        const newBbox = card.getBoundingClientRect();
        const dx = fromBbox.x - newBbox.x;
        const dy = fromBbox.y - newBbox.y;
        card.style.transition = 'none';
        card.style.transformOrigin = 'top left';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        card.style.width = `${fromBbox.width}px`;
        card.style.height = `${fromBbox.height}px`;
        // Grid items default to `min-height: auto`/`min-width: auto`,
        // which resolves to min-content and clamps the cardFrame to its
        // intrinsic content size — the FLIP height transition stalls
        // until the curve crosses the min-content threshold near the
        // very end. Override both to 0 so the transition can interpolate
        // freely; cleared with the rest of the inline overrides at
        // animation end.
        card.style.minHeight = '0';
        card.style.minWidth = '0';
        rafId2 = requestAnimationFrame(() => {
          if (!card.isConnected) return;
          // Re-fetch the cardFrame ref in case React swapped the DOM
          // node between rAFs (e.g., a stray re-render); fall back to
          // the original element if not.
          const target = cardFrameRefs.current.get(firstQuestionId) ?? card;
          target.style.transition = 'transform 1s cubic-bezier(0.32, 0.72, 0, 1), width 1s cubic-bezier(0.32, 0.72, 0, 1), height 1s cubic-bezier(0.32, 0.72, 0, 1)';
          target.style.transform = '';
          target.style.width = `${newBbox.width}px`;
          target.style.height = `${newBbox.height}px`;
          timeoutId = window.setTimeout(() => {
            const finalCard = cardFrameRefs.current.get(firstQuestionId) ?? target;
            if (!finalCard.isConnected) return;
            finalCard.style.transition = '';
            finalCard.style.transformOrigin = '';
            finalCard.style.width = '';
            finalCard.style.height = '';
            finalCard.style.minHeight = '';
            finalCard.style.minWidth = '';
          }, 1050);
        });
      });
    };
    window.addEventListener(POLL_PENDING_EVENT, handler);
    return () => {
      window.removeEventListener(POLL_PENDING_EVENT, handler);
      if (rafId) cancelAnimationFrame(rafId);
      if (rafId2) cancelAnimationFrame(rafId2);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  // POLL_HYDRATED_EVENT: the API call has resolved with the real Poll.
  // Replace the placeholder fields in thread state with the real ones in
  // place — keep the SAME placeholder id as the React key so the card's
  // DOM node doesn't unmount/re-mount mid-FLIP. Once the placeholder is
  // gone (its id was 'pending-...'), the real Poll's id takes over for
  // subsequent operations.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PollHydratedDetail>).detail;
      const placeholderId = detail?.placeholderId;
      const realPoll = detail?.poll;
      if (!placeholderId || !realPoll) return;
      setThread((prev) => {
        if (!prev) return prev;
        if (!prev.polls.some(p => p.id === placeholderId)) return prev;
        const polls = prev.polls.map((p) => (p.id === placeholderId ? realPoll : p));
        const placeholderQuestionIds = new Set(
          prev.polls.find(p => p.id === placeholderId)?.questions.map(q => q.id) ?? [],
        );
        const questions = prev.questions
          .filter(q => !placeholderQuestionIds.has(q.id))
          .concat(realPoll.questions);
        const latestPoll = polls[polls.length - 1];
        const latestQuestion = realPoll.questions[realPoll.questions.length - 1];
        return {
          ...prev,
          polls,
          questions,
          latestPoll,
          latestQuestion,
        };
      });
      // Clear the "pending" flag so the real card renders its full content.
      setPendingPollFirstQuestionId(null);
    };
    window.addEventListener(POLL_HYDRATED_EVENT, handler);
    return () => window.removeEventListener(POLL_HYDRATED_EVENT, handler);
  }, []);

  // Measure the fixed thread header so we can apply matching padding-top on the scroll list
  // (the header is position:fixed and out of flow, so the list doesn't naturally reserve space).
  // Re-measure when `thread` flips loaded — the header is rendered behind a
  // `if (loading) return <Spinner/>` early return, so the measured ref only
  // exists once `thread` is non-null.
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([thread]);

  // Auto-scroll to the bottom once on initial load so newest questions are visible.
  // Waits for headerHeight > 0 (paddingTop applies once the fixed header is
  // measured, otherwise scrollHeight lags). Gated on a ref so subsequent
  // thread-state mutations (question:updated events, re-fetches) can't re-fire it
  // — that yanked the user back to the bottom mid-scroll.
  // Skipped when entering on an expanded question (/p/<id>/) — the expand-scroll
  // effect below positions that card flush with the top bar instead.
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (thread && !loading && headerHeight > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      if (initialExpandedQuestionId) return;
      requestAnimationFrame(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
    }
  }, [thread, loading, headerHeight, initialExpandedQuestionId]);

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

  // When a card expands, adjust scroll so the expanded card fits on screen
  // without disturbing the user's view more than necessary:
  //   1. On initial mount with an expanded question (/p/<id>/ or after creating a
  //      question), always align the card top flush with the bottom of the top
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
    if (!expandedQuestionId) return;
    // Wait for the fixed-header height measurement so visibleTopY is correct
    // before we compute the target scroll position.
    if (headerHeight === 0) return;
    const card = cardRefs.current.get(expandedQuestionId);
    if (!card) return;

    // Measure once, up front, using the overflow-hidden wrapper's scrollHeight
    // (which reflects the natural content size regardless of grid-row state).
    const wrapper = expandedWrapperRefs.current.get(expandedQuestionId);
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
      expandedQuestionId === initialExpandedQuestionId;

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
  }, [expandedQuestionId, headerHeight]);

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

            const handleTouchStart = (e: React.TouchEvent) => {
              isLongPress.current = false;
              isScrolling.current = false;
              setPressedQuestionId(question.id);
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
              if (touchJustHandled.current) return;
              toggleExpand();
            };

            const handleTouchEnd = () => {
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
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
            };

            const handleTouchMove = (e: React.TouchEvent) => {
              if (!touchStartPos.current) return;
              const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
              const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
              if (deltaX > 10 || deltaY > 10) {
                isScrolling.current = true;
                setPressedQuestionId(null);
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              }
            };

            const isExpanded = expandedQuestionId === question.id;
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
                    cardRefs.current.set(question.id, el);
                    intersectionObserverRef.current?.observe(el);
                  } else {
                    const prev = cardRefs.current.get(question.id);
                    if (prev) intersectionObserverRef.current?.unobserve(prev);
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

                <div
                  ref={(el) => {
                    if (el) cardFrameRefs.current.set(question.id, el);
                    else cardFrameRefs.current.delete(question.id);
                  }}
                  className={`col-start-2 row-start-2 min-w-0 px-2 pt-1.5 ${isExpanded ? 'pb-1.5' : 'pb-0.5'} rounded-2xl border shadow-sm ${isAwaiting ? 'border-amber-400 dark:border-amber-500' : 'border-gray-200 dark:border-gray-800'} ${pressedQuestionId === question.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-900'} ${!isExpanded ? 'hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-blue-100 dark:active:bg-blue-900/40' : ''} transition-colors select-none relative`}
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
                                  <div className="mb-3">
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
                                  <div className="mb-3">
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
        <div id="draft-poll-portal" />
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
    </>
  );
}

// Resolves the URL param `/p/<shortId>/` (poll short_id, poll uuid, or question
// uuid) to the thread root + the poll the URL points at, then renders
// ThreadContent with that poll's first question expanded.
function PollPageInner() {
  const router = useRouter();
  const params = useParams();
  const shortId = params.shortId as string;

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
      initialExpandedQuestionId={resolved.question.id}
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

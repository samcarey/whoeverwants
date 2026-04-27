"use client";

import { useEffect, useState, useRef, useMemo, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { Poll } from "@/lib/types";
import { getAccessibleMultipolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import { buildThreadFromMultipollDown, buildThreadSyncFromCache, buildMultipollMap } from "@/lib/threadUtils";
import { apiGetPollById, apiGetPollByShortId, apiGetPollResults, apiGetVotes, apiCloseMultipoll, apiReopenMultipoll, apiCutoffMultipollAvailability, apiGetMultipollById, apiSubmitMultipollVotes, POLL_VOTES_CHANGED_EVENT } from "@/lib/api";
import type { Multipoll } from "@/lib/types";
import type { MultipollVoteItem } from "@/lib/api";
import { buildMultipollVoteItem } from "@/components/SubPollBallot/voteDataBuilders";
import { getUserName, saveUserName } from "@/lib/userProfile";
import CompactNameField from "@/components/CompactNameField";
import type { PollResults } from "@/lib/types";
import { addAccessiblePollId, getAccessiblePollIds, getCreatorSecret } from "@/lib/browserPollAccess";
import { getCachedPollById, getCachedPollByShortId, getCachedPollResults, invalidatePoll, getMultipollForPoll } from "@/lib/pollCache";
import { isUuidLike } from "@/lib/pollId";
import { usePageReady } from "@/lib/usePageReady";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import { getCategoryIcon, relativeTime, isInSuggestionPhase, isInTimeAvailabilityPhase, compactDurationSince } from "@/lib/pollListUtils";
import { formatCreationTimestamp } from "@/lib/timeUtils";
import { loadVotedPolls, setVotedPollFlag, getStoredVoteId, setStoredVoteId, parseYesNoChoice } from "@/lib/votedPollsStorage";
import { usePrefetch } from "@/lib/prefetch";
import { navigateWithTransition } from "@/lib/viewTransitions";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";
import ConfirmationModal from "@/components/ConfirmationModal";
import VoterList from "@/components/VoterList";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import type { ApiVote } from "@/lib/api";
import SubPollBallot, { type SubPollBallotHandle } from "@/components/SubPollBallot";
import PollResultsDisplay, { CompactRankedChoicePreview, CompactSuggestionPreview, CompactTimePreview } from "@/components/PollResults";
import SimpleCountdown from "@/components/SimpleCountdown";
import ThreadHeader from "@/components/ThreadHeader";
import { forgetPoll } from "@/lib/forgetPoll";
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

  // Phase 5b: multipoll-level mutations (close/reopen/cutoff) update the
  // multipolls array; sub-poll mutations (forget) update the polls array.
  const patchThreadMultipolls = useRef(
    (predicate: (mp: Multipoll) => boolean, patcher: (mp: Multipoll) => Partial<Multipoll>) => {
      setThread((prev) => {
        if (!prev) return prev;
        if (!prev.multipolls.some(predicate)) return prev;
        return {
          ...prev,
          multipolls: prev.multipolls.map((mp) => (predicate(mp) ? { ...mp, ...patcher(mp) } : mp)),
        };
      });
    },
  ).current;
  const patchThreadPolls = useRef(
    (predicate: (p: Poll) => boolean, patcher: (p: Poll) => Partial<Poll>) => {
      setThread((prev) => {
        if (!prev) return prev;
        if (!prev.polls.some(predicate)) return prev;
        return {
          ...prev,
          polls: prev.polls.map((p) => (predicate(p) ? { ...p, ...patcher(p) } : p)),
        };
      });
    },
  ).current;

  // Set data attribute on body so the bottom bar "+" button can auto-follow-up
  useEffect(() => {
    if (thread) {
      document.body.setAttribute('data-thread-latest-poll-id', thread.latestPoll.id);
    }
    return () => { document.body.removeAttribute('data-thread-latest-poll-id'); };
  }, [thread]);

  // Signal to the view transition helper that this page's content is rendered.
  usePageReady(!!thread && !loading);

  // Prefetch poll page routes for all polls in this thread. Phase 5b:
  // short_id lives on the multipoll wrapper, so the friendly URL uses the
  // multipoll's short_id when available.
  useEffect(() => {
    if (!thread) return;
    const wrapperByPollId = new Map<string, string>();
    for (const mp of thread.multipolls) {
      if (!mp.short_id) continue;
      for (const sp of mp.sub_polls) wrapperByPollId.set(sp.id, mp.short_id);
    }
    const hrefs = thread.polls.map(p => `/p/${wrapperByPollId.get(p.id) || p.id}`);
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
  // clip. Seeded synchronously from inline poll.results so the previews render
  // on first paint — without this, slots mount empty and fill in late when the
  // viewport-intersection fetch resolves, making every card grow and the list
  // slide down on refresh. The viewport observer still runs to refresh stale
  // entries.
  const [pollResultsMap, setPollResultsMap] = useState<Map<string, PollResults>>(() => {
    const seed = new Map<string, PollResults>();
    if (initialThread) {
      for (const p of initialThread.polls) {
        if (p.results) seed.set(p.id, p.results);
      }
    }
    return seed;
  });
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

  // Staged yes/no choices, keyed by sub_poll_id. Taps on a multi-yes_no
  // group's external card write here instead of firing apiSubmitVote
  // immediately — the wrapper-level Submit commits them as one batch.
  const [pendingMultipollChoices, setPendingMultipollChoices] = useState<Map<string, 'yes' | 'no' | 'abstain'>>(() => new Map());
  const [multipollVoterNames, setMultipollVoterNames] = useState<Map<string, string>>(() => new Map());
  // Single setter that callers (the all-yes_no Submit row + Phase 3.4
  // follow-up B's wrapper Submit) share — same-value guard avoids no-op
  // re-renders.
  const setMultipollVoterName = useRef((id: string, name: string) => {
    setMultipollVoterNames((prev) => (prev.get(id) === name ? prev : new Map(prev).set(id, name)));
  }).current;
  // Snapshots subPolls + the prepared MultipollVoteItems at button-tap time so
  // edits to the form between the click and the modal confirm don't leak into
  // the in-flight batch. preparedNonYesNo is empty for all-yes_no groups (the
  // wrapper builds yes_no items from pendingMultipollChoices at confirm time).
  type PreparedNonYesNoEntry = {
    pollId: string;
    item: MultipollVoteItem;
    commit: (vote: ApiVote) => void;
    fail: (errorMessage: string) => void;
  };
  const [pendingMultipollSubmit, setPendingMultipollSubmit] = useState<
    {
      multipollId: string;
      subPolls: Poll[];
      stagedCount: number;
      preparedNonYesNo: PreparedNonYesNoEntry[];
    } | null
  >(null);
  const [multipollSubmitting, setMultipollSubmitting] = useState<Set<string>>(() => new Set());
  const [multipollSubmitError, setMultipollSubmitError] = useState<Map<string, string>>(() => new Map());
  // Phase 3.4 follow-up B: SubPollBallot signals visibility + label for the
  // wrapper-rendered Submit button. Same-value guard avoids re-render churn.
  type WrapperSubmitState = { visible: boolean; label: string };
  const [wrapperSubmitState, setWrapperSubmitState] = useState<Map<string, WrapperSubmitState>>(() => new Map());
  const handleWrapperSubmitStateChange = useRef((pollId: string, state: WrapperSubmitState) => {
    setWrapperSubmitState((prev) => {
      const cur = prev.get(pollId);
      if (cur && cur.visible === state.visible && cur.label === state.label) return prev;
      const next = new Map(prev);
      next.set(pollId, state);
      return next;
    });
  }).current;
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
  // Phase 3.4 follow-up B: wrapper-level Submit for 1-sub-poll non-yes_no
  // multipolls. Each SubPollBallot exposes triggerSubmit() via this ref;
  // the wrapper Submit calls it, which routes through the same validation
  // + confirmation modal flow the per-sub-poll Submit used to invoke.
  const subPollBallotRefs = useRef<Map<string, SubPollBallotHandle>>(new Map());
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

  // On cache hit, defer the background refresh via requestIdleCallback so it
  // doesn't compete with React commit during a view transition.
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
        // Votes prefetch fires in parallel with getAccessiblePolls so the votes
        // cache is warm by the time VoterList mounts — bubbles render alongside
        // the cards instead of ~100ms after. apiGetVotes is cache + in-flight
        // coalesced, so the later per-card fetch hits the warm cache.
        try { await discoverRelatedPolls(); } catch {}
        for (const id of getAccessiblePollIds()) {
          void apiGetVotes(id).catch(() => null);
        }
        const multipolls = await getAccessibleMultipolls();
        if (!multipolls) { setError(true); return; }

        // Re-read voted state — discovery or the user voting elsewhere may have changed it.
        const { votedPollIds: voted, abstainedPollIds: abstained } = loadVotedPolls();
        const anchorMultipollId = anchorPoll.multipoll_id;
        if (!anchorMultipollId) { setError(true); return; }
        const foundThread = buildThreadFromMultipollDown(anchorMultipollId, multipolls, voted, abstained);

        if (!foundThread) {
          setError(true);
          return;
        }

        // Seed inline results BEFORE setThread so the first render with the
        // loaded thread already has compact previews (no slide-down on refresh).
        setPollResultsMap((prev) => {
          const additions = foundThread.polls.filter(p => p.results && !prev.has(p.id));
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

  // Measure the fixed thread header so we can apply matching padding-top on the scroll list
  // (the header is position:fixed and out of flow, so the list doesn't naturally reserve space).
  // Re-measure when `thread` flips loaded — the header is rendered behind a
  // `if (loading) return <Spinner/>` early return, so the measured ref only
  // exists once `thread` is non-null.
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>([thread]);

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

    // For multi-sub-poll groups, anchor visibility implies the whole
    // group is on-screen — fetch results for every sibling so each
    // sub-poll's preview is populated, not just the anchor's. Compute
    // anchor ids per multipoll once.
    const anchorByMultipoll = new Map<string, string>();
    for (const poll of thread.polls) {
      if (!poll.multipoll_id) continue;
      const cur = anchorByMultipoll.get(poll.multipoll_id);
      if (!cur) {
        anchorByMultipoll.set(poll.multipoll_id, poll.id);
        continue;
      }
      const curPoll = thread.polls.find((p) => p.id === cur);
      if ((poll.sub_poll_index ?? 0) < (curPoll?.sub_poll_index ?? 0)) {
        anchorByMultipoll.set(poll.multipoll_id, poll.id);
      }
    }
    for (const poll of thread.polls) {
      const anchorId = poll.multipoll_id
        ? (anchorByMultipoll.get(poll.multipoll_id) ?? poll.id)
        : poll.id;
      if (!visiblePollIds.has(anchorId)) continue;
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

  const buildYesNoMultipollItems = (subPolls: Poll[]): MultipollVoteItem[] => {
    const items: MultipollVoteItem[] = [];
    for (const sp of subPolls) {
      if (sp.poll_type !== 'yes_no') continue;
      const staged = pendingMultipollChoices.get(sp.id);
      if (!staged) continue;
      const existing = userVoteMap.get(sp.id);
      const voteData = {
        vote_type: 'yes_no' as const,
        yes_no_choice: staged === 'abstain' ? null : staged,
        is_abstain: staged === 'abstain',
      };
      items.push(buildMultipollVoteItem(voteData, sp.id, existing?.voteId ?? null, {
        pollType: 'yes_no',
        canSubmitSuggestions: false,
        isEditing: !!existing?.voteId,
      }));
    }
    return items;
  };

  // Atomic on the server: any item failure rolls back the whole batch.
  const confirmMultipollSubmit = async (
    multipollId: string,
    subPolls: Poll[],
    preparedNonYesNo: PreparedNonYesNoEntry[],
  ) => {
    setMultipollSubmitting((prev) => {
      if (prev.has(multipollId)) return prev;
      const next = new Set(prev);
      next.add(multipollId);
      return next;
    });
    setMultipollSubmitError((prev) => {
      if (!prev.has(multipollId)) return prev;
      const next = new Map(prev);
      next.delete(multipollId);
      return next;
    });
    try {
      const yesNoItems = buildYesNoMultipollItems(subPolls);
      const nonYesNoItems = preparedNonYesNo.map((p) => p.item);
      const items: MultipollVoteItem[] = [...yesNoItems, ...nonYesNoItems];
      if (items.length === 0) {
        setPendingMultipollSubmit(null);
        return;
      }
      const voterNameRaw = multipollVoterNames.get(multipollId) ?? getUserName() ?? '';
      const voter_name = voterNameRaw.trim() || null;
      const returnedVotes = await apiSubmitMultipollVotes(multipollId, { voter_name, items });

      const subPollById = new Map(subPolls.map((sp) => [sp.id, sp]));
      setUserVoteMap((prev) => {
        const next = new Map(prev);
        for (const v of returnedVotes) {
          const sp = subPollById.get(v.poll_id);
          if (!sp || sp.poll_type !== 'yes_no') continue;
          next.set(sp.id, {
            choice: parseYesNoChoice(v),
            voteId: v.id,
            voterName: v.voter_name ?? null,
          });
        }
        return next;
      });

      const returnedByPollId = new Map(returnedVotes.map((v) => [v.poll_id, v]));
      for (const prepared of preparedNonYesNo) {
        const v = returnedByPollId.get(prepared.pollId);
        if (v) prepared.commit(v);
      }

      for (const v of returnedVotes) {
        setStoredVoteId(v.poll_id, v.id);
        setVotedPollFlag(v.poll_id, v.is_abstain ? 'abstained' : true);
      }
      const fresh = loadVotedPolls();
      setVotedPollIds(fresh.votedPollIds);
      setAbstainedPollIds(fresh.abstainedPollIds);

      setPendingMultipollChoices((prev) => {
        let mutated = false;
        for (const sp of subPolls) {
          if (prev.has(sp.id)) { mutated = true; break; }
        }
        if (!mutated) return prev;
        const next = new Map(prev);
        for (const sp of subPolls) next.delete(sp.id);
        return next;
      });

      if (voter_name) saveUserName(voter_name);

      for (const v of returnedVotes) {
        window.dispatchEvent(new CustomEvent(POLL_VOTES_CHANGED_EVENT, { detail: { pollId: v.poll_id } }));
      }

      setPendingMultipollSubmit(null);
    } catch (err: unknown) {
      console.error('Multipoll vote submit failed:', err);
      const message = err instanceof Error ? err.message : 'Submit failed.';
      for (const prepared of preparedNonYesNo) prepared.fail(message);
      setMultipollSubmitError((prev) => { const next = new Map(prev); next.set(multipollId, message); return next; });
    } finally {
      setMultipollSubmitting((prev) => {
        if (!prev.has(multipollId)) return prev;
        const next = new Set(prev);
        next.delete(multipollId);
        return next;
      });
    }
  };

  const confirmVoteChange = async () => {
    if (!pendingVoteChange) return;
    const { pollId, newChoice } = pendingVoteChange;
    const current = userVoteMap.get(pollId);
    const subPoll = thread?.polls.find((p) => p.id === pollId);
    const multipollId = subPoll?.multipoll_id ?? null;
    if (!multipollId) {
      // Phase 5: every poll has a multipoll wrapper, so this branch is dead.
      // Surface as a runtime error rather than silently dropping the vote.
      console.error('confirmVoteChange called for poll without multipoll_id');
      return;
    }
    setVoteChangeSubmitting(true);
    try {
      // Route every yes_no tap-to-change through the unified multipoll endpoint
      // as a single-item batch. Matches the architectural "vote submission is
      // always atomic across the multipoll" rule (see CLAUDE.md → Multipoll
      // System), even when the multipoll has only one sub-poll.
      const voter_name = current
        ? current.voterName
        : (getUserName()?.trim() || null);
      const voteData = {
        vote_type: 'yes_no' as const,
        yes_no_choice: newChoice === 'abstain' ? null : newChoice,
        is_abstain: newChoice === 'abstain',
      };
      const item = buildMultipollVoteItem(voteData, pollId, current?.voteId ?? null, {
        pollType: 'yes_no',
        canSubmitSuggestions: false,
        isEditing: !!current?.voteId,
      });
      const returned = await apiSubmitMultipollVotes(multipollId, { voter_name, items: [item] });
      const v = returned.find((r) => r.poll_id === pollId);
      if (!v) throw new Error('Vote response missing for sub-poll');
      const resultVoteId = v.id;
      const resultVoterName = v.voter_name ?? null;
      if (!current) setStoredVoteId(pollId, resultVoteId);
      if (voter_name) saveUserName(voter_name);
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
  // Phase 5b: open/closed is multipoll-level — every sub-poll inherits its
  // wrapper's is_closed + response_deadline.
  const now = new Date();
  const multipollByPollId = useMemo(() => {
    const map = new Map<string, Multipoll>();
    if (!thread) return map;
    for (const mp of thread.multipolls) {
      for (const sp of mp.sub_polls) map.set(sp.id, mp);
    }
    return map;
  }, [thread]);
  const wrapperFor = (poll: Poll): Multipoll | null =>
    multipollByPollId.get(poll.id) ?? (poll.multipoll_id ? multipollWrapperMap.get(poll.multipoll_id) ?? null : null);
  const isPollOpen = (poll: Poll) => {
    const mp = wrapperFor(poll);
    if (!mp) return true;
    return mp.response_deadline ? new Date(mp.response_deadline) > now && !mp.is_closed : !mp.is_closed;
  };
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

  // Phase 5b: multipoll wrappers ride along on the thread state directly
  // (returned in bulk from /api/polls/accessible). Build a quick id → wrapper
  // map for the existing callsites that look one up. Voter aggregates stay
  // fresh via the POLL_VOTES_CHANGED_EVENT handler below, which refetches
  // affected wrappers and merges them back into thread.multipolls.
  const multipollWrapperMap = useMemo(
    () => (thread ? buildMultipollMap(thread.multipolls) : new Map<string, Multipoll>()),
    [thread],
  );

  // Phase 3.2: group sibling sub-polls of a multipoll into a single visual
  // card group. 1-sub-poll wrappers (the post-Phase-4 norm) render identically
  // to today — anchor === only sub-poll, no section labels, no aggregation.
  // Multi-sub-poll wrappers render one card with stacked sub-poll sections
  // inside the expand clip and a multipoll-level respondent row below.
  //
  // Phase 5b: each group also carries the wrapper Multipoll so callsites can
  // read wrapper-level fields (is_closed, response_deadline, ...) directly
  // instead of looking them up via the cache.
  const groupedThreadPolls = useMemo(() => {
    type Group = {
      key: string;
      multipollId: string | null;
      multipoll: Multipoll | null;
      subPolls: Poll[];
      anchor: Poll;
    };
    const groups: Group[] = [];
    const seen = new Set<string>();
    for (const poll of threadPolls) {
      const groupKey = poll.multipoll_id ?? `solo-${poll.id}`;
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      const subPolls = poll.multipoll_id
        ? threadPolls
            .filter((p) => p.multipoll_id === poll.multipoll_id)
            .sort((a, b) => (a.sub_poll_index ?? 0) - (b.sub_poll_index ?? 0))
        : [poll];
      const multipoll = poll.multipoll_id
        ? (multipollWrapperMap.get(poll.multipoll_id) ?? null)
        : null;
      groups.push({
        key: groupKey,
        multipollId: poll.multipoll_id ?? null,
        multipoll,
        subPolls,
        anchor: subPolls[0],
      });
    }
    return groups;
  }, [threadPolls, multipollWrapperMap]);

  // Refetch on vote-change events: when any sub-poll's votes change, the
  // wrapper's voter_names may have shifted. Refresh affected multipoll
  // wrappers — cheap because the request is small and cached. Updates flow
  // through patchThreadMultipolls so the derived map stays in sync.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pollId?: string } | undefined;
      if (!detail?.pollId || !thread) return;
      const poll = thread.polls.find((p) => p.id === detail.pollId);
      const mid = poll?.multipoll_id;
      if (!mid) return;
      void apiGetMultipollById(mid).then((wrapper) => {
        patchThreadMultipolls(
          (mp) => mp.id === mid,
          () => ({
            voter_names: wrapper.voter_names,
            anonymous_count: wrapper.anonymous_count,
            sub_polls: wrapper.sub_polls,
          }),
        );
      }).catch(() => null);
    };
    window.addEventListener(POLL_VOTES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(POLL_VOTES_CHANGED_EVENT, handler);
  }, [thread, patchThreadMultipolls]);

  // Sync the URL to reflect which card is expanded, using shallow history.replaceState
  // so Next.js doesn't unmount/remount on URL change. Sharing the URL reopens the
  // same expanded card.
  // Phase 5b: short_id lives on the multipoll wrapper. Use the expanded card's
  // multipoll short_id; fall back to the sub-poll uuid if the wrapper isn't
  // available.
  useEffect(() => {
    if (typeof window === 'undefined' || !thread) return;
    let nextPath: string;
    if (expandedPollId) {
      const expandedPoll = thread.polls.find((p) => p.id === expandedPollId);
      const wrapper = expandedPoll ? wrapperFor(expandedPoll) : null;
      const routeId = wrapper?.short_id || expandedPollId;
      nextPath = `/p/${routeId}/`;
    } else {
      nextPath = `/thread/${threadId}/`;
    }
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(window.history.state, '', nextPath + window.location.search + window.location.hash);
    }
  // wrapperFor reads multipollByPollId/multipollWrapperMap which both derive
  // from `thread`, so the existing thread dep covers wrapper lookups too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <ThreadHeader
        headerRef={headerRef}
        title={thread.title}
        participantNames={thread.participantNames}
        anonymousCount={thread.anonymousRespondentCount}
        subtitle={`${thread.polls.length} ${thread.polls.length === 1 ? 'poll' : 'polls'}`}
        onTitleClick={() => navigateWithTransition(router, `/thread/${threadId}/info`, 'forward')}
      />

      {/* paddingTop reserves space for the fixed header above. */}
      <div className="pb-2" style={{ paddingTop: `calc(${headerHeight}px + 0.5rem)` }}>
        {groupedThreadPolls.map((group) => {
            const poll = group.anchor;
            const isMultiGroup = group.subPolls.length > 1;
            const wrapper = group.multipoll;
            const isOpen = isPollOpen(poll);
            const isClosed = !isOpen;
            const isAwaiting = isAwaitingResponse(poll);
            // Wrapper-level reads (Phase 5b). Hoisted here so every callsite
            // inside this card iteration can use them without re-deriving.
            const wrapperResponseDeadline = wrapper?.response_deadline ?? null;
            const wrapperPrephaseDeadline = wrapper?.prephase_deadline ?? null;
            const wrapperCloseReason = wrapper?.close_reason ?? null;
            const wrapperUpdatedAt = wrapper?.updated_at ?? poll.updated_at;

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
                  {getCategoryIcon(poll, isClosed)}
                </div>

                {/* Row 1 used to hold the above-card status label; the
                     label now lives in the card's footer row (see below).
                     Creator + date moved to row 3 alongside respondents
                     (commit d44c6f4 on main). Row 1 is intentionally empty. */}

                <div
                  className={`col-start-2 row-start-2 min-w-0 px-2 pt-1.5 ${isExpanded ? 'pb-1.5' : 'pb-0.5'} rounded-2xl border shadow-sm ${isAwaiting ? 'border-amber-400 dark:border-amber-500' : 'border-gray-200 dark:border-gray-800'} ${pressedPollId === poll.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-900'} ${!isExpanded ? 'hover:bg-gray-200 dark:hover:bg-gray-800 active:bg-blue-100 dark:active:bg-blue-900/40' : ''} transition-colors select-none relative`}
                >
                  {/* Compact header — click/touch + long-press live here so they work
                       whether the card is collapsed or expanded without interfering
                       with interactive elements inside the expanded SubPollBallot. */}
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
                        url={(() => {
                          if (typeof window === 'undefined') return '';
                          // Phase 5b: short_id lives on the multipoll wrapper.
                          const shortId = wrapper?.short_id || poll.id;
                          return `${window.location.origin}/p/${shortId}/`;
                        })()}
                      />
                    </div>
                  </div>
                  {/* Footer row: status label on the left (countdown /
                       "Closed X ago" / "Taking Suggestions" / "Collecting
                       Availability" / etc.) and the poll-type-specific
                       compact pill on the right. The pill collapses to 0
                       height when the card is expanded (inverse grid-rows
                       clip for ranked_choice / suggestion / time; the
                       yes_no compact pill is simply not rendered when
                       expanded since the full cards appear below). If the
                       row would be empty (no status AND no pill) it's not
                       rendered, so the gap doesn't appear. */}
                  {(() => {
                    const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation();

                    // Status label is anchor-based: the multipoll's voting
                    // and prephase deadlines are shared across sub-polls
                    // (per the multipoll design), and `isClosed` is enforced
                    // multipoll-atomically by Phase 3.1 close/reopen.
                    const statusEl: React.ReactNode = (() => {
                      const inSuggestions = isInSuggestionPhase(poll, wrapperPrephaseDeadline);
                      const inTimeAvailability = isInTimeAvailabilityPhase(poll);
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
                      if (inSuggestions && poll.suggestion_deadline_minutes) {
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

                    // Returns the type-specific compact pill JSX for one sub-poll,
                    // or null when there's nothing to show yet (no votes, no
                    // suggestions, etc.). Yes/No pills wrap in a stopBubble
                    // div because their option cards are tappable; the other
                    // pill types are display-only and bubble taps to the
                    // card's expand handler.
                    const pillForSubPoll = (sp: Poll): React.ReactNode => {
                      const r = pollResultsMap.get(sp.id);
                      const inSuggestions = isInSuggestionPhase(sp, wrapperPrephaseDeadline);
                      const inTimeAvailability = isInTimeAvailabilityPhase(sp);
                      if (sp.poll_type === 'yes_no') {
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
                            <PollResultsDisplay
                              results={r!}
                              isPollClosed={isClosed}
                              hideLoser={true}
                              userVoteChoice={userVote?.choice ?? null}
                              onVoteChange={
                                isClosed
                                  ? undefined
                                  : (newChoice) => setPendingVoteChange({ pollId: sp.id, newChoice })
                              }
                            />
                          </div>
                        );
                      }
                      if (sp.poll_type === 'ranked_choice' && r) {
                        const hasPreview = inSuggestions
                          ? (r.suggestion_counts || []).length > 0
                          : (r.total_votes || 0) > 0 && !!r.winner && r.winner !== 'tie';
                        if (!hasPreview) return null;
                        return inSuggestions ? (
                          <CompactSuggestionPreview results={r} />
                        ) : (
                          <CompactRankedChoicePreview results={r} isPollClosed={isClosed} />
                        );
                      }
                      if (sp.poll_type === 'time' && r && !inTimeAvailability) {
                        const hasPreview = (r.total_votes || 0) > 0 && !!r.winner;
                        if (!hasPreview) return null;
                        return <CompactTimePreview results={r} isPollClosed={isClosed} />;
                      }
                      return null;
                    };

                    let pillEl: React.ReactNode = null;
                    if (!isMultiGroup) {
                      // Single-sub-poll group: preserve the existing
                      // per-type clip behavior. yes_no has no clip — the
                      // pill is simply omitted when expanded because the
                      // full cards take over below the row.
                      const anchorPill = pillForSubPoll(poll);
                      if (anchorPill) {
                        if (poll.poll_type === 'yes_no') {
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
                      // Multi-sub-poll group: stack one pill per sub-poll
                      // vertically inside a single CompactPreviewClip so
                      // the whole column animates to 0 in lockstep with
                      // the heavy expand clip below. Sub-polls without
                      // any data yet (no votes / no suggestions) drop
                      // their row so the column stays compact.
                      const subPills = group.subPolls.map((sp) => {
                        const node = pillForSubPoll(sp);
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

                  {/* Expanded full-poll content — pre-mounted (clipped) once the card
                       enters the viewport so fetches + effects complete before expansion.
                       Animates height via grid-template-rows 0fr ↔ 1fr with overflow
                       hidden on the child, so the natural expanded height is used
                       without JS measurement. */}
                  {(visiblePollIds.has(poll.id) || isExpanded) && (() => {
                    // For yes_no polls the thread view renders the whole
                    // voting + results UI externally (via YesNoResults inline
                    // before SubPollBallot), so SubPollBallot returns null
                    // for its yes_no branch. Drop the mt-1.5 wrapper gap when
                    // every sub-poll is yes_no so nothing empty sits under
                    // the external block.
                    const allYesNo = group.subPolls.every((sp) => sp.poll_type === 'yes_no');
                    const useMultipollSubmit = isMultiGroup && !!group.multipollId;
                    const useWrapperSubmit = !isMultiGroup && !!group.multipollId && group.subPolls[0]?.poll_type !== 'yes_no';
                    const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation();
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
                          <div className={allYesNo && !useMultipollSubmit ? '' : 'mt-1.5'}>
                            {group.subPolls.map((sp, idx) => {
                              // Phase 3.3: every yes_no sub-poll uses external
                              // rendering so non-anchor sub-polls also get the
                              // thread-page tap-to-change flow.
                              const isYesNo = sp.poll_type === 'yes_no';
                              const r = isYesNo ? pollResultsMap.get(sp.id) : undefined;
                              const userVote = isYesNo ? userVoteMap.get(sp.id) : undefined;
                              return (
                                <div
                                  key={sp.id}
                                  className={isMultiGroup && idx > 0 ? 'mt-4 pt-3 border-t border-gray-200 dark:border-gray-800' : ''}
                                >
                                  {isMultiGroup && (
                                    // Per-sub-poll section label inside the
                                    // grouped card. Shows the category icon
                                    // + the sub-poll's `details` (its
                                    // disambiguation context); falls back to
                                    // category when details is empty.
                                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                      <span className="text-base leading-none">{getCategoryIcon(sp, isClosed)}</span>
                                      <span className="truncate">
                                        {(sp.details && sp.details.trim()) || sp.category || sp.poll_type.replace('_', '/')}
                                      </span>
                                    </div>
                                  )}
                                  {isYesNo && isExpanded && r && (() => {
                                    // For all-yes_no multi-groups, the displayed
                                    // selection prefers a staged choice (taps
                                    // queued for the wrapper-level Submit) over
                                    // the persisted vote.
                                    const stagedChoice = useMultipollSubmit
                                      ? pendingMultipollChoices.get(sp.id) ?? null
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
                                        <PollResultsDisplay
                                          results={r}
                                          isPollClosed={isClosed}
                                          hideLoser={false}
                                          userVoteChoice={displayedChoice}
                                          onVoteChange={
                                            isClosed
                                              ? undefined
                                              : (newChoice) => {
                                                  if (useMultipollSubmit) {
                                                    setPendingMultipollChoices((prev) => {
                                                      if (prev.get(sp.id) === newChoice) return prev;
                                                      const next = new Map(prev);
                                                      next.set(sp.id, newChoice);
                                                      return next;
                                                    });
                                                  } else {
                                                    setPendingVoteChange({ pollId: sp.id, newChoice });
                                                  }
                                                }
                                          }
                                        />
                                      </div>
                                    );
                                  })()}
                                  {(() => {
                                    // Yes_no sub-polls render externally via PollResultsDisplay
                                    // (Phase 3.3) — they don't have an inline Submit to suppress.
                                    const wrapperOwnsSubmit = !!group.multipollId && (
                                      useWrapperSubmit ||
                                      (useMultipollSubmit && !isYesNo)
                                    );
                                    const wrapperVoterName = wrapperOwnsSubmit
                                      ? (multipollVoterNames.get(group.multipollId!) ?? getUserName() ?? '')
                                      : undefined;
                                    const setWrapperVoterName = wrapperOwnsSubmit
                                      ? ((name: string) => setMultipollVoterName(group.multipollId!, name))
                                      : undefined;
                                    // Phase 5b: every poll has a multipoll
                                    // wrapper post-Phase-4 backfill, so this
                                    // assertion is safe in practice.
                                    if (!wrapper) return null;
                                    return (
                                      <SubPollBallot
                                        ref={(handle) => {
                                          if (handle) subPollBallotRefs.current.set(sp.id, handle);
                                          else subPollBallotRefs.current.delete(sp.id);
                                        }}
                                        poll={sp}
                                        multipoll={wrapper}
                                        createdDate={formatCreationTimestamp(sp.created_at)}
                                        pollId={sp.id}
                                        externalYesNoResults={isYesNo}
                                        isExpanded={isExpanded}
                                        partOfMultipollGroup={isMultiGroup}
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
                            {useMultipollSubmit && group.multipollId && !isClosed && (() => {
                              const multipollId = group.multipollId;
                              const hasYesNoStaged = group.subPolls.some((sp) => sp.poll_type === 'yes_no' && pendingMultipollChoices.has(sp.id));
                              const hasNonYesNoReady = group.subPolls.some(
                                (sp) => sp.poll_type !== 'yes_no' && wrapperSubmitState.get(sp.id)?.visible === true,
                              );
                              const hasStagedChange = hasYesNoStaged || hasNonYesNoReady;
                              const submitting = multipollSubmitting.has(multipollId);
                              const submitError = multipollSubmitError.get(multipollId);
                              const voterNameVal = multipollVoterNames.get(multipollId) ?? getUserName() ?? '';
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
                                      setName={(name: string) => setMultipollVoterName(multipollId, name)}
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
                                      for (const sp of group.subPolls) {
                                        if (sp.poll_type === 'yes_no') {
                                          if (pendingMultipollChoices.has(sp.id)) stagedCount++;
                                          continue;
                                        }
                                        const handle = subPollBallotRefs.current.get(sp.id);
                                        if (!handle) continue;
                                        const result = handle.prepareBatchVoteItem();
                                        if ('skip' in result) continue;
                                        if (!result.ok) {
                                          // Error is surfaced inline via SubPollBallot.voteError.
                                          hadValidationError = true;
                                          continue;
                                        }
                                        preparedNonYesNo.push({
                                          pollId: sp.id,
                                          item: result.item,
                                          commit: result.commit,
                                          fail: result.fail,
                                        });
                                        stagedCount++;
                                      }
                                      if (hadValidationError) return;
                                      if (stagedCount === 0) return;
                                      setPendingMultipollSubmit({
                                        multipollId,
                                        subPolls: group.subPolls,
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
                            {useWrapperSubmit && group.multipollId && !isClosed && (() => {
                              const multipollId = group.multipollId;
                              const sp = group.subPolls[0]!;
                              const submitState = wrapperSubmitState.get(sp.id);
                              if (!submitState?.visible) return null;
                              const voterNameVal = multipollVoterNames.get(multipollId) ?? getUserName() ?? '';
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
                                      setName={(name: string) => setMultipollVoterName(multipollId, name)}
                                      maxLength={30}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      subPollBallotRefs.current.get(sp.id)?.triggerSubmit();
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
                     the old fixed max-w-[75%] respondent cap. */}
                <div className="col-start-2 row-start-3 mt-0 px-3 flex items-start gap-2 min-w-0">
                  <ClientOnly fallback={null}>
                    <span className="shrink-0 truncate text-xs text-gray-400 dark:text-gray-500 mt-px">
                      {wrapper?.creator_name && <>{wrapper.creator_name} &middot; </>}
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
                  <ClientOnly fallback={null}>
                    {isMultiGroup ? (
                      // Multipoll-level respondent row. Sourced from the
                      // multipoll wrapper (voter_names + anonymous_count) per
                      // the Addressability paradigm — never aggregated from
                      // sub-poll vote fetches client-side. Falls back to
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
                        pollId={poll.id}
                        singleLine
                        className="flex-1 min-w-0 justify-end mt-[3px]"
                        filter={isInSuggestionPhase(poll, wrapperPrephaseDeadline) ? suggestionPhaseRespondentFilter : undefined}
                        emptyText={isInSuggestionPhase(poll, wrapperPrephaseDeadline) ? 'No suggestions yet' : 'No voters'}
                      />
                    )}
                  </ClientOnly>
                </div>
              </div>
            );
          })}
      </div>

      {/* Thread-aware long-press modal — Copy + Forget, plus Reopen when
           the poll is closed and the current browser is the creator (or dev). */}
      {modalPoll && (() => {
        const modalWrapper = wrapperFor(modalPoll);
        if (!modalWrapper) return null;
        const isModalClosed = !!modalWrapper.is_closed;
        return (
          <FollowUpModal
            isOpen={showModal}
            poll={modalPoll}
            multipoll={modalWrapper}
            totalVotes={pollResultsMap.get(modalPoll.id)?.total_votes}
            onClose={() => setShowModal(false)}
            onDelete={() => setPendingAction({ kind: 'forget', poll: modalPoll })}
            onReopen={
              isModalClosed &&
              (!!getCreatorSecret(modalPoll.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'reopen', poll: modalPoll })
                : undefined
            }
            onClosePoll={
              !isModalClosed &&
              (!!getCreatorSecret(modalPoll.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'close', poll: modalPoll })
                : undefined
            }
            onCutoffAvailability={
              !isModalClosed &&
              isInTimeAvailabilityPhase(modalPoll) &&
              (!!getCreatorSecret(modalPoll.id) || process.env.NODE_ENV === 'development')
                ? () => setPendingAction({ kind: 'cutoff-availability', poll: modalPoll })
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
              const multipollId = action.poll.multipoll_id;
              if (!multipollId) {
                console.error('Cannot reopen poll without multipoll_id');
                return;
              }
              const updated = await apiReopenMultipoll(multipollId, secret);
              patchThreadMultipolls(
                (mp) => mp.id === multipollId,
                () => ({
                  is_closed: false,
                  close_reason: null,
                  response_deadline: updated.response_deadline ?? null,
                }),
              );
            } catch (err) {
              console.error('Failed to reopen poll:', err);
            }
          } else if (action.kind === 'close') {
            try {
              const secret = getCreatorSecret(action.poll.id) || '';
              const multipollId = action.poll.multipoll_id;
              if (!multipollId) {
                console.error('Cannot close poll without multipoll_id');
                return;
              }
              await apiCloseMultipoll(multipollId, secret);
              patchThreadMultipolls(
                (mp) => mp.id === multipollId,
                () => ({ is_closed: true, close_reason: 'manual' }),
              );
            } catch (err) {
              console.error('Failed to close poll:', err);
            }
          } else if (action.kind === 'cutoff-availability') {
            try {
              const secret = getCreatorSecret(action.poll.id);
              if (!secret) {
                console.error('Missing creator secret for cutoff-availability');
                return;
              }
              const multipollId = action.poll.multipoll_id;
              if (!multipollId) {
                console.error('Cannot cutoff availability without multipoll_id');
                return;
              }
              const wrapper = await apiCutoffMultipollAvailability(multipollId, secret);
              const updated = wrapper.sub_polls.find((sp) => sp.id === action.poll.id) ?? null;
              // Wrapper-level prephase_deadline + per-sub-poll options.
              patchThreadMultipolls(
                (mp) => mp.id === multipollId,
                () => ({
                  prephase_deadline: wrapper.prephase_deadline ?? null,
                }),
              );
              if (updated) {
                patchThreadPolls(
                  (p) => p.id === action.poll.id,
                  (p) => ({ options: updated.options ?? p.options }),
                );
              }
              // Refresh the compact preview — the availability phase just ended so
              // time-slot results are now meaningful.
              const refreshed = await apiGetPollResults(action.poll.id).catch(() => null);
              if (refreshed) {
                setPollResultsMap((prev) => {
                  const existing = prev.get(action.poll.id);
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
                  next.set(action.poll.id, refreshed);
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

      {/* Wrapper-level Submit confirmation. subPolls + stagedCount are
          snapshotted at button-tap time so the modal stays consistent if
          groupedThreadPolls re-derives mid-confirmation. */}
      <ConfirmationModal
        isOpen={!!pendingMultipollSubmit}
        title="Submit vote"
        message={
          pendingMultipollSubmit
            ? pendingMultipollSubmit.stagedCount === 1
              ? 'Submit your vote on this poll?'
              : `Submit your vote across ${pendingMultipollSubmit.stagedCount} sub-polls?`
            : ''
        }
        confirmText={pendingMultipollSubmit && multipollSubmitting.has(pendingMultipollSubmit.multipollId) ? 'Submitting…' : 'Submit Vote'}
        cancelText="Cancel"
        confirmButtonClass="bg-blue-600 hover:bg-blue-700 text-white"
        onConfirm={() => {
          if (!pendingMultipollSubmit) return;
          void confirmMultipollSubmit(
            pendingMultipollSubmit.multipollId,
            pendingMultipollSubmit.subPolls,
            pendingMultipollSubmit.preparedNonYesNo,
          );
        }}
        onCancel={() => setPendingMultipollSubmit(null)}
      />
    </>
  );
}

function EmptyThreadView() {
  usePageReady(true);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  return (
    <>
      <ThreadHeader headerRef={headerRef} title="New Thread" />
      <div
        className="px-4 text-center"
        style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }}
      >
        <p className="text-base text-gray-700 dark:text-gray-300">
          Create a poll and then share the link!
        </p>
      </div>
    </>
  );
}

function ThreadPageInner() {
  const params = useParams();
  const threadId = params.threadId as string;
  // /thread/new/ is a placeholder route — same template as a real thread, but
  // no polls, no fetch. The thread only materializes once the user creates a
  // poll (the new poll becomes its own thread root); navigating away leaves
  // nothing behind.
  if (threadId === 'new') return <EmptyThreadView />;
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

"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { GroupSummary, Poll } from "@/lib/types";
import { buildGroups, getGroupHref, getGroupRouteId, isPendingPollId, Group } from "@/lib/groupUtils";
import { loadVotedQuestions } from "@/lib/votedQuestionsStorage";
import GroupListItem from "@/components/GroupListItem";
import ConfirmationModal from "@/components/ConfirmationModal";
import HeaderPortal from "@/components/HeaderPortal";
import { usePrefetch } from "@/lib/prefetch";
import { slideToGroup } from "@/lib/slideOverlay";
import { apiGetVotes, apiGetQuestionResults } from "@/lib/api";
import { forgetGroup } from "@/lib/forgetQuestion";
import { HOME_SELECTION_MODE_CHANGE_EVENT } from "@/lib/eventChannels";
import { haptic } from "@/lib/haptics";

interface GroupListProps {
  // Phase 5b: the home page passes the polls (wrapper-level units)
  // returned by getAccessiblePolls(). buildGroups groups every poll
  // sharing a `group_id`.
  polls: Poll[];
  /** Membership-only "empty groups" the user joined that have no polls
   *  yet (typically just-created via the home "+" FAB). Built into the
   *  same group list so they appear alongside populated groups. */
  emptyGroups?: GroupSummary[];
  /** Called with the poll-ids of every poll in every forgotten group +
   *  the empty-group-ids of every forgotten empty group, so the parent
   *  page can drop them optimistically (avoids a full server round-trip
   *  just to hide deleted rows). A group spans multiple polls sharing a
   *  `group_id`; passing only root ids would leave follow-up polls
   *  behind and rebuild a ghost group. */
  onGroupsForgotten?: (forgottenPollIds: string[], forgottenGroupIds?: string[]) => void;
}

const LONG_PRESS_MS = 500;

export default function GroupList({ polls, emptyGroups = [], onGroupsForgotten }: GroupListProps) {
  const { prefetchBatch } = usePrefetch();
  // Load voted/abstained synchronously so the very first render's
  // buildGroups call sees the real voted state. Initializing these as
  // empty Sets and loading via useEffect would make every question look
  // awaiting on first render — wrong sort order in sortGroupsForHome,
  // golden borders briefly on already-voted cards.
  const [{ votedQuestionIds, abstainedQuestionIds }] = useState(() => {
    if (typeof window === 'undefined') {
      return { votedQuestionIds: new Set<string>(), abstainedQuestionIds: new Set<string>() };
    }
    return loadVotedQuestions();
  });
  const [pressedGroupId, setPressedGroupId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchHandledRef = useRef(false);

  const groups = useMemo(() => {
    return buildGroups(polls, votedQuestionIds, abstainedQuestionIds, emptyGroups);
  }, [polls, votedQuestionIds, abstainedQuestionIds, emptyGroups]);

  // Stable "row id" for selection state, prefetch keys, ref maps, etc.
  // Populated groups use `rootPollId`; empty groups use `groupId` (no
  // polls exist yet). Both produce a single non-null string per group.
  const groupKeyOf = useCallback((group: Group): string => {
    return group.rootPollId ?? group.groupId ?? '';
  }, []);

  // Groups can drop out from under us (deletions, re-fetch). Strip selection
  // ids that no longer correspond to a visible group. (Selection mode stays
  // active even when the set is empty — the user exits explicitly via the
  // upper-left cancel button or Escape.)
  useEffect(() => {
    if (!selectionMode) return;
    const validIds = new Set(groups.map(groupKeyOf));
    setSelectedGroupIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      return next;
    });
  }, [groups, selectionMode, groupKeyOf]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedGroupIds(new Set());
    setConfirmingDelete(false);
  }, []);

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelectionMode();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectionMode, exitSelectionMode]);

  // Tell the template to hide the home-page settings gear while we own the
  // upper-left slot via HeaderPortal. Cleanup always dispatches false so an
  // unmount mid-selection (e.g. navigating away from home) restores the gear
  // for the next home-page mount.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(HOME_SELECTION_MODE_CHANGE_EVENT, { detail: { active: selectionMode } }));
    return () => {
      window.dispatchEvent(new CustomEvent(HOME_SELECTION_MODE_CHANGE_EVENT, { detail: { active: false } }));
    };
  }, [selectionMode]);

  // Prefetch group page routes for all visible groups on mount.
  // `getGroupHref` returns the bare `/g/<root>` form — cards land collapsed
  // until the user taps one.
  useEffect(() => {
    if (groups.length === 0) return;
    const hrefs = groups.map(t => getGroupHref(t));
    prefetchBatch(hrefs, { priority: "low" });
  }, [groups, prefetchBatch]);

  // Warm per-question votes + results for visible groups so the destination
  // renders from cache on first paint. apiGetVotes is coalesced; re-calls are cheap.
  // Empty groups have no questions, so nothing to warm — the observer skips them
  // via the `groupsByRootId` lookup.
  const warmedGroupIdsRef = useRef<Set<string>>(new Set());
  const groupsByRootId = useMemo(
    () => new Map(
      groups
        .filter((t) => t.rootQuestionId)
        .map((t) => [t.rootQuestionId as string, t] as const),
    ),
    [groups],
  );
  useEffect(() => {
    if (groups.length === 0 || typeof window === 'undefined') return;
    if (!('IntersectionObserver' in window)) return;

    warmedGroupIdsRef.current = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const rootQuestionId = entry.target.getAttribute('data-group-root-id');
        if (!rootQuestionId || warmedGroupIdsRef.current.has(rootQuestionId)) continue;
        warmedGroupIdsRef.current.add(rootQuestionId);
        const group = groupsByRootId.get(rootQuestionId);
        if (!group) continue;
        for (const question of group.questions) {
          if (isPendingPollId(question.id)) continue;
          void apiGetVotes(question.id).catch(() => null);
          if (!question.results) void apiGetQuestionResults(question.id).catch(() => null);
        }
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '200px' });

    const els = document.querySelectorAll<HTMLElement>('[data-group-root-id]');
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [groups, groupsByRootId]);

  const cancelLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const enterSelectionWithGroup = useCallback((groupId: string) => {
    setSelectionMode(true);
    setSelectedGroupIds(new Set([groupId]));
    setPressedGroupId(null);
    haptic.medium();
  }, []);

  const toggleGroupSelection = useCallback((groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    haptic.medium();
    const idsToForget = new Set(selectedGroupIds);
    const groupsToForget = groups.filter((t) => idsToForget.has(groupKeyOf(t)));
    const forgottenPollIds: string[] = [];
    const forgottenGroupIds: string[] = [];
    for (const group of groupsToForget) {
      forgetGroup(group);
      for (const poll of group.polls) forgottenPollIds.push(poll.id);
      if (group.isEmpty && group.groupId) {
        forgottenGroupIds.push(group.groupId);
      }
    }
    setConfirmingDelete(false);
    setSelectionMode(false);
    setSelectedGroupIds(new Set());
    onGroupsForgotten?.(forgottenPollIds, forgottenGroupIds);
  }, [selectedGroupIds, groups, onGroupsForgotten, groupKeyOf]);

  if (groups.length === 0) return null;

  // Cancel + trashcan render via HeaderPortal so they sit outside the
  // ResponsiveScaling container — same target the settings-page back arrow
  // uses. The cancel button visually replaces the home page's gear icon.
  const selectedCount = selectedGroupIds.size;
  const trashLabel = selectedCount === 0
    ? 'Forget selected groups (none selected)'
    : `Forget ${selectedCount} selected group${selectedCount === 1 ? '' : 's'}`;
  const selectionChrome = selectionMode ? (
    <HeaderPortal>
      <button
        onClick={exitSelectionMode}
        aria-label="Exit selection mode"
        className="fixed z-50 w-10 h-10 rounded-full flex items-center justify-center bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-200 dark:active:bg-gray-600 text-gray-700 dark:text-gray-200 shadow-md shadow-black/20 transition-colors"
        style={{
          left: 'max(0.5rem, env(safe-area-inset-left, 0px))',
          top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
        }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <button
        onClick={() => setConfirmingDelete(true)}
        disabled={selectedCount === 0}
        aria-label={trashLabel}
        className="fixed z-50 w-12 h-12 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-md shadow-black/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        style={{
          right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
          top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
        }}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        {selectedCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 text-xs font-bold flex items-center justify-center border border-red-600 dark:border-red-500">
            {selectedCount}
          </span>
        )}
      </button>
    </HeaderPortal>
  ) : null;

  return (
    <div>
      {selectionChrome}
      {groups.map((group, index) => {
        const href = getGroupHref(group);
        const latestQuestion = group.latestQuestion;
        const hasUnvoted = group.unvotedCount > 0;
        const groupKey = groupKeyOf(group);

        const handleActivate = () => {
          if (selectionMode) {
            toggleGroupSelection(groupKey);
            return;
          }
          // Overlay-slide: mount destination above current page + start CSS
          // slide on the same frame as the tap. router.push fires in parallel
          // from inside SlideOverlayHost. Eliminates the view-transitions
          // snapshot+commit cost (~250-300ms) before the first frame.
          //
          // expandedQuestionId stays null — the slide-overlay handoff can
          // race with the real-route's `?p=` cache lookup and collapse a
          // pre-expanded card just after the slide settles.
          const groupRouteId = getGroupRouteId(group);
          slideToGroup({ href, groupId: groupRouteId, expandedQuestionId: null });
        };

        const handleClick = () => {
          if (touchHandledRef.current) return;
          handleActivate();
        };

        const handleTouchStart = (e: React.TouchEvent) => {
          isScrolling.current = false;
          longPressFiredRef.current = false;
          touchHandledRef.current = false;
          setPressedGroupId(groupKey);
          touchStartPos.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
          cancelLongPressTimer();
          // Already-selecting taps just toggle; no long-press needed.
          if (!selectionMode) {
            longPressTimerRef.current = setTimeout(() => {
              if (isScrolling.current) return;
              longPressFiredRef.current = true;
              enterSelectionWithGroup(groupKey);
            }, LONG_PRESS_MS);
          }
        };

        const handleTouchEnd = () => {
          cancelLongPressTimer();
          setPressedGroupId(null);
          const wasLongPress = longPressFiredRef.current;
          const wasScrolling = isScrolling.current;
          touchStartPos.current = null;
          isScrolling.current = false;
          touchHandledRef.current = true;
          setTimeout(() => { touchHandledRef.current = false; }, 400);
          if (wasLongPress || wasScrolling) return;
          handleActivate();
        };

        const handleTouchMove = (e: React.TouchEvent) => {
          if (!touchStartPos.current) return;
          const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
          const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
          if (deltaX > 10 || deltaY > 10) {
            isScrolling.current = true;
            setPressedGroupId(null);
            cancelLongPressTimer();
          }
        };

        return (
          <GroupListItem
            key={groupKey}
            groupRootId={group.rootQuestionId ?? group.groupId ?? undefined}
            title={group.title}
            latestQuestionTitle={latestQuestion?.title ?? ''}
            participantNames={group.participantNames}
            anonymousRespondentCount={group.anonymousRespondentCount}
            imageUrl={group.imageUrl}
            createdAt={latestQuestion?.created_at ?? null}
            statusBadge={group.isEmpty ? 'New group — tap to add a poll' : undefined}
            soonestUnvotedDeadline={group.soonestUnvotedDeadline}
            unvotedDeadlineKind={group.unvotedDeadlineKind}
            hasUnvoted={hasUnvoted}
            pressed={pressedGroupId === groupKey}
            isFirst={index === 0}
            selectionMode={selectionMode}
            isSelected={selectedGroupIds.has(groupKey)}
            onClick={handleClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
          />
        );
      })}

      {confirmingDelete && (
        <ConfirmationModal
          isOpen={true}
          title="Forget groups"
          message={`Forget ${selectedGroupIds.size} ${selectedGroupIds.size === 1 ? 'group' : 'groups'}? This removes ${selectedGroupIds.size === 1 ? 'it' : 'them'} from this browser.`}
          confirmText="Forget"
          cancelText="Cancel"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

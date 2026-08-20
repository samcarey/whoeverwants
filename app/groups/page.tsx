"use client";

/**
 * The groups list, moved off home (which is the playlist now) onto its own
 * page, reached from the "people" button at the upper right of home.
 *
 * Built on the /explore + /settings pattern: its own fixed title bar, a
 * floating back button portaled into #header-portal, and a swipe-back gesture
 * that reveals HomeBackdropHost (the playlist) and commits to `/`.
 *
 * The "+ Group" FAB is NOT rendered here — it's the layout-level
 * CreateGroupButtonHost, which shows itself on this route.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GroupSummary, Poll } from "@/lib/types";
import { getCachedEmptyGroups, getMyGroups } from "@/lib/simpleQuestionQueries";
import { getCachedAccessiblePolls } from "@/lib/questionCache";
import {
  HIDE_GROUPS_BACKDROP_EVENT,
  SHOW_HOME_BACKDROP_EVENT,
  HIDE_HOME_BACKDROP_EVENT,
  POLL_HYDRATED_EVENT,
  HOME_SELECTION_MODE_CHANGE_EVENT,
  type HomeSelectionModeChangeDetail,
} from "@/lib/eventChannels";
import {
  useSwipeBackGesture,
  useHeaderPortalRef,
  resetSwipeBackChrome,
} from "@/lib/useSwipeBackGesture";
import { setSwipeScrollbarLock } from "@/lib/scrollbarLock";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { GROUPS_SCROLL_KEY, getRememberedScroll, clearGroupScroll } from "@/lib/scrollMemory";
import { clearGroupTabs } from "@/lib/groupTabMemory";
import { getCachedSessionUser, SESSION_CHANGED_EVENT, type SessionUser } from "@/lib/session";
import HeaderPortal from "@/components/HeaderPortal";
import GroupList from "@/components/GroupList";
import GroupsTitleBar from "@/components/GroupsTitleBar";
import SignInModal from "@/components/SignInModal";

export default function GroupsPage() {
  // Cache-seed avoids a loading flash on every return from a group page.
  const [{ polls: initialPolls, emptyGroups: initialEmptyGroups, loading: initialLoading }] = useState(() => {
    const cachedPolls = typeof window === "undefined" ? null : getCachedAccessiblePolls();
    const cachedEmptyGroups = typeof window === "undefined" ? [] : getCachedEmptyGroups();
    return {
      polls: cachedPolls ?? [],
      emptyGroups: cachedEmptyGroups,
      loading: cachedPolls === null && cachedEmptyGroups.length === 0,
    };
  });
  const router = useRouter();
  const [polls, setPolls] = useState<Poll[]>(initialPolls);
  const [emptyGroups, setEmptyGroups] = useState<GroupSummary[]>(initialEmptyGroups);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  // GroupList's bulk-forget selection mode portals its own cancel (X) into
  // the same upper-left slot as the back button, so the back button hides
  // while it's active — exactly what the home page used to do with its gear.
  const [selectionMode, setSelectionMode] = useState(false);

  usePageReady(true);

  useEffect(() => {
    setSession(getCachedSessionUser());
    const update = () => setSession(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    const handle = (e: Event) => {
      const detail = (e as CustomEvent<HomeSelectionModeChangeDetail>).detail;
      setSelectionMode(!!detail?.active);
    };
    window.addEventListener(HOME_SELECTION_MODE_CHANGE_EVENT, handle as EventListener);
    return () => window.removeEventListener(HOME_SELECTION_MODE_CHANGE_EVENT, handle as EventListener);
  }, []);

  // Dismiss the group→/groups swipe backdrop once we've rendered through it,
  // and clear any chrome transform the gesture left behind (the source page
  // has unmounted by now, so its own cleanup never ran). Same shape as the
  // home page's mount effect.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    resetSwipeBackChrome();
    setSwipeScrollbarLock(false);
    window.dispatchEvent(new Event(HIDE_GROUPS_BACKDROP_EVENT));
  }, []);

  // Restore the scroll saved when navigating into a group, then reset every
  // group's remembered scroll + tab — coming back to the LIST ends that
  // browsing session, so re-entering a group starts fresh. (This lifecycle
  // used to live on home, back when home was the group list.)
  const hasRestoredScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;
    const remembered = getRememberedScroll(GROUPS_SCROLL_KEY);
    if (remembered !== undefined) window.scrollTo(0, remembered);
    clearGroupScroll();
    clearGroupTabs();
  }, []);

  const fetchGroups = useCallback(async (opts?: { isRetry?: boolean }) => {
    if (initialLoading || opts?.isRetry) setLoading(true);
    setError(null);

    const retryDelaysMs = [500, 1000, 2000];
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        const { polls: nextPolls, emptyGroups: nextEmptyGroups } = await getMyGroups();
        // Preserve array identity when unchanged so GroupList's memo can skip
        // re-rendering every card.
        setPolls((prev) =>
          prev.length === nextPolls.length && prev.every((p, i) => p.id === nextPolls[i].id)
            ? prev
            : nextPolls,
        );
        setEmptyGroups((prev) =>
          prev.length === nextEmptyGroups.length && prev.every((g, i) => g.id === nextEmptyGroups[i].id)
            ? prev
            : nextEmptyGroups,
        );
        setLoading(false);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < retryDelaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
        }
      }
    }

    console.error("Unexpected error:", lastError);
    setError("Couldn't load your groups. Check your connection and try again.");
    setLoading(false);
  }, [initialLoading]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  // Sign-in / sign-out completes in place (modal, no remount), so re-fetch.
  useEffect(() => {
    const refetch = () => void fetchGroups();
    window.addEventListener(SESSION_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, refetch);
  }, [fetchGroups]);

  // A poll created elsewhere (e.g. from /g) can add a group to this list.
  useEffect(() => {
    const handler = async () => {
      try {
        const { polls: nextPolls, emptyGroups: nextEmptyGroups } = await getMyGroups();
        setPolls((prev) =>
          prev.length === nextPolls.length && prev.every((p, i) => p.id === nextPolls[i].id)
            ? prev
            : nextPolls,
        );
        setEmptyGroups((prev) =>
          prev.length === nextEmptyGroups.length && prev.every((g, i) => g.id === nextEmptyGroups[i].id)
            ? prev
            : nextEmptyGroups,
        );
      } catch {}
    };
    window.addEventListener(POLL_HYDRATED_EVENT, handler);
    return () => window.removeEventListener(POLL_HYDRATED_EVENT, handler);
  }, []);

  // Swipe-back → home (the playlist), mirroring /explore and /settings.
  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  return (
    <>
      <HeaderPortal>
        <GroupsTitleBar fixed />
        {!selectionMode && (
          <button
            onClick={() => navigateWithTransition(router, "/", "back")}
            className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
            aria-label="Go back"
          >
            <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </HeaderPortal>

      {/* z-index:2 + opaque background keeps the home backdrop hidden behind
          the page until the swipe moves the wrapper sideways (z-2, not z-1,
          so the "+ Group" FAB can sit between them). The negative margins
          cancel the template wrapper's px-4 plus the outer safe-area padding
          so the background reaches both screen edges; the inner div re-applies
          the safe-area inset. */}
      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          style={{
            paddingLeft: "max(0.35rem, env(safe-area-inset-left, 0px))",
            paddingRight: "max(0.35rem, env(safe-area-inset-right, 0px))",
            // Clear the fixed title bar (safe-area inset + the h-14 row).
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)",
            // Room for the floating "+ Group" button at scroll-bottom.
            paddingBottom: "6rem",
          }}
        >
          {loading && (
            <div className="flex justify-center items-center py-8">
              <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-center">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => fetchGroups({ isRetry: true })}
                className="mt-3 inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && polls.length === 0 && emptyGroups.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">You don&apos;t have access to any groups</p>
              {!session && (
                <button
                  type="button"
                  onClick={() => setSignInOpen(true)}
                  className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  Sign In
                </button>
              )}
            </div>
          )}

          {!loading && !error && (
            <GroupList
              polls={polls}
              emptyGroups={emptyGroups}
              onGroupsForgotten={(forgottenPollIds, forgottenGroupIds) => {
                // Optimistic drop — forgetGroup already invalidated the
                // caches, so the next natural refresh re-syncs.
                const forgottenPolls = new Set(forgottenPollIds);
                setPolls((prev) => prev.filter((p) => !forgottenPolls.has(p.id)));
                if (forgottenGroupIds && forgottenGroupIds.length > 0) {
                  const forgottenGroups = new Set(forgottenGroupIds);
                  setEmptyGroups((prev) => prev.filter((g) => !forgottenGroups.has(g.id)));
                }
              }}
            />
          )}

          <SignInModal isOpen={signInOpen} onClose={() => setSignInOpen(false)} />
        </div>
      </div>
    </>
  );
}

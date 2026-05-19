"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GroupSummary, Poll } from "@/lib/types";
import { getCachedEmptyGroups, getMyGroups } from "@/lib/simpleQuestionQueries";
import { apiGetAllQuestionIds } from "@/lib/api";
import { addAccessibleQuestionId } from "@/lib/browserQuestionAccess";
import { getCachedAccessiblePolls } from "@/lib/questionCache";
import { HIDE_HOME_BACKDROP_EVENT, POLL_HYDRATED_EVENT } from "@/lib/eventChannels";
import { usePageReady } from "@/lib/usePageReady";
import { HOME_SCROLL_KEY, getRememberedScroll } from "@/lib/scrollMemory";
import GroupList from "@/components/GroupList";

// Fun activity phrases (max 25 chars)
const activityPhrases = [
  "Pizza",
  "to see a movie",
  "to hang out", 
  "Coffee",
  "to play games",
  "Ice Cream",
  "to grab lunch",
  "Tacos",
  "to go bowling",
  "to hike",
  "Sushi",
  "to watch the game",
  "Happy Hour drinks",
  "to play basketball",
  "Brunch",
  "to hit the beach",
  "to try that new place",
  "to go dancing",
  "BBQ",
  "to play mini golf"
];

export default function Home() {
  // Cache-seed avoids loading flash on view-transition return from a group.
  const [{ polls: initialPolls, emptyGroups: initialEmptyGroups, loading: initialLoading }] = useState(() => {
    const cachedPolls = typeof window === "undefined" ? null : getCachedAccessiblePolls();
    const cachedEmptyGroups = typeof window === "undefined" ? [] : getCachedEmptyGroups();
    return {
      polls: cachedPolls ?? [],
      emptyGroups: cachedEmptyGroups,
      loading: cachedPolls === null && cachedEmptyGroups.length === 0,
    };
  });
  const [polls, setPolls] = useState<Poll[]>(initialPolls);
  const [emptyGroups, setEmptyGroups] = useState<GroupSummary[]>(initialEmptyGroups);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const [currentPhrase, setCurrentPhrase] = useState<string>("");
  const [displayedPhrase, setDisplayedPhrase] = useState<string>("");
  const [fontSize, setFontSize] = useState<string>("text-xl");

  usePageReady(true);

  // Dismiss the swipe-back home backdrop on mount. The backdrop persists
  // across the router.push that commits the swipe (mounted at layout
  // level via HomeBackdropHost) so there's no blank frame between
  // GroupContent unmount and this page's first paint; once we've rendered
  // we tell the host to unmount. Inside useLayoutEffect so the dispatch
  // happens before the browser paints (otherwise the backdrop briefly
  // sits over the rendered home page).
  //
  // Also resets the commit-age badge's swipe transform here — the badge
  // portal lives in the persistent template chrome (shared with the
  // group page), so any translateX the group's swipe applied to it
  // would otherwise strand it off-screen on home. Resetting in the same
  // useLayoutEffect that dismisses the backdrop syncs both transitions
  // into the same paint pass.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const badge = document.getElementById('commit-badge-portal');
    if (badge) {
      badge.style.transform = '';
      badge.style.transition = '';
    }
    window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT));
  }, []);

  // Restore the scroll position saved when navigating away to a group
  // page. Fires synchronously before paint via `useLayoutEffect` and is
  // ref-guarded so it runs at most once per mount (StrictMode commits
  // the effect twice in dev). Falling back when no value is remembered
  // leaves the browser's default at-top scroll alone.
  const hasRestoredScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;
    const remembered = getRememberedScroll(HOME_SCROLL_KEY);
    if (remembered !== undefined) {
      window.scrollTo(0, remembered);
    }
  }, []);

  // Initialize and rotate phrases
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const STORAGE_KEY = 'whoeverwants_phrases';
    const INDEX_KEY = 'whoeverwants_phrase_index';
    
    // Get or initialize the randomized phrase list
    let storedPhrases = localStorage.getItem(STORAGE_KEY);
    let phraseList: string[];
    
    if (!storedPhrases) {
      // First time: randomize the array
      phraseList = [...activityPhrases].sort(() => Math.random() - 0.5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(phraseList));
    } else {
      phraseList = JSON.parse(storedPhrases);
    }
    
    // Get current index and increment
    let currentIndex = parseInt(localStorage.getItem(INDEX_KEY) || '0');
    const nextIndex = (currentIndex + 1) % phraseList.length;
    localStorage.setItem(INDEX_KEY, nextIndex.toString());
    
    // Calculate font size for blue phrase only to prevent wrapping on second line
    const bluePhrase = phraseList[currentIndex];
    let calculatedBlueFontSize = "text-xl";
    if (bluePhrase.length > 20) {
      calculatedBlueFontSize = "text-base";
    } else if (bluePhrase.length > 15) {
      calculatedBlueFontSize = "text-lg";  
    } else if (bluePhrase.length > 12) {
      calculatedBlueFontSize = "text-xl";
    }

    setFontSize(calculatedBlueFontSize);
    setCurrentPhrase(phraseList[currentIndex]);
  }, []);

  // Animate the phrase typing effect
  useEffect(() => {
    if (!currentPhrase) return;
    
    setDisplayedPhrase(""); // Reset displayed phrase
    
    // Wait before starting the typing animation
    const initialDelay = setTimeout(() => {
      let currentIndex = 0;
      
      // Calculate delay per character to make total animation time constant (630ms)
      const totalAnimationTime = 630;
      const charDelay = totalAnimationTime / currentPhrase.length;
      
      const typeInterval = setInterval(() => {
        if (currentIndex <= currentPhrase.length) {
          setDisplayedPhrase(currentPhrase.slice(0, currentIndex));
          currentIndex++;
        } else {
          clearInterval(typeInterval);
        }
      }, charDelay);
      
      return () => clearInterval(typeInterval);
    }, 392); // 392ms initial delay
    
    return () => clearTimeout(initialDelay);
  }, [currentPhrase]);

  // Inject only the dynamic blue phrase
  useEffect(() => {
    const phraseContainer = document.getElementById('home-phrase-content');
    if (phraseContainer && displayedPhrase) {
      phraseContainer.innerHTML = `<div class="text-blue-600 dark:text-blue-400 ${fontSize} font-bold" style="font-family: 'M PLUS 1 Code', monospace">${displayedPhrase}</div>`;
    }
  }, [fontSize, displayedPhrase]);

  // Fetch questions
  useEffect(() => {
    async function fetchQuestions() {
      try {
        // Only show the spinner when there's no cached data to render —
        // otherwise mounting home (e.g. after a swipe-back from a group)
        // would flash the GroupList off-screen for one render cycle while
        // the refetch round-trips, then flash it back when the same data
        // returns from the cache-warmed endpoint.
        const hasCached = initialPolls.length > 0 || initialEmptyGroups.length > 0;
        if (!hasCached) setLoading(true);
        setError(null);

        // Dev mode: if ?dev=1 in URL, import all question IDs from the database
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          if (params.get('dev') === '1') {
            const allIds = await apiGetAllQuestionIds();
            if (allIds.length > 0) {
              for (const id of allIds) {
                addAccessibleQuestionId(id);
              }
              // Remove ?dev=1 from URL without reload
              params.delete('dev');
              const newUrl = params.toString()
                ? `${window.location.pathname}?${params}`
                : window.location.pathname;
              window.history.replaceState({}, '', newUrl);
            }
          }
        }

        // Phase B.3: one round-trip — server walks polls.group_id and
        // returns every poll in any group containing one of our
        // accessible questions, with results inline. Replaces the legacy
        // discoverRelatedQuestions + getAccessiblePolls pair.
        const { polls: nextPolls, emptyGroups: nextEmptyGroups } = await getMyGroups();
        // Preserve previous array identity when the data is unchanged so
        // GroupList's memo can skip re-rendering every card on every mount.
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
      } catch (error) {
        console.error("Unexpected error:", error);
        setError("An unexpected error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchQuestions();
  }, []);

  // Live-refresh the polls list on poll creation. User submits from /g
  // (empty placeholder), router.replace lands them on /g/<short_id>, and
  // when they navigate home the list would otherwise be stale until refresh.
  // POLL_FAILED is intentionally not listened to: placeholder polls never
  // reach the home cache, so a failure can't change the home list.
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


  return (
    <>

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
          {error}
        </div>
      )}

      {!loading && !error && polls.length === 0 && emptyGroups.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Once you create a question or open a link from someone, it will be shown here.
        </div>
      )}

      {!loading && !error && (
        <GroupList
          polls={polls}
          emptyGroups={emptyGroups}
          onGroupsForgotten={(forgottenPollIds, forgottenGroupIds) => {
            // Drop the forgotten groups optimistically — caches were
            // already invalidated inside forgetGroup, so the next natural
            // refresh re-syncs; no immediate fetch needed.
            const forgottenPolls = new Set(forgottenPollIds);
            setPolls((prev) => prev.filter((p) => !forgottenPolls.has(p.id)));
            if (forgottenGroupIds && forgottenGroupIds.length > 0) {
              const forgottenGroups = new Set(forgottenGroupIds);
              setEmptyGroups((prev) => prev.filter((g) => !forgottenGroups.has(g.id)));
            }
          }}
        />
      )}

    </>
  );
}
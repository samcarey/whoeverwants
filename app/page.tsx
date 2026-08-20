"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getMyGroups } from "@/lib/simpleQuestionQueries";
import { HIDE_HOME_BACKDROP_EVENT } from "@/lib/eventChannels";
import { resetSwipeBackChrome } from "@/lib/useSwipeBackGesture";
import { usePageReady } from "@/lib/usePageReady";
import { HOME_SCROLL_KEY, getRememberedScroll } from "@/lib/scrollMemory";
import PlaylistTab from "@/components/PlaylistTab";

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
    // Covers both swipe sources that land here: group→home (badge
    // transform + scrollbar lock) and settings→home (those plus the
    // #header-portal transform — the settings back/Edit buttons live
    // there). On snap-back/cancel the source page clears these directly;
    // on commit it has unmounted by the time we land here.
    resetSwipeBackChrome();
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
    // (Resetting every group's remembered scroll + tab now happens on
    // /groups — that's the list you return to, and it's where that browsing
    // session actually ends.)
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

  // Warm the groups cache in the background so tapping the groups button
  // paints the list instantly instead of spinning. Fire-and-forget: nothing
  // here renders groups, and getMyGroups() coalesces in-flight calls.
  useEffect(() => {
    void getMyGroups().catch(() => {});
  }, []);

  return <PlaylistTab />;
}

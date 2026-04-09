"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// Total animation time in ms (matches main page typing animation)
const TOTAL_ANIMATION_MS = 630;
// Minimum font size in px before truncating
const MIN_FONT_PX = 13;
// Maximum font size in px
const MAX_FONT_PX = 20;

/**
 * Find the longest common prefix and suffix between two strings.
 * Returns { prefix, oldMiddle, newMiddle, suffix }.
 * The "middle" is the part that differs.
 */
function diffStrings(oldStr: string, newStr: string) {
  let prefixLen = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (prefixLen < minLen && oldStr[prefixLen] === newStr[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldStr[oldStr.length - 1 - suffixLen] === newStr[newStr.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  return {
    prefix: newStr.slice(0, prefixLen),
    oldMiddle: oldStr.slice(prefixLen, oldStr.length - suffixLen),
    newMiddle: newStr.slice(prefixLen, newStr.length - suffixLen),
    suffix: newStr.slice(newStr.length - suffixLen),
  };
}

/**
 * Check if a character should skip its animation delay.
 * Spaces and " for " scaffolding are always instant.
 */
function isScaffoldChar(
  char: string,
  phase: "delete" | "type",
  middle: string,
  charIndex: number,
): boolean {
  if (char === " ") return true;

  // When typing, " for " prefix is scaffold
  if (phase === "type" && middle.startsWith(" for ")) {
    if (charIndex < " for ".length) return true;
  }

  // When deleting, " for " within the old middle is scaffold
  if (phase === "delete") {
    const forIdx = middle.indexOf(" for ");
    if (forIdx >= 0) {
      const posFromLeft = middle.length - 1 - charIndex;
      if (posFromLeft >= forIdx && posFromLeft < forIdx + " for ".length) return true;
    }
  }

  return false;
}

interface AnimatedTitleProps {
  title: string;
  /** Delay in ms before the first animation starts (e.g. wait for modal slide-up) */
  initialDelay?: number;
}

export default function AnimatedTitle({ title, initialDelay = 0 }: AnimatedTitleProps) {
  const [displayedText, _setDisplayedText] = useState("");
  const displayedRef = useRef("");
  const setDisplayedText = useCallback((text: string) => {
    displayedRef.current = text;
    _setDisplayedText(text);
  }, []);
  const targetRef = useRef(title);
  const initialDelayDone = useRef(initialDelay === 0);
  const cancelRef = useRef<() => void>(() => {});
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSizePx, setFontSizePx] = useState(MAX_FONT_PX);

  // Always keep targetRef in sync
  targetRef.current = title;

  // Auto-shrink font to fit container width
  const fitFont = useCallback(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    // Temporarily set max size to measure
    textEl.style.fontSize = `${MAX_FONT_PX}px`;
    const containerWidth = container.clientWidth;

    if (textEl.scrollWidth <= containerWidth) {
      setFontSizePx(MAX_FONT_PX);
      return;
    }

    // Binary search for the right font size
    let lo = MIN_FONT_PX;
    let hi = MAX_FONT_PX;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      textEl.style.fontSize = `${mid}px`;
      if (textEl.scrollWidth > containerWidth) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    setFontSizePx(lo);
    textEl.style.fontSize = `${lo}px`;
  }, []);

  // Fit font only when animation reaches final state (avoid layout thrashing
  // from binary-search reflows on every intermediate animation step)
  useEffect(() => {
    if (displayedRef.current === targetRef.current) fitFont();
  }, [displayedText, fitFont]);

  // Fit font on resize
  useEffect(() => {
    const observer = new ResizeObserver(fitFont);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitFont]);

  // Core animation runner — extracted so it can be called from the effect
  // and from the safety-net check.
  const runAnimation = useCallback((from: string, to: string, delay: number) => {
    cancelRef.current();

    if (!to) {
      setDisplayedText("");
      return;
    }

    const { prefix, oldMiddle, newMiddle, suffix } = diffStrings(from, to);
    const deleteCount = oldMiddle.length;
    const typeCount = newMiddle.length;

    const steps: { phase: "delete" | "type"; index: number; instant: boolean }[] = [];
    let firstVisibleSeen = false;
    for (let i = 0; i < deleteCount; i++) {
      const char = oldMiddle[oldMiddle.length - 1 - i];
      const scaffold = isScaffoldChar(char, "delete", oldMiddle, i);
      const instant = scaffold || !firstVisibleSeen;
      if (!scaffold) firstVisibleSeen = true;
      steps.push({ phase: "delete", index: i, instant });
    }
    for (let i = 0; i < typeCount; i++) {
      const char = newMiddle[i];
      const scaffold = isScaffoldChar(char, "type", newMiddle, i);
      const instant = scaffold || !firstVisibleSeen;
      if (!scaffold) firstVisibleSeen = true;
      steps.push({ phase: "type", index: i, instant });
    }

    const animatedSteps = steps.filter((s) => !s.instant).length;
    if (animatedSteps === 0) {
      setDisplayedText(to);
      return;
    }

    const charDelay = Math.max(15, TOTAL_ANIMATION_MS / animatedSteps);
    let stepIdx = 0;
    let cancelled = false;

    cancelRef.current = () => { cancelled = true; };

    const applyStep = (s: (typeof steps)[number]) => {
      if (s.phase === "delete") {
        const remaining = oldMiddle.slice(0, oldMiddle.length - s.index - 1);
        setDisplayedText(prefix + remaining + suffix);
      } else {
        const typed = newMiddle.slice(0, s.index + 1);
        setDisplayedText(prefix + typed + suffix);
      }
    };

    const tick = () => {
      if (cancelled) {
        // Jump to whatever the *current* target is (not stale closure)
        setDisplayedText(targetRef.current);
        return;
      }

      applyStep(steps[stepIdx]);
      stepIdx++;

      while (stepIdx < steps.length && steps[stepIdx].instant) {
        applyStep(steps[stepIdx]);
        stepIdx++;
      }

      if (stepIdx < steps.length) {
        setTimeout(tick, charDelay);
      }
    };

    if (delay > 0) {
      const timer = setTimeout(tick, delay);
      cancelRef.current = () => { cancelled = true; clearTimeout(timer); };
    } else {
      tick();
    }
  }, [setDisplayedText]);

  // Trigger animation when title changes
  useEffect(() => {
    if (displayedRef.current === title) return;

    const delay = initialDelayDone.current ? 0 : initialDelay;
    initialDelayDone.current = true;

    runAnimation(displayedRef.current, title, delay);

    return () => { cancelRef.current(); };
  }, [title, initialDelay, runAnimation]);

  // Safety net: if after the initial animation should have completed but
  // displayed doesn't match title (e.g. React strict mode cancelled the run), retry.
  useEffect(() => {
    if (!initialDelay) return;
    const timer = setTimeout(() => {
      if (displayedRef.current !== targetRef.current && targetRef.current) {
        initialDelayDone.current = true;
        runAnimation(displayedRef.current, targetRef.current, 0);
      }
    }, initialDelay + TOTAL_ANIMATION_MS + 100);
    return () => clearTimeout(timer);
  }, [initialDelay, runAnimation]);

  return (
    <div
      ref={containerRef}
      className="text-center overflow-hidden whitespace-nowrap"
      style={{ minHeight: `${MAX_FONT_PX + 8}px` }}
    >
      {displayedText && (
        <span
          ref={textRef}
          className="text-blue-600 dark:text-blue-400 font-bold inline-block"
          style={{
            fontSize: `${fontSizePx}px`,
            fontFamily: "'M PLUS 1 Code', monospace",
          }}
        >
          {displayedText}
        </span>
      )}
    </div>
  );
}

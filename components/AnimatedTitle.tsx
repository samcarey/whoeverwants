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
}

export default function AnimatedTitle({ title }: AnimatedTitleProps) {
  const [displayedText, setDisplayedText] = useState(title);
  const prevTitleRef = useRef(title);
  const cancelRef = useRef<() => void>(() => {});
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSizePx, setFontSizePx] = useState(MAX_FONT_PX);

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

  // Fit font whenever displayedText changes
  useEffect(() => {
    fitFont();
  }, [displayedText, fitFont]);

  // Fit font on resize
  useEffect(() => {
    const observer = new ResizeObserver(fitFont);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitFont]);

  // Animate when title changes
  useEffect(() => {
    const oldTitle = prevTitleRef.current;
    prevTitleRef.current = title;

    if (oldTitle === title) return;

    // Cancel any in-progress animation
    cancelRef.current();

    // If transitioning to/from empty, just set immediately
    if (!oldTitle || !title) {
      setDisplayedText(title);
      return;
    }

    const { prefix, oldMiddle, newMiddle, suffix } = diffStrings(oldTitle, title);
    const deleteCount = oldMiddle.length;
    const typeCount = newMiddle.length;

    // Build step list. Scaffold chars (spaces, " for ") are always instant.
    // The first non-scaffold char is also instant (no delay before the first
    // visible change). Only the 2nd+ visible chars get animation delays.
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
      setDisplayedText(title);
      return;
    }

    const charDelay = Math.max(15, TOTAL_ANIMATION_MS / animatedSteps);
    let stepIdx = 0;
    let cancelled = false;

    cancelRef.current = () => {
      cancelled = true;
    };

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
        setDisplayedText(title);
        return;
      }

      // Apply current step and all consecutive instant steps
      applyStep(steps[stepIdx]);
      stepIdx++;

      // Fast-forward through any instant steps
      while (stepIdx < steps.length && steps[stepIdx].instant) {
        applyStep(steps[stepIdx]);
        stepIdx++;
      }

      if (stepIdx < steps.length) {
        setTimeout(tick, charDelay);
      }
    };

    tick();

    return () => {
      cancelled = true;
    };
  }, [title]);

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

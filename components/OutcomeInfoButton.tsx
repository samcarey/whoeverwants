"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Small info (ⓘ) affordance that reveals a plain-language outcome explanation
 * in a tap-to-toggle popover. The explanation text lives ONLY here — never
 * inline — so it stays out of the way until the viewer asks "why this result?".
 *
 * `tone: 'warn'` tints the icon amber (used for the ranked-choice
 * "a broadly-acceptable option lost" case) so a result worth a second look
 * draws a little attention without putting prose on the screen.
 */
export default function OutcomeInfoButton({
  text,
  tone = "info",
  align = "right",
  className = "",
}: {
  text: string;
  tone?: "info" | "warn";
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const iconColor =
    tone === "warn"
      ? "text-amber-500 dark:text-amber-400"
      : "text-gray-400 dark:text-gray-500";

  return (
    <span ref={wrapRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        // Stop the tap from bubbling to the result card's own handlers
        // (round-swipe on ranked-choice, tap-to-detail on the group card).
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label="Why this result?"
        className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${iconColor}`}
      >
        <svg
          className="w-[18px] h-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 11.5v4.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8h.01" />
        </svg>
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } top-full mt-1 z-30 w-64 max-w-[80vw] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-xs leading-relaxed text-gray-700 dark:text-gray-200 shadow-lg`}
        >
          {text}
        </div>
      )}
    </span>
  );
}

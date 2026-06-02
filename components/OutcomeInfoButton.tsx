"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Small grey info (ⓘ) affordance that sits inline right after a result label
 * (e.g. "Scheduled Time", "Final Round", "Final Results") and reveals a
 * plain-language outcome explanation in a tap-to-toggle popover. The
 * explanation text lives ONLY here — never inline — so it stays out of the way
 * until the viewer asks "why this result?".
 */
export default function OutcomeInfoButton({
  text,
  align = "center",
  className = "",
}: {
  text: string;
  // Which edge of the icon the popover anchors to.
  align?: "left" | "right" | "center";
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

  const popoverAnchor =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex items-center align-middle ${className}`}
    >
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
        className="flex items-center justify-center w-5 h-5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <svg
          className="w-[15px] h-[15px]"
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
          className={`absolute ${popoverAnchor} top-full mt-1 z-30 w-64 max-w-[80vw] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-left text-xs leading-relaxed font-normal normal-case text-gray-700 dark:text-gray-200 shadow-lg`}
        >
          {text}
        </div>
      )}
    </span>
  );
}

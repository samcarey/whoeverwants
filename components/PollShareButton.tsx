"use client";

import { useCallback, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";

interface PollShareButtonProps {
  url: string;
  title: string;
}

/**
 * Per-poll-card share button in the corner of each group card. Tapping
 * invokes the native share sheet (`navigator.share`) on iOS / Android,
 * or copies the URL to the clipboard on desktop with a "Link copied"
 * toast. Falls through to a manual-copy `prompt()` as last resort.
 *
 * Mirrors `GroupShareButton`'s behavior but with the compact 26x26 chrome
 * that fits in the card-header layout — see CLAUDE.md → "Expandable
 * Question Cards (Group View)" for the per-card copy-link slot.
 */
export default function PollShareButton({ url, title }: PollShareButtonProps) {
  const [feedback, setFeedback] = useState<null | "copied" | "error">(null);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined" || !url) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Fall through to clipboard.
      }
    }
    if (await copyTextToClipboard(url)) {
      setFeedback("copied");
      setTimeout(() => setFeedback(null), 2000);
      return;
    }
    try {
      window.prompt("Copy this link", url);
    } catch {
      setFeedback("error");
      setTimeout(() => setFeedback(null), 2000);
    }
  }, [url, title]);

  if (!url) {
    return <div className="w-[26px] h-[26px]" />;
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="relative w-[26px] h-[26px] flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 active:scale-95 rounded-full transition-all"
      aria-label={feedback === "copied" ? "Link copied to clipboard" : "Share poll"}
    >
      <svg
        className="w-4 h-4 text-gray-600 dark:text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 6l-4-4-4 4"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 2v14"
        />
      </svg>
      {feedback && (
        <span
          className={`pointer-events-none absolute right-0 top-full mt-1 whitespace-nowrap rounded-md px-2 py-1 text-xs shadow-md ${
            feedback === "copied"
              ? "bg-green-600 text-white dark:bg-green-500"
              : "bg-red-600 text-white dark:bg-red-500"
          }`}
        >
          {feedback === "copied" ? "Link copied" : "Copy failed"}
        </span>
      )}
    </button>
  );
}

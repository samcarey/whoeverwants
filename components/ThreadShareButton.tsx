"use client";

import { useCallback, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";

interface ThreadShareButtonProps {
  routeId: string;
  title: string;
}

/**
 * Top-right action in the thread header. Tapping invokes the native share
 * sheet (`navigator.share`) on iOS / Android, or copies the URL to the
 * clipboard on desktop with a "Link copied" toast. Falls through to a
 * manual-copy `prompt()` as last resort.
 *
 * Shares the BARE thread URL with no `?p=`. Per-card copy-link buttons
 * still emit `?p=<short>` URLs for "navigate to this poll's view" — both
 * forms grant the recipient thread membership on visit; the difference is
 * that `?p=` drives auto-expand and scroll target.
 */
export default function ThreadShareButton({ routeId, title }: ThreadShareButtonProps) {
  const [feedback, setFeedback] = useState<null | "copied" | "error">(null);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/t/${encodeURIComponent(routeId)}`;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet — silent.
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
  }, [routeId, title]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={handleShare}
        className="w-10 h-10 flex items-center justify-center active:opacity-60 transition-opacity"
        aria-label="Share thread"
      >
        <svg
          className="w-6 h-6 text-gray-600 dark:text-gray-400"
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
      </button>
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
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ThreadShareButtonProps {
  routeId: string;
  title: string;
}

/**
 * Top-right action in the thread header. Tapping it surfaces a thread URL
 * via the native share sheet (`navigator.share`) on iOS / Android, or
 * copies the URL to the clipboard on desktop. Migration 106 made thread
 * URLs the canonical "invite" — visiting `/t/<routeId>` writes thread
 * membership inline, so handing someone the bare URL is the way to bring
 * them into the conversation.
 *
 * The share URL is intentionally `/t/<routeId>` with NO `?p=<poll>`. Per-
 * card copy-link buttons still emit `?p=` URLs (those grant the same
 * membership but additionally auto-expand and scroll to the linked
 * poll); this button is the "share the whole conversation" form.
 */
export default function ThreadShareButton({ routeId, title }: ThreadShareButtonProps) {
  const [feedback, setFeedback] = useState<null | "copied" | "error">(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showFeedback = useCallback((kind: "copied" | "error") => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback(kind);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2000);
  }, []);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/t/${encodeURIComponent(routeId)}`;
    const shareData: ShareData = { title, url };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet — silent.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Fall through to clipboard.
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        showFeedback("copied");
        return;
      } catch {
        // Fall through.
      }
    }
    // Last-resort: prompt so the user can copy manually.
    try {
      window.prompt("Copy this link", url);
    } catch {
      showFeedback("error");
    }
  }, [routeId, title, showFeedback]);

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

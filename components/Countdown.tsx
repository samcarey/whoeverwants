"use client";

import { useState, useEffect } from "react";
import { formatCountdownTime } from "@/lib/timeUtils";

interface CountdownProps {
  deadline: string | null;
  label?: string;
  onExpire?: () => void;
  // Render just the bold text (no wrapper div, no centering, no margin) so the
  // caller can place it inline next to a heading.
  inline?: boolean;
}

export default function Countdown({ deadline, label, onExpire, inline = false }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isExpired, setIsExpired] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!deadline || !isClient) return;

    const updateCountdown = () => {
      const now = new Date().getTime();
      const deadlineTime = new Date(deadline).getTime();
      const difference = deadlineTime - now;

      if (difference <= 0) {
        setIsExpired(true);
        setTimeLeft("Completed");
        onExpire?.();
        return;
      }

      setTimeLeft(formatCountdownTime(difference));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [deadline, isClient]);

  if (inline) {
    const text = !deadline || !isClient
      ? ""
      : isExpired
        ? (label ? `${label} ended` : "Ended")
        : `${label || "Closing"} in ${timeLeft}`;
    return (
      <span className={`text-sm font-bold whitespace-nowrap ${isExpired
        ? "text-red-700 dark:text-red-300"
        : "text-blue-700 dark:text-blue-300"
      }`}>
        {text}
      </span>
    );
  }

  if (!deadline) {
    return (
      <div className="text-center text-gray-600 dark:text-gray-300 mb-6">
        <p className="text-sm">No deadline set</p>
      </div>
    );
  }

  // Don't render date formatting until client-side to avoid hydration mismatch
  const deadlineDate = isClient ? new Date(deadline).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) : null;

  // Don't render time-dependent content until client-side
  if (!isClient) {
    return (
      <div className="mb-3 text-center">
        <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="mb-3 text-center">
      <span className={`text-sm font-bold ${isExpired 
        ? 'text-red-700 dark:text-red-300' 
        : 'text-blue-700 dark:text-blue-300'
      }`}>
        {isExpired ? (label ? `${label} ended` : `Question Ended`) : `${label || 'Closing'} in ${timeLeft}`}
      </span>
    </div>
  );
}
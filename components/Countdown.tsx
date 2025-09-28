"use client";

import { useState, useEffect } from "react";

interface CountdownProps {
  deadline: string | null;
}

export default function Countdown({ deadline }: CountdownProps) {
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
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      let timeString = "";
      
      if (days > 0) {
        timeString = `${days}d ${hours}h ${minutes}m`;
      } else if (hours > 0) {
        timeString = `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        timeString = `${minutes}m ${seconds}s`;
      } else {
        timeString = `${seconds}s`;
      }

      setTimeLeft(timeString);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [deadline, isClient]);

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
        {isExpired ? `Poll Ended` : `Closing in ${timeLeft}`}
      </span>
    </div>
  );
}
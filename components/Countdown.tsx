"use client";

import { useState, useEffect } from "react";

interface CountdownProps {
  deadline: string | null;
}

export default function Countdown({ deadline }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!deadline) return;

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
  }, [deadline]);

  if (!deadline) {
    return (
      <div className="text-center text-gray-600 dark:text-gray-300 mb-6">
        <p className="text-sm">No deadline set</p>
      </div>
    );
  }

  const deadlineDate = new Date(deadline).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="text-center mb-6">
      <div className={`p-4 rounded-lg ${isExpired 
        ? 'bg-red-100 dark:bg-red-900 border border-red-200 dark:border-red-700' 
        : 'bg-blue-100 dark:bg-blue-900 border border-blue-200 dark:border-blue-700'
      }`}>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
          {isExpired ? "Poll Ended" : "Time Remaining"}
        </p>
        <p className={`text-2xl font-bold ${isExpired 
          ? 'text-red-700 dark:text-red-300' 
          : 'text-blue-700 dark:text-blue-300'
        }`}>
          {timeLeft}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Deadline: {deadlineDate}
        </p>
      </div>
    </div>
  );
}
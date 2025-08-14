"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, Poll } from "@/lib/supabase";
import ClientOnly from "@/components/ClientOnly";

// Simple countdown component
const SimpleCountdown = ({ deadline }: { deadline: string }) => {
  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date().getTime();
      const deadlineTime = new Date(deadline).getTime();
      const difference = deadlineTime - now;

      if (difference <= 0) {
        setTimeLeft("Expired");
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      let timeString = "";
      if (days > 0) {
        timeString = `${days}d ${hours}h`;
      } else if (hours > 0) {
        timeString = `${hours}h ${minutes}m`;
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

  return (
    <div className="text-right text-sm">
      <div className="text-xs text-gray-500 dark:text-gray-400">Time left</div>
      <div className="font-mono font-semibold text-green-600 dark:text-green-400">
        {timeLeft}
      </div>
    </div>
  );
};

export default function Home() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPolls() {
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from("polls")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) {
          console.error("Error fetching polls:", error);
          setError("Failed to load polls");
          return;
        }

        setPolls(data || []);
      } catch (error) {
        console.error("Unexpected error:", error);
        setError("An unexpected error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchPolls();
  }, []);

  // Separate polls into open and closed
  const openPolls = polls.filter(poll => {
    if (!poll.response_deadline) return false;
    return new Date(poll.response_deadline) > new Date() && !poll.is_closed;
  });

  const closedPolls = polls.filter(poll => {
    if (!poll.response_deadline) return true;
    return new Date(poll.response_deadline) <= new Date() || poll.is_closed;
  });

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Fixed Header */}
      <div className="fixed top-0 left-0 right-0 z-20 bg-white dark:bg-black">
        <div className="flex items-center justify-center py-4 relative">
          <a
            href="https://github.com/samcarey/whoeverwants"
            target="_blank"
            rel="noopener noreferrer"
            className="absolute left-4 rounded-full transition-colors flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 h-9 w-9"
            title="View on GitHub"
          >
            <svg
              className="w-9 h-9"
              fill="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          </a>
          
          <Link
            href="/create-poll"
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 px-8 min-w-[200px]"
          >
            Create Poll
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="pt-24 pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-8">
          {loading && (
            <div className="flex justify-center items-center py-8">
              <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-center">
              {error}
            </div>
          )}

          {!loading && !error && polls.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No polls created yet... Be the first to create one!
            </div>
          )}

          {!loading && !error && polls.length > 0 && (
            <div>
              {/* Open Polls Section */}
              {openPolls.length > 0 ? (
                <div className="mb-8">
                  <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Open Polls</h3>
                  <div className="space-y-3">
                    {openPolls.map((poll) => (
                      <Link
                        key={poll.id}
                        href={`/p/${poll.short_id || poll.id}`}
                        className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-green-300 dark:hover:border-green-600 transition-all cursor-pointer relative"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 mr-4">
                            <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors mb-2">{poll.title}</h3>
                            <div className="flex items-center gap-3">
                              <span className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${
                                poll.poll_type === 'yes_no' 
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                  : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                              }`}>
                                {poll.poll_type === 'yes_no' ? 'Yes/No' : 'Ranked Choice'}
                              </span>
                            </div>
                          </div>
                          {poll.response_deadline && (
                            <div className="flex-shrink-0">
                              <ClientOnly fallback={
                                <div className="text-right text-sm">
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Time left</div>
                                  <div className="font-mono font-semibold text-green-600 dark:text-green-400">
                                    Loading...
                                  </div>
                                </div>
                              }>
                                <SimpleCountdown deadline={poll.response_deadline} />
                              </ClientOnly>
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mb-8 text-center">
                  <p className="text-xl text-gray-500 dark:text-gray-400">No Open Polls</p>
                </div>
              )}

              {/* Closed Polls Section */}
              <div className="mb-8">
                <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Closed Polls</h3>
                {closedPolls.length > 0 ? (
                  <div className="space-y-3">
                    {closedPolls.map((poll) => (
                      <Link
                        key={poll.id}
                        href={`/p/${poll.short_id || poll.id}`}
                        className="block bg-red-50 dark:bg-red-950/20 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-600 transition-all cursor-pointer opacity-75 relative"
                      >
                        <div className="mb-2">
                          <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-red-600 dark:hover:text-red-400 transition-colors">{poll.title}</h3>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${
                            poll.poll_type === 'yes_no' 
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                          }`}>
                            {poll.poll_type === 'yes_no' ? 'Yes/No' : 'Ranked Choice'}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 italic text-center">No Closed Polls</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
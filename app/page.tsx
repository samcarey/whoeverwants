"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, Poll } from "@/lib/supabase";

const POLLS_PER_LOAD = 10;
const LOAD_THRESHOLD = 300; // Load more when user is 300px from bottom

// Placeholder component for loading polls
const PollSkeleton = () => (
  <div className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm animate-pulse">
    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
  </div>
);

export default function Home() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchInitialPolls();
  }, []);

  const fetchInitialPolls = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get total count
      const { count } = await supabase
        .from("polls")
        .select("*", { count: "exact", head: true });

      setTotalCount(count || 0);

      // Get initial polls
      const { data, error } = await supabase
        .from("polls")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, POLLS_PER_LOAD - 1);

      if (error) {
        console.error("Error fetching polls:", error);
        setError("Failed to load polls");
        return;
      }

      setPolls(data || []);
      setHasMore((data?.length || 0) >= POLLS_PER_LOAD && (count || 0) > POLLS_PER_LOAD);
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const loadMorePolls = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    try {
      setLoadingMore(true);
      
      const { data, error } = await supabase
        .from("polls")
        .select("*")
        .order("created_at", { ascending: false })
        .range(polls.length, polls.length + POLLS_PER_LOAD - 1);

      if (error) {
        console.error("Error loading more polls:", error);
        return;
      }

      const newPolls = data || [];
      setPolls(prev => [...prev, ...newPolls]);
      setHasMore(newPolls.length >= POLLS_PER_LOAD && polls.length + newPolls.length < totalCount);
    } catch (error) {
      console.error("Unexpected error loading more polls:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [polls.length, hasMore, loadingMore, totalCount]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom < LOAD_THRESHOLD) {
      loadMorePolls();
    }
  }, [loadMorePolls, loadingMore, hasMore]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div className="h-[calc(100vh-128px)] flex flex-col">
      {/* Action Buttons Section - Fixed at top */}
      <div className="flex-shrink-0 flex flex-col items-center pt-4 pb-6">
        <div className="flex flex-col gap-6 items-center">
          <Link
            href="/create-poll"
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 px-8 min-w-[200px]"
          >
            Create Poll
          </Link>
        </div>
      </div>

      {/* Polls List Section - Scrollable */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full min-h-0">
        <h2 className="text-2xl font-bold mb-4 text-center flex-shrink-0">Recent Polls</h2>
        
        {/* Scrollable Content Area */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4"
        >
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
              No polls created yet. Be the first to create one!
            </div>
          )}

          {!loading && !error && polls.length > 0 && (
            <div className="space-y-3 pb-4">
              {polls.map((poll) => (
                <Link
                  key={poll.id}
                  href={`/poll/${poll.id}`}
                  className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all cursor-pointer"
                >
                  <h3 className="font-medium text-lg mb-2 line-clamp-1 text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{poll.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Created {new Date(poll.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
              
              {/* Loading more placeholders */}
              {loadingMore && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <PollSkeleton key={`skeleton-${index}`} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

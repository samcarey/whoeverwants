"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, Poll } from "@/lib/supabase";

const WINDOW_SIZE = 100; // Keep 100 polls in memory around current position
const POLL_HEIGHT = 88; // Estimated height of each poll item in pixels

// Placeholder component for loading polls
const PollSkeleton = () => (
  <div className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm animate-pulse">
    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
  </div>
);

// Spacer component to maintain scroll position for unloaded polls
const PollSpacer = ({ height }: { height: number }) => (
  <div style={{ height: `${height}px` }} className="flex-shrink-0" />
);

export default function Home() {
  const [pollsData, setPollsData] = useState<Map<number, Poll>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [windowStart, setWindowStart] = useState(0);
  const [windowEnd, setWindowEnd] = useState(WINDOW_SIZE);
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
        .range(0, Math.min(WINDOW_SIZE - 1, (count || 0) - 1));

      if (error) {
        console.error("Error fetching polls:", error);
        setError("Failed to load polls");
        return;
      }

      const newPollsData = new Map<number, Poll>();
      (data || []).forEach((poll, index) => {
        newPollsData.set(index, poll);
      });
      
      setPollsData(newPollsData);
      setWindowEnd(Math.min(WINDOW_SIZE, count || 0));

    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Track which ranges are currently being fetched to prevent race conditions
  const fetchingRanges = useRef(new Set<string>());

  const fetchPollsInRange = useCallback(async (startIndex: number, endIndex: number) => {
    if (startIndex >= endIndex || startIndex >= totalCount) return;

    // Create a unique key for this range to prevent duplicate fetches
    const rangeKey = `${startIndex}-${endIndex}`;
    if (fetchingRanges.current.has(rangeKey)) {
      return; // Already fetching this range
    }

    fetchingRanges.current.add(rangeKey);

    try {
      setLoadingMore(true);
      
      const { data, error } = await supabase
        .from("polls")
        .select("*")
        .order("created_at", { ascending: false })
        .range(startIndex, Math.min(endIndex - 1, totalCount - 1));

      if (error) {
        console.error("Error loading polls:", error);
        return;
      }

      setPollsData(prev => {
        const newData = new Map(prev);
        (data || []).forEach((poll, index) => {
          const pollIndex = startIndex + index;
          // Only set if not already exists to prevent overwrites
          if (!newData.has(pollIndex)) {
            newData.set(pollIndex, poll);
          }
        });


        return newData;
      });
    } catch (error) {
      console.error("Unexpected error loading polls:", error);
    } finally {
      fetchingRanges.current.delete(rangeKey);
      setLoadingMore(false);
    }
  }, [totalCount]);

  const updateWindow = useCallback((scrollTop: number) => {
    if (totalCount === 0) return;

    // Calculate which poll index should be at the top of the viewport
    const topPollIndex = Math.floor(scrollTop / POLL_HEIGHT);
    
    // Calculate new window bounds centered around visible area
    const newWindowStart = Math.max(0, topPollIndex - Math.floor(WINDOW_SIZE / 2));
    const newWindowEnd = Math.min(totalCount, newWindowStart + WINDOW_SIZE);
    
    if (newWindowStart !== windowStart || newWindowEnd !== windowEnd) {
      setWindowStart(newWindowStart);
      setWindowEnd(newWindowEnd);
      
      // Use functional update to avoid stale closure and calculate missing ranges
      setPollsData(prev => {
        const newData = new Map();
        
        // Copy existing data in the new window range
        for (let i = newWindowStart; i < newWindowEnd; i++) {
          if (prev.has(i)) {
            newData.set(i, prev.get(i)!);
          }
        }
        
        // Calculate missing ranges using current data
        const missingRanges: Array<[number, number]> = [];
        let rangeStart = newWindowStart;
        
        for (let i = newWindowStart; i < newWindowEnd; i++) {
          if (!prev.has(i)) {
            // Found a missing poll, extend current range
            continue;
          } else {
            // Found existing poll, close current range if any
            if (rangeStart < i) {
              missingRanges.push([rangeStart, i]);
            }
            rangeStart = i + 1;
          }
        }
        
        // Close final range if needed
        if (rangeStart < newWindowEnd) {
          missingRanges.push([rangeStart, newWindowEnd]);
        }
        
        // Batch fetch missing ranges (avoid too many small requests)
        missingRanges.forEach(([start, end]) => {
          if (end - start > 0) {
            fetchPollsInRange(start, end);
          }
        });
        
        return newData;
      });
    }
  }, [windowStart, windowEnd, totalCount, fetchPollsInRange]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop } = container;
    updateWindow(scrollTop);
  }, [updateWindow]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Get visible polls for rendering
  const getVisiblePolls = useCallback(() => {
    const visiblePolls: Array<{ index: number; poll: Poll | null }> = [];
    
    // Only loop through the window range for efficiency
    for (let i = windowStart; i < windowEnd; i++) {
      visiblePolls.push({
        index: i,
        poll: pollsData.get(i) || null
      });
    }
    
    return visiblePolls;
  }, [pollsData, windowStart, windowEnd]);


  return (
    <div className="flex flex-col h-screen -m-8 pt-8 px-8 pb-0">
      {/* Action Buttons Section */}
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

      {/* Polls List Section Header */}
      <div className="flex-shrink-0 max-w-4xl mx-auto w-full px-8">
        <h2 className="text-2xl font-bold mb-4 text-center">Recent Polls</h2>
      </div>
      
      {/* Scrollable Content Area - takes remaining height */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-4xl mx-auto px-8">
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

          {!loading && !error && totalCount === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No polls created yet. Be the first to create one!
            </div>
          )}

          {!loading && !error && totalCount > 0 && (
            <div>
              {/* Top spacer for unloaded polls */}
              {windowStart > 0 && (
                <PollSpacer height={windowStart * POLL_HEIGHT} />
              )}
              
              {/* Visible polls window */}
              <div className="space-y-3">
                {getVisiblePolls().map(({ index, poll }) => (
                  poll ? (
                    <Link
                      key={`poll-${index}-${poll.id}`}
                      href={`/poll/${poll.id}`}
                      className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all cursor-pointer"
                    >
                      <h3 className="font-medium text-lg mb-2 line-clamp-1 text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{poll.title}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Created {new Date(poll.created_at).toLocaleDateString()}
                      </p>
                    </Link>
                  ) : (
                    <PollSkeleton key={`skeleton-${index}`} />
                  )
                ))}
              </div>
              
              {/* Bottom spacer for unloaded polls + padding at end */}
              {windowEnd < totalCount ? (
                <PollSpacer height={(totalCount - windowEnd) * POLL_HEIGHT} />
              ) : (
                // Add padding when we're at the last item so it doesn't touch the bottom
                <div className="h-6" />
              )}
              
              {/* Loading indicator */}
              {loadingMore && (
                <div className="flex justify-center items-center py-4">
                  <svg className="animate-spin h-6 w-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

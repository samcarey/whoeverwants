"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, Poll } from "@/lib/supabase";

const WINDOW_SIZE = 100; // Keep 100 polls in memory around current position
const POLL_HEIGHT = 88; // Estimated height of each poll item in pixels

// Compact countdown component for poll list
const CompactCountdown = ({ deadline, onExpire }: { deadline: string; onExpire?: () => void }) => {
  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date().getTime();
      const deadlineTime = new Date(deadline).getTime();
      const difference = deadlineTime - now;

      if (difference <= 0) {
        setTimeLeft("Expired");
        // Trigger expiration callback to move poll to closed section
        if (onExpire) {
          onExpire();
        }
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      let timeString = "";
      
      if (days > 0) {
        timeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
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
  }, [deadline, onExpire]);

  return (
    <div className="text-right text-sm">
      <div className="text-xs text-gray-500 dark:text-gray-400">Time left</div>
      <div className="font-mono font-semibold text-green-600 dark:text-green-400">
        {timeLeft}
      </div>
    </div>
  );
};

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
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    fetchInitialPolls();
    
    // Add visibility change listener to refresh when user returns to page
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // User returned to the page, refresh the data
        fetchInitialPolls();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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

  const updateWindow = useCallback((scrollTop: number, containerHeight: number) => {
    if (totalCount === 0) return;

    // Calculate which poll index should be at the top of the viewport
    const topPollIndex = Math.floor(scrollTop / POLL_HEIGHT);
    
    // Calculate how many polls are visible in the viewport
    const visiblePollCount = Math.ceil(containerHeight / POLL_HEIGHT) + 2; // +2 for buffer
    
    // Calculate new window bounds with some buffer around visible area
    const bufferSize = Math.max(20, Math.floor(WINDOW_SIZE / 4));
    const newWindowStart = Math.max(0, topPollIndex - bufferSize);
    const newWindowEnd = Math.min(totalCount, topPollIndex + visiblePollCount + bufferSize);
    
    // Only update if the window has changed significantly (prevent micro-updates)
    const windowChanged = Math.abs(newWindowStart - windowStart) > 5 || 
                         Math.abs(newWindowEnd - windowEnd) > 5;
    
    if (windowChanged) {
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

  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Clear previous timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Throttle scroll updates to prevent excessive re-renders
    scrollTimeoutRef.current = setTimeout(() => {
      const { scrollTop, clientHeight } = container;
      updateWindow(scrollTop, clientHeight);
    }, 16); // ~60fps
  }, [updateWindow]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  // Get visible polls for rendering, separated by status
  const getVisiblePolls = useCallback(() => {
    const allVisiblePolls: Array<{ index: number; poll: Poll | null }> = [];
    
    // Only loop through the window range for efficiency
    for (let i = windowStart; i < windowEnd; i++) {
      allVisiblePolls.push({
        index: i,
        poll: pollsData.get(i) || null
      });
    }
    
    // Separate into open and closed polls
    const openPolls: Array<{ index: number; poll: Poll }> = [];
    const closedPolls: Array<{ index: number; poll: Poll }> = [];
    const loadingPolls: Array<{ index: number; poll: null }> = [];
    
    allVisiblePolls.forEach(({ index, poll }) => {
      if (!poll) {
        loadingPolls.push({ index, poll });
        return;
      }
      
      // Check if poll is open (has deadline, deadline is in the future, and not manually closed)
      const hasDeadline = poll.response_deadline && new Date(poll.response_deadline) > new Date();
      const isManuallyClosed = poll.is_closed;
      const isOpen = hasDeadline && !isManuallyClosed;
      
      if (isOpen) {
        openPolls.push({ index, poll });
      } else {
        closedPolls.push({ index, poll });
      }
    });
    
    return { openPolls, closedPolls, loadingPolls };
  }, [pollsData, windowStart, windowEnd, refreshTrigger]);

  // Callback to trigger refresh when a poll expires
  const handlePollExpire = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);


  return (
    <div className="flex flex-col h-screen -m-8 pt-8 px-4 sm:px-8 pb-0">
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

      
      {/* Scrollable Content Area - takes remaining height */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-hide"
      >
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

          {!loading && !error && totalCount === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No polls created yet... Be the first to create one!
            </div>
          )}

          {!loading && !error && totalCount > 0 && (
            <div>
              {/* Top spacer for unloaded polls */}
              {windowStart > 0 && (
                <PollSpacer height={windowStart * POLL_HEIGHT} />
              )}
              
              {(() => {
                const { openPolls, closedPolls, loadingPolls } = getVisiblePolls();
                
                return (
                  <>
                    {/* Open Polls Section */}
                    {openPolls.length > 0 ? (
                      <div className="mb-8">
                        <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Open Polls</h3>
                        <div className="space-y-3">
                          {openPolls.map(({ index, poll }) => (
                            <Link
                              key={`open-poll-${index}-${poll.id}`}
                              href={`/poll?id=${poll.id}`}
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
                                    <CompactCountdown 
                                      deadline={poll.response_deadline} 
                                      onExpire={handlePollExpire}
                                    />
                                  </div>
                                )}
                              </div>
                              {poll.response_deadline && (
                                <div className="absolute bottom-4 right-4">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Deadline: {(() => {
                                      const deadlineDate = new Date(poll.response_deadline);
                                      const today = new Date();
                                      const isToday = deadlineDate.toDateString() === today.toDateString();
                                      
                                      if (isToday) {
                                        return deadlineDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                      } else {
                                        return deadlineDate.toLocaleDateString();
                                      }
                                    })()}
                                  </span>
                                </div>
                              )}
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
                          {closedPolls.map(({ index, poll }) => (
                            <Link
                              key={`closed-poll-${index}-${poll.id}`}
                              href={`/poll?id=${poll.id}`}
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
                              <div className="absolute bottom-4 right-4">
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Expired: {(() => {
                                    const expiredDate = new Date(poll.response_deadline!);
                                    const today = new Date();
                                    const isToday = expiredDate.toDateString() === today.toDateString();
                                    
                                    if (isToday) {
                                      return expiredDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    } else {
                                      return expiredDate.toLocaleDateString();
                                    }
                                  })()}
                                </span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-500 dark:text-gray-400 italic">No Closed Polls</p>
                      )}
                    </div>

                    {/* Loading skeletons */}
                    {loadingPolls.length > 0 && (
                      <div className="space-y-3">
                        {loadingPolls.map(({ index }) => (
                          <PollSkeleton key={`skeleton-${index}`} />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
              
              {/* Bottom spacer for unloaded polls + padding at end */}
              {windowEnd < totalCount ? (
                <PollSpacer height={(totalCount - windowEnd) * POLL_HEIGHT + 24} />
              ) : (
                // Add padding when we're at the last item so it doesn't touch the bottom
                <div className="h-24" />
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

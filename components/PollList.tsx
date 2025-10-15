"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Poll } from "@/lib/supabase";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";

// Simple countdown component
const SimpleCountdown = ({ deadline }: { deadline: string }) => {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    
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
  }, [deadline, isClient]);

  return (
    <>
      <span className="font-mono font-semibold text-green-600 dark:text-green-400">{timeLeft}</span>
      {timeLeft !== "Expired" && " left"}
    </>
  );
};

interface PollListProps {
  polls: Poll[];
  showSections?: boolean; // Whether to show "Open Polls" and "Closed Polls" section headers
  sectionTitles?: {
    open?: string;
    closed?: string;
  };
}

export default function PollList({ polls, showSections = true, sectionTitles = { open: "Open Polls", closed: "Closed Polls" } }: PollListProps) {
  const router = useRouter();
  const [openPolls, setOpenPolls] = useState<Poll[]>([]);
  const [closedPolls, setClosedPolls] = useState<Poll[]>([]);
  const [votedPollIds, setVotedPollIds] = useState<Set<string>>(new Set());
  const [abstainedPollIds, setAbstainedPollIds] = useState<Set<string>>(new Set());
  const [modalPoll, setModalPoll] = useState<Poll | null>(null);
  const [showModal, setShowModal] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);
  const [pressedPollId, setPressedPollId] = useState<string | null>(null);
  const [navigatingPollId, setNavigatingPollId] = useState<string | null>(null);
  
  // Load voted and abstained polls from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      const voted = new Set<string>();
      const abstained = new Set<string>();
      
      Object.keys(votedPolls).forEach(id => {
        if (votedPolls[id] === 'abstained') {
          abstained.add(id);
        } else if (votedPolls[id] === true) {
          voted.add(id);
        }
      });
      
      setVotedPollIds(voted);
      setAbstainedPollIds(abstained);
    } catch (error) {
      console.error('Error loading voted polls:', error);
    }
  }, []);
  
  // Function to categorize and sort polls
  const categorizePollsByTime = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    const now = new Date();
    const open = polls.filter(poll => {
      if (!poll.response_deadline) return false;
      return new Date(poll.response_deadline) > now && !poll.is_closed;
    });

    const closed = polls.filter(poll => {
      if (!poll.response_deadline) return true;
      return new Date(poll.response_deadline) <= now || poll.is_closed;
    });
    
    // Sort open polls by voted status (unvoted first, then voted/abstained)
    // Within each group, sort by expiring soonest first
    const sortByVoted = (pollList: Poll[]) => {
      const unvoted = pollList.filter(p => !votedPollIds.has(p.id) && !abstainedPollIds.has(p.id));
      const voted = pollList.filter(p => votedPollIds.has(p.id) || abstainedPollIds.has(p.id));
      
      // Sort each group by expiring soonest (ascending deadline)
      const sortByDeadline = (polls: Poll[]) => {
        return polls.sort((a, b) => {
          const deadlineA = new Date(a.response_deadline || a.created_at).getTime();
          const deadlineB = new Date(b.response_deadline || b.created_at).getTime();
          return deadlineA - deadlineB; // Ascending order - soonest first
        });
      };
      
      return [...sortByDeadline(unvoted), ...sortByDeadline(voted)];
    };
    
    // Sort closed polls by most recently closed (newest closed first)
    const sortClosedByTime = (pollList: Poll[]) => {
      return pollList.sort((a, b) => {
        // First determine when each poll was closed
        const getClosingTime = (poll: Poll) => {
          if (poll.is_closed) {
            // If manually closed, we'll use response_deadline as proxy for closing time
            // In the future, we could add a closed_at timestamp field
            return new Date(poll.response_deadline || poll.created_at).getTime();
          } else {
            // If closed by deadline expiry, use response_deadline
            return new Date(poll.response_deadline || poll.created_at).getTime();
          }
        };
        
        const timeA = getClosingTime(a);
        const timeB = getClosingTime(b);
        
        // Sort by most recently closed first (descending order)
        return timeB - timeA;
      });
    };
    
    setOpenPolls(sortByVoted(open));
    setClosedPolls(sortClosedByTime(closed));
  }, [polls, votedPollIds, abstainedPollIds]);
  
  // Initial categorization when polls change
  useEffect(() => {
    categorizePollsByTime();
  }, [categorizePollsByTime]);
  
  // Set up timer to check for expired polls every 10 seconds
  useEffect(() => {
    if (typeof window === 'undefined' || polls.length === 0) return;
    
    const interval = setInterval(() => {
      categorizePollsByTime();
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(interval);
  }, [categorizePollsByTime, polls.length]);

  if (polls.length === 0) {
    return null;
  }

  return (
    <div>
      {/* Open Polls Section */}
      {openPolls.length > 0 && (
        <div className="mb-3">
          <div className="space-y-1">
            {openPolls.map((poll, index) => {
              const isVoted = votedPollIds.has(poll.id);
              const isAbstained = abstainedPollIds.has(poll.id);
              const hasVotedOrAbstained = isVoted || isAbstained;
              const prevPoll = index > 0 ? openPolls[index - 1] : null;
              const isPrevVoted = prevPoll ? (votedPollIds.has(prevPoll.id) || abstainedPollIds.has(prevPoll.id)) : false;
              const isFirstVoted = hasVotedOrAbstained && !isPrevVoted;
              
              const handleTouchStart = (e: React.TouchEvent) => {
                isLongPress.current = false;
                isScrolling.current = false;
                setPressedPollId(poll.id); // Set pressed state immediately
                touchStartPos.current = {
                  x: e.touches[0].clientX,
                  y: e.touches[0].clientY
                };

                longPressTimer.current = setTimeout(() => {
                  if (!isScrolling.current) {
                    isLongPress.current = true;
                    // Vibrate on Android (iOS doesn't support Vibration API)
                    if ('vibrate' in navigator) {
                      try {
                        navigator.vibrate(50);
                      } catch (err) {
                        // Silently fail on iOS
                      }
                    }
                    setModalPoll(poll);
                    setShowModal(true);
                    setPressedPollId(null); // Clear pressed state when modal opens
                  }
                }, 500); // 500ms for long press
              };

              const handleTouchEnd = (e: React.TouchEvent) => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }

                // Only navigate if not scrolling and not long press
                if (!isScrolling.current && !isLongPress.current) {
                  setNavigatingPollId(poll.id); // Show loading state
                  setPressedPollId(null); // Clear pressed state
                  router.push(`/p/${poll.id}`);
                } else {
                  // Reset states if not navigating
                  setPressedPollId(null); // Clear pressed state
                }

                touchStartPos.current = null;
                isScrolling.current = false;
              };

              const handleTouchMove = (e: React.TouchEvent) => {
                if (!touchStartPos.current) return;

                const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
                const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);

                // If moved more than 10px in any direction, consider it scrolling
                if (deltaX > 10 || deltaY > 10) {
                  isScrolling.current = true;
                  setPressedPollId(null); // Clear pressed state when scrolling

                  // Cancel long press timer if scrolling
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                }
              };

              return (
                <React.Fragment key={poll.id}>
                  {isFirstVoted && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-2.5 mb-2 ml-7">
                      Already Voted
                    </div>
                  )}
                  <div key={poll.id}>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-shrink-0 text-base">
                        {poll.poll_type === 'yes_no' ? '☐' : poll.poll_type === 'nomination' ? '💡' : poll.poll_type === 'ranked_choice' ? '🗳️' : poll.poll_type === 'participation' ? '🙋' : '☰'}
                      </div>
                      <div
                        onClick={() => {
                          setNavigatingPollId(poll.id);
                          router.push(`/p/${poll.id}`);
                        }}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onTouchMove={handleTouchMove}
                        className={`flex-1 ${pressedPollId === poll.id ? '' : hasVotedOrAbstained ? 'bg-gray-100 dark:bg-gray-800/50 opacity-75' : 'bg-white dark:bg-gray-800'} border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 active:scale-95 active:shadow-sm active:border-blue-400 dark:active:border-blue-500 ${pressedPollId === poll.id ? 'scale-95 !shadow-md !border-blue-500 dark:!border-blue-400 !bg-blue-100 dark:!bg-blue-900/40 opacity-100' : ''} transition-all cursor-pointer select-none relative`}
                      >
                        {navigatingPollId === poll.id && (
                          <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 flex items-center justify-center rounded-lg">
                            <svg className="animate-spin h-6 w-6 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          </div>
                        )}
                        <h3 className="font-medium text-lg line-clamp-2 text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {poll.title}
                        </h3>
                      </div>
                    </div>
                    {poll.response_deadline && (
                      <div className="text-right mt-1 mr-0 text-xs text-gray-500 dark:text-gray-400">
                        <ClientOnly fallback={<>Loading...</>}>
                          <SimpleCountdown deadline={poll.response_deadline} />
                        </ClientOnly>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Closed Polls Section */}
      {closedPolls.length > 0 && (
        <div className="mb-3">
          {openPolls.length > 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-2.5 mb-2 ml-7">
              Closed
            </div>
          )}
          <div className="space-y-1">
              {closedPolls.map((poll, index) => {
                const isVoted = votedPollIds.has(poll.id);
                const isAbstained = abstainedPollIds.has(poll.id);
                const hasVotedOrAbstained = isVoted || isAbstained;
                
                const handleTouchStart = (e: React.TouchEvent) => {
                  isLongPress.current = false;
                  isScrolling.current = false;
                  setPressedPollId(poll.id); // Set pressed state immediately
                  touchStartPos.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY
                  };

                  longPressTimer.current = setTimeout(() => {
                    if (!isScrolling.current) {
                      isLongPress.current = true;
                      // Vibrate on Android (iOS doesn't support Vibration API)
                      if ('vibrate' in navigator) {
                        try {
                          navigator.vibrate(50);
                        } catch (err) {
                          // Silently fail on iOS
                        }
                      }
                      setModalPoll(poll);
                      setShowModal(true);
                      setPressedPollId(null); // Clear pressed state when modal opens
                    }
                  }, 500); // 500ms for long press
                };

                const handleTouchEnd = (e: React.TouchEvent) => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }

                  // Only navigate if not scrolling and not long press
                  if (!isScrolling.current && !isLongPress.current) {
                    setNavigatingPollId(poll.id); // Show loading state
                    setPressedPollId(null); // Clear pressed state
                    router.push(`/p/${poll.id}`);
                  } else {
                    // Reset states if not navigating
                    setPressedPollId(null); // Clear pressed state
                  }

                  touchStartPos.current = null;
                  isScrolling.current = false;
                };

                const handleTouchMove = (e: React.TouchEvent) => {
                  if (!touchStartPos.current) return;

                  const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
                  const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);

                  // If moved more than 10px in any direction, consider it scrolling
                  if (deltaX > 10 || deltaY > 10) {
                    isScrolling.current = true;
                    setPressedPollId(null); // Clear pressed state when scrolling

                    // Cancel long press timer if scrolling
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                  }
                };

                return (
                  <div key={poll.id}>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-shrink-0 text-base">
                        {poll.poll_type === 'yes_no' ? '🏆' : poll.poll_type === 'nomination' ? '💡' : poll.poll_type === 'ranked_choice' ? '🗳️' : poll.poll_type === 'participation' ? '🙋' : '☰'}
                      </div>
                      <div
                        onClick={() => {
                          setNavigatingPollId(poll.id);
                          router.push(`/p/${poll.id}`);
                        }}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        onTouchMove={handleTouchMove}
                        className={`flex-1 ${pressedPollId === poll.id ? '' : 'bg-gray-100 dark:bg-gray-800/50'} border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 active:scale-95 active:shadow-sm active:border-blue-400 dark:active:border-blue-500 ${pressedPollId === poll.id ? 'scale-95 !shadow-md !border-blue-500 dark:!border-blue-400 !bg-blue-100 dark:!bg-blue-900/40 opacity-100' : 'opacity-75'} transition-all cursor-pointer select-none relative`}
                      >
                        {navigatingPollId === poll.id && (
                          <div className="absolute inset-0 bg-gray-100/90 dark:bg-gray-800/90 flex items-center justify-center rounded-lg">
                            <svg className="animate-spin h-6 w-6 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          </div>
                        )}
                        <h3 className="font-medium text-lg line-clamp-2 text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {poll.title}
                        </h3>
                      </div>
                    </div>
                    {poll.response_deadline && (
                      <div className="text-right -mt-1 mr-0">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Closed {(() => {
                            const deadline = new Date(poll.response_deadline);
                            const now = new Date();
                            const hoursAgo = (now.getTime() - deadline.getTime()) / (1000 * 60 * 60);

                            if (hoursAgo <= 24) {
                              // Within 24 hours, show only time
                              return deadline.toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true
                              });
                            } else {
                              // More than 24 hours ago, show only date
                              return deadline.toLocaleDateString("en-US", {
                                month: "numeric",
                                day: "numeric",
                                year: "2-digit"
                              });
                            }
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
              );
            })}
            </div>
        </div>
      )}

      {/* Follow-up Modal */}
      {modalPoll && (
        <FollowUpModal
          isOpen={showModal}
          poll={modalPoll}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
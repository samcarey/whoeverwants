"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Poll } from "@/lib/supabase";
import ClientOnly from "@/components/ClientOnly";

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
    <div className="text-right text-xs text-gray-500 dark:text-gray-400">
      <span className="font-mono font-semibold text-green-600 dark:text-green-400">{timeLeft}</span>
      {timeLeft !== "Expired" && " left"}
    </div>
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
        <div className="mb-8">
          <div className="space-y-3">
            {openPolls.map((poll, index) => {
              const isVoted = votedPollIds.has(poll.id);
              const isAbstained = abstainedPollIds.has(poll.id);
              const hasVotedOrAbstained = isVoted || isAbstained;
              const prevPoll = index > 0 ? openPolls[index - 1] : null;
              const isPrevVoted = prevPoll ? (votedPollIds.has(prevPoll.id) || abstainedPollIds.has(prevPoll.id)) : false;
              const isFirstVoted = hasVotedOrAbstained && !isPrevVoted;
              
              const handleTouchStart = (e: React.TouchEvent) => {
                isLongPress.current = false;
                longPressTimer.current = setTimeout(() => {
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
                }, 500); // 500ms for long press
              };

              const handleTouchEnd = (e: React.TouchEvent) => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
                if (!isLongPress.current) {
                  router.push(`/p/${poll.id}`);
                }
              };

              const handleTouchMove = () => {
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
              };

              return (
                <React.Fragment key={poll.id}>
                  {isFirstVoted && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-6 mb-2">
                      Already Voted
                    </div>
                  )}
                  <div
                    onClick={() => router.push(`/p/${poll.id}`)}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchMove}
                    className={`block ${hasVotedOrAbstained ? 'bg-gray-100 dark:bg-gray-800/50 opacity-75' : 'bg-white dark:bg-gray-800'} border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-sm hover:shadow-md hover:border-green-300 dark:hover:border-green-600 transition-all cursor-pointer relative select-none`}
                  >
                  {poll.response_deadline && (
                    <div className="absolute top-1 right-2 z-10">
                      <ClientOnly fallback={
                        <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                          Loading...
                        </div>
                      }>
                        <SimpleCountdown deadline={poll.response_deadline} />
                      </ClientOnly>
                    </div>
                  )}
                  <div>
                    <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors pr-20">
                      <span className="mr-2 text-base">
                        {poll.poll_type === 'yes_no' ? '☐' : '☰'}
                      </span>
                      {poll.title}
                    </h3>
                </div>
              </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Horizontal divider between sections - only show if both sections have content */}
      {openPolls.length > 0 && closedPolls.length > 0 && (
        <div className="mb-8">
          <hr className="border-gray-200 dark:border-gray-700" />
        </div>
      )}

      {/* Closed Polls Section */}
      {closedPolls.length > 0 && (
        <div className="mb-8">
            <div className="space-y-3">
              {closedPolls.map((poll, index) => {
                const isVoted = votedPollIds.has(poll.id);
                const isAbstained = abstainedPollIds.has(poll.id);
                const hasVotedOrAbstained = isVoted || isAbstained;
                
                const handleTouchStart = (e: React.TouchEvent) => {
                  isLongPress.current = false;
                  longPressTimer.current = setTimeout(() => {
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
                  }, 500); // 500ms for long press
                };

                const handleTouchEnd = (e: React.TouchEvent) => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                  if (!isLongPress.current) {
                    router.push(`/p/${poll.id}`);
                  }
                };

                const handleTouchMove = () => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                };

                return (
                  <div
                    key={poll.id}
                    onClick={() => router.push(`/p/${poll.id}`)}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchMove}
                    className={`block bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-600 transition-all cursor-pointer opacity-75 relative select-none`}
                  >
                    {poll.response_deadline && (
                      <div className="absolute top-1 right-2 z-10">
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
                  <div>
                    <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-red-600 dark:hover:text-red-400 transition-colors pr-20">
                      <span className="mr-2 text-base">
                        {poll.poll_type === 'yes_no' ? '☐' : '☰'}
                      </span>
                      {poll.title}
                    </h3>
                  </div>
                </div>
              );
            })}
            </div>
        </div>
      )}

      {/* Follow-up Modal */}
      {showModal && modalPoll && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[60] animate-fade-in"
            onClick={() => setShowModal(false)}
          />
          
          {/* Modal */}
          <div className="fixed bottom-0 left-0 right-0 z-[70] animate-slide-up">
            <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-6 pb-8">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Follow up to: {modalPoll.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Create a follow-up poll accessible to the same recipients
                </p>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    router.push(`/create-poll?followUpTo=${modalPoll.id}`);
                    setShowModal(false);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded-lg transition-colors duration-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                  Blank
                </button>
                
                <button
                  onClick={() => {
                    router.push(`/create-poll?followUpTo=${modalPoll.id}&copy=true`);
                    setShowModal(false);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors duration-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy
                </button>
                
                <button
                  onClick={() => {
                    router.push(`/create-poll?followUpTo=${modalPoll.id}&fork=true`);
                    setShowModal(false);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium text-sm rounded-lg transition-colors duration-200"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  Fork
                </button>
              </div>
              
              <button
                onClick={() => setShowModal(false)}
                className="w-full mt-4 py-2 text-gray-600 dark:text-gray-400 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
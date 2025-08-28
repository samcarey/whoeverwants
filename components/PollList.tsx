"use client";

import React, { useState, useEffect, useCallback } from "react";
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
      <span className="font-mono font-semibold text-green-600 dark:text-green-400">{timeLeft}</span> left
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
      {openPolls.length > 0 ? (
        <div className="mb-8">
          {showSections && (
            <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">{sectionTitles.open}</h3>
          )}
          <div className="space-y-3">
            {openPolls.map((poll, index) => {
              const isVoted = votedPollIds.has(poll.id);
              const isAbstained = abstainedPollIds.has(poll.id);
              const hasVotedOrAbstained = isVoted || isAbstained;
              const prevPoll = index > 0 ? openPolls[index - 1] : null;
              const isPrevVoted = prevPoll ? (votedPollIds.has(prevPoll.id) || abstainedPollIds.has(prevPoll.id)) : false;
              const isFirstVoted = hasVotedOrAbstained && !isPrevVoted;
              
              return (
                <React.Fragment key={poll.id}>
                  {isFirstVoted && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-6 mb-2">
                      Already Voted
                    </div>
                  )}
                  <div
                    onClick={() => router.push(`/p/${poll.id}`)}
                    className={`block ${hasVotedOrAbstained ? 'bg-gray-100 dark:bg-gray-800/50 opacity-75' : 'bg-white dark:bg-gray-800'} border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1 shadow-sm hover:shadow-md hover:border-green-300 dark:hover:border-green-600 transition-all cursor-pointer relative`}
                  >
                  {hasVotedOrAbstained && (
                    <div className="absolute top-1 right-1 z-10">
                      <span className={`text-white text-xs font-bold px-2 py-0.5 rounded ${
                        isAbstained ? 'bg-yellow-700' : 'bg-green-700'
                      }`}>
                        {isAbstained ? 'ABSTAINED' : 'VOTED'}
                      </span>
                    </div>
                  )}
                  <div className="mb-2">
                    <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors mb-2">
                      <span className="mr-2 text-base">
                        {poll.poll_type === 'yes_no' ? '☐' : '☰'}
                      </span>
                      {poll.title}
                    </h3>
                  <div className="flex items-center justify-between">
                    <div></div>
                    {poll.response_deadline && (
                      <ClientOnly fallback={
                        <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                          Loading...
                        </div>
                      }>
                        <SimpleCountdown deadline={poll.response_deadline} />
                      </ClientOnly>
                    )}
                  </div>
                </div>
              </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        showSections && (
          <div className="mb-8 text-center">
            <p className="text-xl text-gray-500 dark:text-gray-400">No Open Polls</p>
          </div>
        )
      )}

      {/* Closed Polls Section */}
      <div className="mb-8">
        {showSections && (
          <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">{sectionTitles.closed}</h3>
        )}
        {closedPolls.length > 0 ? (
          <div className="space-y-3">
            {closedPolls.map((poll, index) => {
              const isVoted = votedPollIds.has(poll.id);
              const isAbstained = abstainedPollIds.has(poll.id);
              const hasVotedOrAbstained = isVoted || isAbstained;
              
              return (
                <div
                  key={poll.id}
                  onClick={() => router.push(`/p/${poll.id}`)}
                  className={`block bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-600 transition-all cursor-pointer opacity-75 relative`}
                >
                  {hasVotedOrAbstained && (
                    <div className="absolute top-1 right-1 z-10">
                      <span className={`text-white text-xs font-bold px-2 py-0.5 rounded ${
                        isAbstained ? 'bg-yellow-700' : 'bg-green-700'
                      }`}>
                        {isAbstained ? 'ABSTAINED' : 'VOTED'}
                      </span>
                    </div>
                  )}
                <div className="mb-2">
                  <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-red-600 dark:hover:text-red-400 transition-colors mb-2">
                    <span className="mr-2 text-base">
                      {poll.poll_type === 'yes_no' ? '☐' : '☰'}
                    </span>
                    {poll.title}
                  </h3>
                  <div className="flex items-center justify-between">
                  <div></div>
                  {poll.response_deadline && (
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
                  )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        ) : (
          showSections && (
            <p className="text-gray-500 dark:text-gray-400 italic text-center">No Closed Polls</p>
          )
        )}
      </div>
    </div>
  );
}
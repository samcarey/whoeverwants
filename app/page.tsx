"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState, useCallback } from "react";
import { supabase, Poll } from "@/lib/supabase";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import ClientOnly from "@/components/ClientOnly";

// Fun activity phrases (max 25 chars)
const activityPhrases = [
  "Pizza",
  "to see a movie",
  "to hang out",
  "Coffee",
  "to play games",
  "Ice Cream",
  "to grab lunch",
  "Tacos",
  "to go bowling",
  "to hike",
  "Sushi",
  "to watch the game",
  "Happy Hour drinks",
  "to play basketball",
  "Brunch",
  "to hit the beach",
  "to try that new place",
  "to go dancing",
  "BBQ",
  "to play mini golf"
];

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

export default function Home() {
  const router = useRouter();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPhrase, setCurrentPhrase] = useState<string>("");
  const [displayedPhrase, setDisplayedPhrase] = useState<string>("");
  const [fontSize, setFontSize] = useState<string>("text-xl");
  const [titleReady, setTitleReady] = useState<boolean>(false);

  // Initialize and rotate phrases
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const STORAGE_KEY = 'whoeverwants_phrases';
    const INDEX_KEY = 'whoeverwants_phrase_index';
    
    // Get or initialize the randomized phrase list
    let storedPhrases = localStorage.getItem(STORAGE_KEY);
    let phraseList: string[];
    
    if (!storedPhrases) {
      // First time: randomize the array
      phraseList = [...activityPhrases].sort(() => Math.random() - 0.5);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(phraseList));
    } else {
      phraseList = JSON.parse(storedPhrases);
    }
    
    // Get current index and increment
    let currentIndex = parseInt(localStorage.getItem(INDEX_KEY) || '0');
    const nextIndex = (currentIndex + 1) % phraseList.length;
    localStorage.setItem(INDEX_KEY, nextIndex.toString());
    
    // Calculate font size based on total text length to keep it on one line
    // More generous breakpoints to better utilize available width
    const fullText = `Whoever Wants ${phraseList[currentIndex]}`;
    let calculatedFontSize = "text-xl";
    if (fullText.length > 35) {
      calculatedFontSize = "text-sm";
    } else if (fullText.length > 28) {
      calculatedFontSize = "text-base";  
    } else if (fullText.length > 22) {
      calculatedFontSize = "text-lg";
    }
    
    // Set everything at once to prevent flash
    setCurrentPhrase(phraseList[currentIndex]);
    setFontSize(calculatedFontSize);
    setTitleReady(true);
  }, []);

  // Animate the phrase typing effect
  useEffect(() => {
    if (!currentPhrase) return;
    
    setDisplayedPhrase(""); // Reset displayed phrase
    
    // Wait before starting the typing animation
    const initialDelay = setTimeout(() => {
      let currentIndex = 0;
      
      // Calculate delay per character to make total animation time constant (630ms)
      const totalAnimationTime = 630; // Total time for typing animation in ms (25% faster than 840ms)
      const charDelay = totalAnimationTime / currentPhrase.length;
      
      const typeInterval = setInterval(() => {
        if (currentIndex <= currentPhrase.length) {
          setDisplayedPhrase(currentPhrase.slice(0, currentIndex));
          currentIndex++;
        } else {
          clearInterval(typeInterval);
        }
      }, charDelay);
      
      // Store interval reference for cleanup
      return () => clearInterval(typeInterval);
    }, 392); // 392ms initial delay
    
    return () => clearTimeout(initialDelay);
  }, [currentPhrase]);

  useEffect(() => {
    async function fetchPolls() {
      try {
        setLoading(true);
        setError(null);

        // First, discover any new follow-up polls
        try {
          const discoveryResult = await discoverRelatedPolls();
          if (discoveryResult.newPollIds.length > 0) {
            console.log(`🔗 Discovered ${discoveryResult.newPollIds.length} follow-up polls`);
          }
        } catch (discoveryError) {
          console.warn('Poll discovery failed, continuing with existing polls:', discoveryError);
          // Don't fail the entire poll loading if discovery fails
        }

        // Get polls this browser has access to (including newly discovered ones)
        const data = await getAccessiblePolls();

        if (!data) {
          console.error("Error fetching accessible polls");
          setError("Failed to load polls");
          return;
        }

        setPolls(data);
      } catch (error) {
        console.error("Unexpected error:", error);
        setError("An unexpected error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchPolls();
  }, []);

  // Separate polls into open and closed (client-side only to avoid hydration mismatch)
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
    const sortByVoted = (pollList: Poll[]) => {
      const unvoted = pollList.filter(p => !votedPollIds.has(p.id) && !abstainedPollIds.has(p.id));
      const voted = pollList.filter(p => votedPollIds.has(p.id) || abstainedPollIds.has(p.id));
      return [...unvoted, ...voted];
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

  return (
    <div className="min-h-screen -mx-8 -my-8">
      {/* Fixed Header */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 safe-area-header">
        <div className="flex items-center justify-between pt-3 pb-2 px-2">
          <a
            href="https://github.com/samcarey/whoeverwants"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 rounded-full transition-colors flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 h-7 w-7"
            title="View on GitHub"
          >
            <svg
              className="w-7 h-7"
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
          
          <h1 className={`${fontSize} font-bold text-center flex-1 mx-2 whitespace-nowrap`}>
            {titleReady ? (
              <>
                Whoever Wants{displayedPhrase && (
                  <span className="text-blue-600 dark:text-blue-400" style={{fontFamily: '"M PLUS 1 Code", monospace'}}> {displayedPhrase}</span>
                )}
              </>
            ) : (
              <span className="opacity-0">Whoever Wants</span>
            )}
          </h1>
          
          
          {/* Invisible spacer to balance the layout */}
          <div className="w-7 h-7 flex-shrink-0"></div>
        </div>
      </div>

      {/* Content */}
      <div className="safe-area-content pb-8">
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
              Once you create a poll or open a link from someone, it will be shown here.
            </div>
          )}

          {!loading && !error && polls.length > 0 && (
            <div>
              {/* Open Polls Section */}
              {openPolls.length > 0 ? (
                <div className="mb-8">
                  <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Open Polls</h3>
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
                            <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors mb-2">{poll.title}</h3>
                          <div className="flex items-center justify-between">
                            <span className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${
                              poll.poll_type === 'yes_no' 
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                            }`}>
                              {poll.poll_type === 'yes_no' ? 'Yes/No' : 'Ranked Choice'}
                            </span>
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
                <div className="mb-8 text-center">
                  <p className="text-xl text-gray-500 dark:text-gray-400">No Open Polls</p>
                </div>
              )}

              {/* Closed Polls Section */}
              <div className="mb-8">
                <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Closed Polls</h3>
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
                          <h3 className="font-medium text-lg line-clamp-1 text-gray-900 dark:text-white hover:text-red-600 dark:hover:text-red-400 transition-colors mb-2">{poll.title}</h3>
                          <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${
                              poll.poll_type === 'yes_no' 
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                            }`}>
                              {poll.poll_type === 'yes_no' ? 'Yes/No' : 'Ranked Choice'}
                            </span>
                          </div>
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
                  <p className="text-gray-500 dark:text-gray-400 italic text-center">No Closed Polls</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Create Poll Button */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => router.push("/create-poll")}
          className="flex items-center justify-center px-4 py-2 bg-white dark:bg-gray-900 border border-solid border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 text-gray-700 dark:text-gray-300 font-semibold text-sm"
          title="Create new poll"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Poll
        </button>
      </div>
    </div>
  );
}
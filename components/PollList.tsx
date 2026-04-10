"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Poll, PollResults } from "@/lib/types";
import { getUserName } from "@/lib/userProfile";
import { getSeenPollOptions } from "@/lib/browserPollAccess";
import ClientOnly from "@/components/ClientOnly";
import FollowUpModal from "@/components/FollowUpModal";
import { getBuiltInType } from "@/components/TypeFieldInput";

const POLL_TYPE_SYMBOLS: Record<string, string> = {
  yes_no: '👍',
  ranked_choice: '🗳️',
  participation: '🙋',
};

const CLOSED_YES_NO_SYMBOL = '🏆';

function getPollSymbol(pollType: string, isClosed: boolean): string {
  if (pollType === 'yes_no' && isClosed) return CLOSED_YES_NO_SYMBOL;
  return POLL_TYPE_SYMBOLS[pollType] || '☰';
}

function getCategoryIcon(poll: Poll): string {
  const category = poll.category;
  if (category && category !== 'custom') {
    const builtIn = getBuiltInType(category);
    if (builtIn?.icon) return builtIn.icon;
  }
  // Custom or no category — use poll type symbol
  return getPollSymbol(poll.poll_type, poll.is_closed ?? false);
}

/** Extract image URLs from poll options metadata (skip entries without images). */
function getOptionIconUrls(poll: Poll): string[] {
  const meta = poll.options_metadata;
  if (!meta) return [];
  const keys = poll.options?.filter(o => meta[o]?.imageUrl) ??
    Object.keys(meta).filter(k => meta[k]?.imageUrl);
  return keys.map(k => meta[k].imageUrl!);
}

// Re-check overflow after lazy images load/fail
const IMAGE_SETTLE_MS = 1500;

/** Poll title h3 with inline option icons and overflow-based ellipsis. */
function PollTitle({ poll, className }: { poll: Poll; className: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const icons = useMemo(() => getOptionIconUrls(poll), [poll]);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || icons.length === 0) { setOverflows(false); return; }
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const t = setTimeout(check, IMAGE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [icons, poll.title]);

  return (
    <div className="relative">
      <h3 ref={ref} className={className}>
        {poll.title}
        {icons.length > 0 && (
          <>
            {' '}
            {icons.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="inline-block h-[1em] w-[1em] object-cover rounded-sm align-middle ml-0.5"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ))}
          </>
        )}
      </h3>
      {overflows && (
        <span className="absolute bottom-0 right-0 text-gray-400 dark:text-gray-500 text-[0.85em] leading-[1.4] pointer-events-none select-none">…</span>
      )}
    </div>
  );
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// Simple countdown component
const SimpleCountdown = ({ deadline, label }: { deadline: string; label: string }) => {
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
  }, [deadline, isClient]);

  return (
    <>
      {label && `${label}: `}<span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{timeLeft}</span>
    </>
  );
};

function isInSuggestionPhase(poll: Poll): boolean {
  if (poll.poll_type !== 'ranked_choice') return false;
  if (poll.suggestion_deadline && new Date(poll.suggestion_deadline) > new Date()) return true;
  if (!poll.suggestion_deadline && poll.suggestion_deadline_minutes) return true;
  return false;
}

function getOptionDisplayName(optionKey: string, poll: Poll): string {
  const meta = poll.options_metadata?.[optionKey];
  if (meta?.name) return meta.name;
  return optionKey;
}

interface ResultBadge {
  text: string;
  emoji: string;
  color: 'green' | 'red' | 'yellow' | 'gray';
}

const BADGE_COLORS = {
  green: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200',
  red: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200',
  gray: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
};

function getResultBadge(poll: Poll, results: PollResults | null | undefined, userVoteId?: string | null, userVoted?: boolean, userName?: string | null): ResultBadge {
  if (!results) {
    return { text: 'No results', emoji: '🔇', color: 'gray' };
  }

  if (results.total_votes === 0) {
    return { text: 'No voters', emoji: '🦗', color: 'gray' };
  }

  switch (poll.poll_type) {
    case 'yes_no': {
      if (results.winner === 'yes') return { text: 'Yes', emoji: '👑', color: 'green' };
      if (results.winner === 'no') return { text: 'No', emoji: '👑', color: 'red' };
      if (results.winner === 'tie') return { text: 'Tie', emoji: '🤝', color: 'yellow' };
      return { text: 'No winner', emoji: '🤷', color: 'gray' };
    }
    case 'ranked_choice': {
      if (results.winner) {
        return { text: getOptionDisplayName(results.winner, poll), emoji: '👑', color: 'green' };
      }
      return { text: 'No winner', emoji: '🤷', color: 'gray' };
    }
    case 'participation': {
      const participatingCount = results.yes_count || 0;
      let isHappening = participatingCount > 0;
      if (results.min_participants != null && participatingCount < results.min_participants) {
        isHappening = false;
      }
      if (results.max_participants != null && participatingCount > results.max_participants) {
        isHappening = false;
      }
      const userIsParticipating = !!(
        (userVoteId && results.participating_vote_ids?.includes(userVoteId)) ||
        (userName && results.participating_voter_names?.includes(userName))
      );
      if (isHappening && userIsParticipating) {
        if (participatingCount === 1) return { text: "You're going alone", emoji: '😢', color: 'yellow' };
        const others = participatingCount - 1;
        return { text: `You're going with ${others} other${others > 1 ? 's' : ''}`, emoji: '🎉', color: 'green' };
      }
      if (isHappening && !userVoted) return { text: "It's happening without you", emoji: '🎉', color: 'yellow' };
      if (isHappening) return { text: 'Happening', emoji: '🎉', color: 'green' };
      return { text: 'Not happening', emoji: '✗', color: 'red' };
    }
    default:
      return { text: 'Closed', emoji: '🔒', color: 'gray' };
  }
}

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
  const [pollVoteIds, setPollVoteIds] = useState<Record<string, string>>({});
  const [pollsWithNewOptions, setPollsWithNewOptions] = useState<Set<string>>(new Set());
  const [modalPoll, setModalPoll] = useState<Poll | null>(null);
  const [showModal, setShowModal] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);
  const [pressedPollId, setPressedPollId] = useState<string | null>(null);
  const [navigatingPollId, setNavigatingPollId] = useState<string | null>(null);
  const savedUserName = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getUserName();
  }, []);

  const resultBadges = useMemo(() => {
    const badges: Record<string, ResultBadge> = {};
    for (const poll of closedPolls) {
      const userVoted = votedPollIds.has(poll.id) || abstainedPollIds.has(poll.id);
      badges[poll.id] = getResultBadge(poll, poll.results, pollVoteIds[poll.id], userVoted, savedUserName);
    }
    return badges;
  }, [closedPolls, pollVoteIds, votedPollIds, abstainedPollIds, savedUserName]);
  
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

      const voteIds: Record<string, string> = {};
      const storedVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
      Object.assign(voteIds, storedVoteIds);
      Object.keys(votedPolls).forEach(id => {
        if (!voteIds[id] && votedPolls[id]?.voteId) {
          voteIds[id] = votedPolls[id].voteId;
        }
      });
      setPollVoteIds(voteIds);

      // Detect polls where new suggestions were added since the user last voted.
      // Compare stored seen-options against current poll data (suggestion_counts or options).
      const withNew = new Set<string>();
      for (const poll of polls) {
        if (poll.poll_type !== 'ranked_choice') continue;
        if (poll.is_closed) continue;
        if (!voted.has(poll.id)) continue; // only for polls the user voted on
        const seen = getSeenPollOptions(poll.id);
        if (seen.length === 0) continue; // no stored baseline → can't compare
        const current: string[] =
          poll.results?.suggestion_counts?.map((sc: { option: string }) => sc.option) ??
          (Array.isArray(poll.options) ? poll.options : []);
        if (current.some(o => !seen.includes(o))) {
          withNew.add(poll.id);
        }
      }
      setPollsWithNewOptions(withNew);
    } catch (error) {
      console.error('Error loading voted polls:', error);
    }
  }, [polls]);
  
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
    
    const getEffectiveCutoff = (poll: Poll): number => {
      if (isInSuggestionPhase(poll)) {
        if (poll.suggestion_deadline) return new Date(poll.suggestion_deadline).getTime();
        // Timer not started — sort after polls with active countdowns
        return Infinity;
      }
      return new Date(poll.response_deadline || poll.created_at).getTime();
    };

    const sortByVoted = (pollList: Poll[]) => {
      const unvoted = pollList.filter(p => !votedPollIds.has(p.id) && !abstainedPollIds.has(p.id));
      const voted = pollList.filter(p => votedPollIds.has(p.id) || abstainedPollIds.has(p.id));

      const sortByCutoff = (polls: Poll[]) => {
        return polls.sort((a, b) => getEffectiveCutoff(a) - getEffectiveCutoff(b));
      };

      return [...sortByCutoff(unvoted), ...sortByCutoff(voted)];
    };

    const sortClosedByTime = (pollList: Poll[]) => {
      return pollList.sort((a, b) => {
        const getClosingTime = (poll: Poll) => {
          if (poll.close_reason === 'manual') {
            return new Date(poll.updated_at).getTime();
          }
          return new Date(poll.response_deadline || poll.created_at).getTime();
        };
        return getClosingTime(b) - getClosingTime(a);
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
        <div>
          <div>
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
                  router.push(`/p/${poll.short_id || poll.id}`);
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
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-medium px-4 py-1.5 border-y border-gray-200 dark:border-gray-700 mx-1.5 bg-gray-50 dark:bg-gray-800/30">
                      Already Voted
                    </div>
                  )}
                  <div key={poll.id} className={`border-b ${index === 0 && !isFirstVoted ? 'border-t' : ''} border-gray-200 dark:border-gray-700 mx-1.5`}>
                    <div
                      onClick={() => {
                        setNavigatingPollId(poll.id);
                        router.push(`/p/${poll.short_id || poll.id}`);
                      }}
                      onTouchStart={handleTouchStart}
                      onTouchEnd={handleTouchEnd}
                      onTouchMove={handleTouchMove}
                      className={`px-1 py-2.5 ${pressedPollId === poll.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''} hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-blue-50 dark:active:bg-blue-900/30 transition-colors cursor-pointer select-none relative`}
                    >
                      {navigatingPollId === poll.id && (
                        <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center">
                          <svg className="animate-spin h-6 w-6 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{getCategoryIcon(poll)}</span>
                          <ClientOnly fallback={null}>
                            {pollsWithNewOptions.has(poll.id) && (
                              <span className="flex items-center gap-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                </svg>
                                New options
                              </span>
                            )}
                          </ClientOnly>
                        </div>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          <ClientOnly fallback={<>Loading...</>}>
                            {(() => {
                              const inSuggestions = isInSuggestionPhase(poll);
                              if (inSuggestions && poll.suggestion_deadline) {
                                return <SimpleCountdown deadline={poll.suggestion_deadline} label="Suggestions" />;
                              }
                              if (inSuggestions && poll.suggestion_deadline_minutes) {
                                return <span className="font-semibold text-blue-600 dark:text-blue-400">Taking Suggestions</span>;
                              }
                              if (poll.response_deadline) {
                                return <SimpleCountdown deadline={poll.response_deadline} label="Voting" />;
                              }
                              return null;
                            })()}
                          </ClientOnly>
                        </span>
                      </div>
                      <PollTitle poll={poll} className="font-medium text-lg line-clamp-2 text-gray-900 dark:text-white" />
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          <ClientOnly fallback={null}>
                            <>{poll.creator_name && <>{poll.creator_name} &middot; </>}{relativeTime(poll.created_at)}</>
                          </ClientOnly>
                        </div>
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_COLORS.gray}`}>
                          {(poll.response_count ?? 0) > 0
                            ? `${poll.response_count} ${poll.response_count === 1 ? 'response' : 'responses'}`
                            : 'No responses yet'}
                        </span>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Closed Polls Section */}
      {closedPolls.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium px-4 py-1.5 border-y border-gray-200 dark:border-gray-700 mx-1.5 bg-gray-50 dark:bg-gray-800/30">
            Closed
          </div>
          <div>
              {closedPolls.map((poll, index) => {
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
                    router.push(`/p/${poll.short_id || poll.id}`);
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
                  <div key={poll.id} className="border-b border-gray-200 dark:border-gray-700 mx-1.5">
                    <div
                      onClick={() => {
                        setNavigatingPollId(poll.id);
                        router.push(`/p/${poll.short_id || poll.id}`);
                      }}
                      onTouchStart={handleTouchStart}
                      onTouchEnd={handleTouchEnd}
                      onTouchMove={handleTouchMove}
                      className={`px-1 py-2.5 ${pressedPollId === poll.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''} hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-blue-50 dark:active:bg-blue-900/30 transition-colors cursor-pointer select-none relative`}
                    >
                      {navigatingPollId === poll.id && (
                        <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center">
                          <svg className="animate-spin h-6 w-6 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{getCategoryIcon(poll)}</span>
                        {(poll.response_deadline || poll.updated_at) && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            <ClientOnly fallback={<>Closed</>}>
                              <>Closed {(() => {
                                const closedAt = poll.close_reason === 'manual'
                                  ? new Date(poll.updated_at)
                                  : new Date(poll.response_deadline || poll.updated_at);
                                const now = new Date();
                                const hoursAgo = (now.getTime() - closedAt.getTime()) / (1000 * 60 * 60);

                                if (hoursAgo <= 24) {
                                  return closedAt.toLocaleTimeString("en-US", {
                                    hour: "numeric",
                                    minute: "2-digit",
                                    hour12: true
                                  });
                                } else {
                                  return closedAt.toLocaleDateString("en-US", {
                                    month: "numeric",
                                    day: "numeric",
                                    year: "2-digit"
                                  });
                                }
                              })()}</>
                            </ClientOnly>
                          </span>
                        )}
                      </div>
                      <PollTitle poll={poll} className="font-medium text-lg leading-[1.2] line-clamp-2 text-gray-900 dark:text-white mt-1 mb-1" />
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          <ClientOnly fallback={null}>
                            <>{poll.creator_name && <>{poll.creator_name} &middot; </>}{relativeTime(poll.created_at)}</>
                          </ClientOnly>
                        </div>
                        {(() => {
                          const badge = resultBadges[poll.id];
                          return badge && (
                            <div className="flex items-center gap-1 max-w-[40%]">
                              <span className="flex-shrink-0 text-xs leading-none -mt-px">{badge.emoji}</span>
                              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full truncate ${BADGE_COLORS[badge.color]}`}>
                                {badge.text}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
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
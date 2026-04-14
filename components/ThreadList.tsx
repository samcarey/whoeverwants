"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Poll } from "@/lib/types";
import { buildThreads, getThreadRouteId, Thread } from "@/lib/threadUtils";
import { relativeTime } from "@/lib/pollListUtils";
import { loadVotedPolls } from "@/lib/votedPollsStorage";
import ClientOnly from "@/components/ClientOnly";
import RespondentCircles from "@/components/RespondentCircles";
import { usePrefetch } from "@/lib/prefetch";

const SimpleCountdown = ({ deadline, colorClass = "text-green-600 dark:text-green-400" }: { deadline: string; colorClass?: string }) => {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isClient, setIsClient] = useState(false);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    if (!isClient) return;
    const updateCountdown = () => {
      const now = new Date().getTime();
      const deadlineTime = new Date(deadline).getTime();
      const difference = deadlineTime - now;
      if (difference <= 0) { setTimeLeft("Expired"); return; }
      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);
      let timeString = "";
      if (days > 0) timeString = `${days}d ${hours}h ${minutes}m`;
      else if (hours > 0) timeString = `${hours}h ${minutes}m ${seconds}s`;
      else if (minutes > 0) timeString = `${minutes}m ${seconds}s`;
      else timeString = `${seconds}s`;
      setTimeLeft(timeString);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [deadline, isClient]);

  return <span className={`font-mono font-semibold ${colorClass}`}>{timeLeft}</span>;
};

interface ThreadListProps {
  polls: Poll[];
}

export default function ThreadList({ polls }: ThreadListProps) {
  const router = useRouter();
  const { prefetchBatch } = usePrefetch();
  const [votedPollIds, setVotedPollIds] = useState<Set<string>>(new Set());
  const [abstainedPollIds, setAbstainedPollIds] = useState<Set<string>>(new Set());
  const [pressedThreadId, setPressedThreadId] = useState<string | null>(null);
  const [navigatingThreadId, setNavigatingThreadId] = useState<string | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const isScrolling = useRef(false);

  // Load voted/abstained from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { votedPollIds: voted, abstainedPollIds: abstained } = loadVotedPolls();
    setVotedPollIds(voted);
    setAbstainedPollIds(abstained);
  }, []);

  const threads = useMemo(() => {
    return buildThreads(polls, votedPollIds, abstainedPollIds);
  }, [polls, votedPollIds, abstainedPollIds]);

  // Prefetch thread page routes for all visible threads on mount
  useEffect(() => {
    if (threads.length === 0) return;
    const hrefs = threads.map(t => `/thread/${getThreadRouteId(t)}`);
    prefetchBatch(hrefs, { priority: "low" });
  }, [threads, prefetchBatch]);

  if (threads.length === 0) return null;

  return (
    <div>
      {threads.map((thread, index) => {
        const routeId = getThreadRouteId(thread);
        const latestPoll = thread.latestPoll;
        const hasUnvoted = thread.unvotedCount > 0;

        const handleTouchStart = (e: React.TouchEvent) => {
          isScrolling.current = false;
          setPressedThreadId(thread.rootPollId);
          touchStartPos.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        };

        const handleTouchEnd = () => {
          if (!isScrolling.current) {
            setNavigatingThreadId(thread.rootPollId);
            setPressedThreadId(null);
            router.push(`/thread/${routeId}`);
          } else {
            setPressedThreadId(null);
          }
          touchStartPos.current = null;
          isScrolling.current = false;
        };

        const handleTouchMove = (e: React.TouchEvent) => {
          if (!touchStartPos.current) return;
          const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
          const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
          if (deltaX > 10 || deltaY > 10) {
            isScrolling.current = true;
            setPressedThreadId(null);
          }
        };

        return (
          <div
            key={thread.rootPollId}
            className={`border-b ${index === 0 ? 'border-t' : ''} border-gray-200 dark:border-gray-700 mx-1.5`}
          >
            <div
              onClick={() => {
                console.log(`[ThreadList] navigating to /thread/${routeId} at t=${performance.now().toFixed(0)}`);
                setNavigatingThreadId(thread.rootPollId);
                router.push(`/thread/${routeId}`);
              }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              className={`flex gap-3 pl-2 pr-3 py-3 ${pressedThreadId === thread.rootPollId ? 'bg-blue-50 dark:bg-blue-900/30' : ''} hover:bg-gray-50 dark:hover:bg-gray-800/50 active:bg-blue-50 dark:active:bg-blue-900/30 transition-colors cursor-pointer select-none relative`}
            >
              {navigatingThreadId === thread.rootPollId && (
                <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center z-10">
                  <svg className="animate-spin h-6 w-6 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}

              {/* Respondent circles */}
              <RespondentCircles
                names={thread.participantNames}
                anonymousCount={thread.anonymousRespondentCount}
              />

              {/* Text content */}
              <div className="flex-1 min-w-0">
                {/* Row 1: Thread title + unvoted badge */}
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`font-semibold text-base truncate flex-1 ${hasUnvoted ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                    {thread.title}
                  </h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasUnvoted && (
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                        {thread.unvotedCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: Latest poll title (preview) */}
                <p className="text-sm text-gray-600 dark:text-gray-300 truncate mt-0.5">
                  {latestPoll.title}
                </p>

                {/* Row 3: Metadata row */}
                <div className="flex items-center justify-between mt-1">
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    <ClientOnly fallback={null}>
                      <>
                        {thread.polls.length > 1 && <>{thread.polls.length} polls &middot; </>}
                        {relativeTime(latestPoll.created_at)}
                      </>
                    </ClientOnly>
                  </div>
                  {thread.soonestUnvotedDeadline && (
                    <div className="text-xs">
                      <ClientOnly fallback={null}>
                        <SimpleCountdown deadline={thread.soonestUnvotedDeadline} />
                      </ClientOnly>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { Poll } from "@/lib/types";
import { apiGetPollById, apiGetPollByShortId } from "@/lib/api";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useParams, useSearchParams } from "next/navigation";
import PollPageClient from "./PollPageClient";

function PollContent() {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pollId, setPollId] = useState<string | null>(null);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  // Prefetch critical pages
  useEffect(() => {
    router.prefetch('/');
  }, [router]);

  useEffect(() => {
    const pollId = params.shortId as string; // Note: this is actually a UUID now, not a short_id
    
    if (!pollId) {
      router.replace('/');
      return;
    }

    async function fetchPoll() {
      try {
        // Try to fetch poll by UUID first, fall back to short_id
        let pollData: Poll | null = null;
        try {
          // UUID format check (simple heuristic)
          if (pollId.length > 10 && pollId.includes('-')) {
            pollData = await apiGetPollById(pollId);
          } else {
            pollData = await apiGetPollByShortId(pollId);
          }
        } catch {
          // If lookup fails, only try short_id fallback if it doesn't look like a UUID
          if (!(pollId.length > 10 && pollId.includes('-'))) {
            try {
              pollData = await apiGetPollByShortId(pollId);
            } catch {
              pollData = null;
            }
          }
        }
        // Grant access to this poll
        if (pollData) {
          addAccessiblePollId(pollData.id);
        }
        
        if (!pollData) {
          setError(true);
          return;
        }

        setPoll(pollData);
        setPollId(pollData.id);
      } catch (err) {
        console.error('Error fetching poll:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchPoll();
  }, [params.shortId, router]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading poll...</p>
        </div>
      </div>
    );
  }

  if (error || !poll) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Poll Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">This poll may have been removed or the link is incorrect.</p>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const createdDateTime = new Date(poll.created_at);
  const createdTime = createdDateTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  const createdDate = `@ ${createdTime} ${createdDateTime.toLocaleDateString("en-US", {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  })}`;

  return (
    <div className="pb-4">
      <PollPageClient poll={poll} createdDate={createdDate} pollId={pollId} />
    </div>
  );
}

export default function PollPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-64 mx-auto mb-4"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mx-auto mb-8"></div>
            <div className="space-y-3">
              <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
              <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            </div>
          </div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading poll...</p>
        </div>
      </div>
    }>
      <PollContent />
    </Suspense>
  );
}
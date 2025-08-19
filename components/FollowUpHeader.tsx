"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface FollowUpHeaderProps {
  followUpToPollId: string;
}

export default function FollowUpHeader({ followUpToPollId }: FollowUpHeaderProps) {
  const [originalPollTitle, setOriginalPollTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchOriginalPoll() {
      if (!followUpToPollId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('polls')
          .select('title, id')
          .eq('id', followUpToPollId)
          .single();

        if (error || !data) {
          console.error('Error fetching original poll:', error);
          setError(true);
        } else {
          setOriginalPollTitle(data.title);
        }
      } catch (err) {
        console.error('Error fetching original poll:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchOriginalPoll();
  }, [followUpToPollId]);

  if (loading) {
    return (
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 bg-blue-100 dark:bg-blue-800 rounded-full">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-blue-900 dark:text-blue-100">Follow-up Poll</h3>
            <p className="text-sm text-blue-700 dark:text-blue-300">Loading original poll...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !originalPollTitle) {
    return (
      <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 bg-yellow-100 dark:bg-yellow-800 rounded-full">
            <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.664-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-yellow-900 dark:text-yellow-100">Follow-up Poll</h3>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">Unable to load original poll details</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 bg-blue-100 dark:bg-blue-800 rounded-full">
          <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" 
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100">Follow-up Poll</h3>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Follow up to:{" "}
            <Link 
              href={`/p/${followUpToPollId}`}
              className="font-medium hover:underline"
            >
              &ldquo;{originalPollTitle}&rdquo;
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
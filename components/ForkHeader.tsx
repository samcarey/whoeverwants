"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ForkHeaderProps {
  forkOfPollId: string;
}

export default function ForkHeader({ forkOfPollId }: ForkHeaderProps) {
  const router = useRouter();
  const [originalPollTitle, setOriginalPollTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchOriginalPoll() {
      if (!forkOfPollId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('polls')
          .select('title, id')
          .eq('id', forkOfPollId)
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
  }, [forkOfPollId]);

  if (loading) {
    return (
      <div className="-mt-2 mb-3 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-center">
        <div className="text-sm text-green-900 dark:text-green-100 mb-1 flex items-center justify-center flex-wrap gap-x-1">
          <span>Fork of</span>
          <span className="inline-flex items-center px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 rounded text-sm font-medium text-green-800 dark:text-green-200 relative overflow-hidden whitespace-nowrap min-w-0 max-w-[180px]">
            <span className="flex space-x-1">
              <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
              <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
              <span className="w-1 h-1 bg-current rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
            </span>
            <div className="absolute top-0 right-0 bottom-0 w-3 bg-gradient-to-l from-green-100 dark:from-green-900/50 to-transparent pointer-events-none"></div>
          </span>
        </div>
        <p className="text-xs text-green-600 dark:text-green-400">
          Based on the original poll structure
        </p>
      </div>
    );
  }

  if (error || !originalPollTitle) {
    return (
      <div className="-mt-2 mb-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 bg-yellow-100 dark:bg-yellow-800 rounded-full">
            <svg className="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.664-.833-2.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-yellow-900 dark:text-yellow-100">Forked Poll</h3>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">Unable to load original poll details</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="-mt-2 mb-3 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-center">
      <div className="text-sm text-green-900 dark:text-green-100 mb-1 flex items-center justify-center flex-wrap gap-x-1">
        <span>Fork of</span>
        <button 
          onClick={() => router.push(`/p/${forkOfPollId}`)}
          className="inline-flex items-center px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 hover:bg-green-200 dark:hover:bg-green-800/70 rounded text-sm font-medium text-green-800 dark:text-green-200 transition-colors relative overflow-hidden whitespace-nowrap min-w-0 max-w-[180px]"
          title={originalPollTitle}
        >
          <span className="truncate">{originalPollTitle}</span>
          <div className="absolute top-0 right-0 bottom-0 w-3 bg-gradient-to-l from-green-100 dark:from-green-900/50 to-transparent pointer-events-none"></div>
        </button>
      </div>
      <p className="text-xs text-green-600 dark:text-green-400">
        Based on the original poll structure
      </p>
    </div>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, Poll } from "@/lib/supabase";

// Calculate polls per page based on viewport height
const calculatePollsPerPage = () => {
  if (typeof window === 'undefined') return 8; // Default for SSR
  
  const viewportHeight = window.innerHeight;
  const headerHeight = 64; // Home button area
  const buttonSectionHeight = 120; // Create Poll button section
  const titleHeight = 80; // "Recent Polls" title
  const paginationHeight = 80; // Pagination controls
  const margins = 64; // Top and bottom margins
  
  const availableHeight = viewportHeight - headerHeight - buttonSectionHeight - titleHeight - paginationHeight - margins;
  const pollItemHeight = 88; // Height of each poll item including spacing
  
  return Math.max(3, Math.floor(availableHeight / pollItemHeight));
};

export default function Home() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollsPerPage, setPollsPerPage] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    // Calculate polls per page on mount and window resize
    const updatePollsPerPage = () => {
      setPollsPerPage(calculatePollsPerPage());
    };

    updatePollsPerPage();
    window.addEventListener('resize', updatePollsPerPage);

    return () => window.removeEventListener('resize', updatePollsPerPage);
  }, []);

  useEffect(() => {
    fetchPolls();
  }, [currentPage, pollsPerPage]);

  const fetchPolls = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get total count
      const { count } = await supabase
        .from("polls")
        .select("*", { count: "exact", head: true });

      setTotalCount(count || 0);

      // Get paginated polls
      const { data, error } = await supabase
        .from("polls")
        .select("*")
        .order("created_at", { ascending: false })
        .range((currentPage - 1) * pollsPerPage, currentPage * pollsPerPage - 1);

      if (error) {
        console.error("Error fetching polls:", error);
        setError("Failed to load polls");
        return;
      }

      setPolls(data || []);
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(totalCount / pollsPerPage);

  return (
    <div className="h-[calc(100vh-128px)] flex flex-col">
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

      {/* Polls List Section */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        <h2 className="text-2xl font-bold mb-4 text-center flex-shrink-0">Recent Polls</h2>
        
        {/* Content Area - grows to fill available space */}
        <div className="flex-1 flex flex-col justify-center min-h-0">
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
              No polls created yet. Be the first to create one!
            </div>
          )}

          {!loading && !error && polls.length > 0 && (
            <div className="space-y-3 overflow-hidden">
              {polls.map((poll) => (
                <div
                  key={poll.id}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow flex-shrink-0"
                >
                  <h3 className="font-medium text-lg mb-2 line-clamp-1">{poll.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Created {new Date(poll.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination - always at bottom */}
        <div className="flex-shrink-0 pt-4 pb-2">
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Previous
              </button>
              
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {currentPage} of {totalPages}
              </span>
              
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

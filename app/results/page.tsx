"use client";

import { supabase, Poll, getPollResults, PollResults } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import PollResultsDisplay from "@/components/PollResults";
import Link from "next/link";

function ResultsContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [poll, setPoll] = useState<Poll | null>(null);
  const [results, setResults] = useState<PollResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) {
      setError(true);
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        // Fetch poll info
        const { data: pollData, error: pollError } = await supabase
          .from("polls")
          .select("*")
          .eq("id", id)
          .single();

        if (pollError || !pollData) {
          setError(true);
          return;
        }

        setPoll(pollData);

        // Fetch results
        const pollResults = await getPollResults(id);
        if (pollResults) {
          setResults(pollResults);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Loading results...</p>
        </div>
      </div>
    );
  }

  if (error || !poll || !results) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Results Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            The poll results could not be loaded.
          </p>
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-solid border-gray-300 dark:border-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-2 text-sm font-medium"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  const createdDate = new Date(poll.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6">
        {/* Poll Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">
            {poll.title}
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Poll Results • Created {createdDate}
          </p>
        </div>

        {/* Results Display */}
        <PollResultsDisplay results={results} />

        {/* Navigation */}
        <div className="mt-8 flex justify-center space-x-4">
          <Link
            href={`/poll?id=${poll.id}`}
            className="inline-flex items-center rounded-full border border-solid border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900 px-6 py-2 text-sm font-medium"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            View Poll
          </Link>
          
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-solid border-gray-300 dark:border-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-2 text-sm font-medium"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12v0"
              />
            </svg>
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <ResultsContent />
    </Suspense>
  );
}
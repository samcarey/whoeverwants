"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, Poll } from "@/lib/supabase";

export default function HomeDebug() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  const addDebugInfo = (info: string) => {
    console.log(`[DEBUG] ${info}`);
    setDebugInfo(prev => [...prev, `${new Date().toISOString()}: ${info}`]);
  };

  useEffect(() => {
    addDebugInfo("Component mounted, starting debug");
    
    // Log environment info
    addDebugInfo(`NODE_ENV: ${process.env.NODE_ENV}`);
    addDebugInfo(`Client-side check: ${typeof window !== 'undefined'}`);
    
    async function fetchPolls() {
      try {
        addDebugInfo("Starting fetchPolls function");
        setLoading(true);
        setError(null);

        // Debug the supabase client
        addDebugInfo(`Supabase client exists: ${!!supabase}`);
        
        // Check what URL the client is configured for
        const supabaseUrl = (supabase as any).supabaseUrl;
        const supabaseKey = (supabase as any).supabaseKey;
        addDebugInfo(`Supabase URL: ${supabaseUrl?.substring(0, 30)}...`);
        addDebugInfo(`Supabase Key exists: ${!!supabaseKey}`);

        addDebugInfo("Making Supabase API call...");
        const { data, error } = await supabase
          .from("polls")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);

        addDebugInfo(`API call completed`);
        addDebugInfo(`Error: ${error ? JSON.stringify(error) : 'null'}`);
        addDebugInfo(`Data type: ${typeof data}`);
        addDebugInfo(`Data length: ${Array.isArray(data) ? data.length : 'not array'}`);
        
        if (Array.isArray(data) && data.length > 0) {
          addDebugInfo(`First poll: ${JSON.stringify(data[0]).substring(0, 100)}...`);
        }

        if (error) {
          addDebugInfo(`Error details: ${error.message}`);
          console.error("Error fetching polls:", error);
          setError("Failed to load polls");
          return;
        }

        addDebugInfo(`Setting polls state with ${(data || []).length} items`);
        setPolls(data || []);
      } catch (error) {
        addDebugInfo(`Catch block: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error("Unexpected error:", error);
        setError("An unexpected error occurred");
      } finally {
        addDebugInfo("fetchPolls finally block");
        setLoading(false);
      }
    }

    fetchPolls();
  }, []);

  // Separate polls into open and closed with debug info
  const openPolls = polls.filter(poll => {
    if (!poll.response_deadline) return false;
    const isOpen = new Date(poll.response_deadline) > new Date() && !poll.is_closed;
    addDebugInfo(`Poll "${poll.title}": deadline=${poll.response_deadline}, isOpen=${isOpen}`);
    return isOpen;
  });

  const closedPolls = polls.filter(poll => {
    if (!poll.response_deadline) return true;
    return new Date(poll.response_deadline) <= new Date() || poll.is_closed;
  });

  addDebugInfo(`Final counts: total=${polls.length}, open=${openPolls.length}, closed=${closedPolls.length}`);

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      {/* Fixed Header */}
      <div className="fixed top-0 left-0 right-0 z-20 bg-white dark:bg-black safe-area-header">
        <div className="flex items-center justify-center py-4 relative">
          <Link
            href="/create-poll"
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 px-8 min-w-[200px]"
          >
            Create Poll
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="safe-area-content pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-8">
          
          {/* Debug Info Panel */}
          <div className="mb-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <h2 className="font-bold mb-2 text-red-600">🐛 DEBUG INFO (Production Site)</h2>
            <div className="text-xs space-y-1 max-h-60 overflow-y-auto">
              {debugInfo.map((info, i) => (
                <div key={i} className="font-mono">{info}</div>
              ))}
            </div>
          </div>

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
                  <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Open Polls ({openPolls.length})</h3>
                  <div className="space-y-3">
                    {openPolls.map((poll) => (
                      <Link
                        key={poll.id}
                        href={`/p/${poll.id}`}
                        className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-green-300 dark:hover:border-green-600 transition-all cursor-pointer relative"
                      >
                        <h3 className="font-medium text-lg text-gray-900 dark:text-white">{poll.title}</h3>
                        <div className="text-sm text-gray-500">ID: {poll.id}</div>
                        <div className="text-sm text-gray-500">Deadline: {poll.response_deadline}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mb-8 text-center">
                  <p className="text-xl text-gray-500 dark:text-gray-400">No Open Polls</p>
                </div>
              )}

              {/* Closed Polls Section */}
              <div className="mb-8">
                <h3 className="text-2xl font-bold mb-4 text-center text-gray-900 dark:text-white">Closed Polls ({closedPolls.length})</h3>
                {closedPolls.length > 0 ? (
                  <div className="space-y-3">
                    {closedPolls.map((poll) => (
                      <Link
                        key={poll.id}
                        href={`/p/${poll.id}`}
                        className="block bg-red-50 dark:bg-red-950/20 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-600 transition-all cursor-pointer opacity-75 relative"
                      >
                        <h3 className="font-medium text-lg text-gray-900 dark:text-white">{poll.title}</h3>
                        <div className="text-sm text-gray-500">ID: {poll.id}</div>
                        <div className="text-sm text-gray-500">Deadline: {poll.response_deadline}</div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 italic text-center">No Closed Polls</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { Poll } from "@/lib/supabase";
import { getAccessiblePolls } from "@/lib/simplePollQueries";
import { discoverRelatedPolls } from "@/lib/pollDiscovery";
import PollList from "@/components/PollList";

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

          {!loading && !error && (
            <PollList polls={polls} showSections={true} />
          )}
        </div>
      </div>

      {/* Floating Create Poll Button */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => router.push("/create-poll")}
          className="flex items-center justify-center px-5 py-3 bg-white dark:bg-gray-900 border border-solid border-blue-400 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 text-blue-600 dark:text-blue-400 font-semibold text-base"
          title="Create new poll"
        >
          <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Poll
        </button>
      </div>
    </div>
  );
}
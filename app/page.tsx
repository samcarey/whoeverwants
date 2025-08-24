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
    const fullText = `Whoever Wants ${phraseList[currentIndex]}`;
    let calculatedFontSize = "text-xl";
    if (fullText.length > 32) {
      calculatedFontSize = "text-sm";
    } else if (fullText.length > 26) {
      calculatedFontSize = "text-base";  
    } else if (fullText.length > 20) {
      calculatedFontSize = "text-lg";
    }

    setFontSize(calculatedFontSize);
    setCurrentPhrase(phraseList[currentIndex]);
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
      const totalAnimationTime = 630;
      const charDelay = totalAnimationTime / currentPhrase.length;
      
      const typeInterval = setInterval(() => {
        if (currentIndex <= currentPhrase.length) {
          setDisplayedPhrase(currentPhrase.slice(0, currentIndex));
          currentIndex++;
        } else {
          clearInterval(typeInterval);
        }
      }, charDelay);
      
      return () => clearInterval(typeInterval);
    }, 392); // 392ms initial delay
    
    return () => clearTimeout(initialDelay);
  }, [currentPhrase]);

  // Inject dynamic title into template header
  useEffect(() => {
    const titleContainer = document.getElementById('home-title');
    if (titleContainer) {
      const titleElement = document.createElement('h1');
      titleElement.className = `${fontSize} font-bold text-center flex-1 mx-2 whitespace-nowrap`;
      titleElement.innerHTML = titleReady 
        ? `Whoever Wants${displayedPhrase ? `<span class="text-blue-600 dark:text-blue-400" style="font-family: 'M PLUS 1 Code', monospace"> ${displayedPhrase}</span>` : ''}`
        : '<span class="opacity-0">Whoever Wants</span>';
      
      titleContainer.innerHTML = '';
      titleContainer.appendChild(titleElement);
    }
  }, [fontSize, titleReady, displayedPhrase]);

  // Fetch polls
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
        }

        // Get polls this browser has access to
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
    <>
      {loading && (
        <div className="flex justify-center items-center py-8">
          <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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

      {/* Floating Create New Poll Button */}
      <Link
        href="/create-poll"
        className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-full shadow-lg transition-all duration-200 hover:shadow-xl"
        style={{ 
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' 
        }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span>New Poll</span>
      </Link>

    </>
  );
}
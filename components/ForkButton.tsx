"use client";

import { useRouter } from "next/navigation";
import { Poll } from "@/lib/supabase";
import { debugLog } from "@/lib/debugLogger";

interface ForkButtonProps {
  poll: Poll;
  className?: string;
}

export default function ForkButton({ poll, className = "" }: ForkButtonProps) {
  const router = useRouter();

  const handleFork = () => {
    // Store poll data in localStorage for the create-poll form to access
    const forkData = {
      title: poll.title,
      poll_type: poll.poll_type,
      options: poll.options,
      response_deadline: poll.response_deadline,
      creator_name: poll.creator_name,
      min_participants: poll.min_participants,
      max_participants: poll.max_participants
    };
    
    debugLog.logObject('Fork button clicked', { pollId: poll.id, forkData }, 'ForkButton');
    
    const storageKey = `fork-data-${poll.id}`;
    localStorage.setItem(storageKey, JSON.stringify(forkData));
    
    debugLog.logObject('Stored fork data', { storageKey, data: localStorage.getItem(storageKey) }, 'ForkButton');
    
    // Navigate to create-poll with fork parameter
    const navigateUrl = `/create-poll?fork=${poll.id}`;
    debugLog.info(`Navigating to: ${navigateUrl}`, 'ForkButton');
    router.push(navigateUrl);
  };

  return (
    <button
      onClick={handleFork}
      className={`inline-flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-medium text-sm rounded-lg transition-colors duration-200 ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <circle cx="6" cy="6" r="2"/>
        <circle cx="18" cy="6" r="2"/>
        <circle cx="12" cy="18" r="2"/>
        <path d="M18 8v2a2 2 0 01-2 2H8a2 2 0 01-2-2V8"/>
        <path d="M12 16V12"/>
      </svg>
      <span>Fork</span>
    </button>
  );
}
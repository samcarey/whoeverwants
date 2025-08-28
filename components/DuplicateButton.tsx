"use client";

import { useRouter } from "next/navigation";
import { Poll } from "@/lib/supabase";
import { debugLog } from "@/lib/debugLogger";

interface DuplicateButtonProps {
  poll: Poll;
}

export default function DuplicateButton({ poll }: DuplicateButtonProps) {
  const router = useRouter();

  const handleDuplicate = () => {
    // Create duplicate data for follow-up with prefilled form data
    const duplicateData = {
      title: poll.title,
      poll_type: poll.poll_type,
      options: poll.options,
      response_deadline: poll.response_deadline,
      creator_name: poll.creator_name
    };
    
    debugLog.logObject('Duplicate button clicked', { pollId: poll.id, duplicateData }, 'DuplicateButton');
    
    // Store in localStorage for form auto-fill
    const storageKey = `duplicate-data-${poll.id}`;
    localStorage.setItem(storageKey, JSON.stringify(duplicateData));
    
    debugLog.logObject('Stored duplicate data', { storageKey, data: localStorage.getItem(storageKey) }, 'DuplicateButton');
    
    // Navigate to create-poll with duplicate parameter
    const navigateUrl = `/create-poll?duplicate=${poll.id}`;
    debugLog.info(`Navigating to: ${navigateUrl}`, 'DuplicateButton');
    router.push(navigateUrl);
  };

  return (
    <button
      onClick={handleDuplicate}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-200"
      title="Create a follow-up poll with the same structure"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      Copy
    </button>
  );
}
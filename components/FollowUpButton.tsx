"use client";

import Link from "next/link";

interface FollowUpButtonProps {
  pollId: string;
  isPollClosed: boolean;
  className?: string;
}

export default function FollowUpButton({ pollId, isPollClosed, className = "" }: FollowUpButtonProps) {
  // Only show for closed polls
  if (!isPollClosed) {
    return null;
  }

  return (
    <Link
      href={`/create-poll?followUpTo=${pollId}`}
      className={`inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors duration-200 ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" 
        />
      </svg>
      <span>Follow Up</span>
    </Link>
  );
}
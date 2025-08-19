"use client";

import Link from "next/link";

interface FollowUpButtonProps {
  pollId: string;
  isPollClosed: boolean;
  className?: string;
}

export default function FollowUpButton({ pollId, isPollClosed, className = "" }: FollowUpButtonProps) {
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
          d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" 
        />
      </svg>
      <span>Follow Up</span>
    </Link>
  );
}
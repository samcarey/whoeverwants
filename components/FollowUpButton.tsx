"use client";

import { useRouter } from "next/navigation";

interface FollowUpButtonProps {
  pollId: string;
  isPollClosed: boolean;
  className?: string;
}

export default function FollowUpButton({ pollId, isPollClosed, className = "" }: FollowUpButtonProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(`/create-poll?followUpTo=${pollId}`)}
      className={`inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 dark:active:bg-gray-600 active:scale-95 text-gray-900 dark:text-white font-medium text-sm rounded-lg transition-all duration-200 border border-gray-200 dark:border-gray-700 ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
      </svg>
      Follow up
    </button>
  );
}
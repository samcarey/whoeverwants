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
      className={`inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded-lg transition-colors duration-200 ${className}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/>
      </svg>
      Blank
    </button>
  );
}
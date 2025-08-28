"use client";

import FollowUpButton from "./FollowUpButton";
import DuplicateButton from "./DuplicateButton";
import ForkButton from "./ForkButton";
import { Poll } from "@/lib/supabase";

interface PollActionsCardProps {
  poll: Poll;
  isPollClosed: boolean;
}

export default function PollActionsCard({ poll, isPollClosed }: PollActionsCardProps) {
  return (
    <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 text-left flex items-center">
        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
        New poll with same recipients
      </h3>
      <div className="flex justify-center items-center gap-3">
        <FollowUpButton pollId={poll.id} isPollClosed={isPollClosed} />
        <DuplicateButton poll={poll} />
        <ForkButton poll={poll} />
      </div>
    </div>
  );
}
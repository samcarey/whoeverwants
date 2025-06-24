"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Countdown from "@/components/Countdown";
import UrlCopy from "@/components/UrlCopy";
import SuccessPopup from "@/components/SuccessPopup";
import { Poll } from "@/lib/supabase";

interface PollPageClientProps {
  poll: Poll;
  createdDate: string;
}

export default function PollPageClient({ poll, createdDate }: PollPageClientProps) {
  const searchParams = useSearchParams();
  const isNewPoll = searchParams.get("new") === "true";
  const [showSuccessPopup, setShowSuccessPopup] = useState(isNewPoll);
  const [pollUrl, setPollUrl] = useState("");

  useEffect(() => {
    // Set the poll URL on the client side to avoid SSR issues
    setPollUrl(`${window.location.origin}/poll/${poll.id}`);
  }, [poll.id]);

  return (
    <>
      <div className="max-w-md mx-auto">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold mb-4 text-center">{poll.title}</h1>
          
          <Countdown deadline={poll.response_deadline} />
          
          {/* Poll Content Based on Type */}
          {poll.poll_type === 'yes_no' ? (
            <div className="mb-6">
              <div className="flex gap-3">
                <button className="flex-1 py-3 px-4 bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200 rounded-lg font-medium transition-colors">
                  Yes
                </button>
                <button className="flex-1 py-3 px-4 bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800 text-red-800 dark:text-red-200 rounded-lg font-medium transition-colors">
                  No
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-3">Options:</h3>
              <div className="space-y-2">
                {poll.options?.map((option, index) => (
                  <div key={index} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="font-medium">{index + 1}.</span> {option}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {pollUrl && <UrlCopy url={pollUrl} />}
          
          <div className="text-center text-gray-600 dark:text-gray-300 mb-6">
            <p className="text-sm">Created on</p>
            <p className="font-medium">{createdDate}</p>
          </div>

          <div className="text-center">
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-solid border-gray-300 dark:border-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-2 text-sm font-medium"
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12v0"
                />
              </svg>
              Home
            </Link>
          </div>
        </div>
      </div>

      <SuccessPopup 
        show={showSuccessPopup} 
        onClose={() => setShowSuccessPopup(false)} 
      />
    </>
  );
}
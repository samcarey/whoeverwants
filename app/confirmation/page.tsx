"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function Confirmation() {
  const searchParams = useSearchParams();
  const pollId = searchParams.get("pollId");
  const [copied, setCopied] = useState(false);
  
  const pollUrl = pollId ? `${window.location.origin}/poll/${pollId}` : "";

  const copyToClipboard = async () => {
    if (pollUrl) {
      try {
        await navigator.clipboard.writeText(pollUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error("Failed to copy:", error);
      }
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6 text-center">
        <h1 className="text-2xl font-bold mb-4 text-green-600 dark:text-green-400">
          Your poll is now live!
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Your poll has been created and is ready to share.
        </p>
        <div className="checkmark mb-6">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        
        {pollUrl && (
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              Share this link:
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={pollUrl}
                readOnly
                className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={copyToClipboard}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <Link
          href="/"
          className="inline-block rounded-full border border-solid border-gray-300 dark:border-gray-600 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 px-6 py-2 text-sm font-medium"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
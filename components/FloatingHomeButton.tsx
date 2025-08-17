"use client";

import Link from "next/link";

export default function FloatingHomeButton() {
  // In development, move button more to the right to avoid dev tools
  const isDev = process.env.NODE_ENV === 'development';
  const leftPosition = isDev ? 'left-12' : 'left-4';
  
  return (
    <div className={`fixed bottom-4 ${leftPosition} z-50`}>
      <Link
        href="/"
        prefetch={true}
        className="flex items-center justify-center w-12 h-12 bg-white dark:bg-gray-900 border border-solid border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
        title="Go to homepage"
        aria-label="Go to homepage"
      >
        <svg
          className="w-6 h-6"
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
      </Link>
    </div>
  );
}
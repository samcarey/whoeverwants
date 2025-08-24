"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getUserName, saveUserName, clearUserName } from "@/lib/userProfile";
import FloatingHomeButton from "@/components/FloatingHomeButton";

export default function ProfilePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const savedName = getUserName();
    if (savedName) {
      setName(savedName);
    }
  }, []);

  const handleSave = () => {
    setIsLoading(true);
    setMessage(null);
    
    try {
      saveUserName(name);
      setMessage({ type: 'success', text: 'Name saved successfully!' });
      
      // Redirect back after a short delay
      setTimeout(() => {
        router.back();
      }, 1000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save name' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = () => {
    if (confirm('Are you sure you want to clear your name?')) {
      clearUserName();
      setName("");
      setMessage({ type: 'success', text: 'Name cleared successfully!' });
      
      // Redirect to home after a short delay
      setTimeout(() => {
        router.push('/');
      }, 1000);
    }
  };

  return (
    <div className="poll-content">
      {/* Name Input Section */}
      <div className="mb-6">
        <label htmlFor="name" className="block text-sm font-medium mb-2">
          Your Name
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name..."
          maxLength={50}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
          disabled={isLoading}
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          This name will be automatically filled in voting forms
        </p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-md text-sm ${
          message.type === 'success' 
            ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-400 dark:border-green-600'
            : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-400 dark:border-red-600'
        }`}>
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={isLoading || !name.trim()}
        className="w-full rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 disabled:opacity-50 disabled:cursor-not-allowed mb-6"
      >
        {isLoading ? 'Saving...' : 'Save Name'}
      </button>

      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mb-6">
        <button
          onClick={handleSignOut}
          className="w-full rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center font-medium text-base h-12"
        >
          Clear Name
        </button>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
          Remove your saved name from this browser
        </p>
      </div>

      {/* About Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
          About
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-4">
          WhoeverWants is an open-source polling application
        </p>
        <a
          href="https://github.com/samcarey/whoeverwants"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center font-medium text-base h-12 gap-3"
        >
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          View on GitHub
        </a>
      </div>

      <FloatingHomeButton />
    </div>
  );
}
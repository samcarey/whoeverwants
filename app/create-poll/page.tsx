"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { generateCreatorSecret, storePollCreation, cleanupOldPolls } from "@/lib/pollCreator";

export default function CreatePoll() {
  const [title, setTitle] = useState("");
  const [pollType, setPollType] = useState<'yes_no' | 'ranked_choice'>('yes_no');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [deadlineOption, setDeadlineOption] = useState("5min");
  const [customDate, setCustomDate] = useState(() => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const year = oneHourLater.getFullYear();
    const month = String(oneHourLater.getMonth() + 1).padStart(2, '0');
    const day = String(oneHourLater.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [customTime, setCustomTime] = useState(() => {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const hours = String(oneHourLater.getHours()).padStart(2, '0');
    const minutes = String(oneHourLater.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Get today's date in YYYY-MM-DD format (local timezone)
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Handle options for ranked choice polls
  const addOption = () => {
    setOptions([...options, '']);
  };

  const removeOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const deadlineOptions = [
    { value: "5min", label: "5 minutes", minutes: 5 },
    { value: "10min", label: "10 minutes", minutes: 10 },
    { value: "15min", label: "15 minutes", minutes: 15 },
    { value: "30min", label: "30 minutes", minutes: 30 },
    { value: "1hr", label: "1 hour", minutes: 60 },
    { value: "2hr", label: "2 hours", minutes: 120 },
    { value: "4hr", label: "4 hours", minutes: 240 },
    { value: "custom", label: "Custom", minutes: 0 },
  ];

  const calculateDeadline = () => {
    const now = new Date();
    
    if (deadlineOption === "custom") {
      if (!customDate || !customTime) return null;
      const dateTimeString = `${customDate}T${customTime}`;
      const customDateTime = new Date(dateTimeString);
      
      // Check if the selected time is in the past
      if (customDateTime <= now) {
        return null; // Will be caught by validation
      }
      
      return customDateTime.toISOString();
    }
    
    const option = deadlineOptions.find(opt => opt.value === deadlineOption);
    if (!option) return null;
    
    const deadline = new Date(now.getTime() + option.minutes * 60 * 1000);
    return deadline.toISOString();
  };

  const getTimeLabel = (option: string) => {
    const selected = deadlineOptions.find(opt => opt.value === option);
    if (!selected || option === "custom") return selected?.label || "";
    
    const now = new Date();
    const deadline = new Date(now.getTime() + selected.minutes * 60 * 1000);
    const timeString = deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `${selected.label} (${timeString})`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    
    try {
      // Validate ranked choice options
      if (pollType === 'ranked_choice') {
        const filledOptions = options.filter(opt => opt.trim() !== '');
        if (filledOptions.length < 2) {
          setError("Ranked choice polls must have at least 2 options.");
          setIsLoading(false);
          return;
        }
      }

      const responseDeadline = calculateDeadline();
      
      if (deadlineOption === "custom") {
        if (!customDate || !customTime) {
          setError("Please select both a custom deadline date and time.");
          setIsLoading(false);
          return;
        }
        
        const customDateTime = new Date(`${customDate}T${customTime}`);
        if (customDateTime <= new Date()) {
          setError("Custom deadline must be in the future.");
          setIsLoading(false);
          return;
        }
      }
      
      // Generate creator secret
      const creatorSecret = generateCreatorSecret();
      
      // Prepare poll data
      const pollData: any = {
        title,
        poll_type: pollType,
        response_deadline: responseDeadline,
        creator_secret: creatorSecret
      };

      // Add options for ranked choice polls
      if (pollType === 'ranked_choice') {
        pollData.options = options.filter(opt => opt.trim() !== '');
      }
      
      const { data, error } = await supabase
        .from("polls")
        .insert([pollData])
        .select();

      if (error) {
        console.error("Error creating poll:", error);
        setError("Failed to create poll. Please try again.");
        return;
      }

      // Store the poll creation locally so this device can manage it
      storePollCreation(data[0].id, creatorSecret);
      
      // Clean up old poll records occasionally
      cleanupOldPolls();

      router.push(`/poll?id=${data[0].id}&new=true`);
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-6 text-center">Create New Poll</h1>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-2">
              Poll Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Enter your poll title..."
              required
            />
          </div>

          <div>
            <label htmlFor="pollType" className="block text-sm font-medium mb-2">
              Poll Type
            </label>
            <select
              id="pollType"
              value={pollType}
              onChange={(e) => setPollType(e.target.value as 'yes_no' | 'ranked_choice')}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="yes_no">Yes or No</option>
              <option value="ranked_choice">Ranked Choice</option>
            </select>
          </div>

          {pollType === 'ranked_choice' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Poll Options
              </label>
              <div className="space-y-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      disabled={isLoading}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder={`Option ${index + 1}`}
                      required
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(index)}
                        disabled={isLoading}
                        className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addOption}
                  disabled={isLoading}
                  className="w-full px-3 py-2 border border-dashed border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + Add Option
                </button>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="deadline" className="block text-sm font-medium mb-2">
              Response Deadline
            </label>
            <select
              id="deadline"
              value={deadlineOption}
              onChange={(e) => setDeadlineOption(e.target.value)}
              disabled={isLoading}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deadlineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {getTimeLabel(option.value)}
                </option>
              ))}
            </select>
          </div>

          {deadlineOption === "custom" && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Custom Deadline
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="customDate" className="block text-xs text-gray-500 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    id="customDate"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    disabled={isLoading}
                    min={getTodayDate()}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="customTime" className="block text-xs text-gray-500 mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    id="customTime"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    disabled={isLoading}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                  />
                </div>
              </div>
            </div>
          )}
          
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating Poll...
              </>
            ) : (
              "Submit"
            )}
          </button>
        </form>
        
        <div className="text-center mt-6">
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
  );
}
"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAppPrefetch } from "@/lib/prefetch";
import { generateCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";
import ConfirmationModal from "@/components/ConfirmationModal";
import FloatingHomeButton from "@/components/FloatingHomeButton";
import FollowUpHeader from "@/components/FollowUpHeader";
import { triggerDiscoveryIfNeeded } from "@/lib/pollDiscovery";
import { getUserName, saveUserName } from "@/lib/userProfile";

export const dynamic = 'force-dynamic';

function CreatePollContent() {
  const { prefetch } = useAppPrefetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const followUpTo = searchParams.get('followUpTo');
  
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState<string[]>(['']);
  const [deadlineOption, setDeadlineOption] = useState("10min");
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [shouldFocusNewOption, setShouldFocusNewOption] = useState(false);
  const isSubmittingRef = useRef(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [creatorName, setCreatorName] = useState<string>("");

  // Helper to re-enable form elements
  const reEnableForm = useCallback((form: HTMLFormElement | null) => {
    if (form) {
      const inputs = form.querySelectorAll('input, select, button');
      inputs.forEach(input => {
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLButtonElement) {
          input.disabled = false;
        }
      });
    }
  }, []);

  // Save form state to localStorage
  const saveFormState = useCallback(() => {
    if (typeof window !== 'undefined') {
      const formState = {
        title,
        options,
        deadlineOption,
        customDate,
        customTime,
        creatorName
      };
      localStorage.setItem('pollFormState', JSON.stringify(formState));
      console.log('💾 Form state saved:', formState);
    }
  }, [title, options, deadlineOption, customDate, customTime, creatorName]);

  // Get default date/time values (client-side only to avoid hydration mismatch)
  const getDefaultDateTime = () => {
    if (typeof window === 'undefined') {
      return { date: '', time: '' };
    }
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const year = oneHourLater.getFullYear();
    const month = String(oneHourLater.getMonth() + 1).padStart(2, '0');
    const day = String(oneHourLater.getDate()).padStart(2, '0');
    const hours = String(oneHourLater.getHours()).padStart(2, '0');
    const minutes = String(oneHourLater.getMinutes()).padStart(2, '0');
    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`
    };
  };

  // Load form state from localStorage
  const loadFormState = () => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pollFormState');
      if (saved) {
        try {
          const formState = JSON.parse(saved);
          console.log('📥 Form state loaded:', formState);
          setTitle(formState.title || '');
          setOptions(formState.options || ['']);
          setDeadlineOption(formState.deadlineOption || '10min');
          setCustomDate(formState.customDate || '');
          setCustomTime(formState.customTime || '');
          setCreatorName(formState.creatorName || '');
        } catch (error) {
          console.error('Failed to load form state:', error);
        }
      } else {
        console.log('📥 No saved form state found');
      }
    }
  };

  // Clear saved form state
  const clearFormState = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pollFormState');
    }
  };

  // Determine poll type based on options
  const getPollType = (): 'yes_no' | 'ranked_choice' => {
    const filledOptions = options.filter(opt => opt.trim() !== '');
    return filledOptions.length === 0 ? 'yes_no' : 'ranked_choice';
  };

  // Check if an option is a duplicate
  const isDuplicateOption = (index: number): boolean => {
    const currentOption = options[index]?.trim().toLowerCase();
    if (!currentOption) return false;
    
    // Check if this option appears elsewhere in the array
    for (let i = 0; i < options.length; i++) {
      if (i !== index && options[i]?.trim().toLowerCase() === currentOption) {
        return true;
      }
    }
    return false;
  };

  // Validation for poll options with specific error messages
  const getValidationError = (): string | null => {
    // Check title first
    if (!title.trim()) {
      return "Please enter a poll title.";
    }
    
    if (title.length > 50) {
      return "Poll title must be 50 characters or less.";
    }

    // Check custom deadline if selected
    if (deadlineOption === "custom") {
      if (!customDate || !customTime) {
        return "Please select both a custom deadline date and time.";
      }
      
      const customDateTime = new Date(`${customDate}T${customTime}`);
      if (customDateTime <= new Date()) {
        return "Custom deadline must be in the future.";
      }
    }

    const filledOptions = options.filter(opt => opt.trim() !== '');
    const emptyOptions = options.filter(opt => opt.trim() === '');
    const pollType = getPollType();
    
    // Check for options that exceed character limit
    const longOptions = filledOptions.filter(opt => opt.length > 35);
    if (longOptions.length > 0) {
      return "Poll options must be 35 characters or less.";
    }
    
    // If we have any filled options, check that there are no empty fields in between
    if (filledOptions.length > 0) {
      // Find the last filled option index
      let lastFilledIndex = -1;
      for (let i = options.length - 1; i >= 0; i--) {
        if (options[i].trim() !== '') {
          lastFilledIndex = i;
          break;
        }
      }
      
      // Check if there are any empty fields before the last filled option
      for (let i = 0; i <= lastFilledIndex; i++) {
        if (options[i].trim() === '') {
          return "Please fill in all option fields or remove empty ones.";
        }
      }
    }
    
    // If no options (yes/no poll), that's valid
    if (filledOptions.length === 0) return null;
    
    // If there are options (ranked choice), must have at least 2
    if (filledOptions.length === 1) {
      return "Add at least one more option for a ranked choice poll, or leave all options blank for a yes/no poll.";
    }
    
    // No two options should be exactly the same
    const uniqueOptions = new Set(filledOptions.map(opt => opt.trim()));
    if (uniqueOptions.size !== filledOptions.length) {
      return "All poll options must be unique (no duplicates).";
    }
    
    return null;
  };

  const isFormValid = () => {
    return getValidationError() === null;
  };

  // Get today's date in YYYY-MM-DD format (client-side only to avoid hydration mismatch)
  const getTodayDate = () => {
    if (typeof window === 'undefined') {
      return '';
    }
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Initialize client-side state
  useEffect(() => {
    setIsClient(true);
    loadFormState();
    
    // Load saved user name if no name in form state
    const savedName = getUserName();
    if (savedName && !creatorName) {
      setCreatorName(savedName);
    }
  }, []);

  // Set default date/time values after client initialization
  useEffect(() => {
    if (isClient && !customDate && !customTime) {
      const defaultDateTime = getDefaultDateTime();
      setCustomDate(defaultDateTime.date);
      setCustomTime(defaultDateTime.time);
    }
  }, [isClient, customDate, customTime]);

  // Save form state whenever form data changes
  useEffect(() => {
    if (isClient) {
      saveFormState();
    }
  }, [title, options, deadlineOption, customDate, customTime, creatorName, isClient, saveFormState]);

  // Auto-focus new option fields
  useEffect(() => {
    if (shouldFocusNewOption && optionRefs.current.length > 0) {
      const lastInput = optionRefs.current[optionRefs.current.length - 1];
      if (lastInput) {
        // Small delay to ensure DOM is updated
        setTimeout(() => {
          lastInput.focus();
          // For iOS, also trigger click to ensure keyboard appears
          if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            lastInput.click();
          }
        }, 50);
      }
      setShouldFocusNewOption(false);
    }
  }, [options.length, shouldFocusNewOption]);

  // Handle options for ranked choice polls
  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    
    // If typing in the last field and it now has content, add expansion field
    if (index === options.length - 1 && value.trim() !== '') {
      newOptions.push('');
    }
    
    // Remove trailing empty fields but always keep at least 1 field
    while (newOptions.length > 1) {
      const lastIndex = newOptions.length - 1;
      const secondLastIndex = newOptions.length - 2;
      
      // Only remove if last two fields are empty
      if (newOptions[lastIndex] === '' && newOptions[secondLastIndex] === '') {
        newOptions.pop();
      } else {
        break;
      }
    }
    
    // Ensure we always have at least 1 field
    if (newOptions.length === 0) {
      newOptions.push('');
    }
    
    setOptions(newOptions);
  };

  const removeOption = (index: number) => {
    // Remove the specific option and collapse array
    const newOptions = options.filter((_, i) => i !== index);
    
    // Ensure we always have at least 1 field
    if (newOptions.length === 0) {
      newOptions.push('');
    }
    
    setOptions(newOptions);
  };

  const baseDeadlineOptions = [
    { value: "5min", label: "5 minutes", minutes: 5 },
    { value: "10min", label: "10 minutes", minutes: 10 },
    { value: "15min", label: "15 minutes", minutes: 15 },
    { value: "30min", label: "30 minutes", minutes: 30 },
    { value: "1hr", label: "1 hour", minutes: 60 },
    { value: "2hr", label: "2 hours", minutes: 120 },
    { value: "4hr", label: "4 hours", minutes: 240 },
    { value: "custom", label: "Custom", minutes: 0 },
  ];

  // Add 10-second option for development only
  const deadlineOptions = process.env.NODE_ENV === 'development' 
    ? [
        { value: "10sec", label: "10 seconds (Dev Only)", minutes: 1/6 }, // 10 seconds = 1/6 minute
        ...baseDeadlineOptions
      ]
    : baseDeadlineOptions;

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
    
    // Only calculate time on client to avoid hydration mismatch
    if (typeof window === 'undefined') {
      return selected.label; // Server-side: just return the label
    }
    
    const now = new Date();
    const deadline = new Date(now.getTime() + selected.minutes * 60 * 1000);
    
    // For 10-second option, show seconds
    const timeString = option === "10sec" 
      ? deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `${selected.label} (${timeString})`;
  };

  // Calculate and format time until custom deadline
  const getCustomDeadlineDisplay = () => {
    if (!customDate || !customTime) return "";
    
    // Only calculate on client to avoid hydration mismatch
    if (typeof window === 'undefined') return "";
    
    const now = new Date();
    const customDateTime = new Date(`${customDate}T${customTime}`);
    const diff = customDateTime.getTime() - now.getTime();
    
    if (diff <= 0) return " (in the past)";
    
    const totalMinutes = Math.floor(diff / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const totalYears = Math.floor(totalDays / 365);
    
    const years = totalYears;
    const days = totalDays - (years * 365);
    const hours = totalHours - (totalDays * 24);
    const minutes = totalMinutes - (totalHours * 60);
    
    const parts = [];
    if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`);
    
    // Return only the two most significant non-zero parts
    const displayParts = parts.slice(0, 2);
    if (displayParts.length === 0) return " (less than 1 min)";
    
    return ` (${displayParts.join(', ')})`;
  };

  const handleSubmitClick = (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check for validation errors before showing modal
    const validationError = getValidationError();
    if (validationError) {
      setError(validationError);
      return;
    }
    
    // Show confirmation modal
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    // Hide modal
    setShowConfirmModal(false);
    
    // Prevent duplicate submissions - check ref first for immediate blocking
    if (isSubmittingRef.current) {
      return;
    }
    
    // Set ref immediately to block subsequent clicks
    isSubmittingRef.current = true;
    setIsLoading(true);
    setError(null);
    
    // Disable the entire form to prevent any interaction
    const form = document.querySelector('form');
    if (form) {
      const inputs = form.querySelectorAll('input, select, button');
      inputs.forEach(input => {
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLButtonElement) {
          input.disabled = true;
        }
      });
    }
    
    try {
      // Check for validation errors before submission
      const validationError = getValidationError();
      if (validationError) {
        setError(validationError);
        setIsLoading(false);
        isSubmittingRef.current = false;
        reEnableForm(form);
        return;
      }
      
      // Determine poll type and get options
      const pollType = getPollType();
      const filledOptions = options.filter(opt => opt.trim() !== '');

      const responseDeadline = calculateDeadline();
      
      if (deadlineOption === "custom") {
        if (!customDate || !customTime) {
          setError("Please select both a custom deadline date and time.");
          setIsLoading(false);
          isSubmittingRef.current = false;
          reEnableForm(form);
          return;
        }
        
        const customDateTime = new Date(`${customDate}T${customTime}`);
        if (customDateTime <= new Date()) {
          setError("Custom deadline must be in the future.");
          setIsLoading(false);
          isSubmittingRef.current = false;
          reEnableForm(form);
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

      // Add creator_name if provided (may fail if column doesn't exist yet)
      if (creatorName.trim()) {
        pollData.creator_name = creatorName.trim();
      }

      // Add follow-up reference if this is a follow-up poll
      if (followUpTo) {
        pollData.follow_up_to = followUpTo;
      }

      // Add options for ranked choice polls
      if (pollType === 'ranked_choice') {
        pollData.options = filledOptions;
      }

      console.log("Creating poll with data:", pollData);
      
      const { data, error } = await supabase
        .from("polls")
        .insert([pollData])
        .select();

      if (error) {
        console.error("Error creating poll:", error);
        console.error("Error details:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        console.error("Poll data that failed:", pollData);
        
        // Provide more specific error message based on error type
        let errorMessage = "Failed to create poll. Please try again.";
        if (error.message) {
          if (error.message.includes('duplicate key')) {
            errorMessage = "A poll with this data already exists.";
          } else if (error.message.includes('not-null violation')) {
            errorMessage = "Missing required information. Please check all fields.";
          } else if (error.message.includes('foreign key')) {
            errorMessage = "Invalid reference in poll data.";
          } else if (error.message.includes('permission')) {
            errorMessage = "Permission denied. Please try again.";
          } else {
            errorMessage = `Database error: ${error.message}`;
          }
        }
        
        setError(errorMessage);
        setIsLoading(false);
        isSubmittingRef.current = false;
        reEnableForm(form);
        return;
      }

      // Record poll creation in browser storage
      recordPollCreation(data[0].id, creatorSecret);

      // Trigger poll discovery if this is a follow-up poll
      if (followUpTo) {
        try {
          await triggerDiscoveryIfNeeded();
        } catch (error) {
          console.warn('Failed to trigger poll discovery:', error);
          // Don't fail the poll creation if discovery fails
        }
      }

      // Save the creator's name if they provided one
      if (creatorName.trim()) {
        saveUserName(creatorName.trim());
      }

      // Clear saved form state since poll was created successfully
      clearFormState();
      
      // Mark as submitted to prevent further submissions
      setIsSubmitted(true);

      // Use UUID for now (short_id not available due to incomplete migration)
      const redirectId = data[0].id;
      router.push(`/p/${redirectId}?new=true`);
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
      isSubmittingRef.current = false;
      reEnableForm(form);
    }
  };

  return (
    <div className="poll-content">
      {followUpTo && (
        <FollowUpHeader followUpToPollId={followUpTo} />
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md">
          {error}
        </div>
      )}
      
      <form onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Do nothing - all submission is handled by button onClick
        }} className="space-y-4">
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
              maxLength={50}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Enter your poll title..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Poll Options <span className="text-gray-500 font-normal">(blank for yes/no)</span>
            </label>
              <div className="space-y-2">
                {options.map((option, index) => {
                  const isDuplicate = isDuplicateOption(index);
                  return (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        ref={(el) => {
                          optionRefs.current[index] = el;
                        }}
                        type="text"
                        value={option}
                        onChange={(e) => updateOption(index, e.target.value)}
                        disabled={isLoading}
                        maxLength={35}
                        className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isDuplicate 
                            ? 'bg-red-50 dark:bg-red-900/30 border-red-400 dark:border-red-600 text-red-900 dark:text-red-100' 
                            : 'border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white'
                        }`}
                      placeholder={
                        (() => {
                          const filledOptions = options.filter(opt => opt.trim() !== '');
                          const isLastField = index === options.length - 1;
                          
                          if (isLastField) {
                            return filledOptions.length === 0 ? "Add an option" : "Add another option...";
                          }
                          return `Option ${index + 1}`;
                        })()
                      }
                    />
                    {(() => {
                      const filledOptions = options.filter(opt => opt.trim() !== '');
                      const isLastField = index === options.length - 1;
                      const canDelete = filledOptions.length >= 1;
                      
                      if (isLastField) {
                        // Empty space for alignment on the last "Add another option" field
                        return <div className="w-9 h-9"></div>;
                      }
                      
                      return (
                        <button
                          type="button"
                          onClick={() => canDelete ? removeOption(index) : undefined}
                          disabled={isLoading || !canDelete}
                          className={`p-2 transition-colors ${
                            canDelete 
                              ? 'text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 cursor-pointer'
                              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                          } disabled:opacity-50`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      );
                    })()}
                  </div>
                  );
                })}
              </div>
          </div>

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
                  {isClient ? getTimeLabel(option.value) : option.label}
                </option>
              ))}
            </select>
          </div>

          {deadlineOption === "custom" && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Custom Deadline<span className="text-gray-500 font-normal">{getCustomDeadlineDisplay()}</span>
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
                    min={isClient ? getTodayDate() : ''}
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

          <div>
            <label htmlFor="creatorName" className="block text-sm font-medium mb-2">
              Your Name (optional)
            </label>
            <input
              type="text"
              id="creatorName"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              disabled={isLoading}
              maxLength={50}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Enter your name..."
            />
          </div>
          
          {!isFormValid() && !isLoading && (
            <div className="text-center text-red-600 dark:text-red-400 text-sm mb-3">
              {getValidationError()}
            </div>
          )}
          
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={isLoading || isSubmitted || !isFormValid()}
            className="w-full rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-base h-12 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitted ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Redirecting...
              </>
            ) : isLoading ? (
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
      
      <ConfirmationModal
        isOpen={showConfirmModal}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirmModal(false)}
        title="Create Poll"
        message={`Are you sure you want to create this ${getPollType() === 'yes_no' ? 'Yes/No' : 'Ranked Choice'} poll? It will be private and require the full link to access.`}
        confirmText="Create Poll"
        cancelText="Cancel"
      />
      
      <FloatingHomeButton />
    </div>
  );
}

export default function CreatePoll() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center h-screen">
        <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    }>
      <CreatePollContent />
    </Suspense>
  );
}
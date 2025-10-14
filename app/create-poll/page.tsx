"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAppPrefetch } from "@/lib/prefetch";
import { generateCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";
import ConfirmationModal from "@/components/ConfirmationModal";
import FollowUpHeader from "@/components/FollowUpHeader";
import ForkHeader from "@/components/ForkHeader";
import { triggerDiscoveryIfNeeded } from "@/lib/pollDiscovery";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { debugLog } from "@/lib/debugLogger";
import OptionsInput from "@/components/OptionsInput";

export const dynamic = 'force-dynamic';

function CreatePollContent() {
  const { prefetch } = useAppPrefetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const followUpToParam = searchParams.get('followUpTo');
  const forkOfParam = searchParams.get('fork');
  const duplicateOfParam = searchParams.get('duplicate');
  const voteFromNominationParam = searchParams.get('voteFromNomination');

  // Track duplicate and fork relationships as part of form state
  const [followUpTo, setFollowUpTo] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [forkOf, setForkOf] = useState<string | null>(null);
  const [voteFromNomination, setVoteFromNomination] = useState<string | null>(null);

  debugLog.logObject('Create poll page loaded with params', { followUpTo: followUpToParam, forkOf: forkOfParam, duplicateOf: duplicateOfParam, voteFromNomination: voteFromNominationParam }, 'CreatePoll');
  
  const [title, setTitle] = useState("");
  const [pollType, setPollType] = useState<'poll' | 'nomination' | 'participation'>('nomination');
  const [options, setOptions] = useState<string[]>(['']);
  const [minParticipants, setMinParticipants] = useState<number | null>(1);
  const [maxParticipants, setMaxParticipants] = useState<number | null>(null);
  const [minEnabled, setMinEnabled] = useState(true);
  const [maxEnabled, setMaxEnabled] = useState(false);
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
  const [originalPollData, setOriginalPollData] = useState<any>(null);
  const [hasFormChanged, setHasFormChanged] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

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
        pollType,
        options,
        deadlineOption,
        customDate,
        customTime,
        creatorName
      };
      localStorage.setItem('pollFormState', JSON.stringify(formState));
    }
  }, [title, pollType, options, deadlineOption, customDate, customTime, creatorName]);

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
          setTitle(formState.title || '');
          setPollType(formState.pollType || 'poll');
          setOptions(formState.options || ['']);
          setDeadlineOption(formState.deadlineOption || '10min');
          setCustomDate(formState.customDate || '');
          setCustomTime(formState.customTime || '');
          setCreatorName(formState.creatorName || '');
        } catch (error) {
          console.error('Failed to load form state:', error);
        }
      } else {
      }
    }
  };

  // Clear saved form state
  const clearFormState = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pollFormState');

      // Also clean up any special poll creation data
      if (voteFromNomination) {
        localStorage.removeItem(`vote-from-nomination-${voteFromNomination}`);
      }
      if (forkOf) {
        localStorage.removeItem(`fork-data-${forkOf}`);
      }
      if (duplicateOf) {
        localStorage.removeItem(`duplicate-data-${duplicateOf}`);
      }
    }
  };

  // Determine poll type based on form selection and options
  const getPollType = (): 'yes_no' | 'ranked_choice' | 'nomination' | 'participation' => {
    if (pollType === 'nomination') {
      return 'nomination';
    }
    if (pollType === 'participation') {
      return 'participation';
    }
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
      return "Please enter a title.";
    }
    
    if (title.length > 50) {
      return "Title must be 50 characters or less.";
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
    
    // If no options, that's valid for all poll types
    if (filledOptions.length === 0) {
      return null;
    }
    
    // If there are options, must have at least 2 for ranked choice, at least 1 for nomination
    if (filledOptions.length === 1 && pollType !== 'nomination') {
      return "Add at least one more option for a ranked choice poll, or leave all options blank for a yes/no poll.";
    }
    
    // No two options should be exactly the same
    const uniqueOptions = new Set(filledOptions.map(opt => opt.trim()));
    if (uniqueOptions.size !== filledOptions.length) {
      return "All poll options must be unique (no duplicates).";
    }
    
    return null;
  };

  const isFormValid = (): boolean => {
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

  // Initialize state from URL params
  useEffect(() => {
    if (followUpToParam) setFollowUpTo(followUpToParam);
    if (forkOfParam) setForkOf(forkOfParam);
    if (duplicateOfParam) setDuplicateOf(duplicateOfParam);
    if (voteFromNominationParam) setVoteFromNomination(voteFromNominationParam);
  }, [followUpToParam, forkOfParam, duplicateOfParam, voteFromNominationParam]);

  // Initialize client-side state
  useEffect(() => {
    setIsClient(true);

    // Only load form state if this is NOT a follow-up, fork, duplicate, or vote-from-nomination
    // (these special cases load their own data from URL params)
    if (!followUpToParam && !forkOfParam && !duplicateOfParam && !voteFromNominationParam) {
      loadFormState();
    }

    // Load saved user name if no name in form state
    const savedName = getUserName();
    if (savedName && !creatorName) {
      setCreatorName(savedName);
    }
  }, [followUpToParam, forkOfParam, duplicateOfParam, voteFromNominationParam, creatorName]);

  // Emit poll type changes to update the header
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pollTypeChange', {
        detail: { pollType }
      }));
    }
  }, [pollType]);

  // Load fork data if this is a fork
  useEffect(() => {
    debugLog.logObject('Fork useEffect running', { forkOfParam, windowExists: typeof window !== 'undefined' }, 'CreatePoll');

    if (forkOfParam && typeof window !== 'undefined') {
      // Set the fork relationship in state
      setForkOf(forkOfParam);

      const forkDataKey = `fork-data-${forkOfParam}`;
      const savedForkData = localStorage.getItem(forkDataKey);

      debugLog.logObject('Fork data lookup', { forkDataKey, found: !!savedForkData, data: savedForkData }, 'CreatePoll');

      if (savedForkData) {
        try {
          const forkData = JSON.parse(savedForkData);
          debugLog.logObject('Parsed fork data', forkData, 'CreatePoll');

          // Store original data for change comparison
          setOriginalPollData(forkData);

          // Auto-fill form with fork data
          setTitle(forkData.title || "");

          // Set poll type and options based on forked poll
          if (forkData.poll_type === 'ranked_choice' && forkData.options) {
            setPollType('poll');
            setOptions(forkData.options);
          } else if (forkData.poll_type === 'nomination') {
            setPollType('nomination');
            setOptions(['']);
          } else if (forkData.poll_type === 'participation') {
            setPollType('participation');
            setOptions(['']);
            // Load participant counts
            if (forkData.min_participants !== null && forkData.min_participants !== undefined) {
              setMinParticipants(forkData.min_participants);
            }
            if (forkData.max_participants !== null && forkData.max_participants !== undefined) {
              setMaxParticipants(forkData.max_participants);
              setMaxEnabled(true);
            } else {
              setMaxEnabled(false);
              setMaxParticipants(null);
            }
          } else {
            // yes_no poll
            setPollType('poll');
            setOptions(['']);
          }

          if (forkData.response_deadline) {
            // Parse the deadline and set appropriate form values
            const deadline = new Date(forkData.response_deadline);
            const now = new Date();
            const diffMs = deadline.getTime() - now.getTime();

            if (diffMs > 0) {
              const diffMinutes = Math.round(diffMs / (1000 * 60));
              if (diffMinutes <= 10) setDeadlineOption("10min");
              else if (diffMinutes <= 60) setDeadlineOption("1hr");
              else if (diffMinutes <= 240) setDeadlineOption("4hr");
              else if (diffMinutes <= 1440) setDeadlineOption("1day");
              else setDeadlineOption("custom");
            }
          }
          if (forkData.creator_name) {
            setCreatorName(forkData.creator_name);
          }
        } catch (error) {
          console.error('Error loading fork data:', error);
        }
      }
    }
  }, [forkOfParam]);

  // Load duplicate data if this is a duplicate (for follow-up polls)
  useEffect(() => {
    debugLog.logObject('Duplicate useEffect running', { duplicateOfParam, windowExists: typeof window !== 'undefined' }, 'CreatePoll');

    if (duplicateOfParam && typeof window !== 'undefined') {
      // Set the duplicate relationship in state
      setDuplicateOf(duplicateOfParam);

      const duplicateDataKey = `duplicate-data-${duplicateOfParam}`;
      const savedDuplicateData = localStorage.getItem(duplicateDataKey);

      debugLog.logObject('Duplicate data lookup', { duplicateDataKey, found: !!savedDuplicateData, data: savedDuplicateData }, 'CreatePoll');

      if (savedDuplicateData) {
        try {
          const duplicateData = JSON.parse(savedDuplicateData);
          debugLog.logObject('Parsed duplicate data', duplicateData, 'CreatePoll');

          // Auto-fill form with duplicate data
          setTitle(duplicateData.title || "");

          // Set poll type based on duplicated poll
          if (duplicateData.poll_type === 'ranked_choice') {
            setPollType('poll');
            setOptions(duplicateData.options || ['']);
          } else if (duplicateData.poll_type === 'nomination') {
            setPollType('nomination');
            setOptions(['']);
          } else if (duplicateData.poll_type === 'participation') {
            setPollType('participation');
            setOptions(['']);
            // Load participant counts
            if (duplicateData.min_participants !== null && duplicateData.min_participants !== undefined) {
              setMinParticipants(duplicateData.min_participants);
              setMinEnabled(true);
            }
            if (duplicateData.max_participants !== null && duplicateData.max_participants !== undefined) {
              setMaxParticipants(duplicateData.max_participants);
              setMaxEnabled(true);
            } else {
              setMaxEnabled(false);
              setMaxParticipants(null);
            }
          } else {
            // yes_no poll
            setPollType('poll');
            setOptions(['']);
          }
          if (duplicateData.response_deadline) {
            // Parse the deadline and set appropriate form values
            const deadline = new Date(duplicateData.response_deadline);
            const now = new Date();
            const diffMs = deadline.getTime() - now.getTime();

            if (diffMs > 0) {
              const diffMinutes = Math.round(diffMs / (1000 * 60));
              if (diffMinutes <= 10) setDeadlineOption("10min");
              else if (diffMinutes <= 60) setDeadlineOption("1hr");
              else if (diffMinutes <= 240) setDeadlineOption("4hr");
              else if (diffMinutes <= 1440) setDeadlineOption("1day");
              else setDeadlineOption("custom");
            }
          }
          if (duplicateData.creator_name) {
            setCreatorName(duplicateData.creator_name);
          }

          // Don't clean up the duplicate data yet - keep it until poll is created
          // so that refresh doesn't lose the data
          // Keep the duplicate URL parameter so refresh works correctly
          debugLog.info('Loaded duplicate data from localStorage (will clean up after submission)', 'CreatePoll');
        } catch (error) {
          console.error('Error loading duplicate data:', error);
        }
      }
    }
  }, [duplicateOfParam]);

  // Load vote-from-nomination data if creating preference poll from nominations
  useEffect(() => {
    debugLog.logObject('VoteFromNomination useEffect running', { voteFromNominationParam, windowExists: typeof window !== 'undefined' }, 'CreatePoll');

    if (voteFromNominationParam && typeof window !== 'undefined') {
      // Set the vote-from-nomination relationship in state
      setVoteFromNomination(voteFromNominationParam);

      const voteDataKey = `vote-from-nomination-${voteFromNominationParam}`;
      const savedVoteData = localStorage.getItem(voteDataKey);

      debugLog.logObject('Vote data lookup', { voteDataKey, found: !!savedVoteData, data: savedVoteData }, 'CreatePoll');

      if (savedVoteData) {
        try {
          const voteData = JSON.parse(savedVoteData);
          debugLog.logObject('Parsed vote data', voteData, 'CreatePoll');

          // Auto-fill form with preference poll type and nominated options
          setTitle(voteData.title || "");
          setPollType('poll'); // Set to preference poll
          setOptions(voteData.options && voteData.options.length > 0 ? voteData.options : ['']);

          // Don't clean up the vote data yet - keep it until poll is created
          // so that refresh doesn't lose the data
          debugLog.info('Loaded vote data from localStorage (will clean up after submission)', 'CreatePoll');

          // Keep the voteFromNomination parameter so refresh works
          // Also set followUpTo parameter to link the new poll
          if (voteData.followUpTo) {
            const url = new URL(window.location.href);
            url.searchParams.set('followUpTo', voteData.followUpTo);
            window.history.replaceState({}, '', url.toString());
          }
        } catch (error) {
          console.error('Error loading vote-from-nomination data:', error);
        }
      }
    }
  }, [voteFromNominationParam]);

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
  }, [title, pollType, options, deadlineOption, customDate, customTime, creatorName, duplicateOf, forkOf, isClient, saveFormState]);

  // Track form changes for fork validation
  useEffect(() => {
    if (originalPollData && forkOf) {
      const hasChanged =
        title !== originalPollData.title ||
        JSON.stringify(options) !== JSON.stringify(originalPollData.options || []) ||
        creatorName !== (originalPollData.creator_name || "") ||
        pollType !== 'poll'; // Nomination polls are always considered changed

      setHasFormChanged(hasChanged);
    }
  }, [title, pollType, options, creatorName, originalPollData, forkOf]);

  // Handle removal of parent poll association
  const handleRemoveAssociation = useCallback(() => {
    // Clear the relationship states
    setFollowUpTo(null);
    setForkOf(null);
    setDuplicateOf(null);
    setOriginalPollData(null);
    setHasFormChanged(false);

    // Clear localStorage data
    if (typeof window !== 'undefined') {
      if (followUpTo) {
        localStorage.removeItem(`duplicate-data-${followUpTo}`);
      }
      if (forkOf) {
        localStorage.removeItem(`fork-data-${forkOf}`);
      }
      if (duplicateOf) {
        localStorage.removeItem(`duplicate-data-${duplicateOf}`);
      }
      if (voteFromNomination) {
        localStorage.removeItem(`vote-from-nomination-${voteFromNomination}`);
      }
    }

    // Update URL to remove query parameters
    const url = new URL(window.location.href);
    url.searchParams.delete('followUpTo');
    url.searchParams.delete('fork');
    url.searchParams.delete('duplicate');
    url.searchParams.delete('voteFromNomination');
    window.history.replaceState({}, '', url.toString());
  }, [followUpTo, forkOf, duplicateOf, voteFromNomination]);

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
      const dbPollType = getPollType();
      const pollData: any = {
        title,
        poll_type: dbPollType,
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
      // Add duplicate as follow-up reference if this is a duplicate
      if (duplicateOf) {
        pollData.follow_up_to = duplicateOf;
      }

      // Add fork reference if this is a fork
      if (forkOf) {
        pollData.fork_of = forkOf;
      }

      // Add options for ranked choice polls only
      // For nomination polls, initial options become the creator's vote (not poll content)
      if (dbPollType === 'ranked_choice') {
        pollData.options = filledOptions;
      }

      // Add min/max participants for participation polls
      if (dbPollType === 'participation') {
        // Min is always required
        if (minParticipants !== null) {
          pollData.min_participants = minParticipants;
        }
        // Max is optional
        if (maxEnabled && maxParticipants !== null) {
          pollData.max_participants = maxParticipants;
        }
      }


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

      // For nomination polls, creators vote after creation like any other participant
      // No initial vote is created

      // Trigger poll discovery if this is a follow-up poll
      if (followUpTo) {
        try {
          await triggerDiscoveryIfNeeded();
        } catch (error) {
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
      router.push(`/p/${redirectId}`);
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
      {error && (
        <div className="mb-4 p-2 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md">
          {error}
        </div>
      )}

      <form onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Do nothing - all submission is handled by button onClick
        }} className="space-y-4">
          <div className="flex justify-center">
            <div className="relative w-48 bg-gray-100 dark:bg-gray-800 rounded-full p-0.5 mb-1">
              <div
                className={`absolute top-0.5 bottom-0.5 rounded-full shadow-sm transition-all duration-200 ease-in-out ${
                  pollType === 'nomination'
                    ? 'bg-blue-100 dark:bg-blue-900/30'
                    : pollType === 'poll'
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : 'bg-purple-100 dark:bg-purple-900/30'
                }`}
                style={{
                  width: 'calc(33.333% - 4px)',
                  left: pollType === 'nomination' ? '2px' : pollType === 'poll' ? 'calc(33.333% + 1px)' : 'calc(66.666% - 0px)'
                }}
              />
              <div className="relative flex w-full">
                <button
                  type="button"
                  onClick={() => {
                    if (titleInputRef.current) {
                      titleInputRef.current.focus();
                    }
                    setPollType('nomination');
                  }}
                  disabled={isLoading}
                  className={`flex-1 py-1 text-xl rounded-md transition-colors duration-200 ${
                    pollType === 'nomination'
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  💡
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (titleInputRef.current) {
                      titleInputRef.current.focus();
                    }
                    setPollType('poll');
                  }}
                  disabled={isLoading}
                  className={`flex-1 py-1 text-xl rounded-md transition-colors duration-200 ${
                    pollType === 'poll'
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  🗳️
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (titleInputRef.current) {
                      titleInputRef.current.focus();
                    }
                    setPollType('participation');
                  }}
                  disabled={isLoading}
                  className={`flex-1 py-1 text-xl rounded-md transition-colors duration-200 ${
                    pollType === 'participation'
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  🙋
                </button>
              </div>
            </div>
          </div>

          <div className="-mt-4">
            <label htmlFor="title" className="block text-sm font-medium mb-2">
              Title
            </label>
            <input
              type="text"
              id="title"
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLoading}
              maxLength={50}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="Enter your title..."
              required
            />
          </div>

          {/* Participant counter for participation polls */}
          {pollType === 'participation' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                How many participants?
              </label>
              <div className="flex justify-between items-center gap-4">
                {/* Min participants counter */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Min:</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (minParticipants !== null && minParticipants > 1) {
                        setMinParticipants(minParticipants - 1);
                      }
                    }}
                    disabled={minParticipants === null || minParticipants <= 1}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div
                    className="min-w-[3rem] px-3 py-1 rounded-md font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 border-2 border-blue-500 flex items-center justify-center"
                  >
                    {minParticipants ?? 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (minParticipants !== null) {
                        const newMin = minParticipants + 1;
                        setMinParticipants(newMin);
                        // If max is enabled and new min is greater than max, update max
                        if (maxEnabled && maxParticipants !== null && newMin > maxParticipants) {
                          setMaxParticipants(newMin);
                        }
                      }
                    }}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                </div>

                {/* Max participants counter */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Max:</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (maxEnabled && maxParticipants !== null) {
                        const minValue = minParticipants ?? 1;
                        if (maxParticipants > minValue) {
                          setMaxParticipants(maxParticipants - 1);
                        }
                      }
                    }}
                    disabled={!maxEnabled || maxParticipants === null || maxParticipants <= (minParticipants ?? 1)}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (maxEnabled) {
                        setMaxEnabled(false);
                        setMaxParticipants(null);
                      } else {
                        setMaxEnabled(true);
                        const startValue = minParticipants ?? 1;
                        setMaxParticipants(startValue);
                      }
                    }}
                    className={`min-w-[3rem] px-3 py-1 rounded-md font-medium transition-colors ${
                      maxEnabled
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 border-2 border-blue-500'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-2 border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {maxEnabled && maxParticipants !== null ? maxParticipants : '—'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (maxEnabled && maxParticipants !== null) {
                        setMaxParticipants(maxParticipants + 1);
                      }
                    }}
                    disabled={!maxEnabled}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Hide options field for nomination and participation polls */}
          {pollType !== 'nomination' && pollType !== 'participation' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Options{' '}
                <span className="text-gray-500 font-normal">
                  (blank for yes/no)
                </span>
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
            disabled={isLoading || isSubmitted || !isFormValid() || (!!forkOf && !hasFormChanged)}
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

        {/* Show only one header, prioritizing in order: fork > duplicate > followUpTo */}
        {forkOf ? (
          <div className="mt-4">
            <ForkHeader forkOfPollId={forkOf} onRemove={handleRemoveAssociation} />
            {!hasFormChanged && (
              <div className="mb-4 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Make changes to create your fork. The submit button will be enabled once you modify the poll.
                </p>
              </div>
            )}
          </div>
        ) : duplicateOf ? (
          <div className="mt-4">
            <FollowUpHeader followUpToPollId={duplicateOf} onRemove={handleRemoveAssociation} />
          </div>
        ) : followUpTo ? (
          <div className="mt-4">
            <FollowUpHeader followUpToPollId={followUpTo} onRemove={handleRemoveAssociation} />
          </div>
        ) : null}

        {!followUpTo && !forkOf && !duplicateOf && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-3">
            Private until you share the link
          </p>
        )}
      
      <ConfirmationModal
        isOpen={showConfirmModal}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirmModal(false)}
        title="Create Poll"
        message={`Are you sure you want to create "${title}"?`}
        confirmText="Create"
        cancelText="Cancel"
      />
      
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
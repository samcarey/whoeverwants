"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiCreatePoll, apiFindDuplicatePoll } from "@/lib/api";
import type { OptionsMetadata } from "@/lib/types";
import TypeFieldInput, { getBuiltInType } from "@/components/TypeFieldInput";
import { useAppPrefetch } from "@/lib/prefetch";
import { generateCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";
import ConfirmationModal from "@/components/ConfirmationModal";
import FollowUpHeader from "@/components/FollowUpHeader";
import ForkHeader from "@/components/ForkHeader";
import { triggerDiscoveryIfNeeded } from "@/lib/pollDiscovery";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { debugLog } from "@/lib/debugLogger";
import OptionsInput from "@/components/OptionsInput";
import MinMaxCounter from "@/components/MinMaxCounter";
import ParticipationConditions, { DayTimeWindow } from "@/components/ParticipationConditions";
import LocationTimeFieldConfig from "@/components/LocationTimeFieldConfig";
import ReferenceLocationInput from "@/components/ReferenceLocationInput";
export const dynamic = 'force-dynamic';

// Matches the rendered height of a single-line <input> with py-2 padding.
// Used for the Details textarea initial height and auto-grow reset.
const SINGLE_LINE_INPUT_HEIGHT = 42;

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

  const [title, setTitle] = useState("");
  const [pollType, setPollType] = useState<'poll' | 'nomination' | 'participation'>('nomination');
  const [options, setOptions] = useState<string[]>(['']);
  const [minParticipants, setMinParticipants] = useState<number | null>(1);
  const [maxParticipants, setMaxParticipants] = useState<number | null>(null);
  const [minEnabled, setMinEnabled] = useState(true);
  const [maxEnabled, setMaxEnabled] = useState(false);
  const [durationMinValue, setDurationMinValue] = useState<number | null>(1);
  const [durationMaxValue, setDurationMaxValue] = useState<number | null>(2);
  const [durationMinEnabled, setDurationMinEnabled] = useState(true);
  const [durationMaxEnabled, setDurationMaxEnabled] = useState(true);
  const [dayTimeWindows, setDayTimeWindows] = useState<DayTimeWindow[]>([]);
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
  const [isAutoTitle, setIsAutoTitle] = useState(true);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [hasLoadedPollType, setHasLoadedPollType] = useState(false);
  const [autoCreatePreferences, setAutoCreatePreferences] = useState(true);
  const [autoPreferencesDeadline, setAutoPreferencesDeadline] = useState("10min");
  const [autoCloseAfter, setAutoCloseAfter] = useState<number | null>(null);
  const [details, setDetails] = useState("");
  const [category, setCategory] = useState<string>('custom');
  const [optionsMetadata, setOptionsMetadata] = useState<OptionsMetadata>({});
  // Location/time fields for participation polls
  const [locationMode, setLocationMode] = useState<'none' | 'set' | 'preferences' | 'suggestions'>('none');
  const [locationValue, setLocationValue] = useState('');
  const [locationOptions, setLocationOptions] = useState<string[]>(['', '']);
  const [locationSuggestionsDeadline, setLocationSuggestionsDeadline] = useState('10min');
  const [locationPreferencesDeadline, setLocationPreferencesDeadline] = useState('10min');
  const [timeMode, setTimeMode] = useState<'none' | 'set' | 'preferences' | 'suggestions'>('none');
  const [timeValue, setTimeValue] = useState('');
  const [timeOptions, setTimeOptions] = useState<string[]>(['', '']);
  const [timeSuggestionsDeadline, setTimeSuggestionsDeadline] = useState('10min');
  const [timePreferencesDeadline, setTimePreferencesDeadline] = useState('10min');
  // Reference location for proximity-based search
  const [refLatitude, setRefLatitude] = useState<number | undefined>(undefined);
  const [refLongitude, setRefLongitude] = useState<number | undefined>(undefined);
  const [refLocationLabel, setRefLocationLabel] = useState("");
  const [searchRadius, setSearchRadius] = useState(25);

  // Generate a title from the current form state
  const generateTitle = useCallback(() => {
    const builtIn = getBuiltInType(category);
    const icon = builtIn?.icon || '';

    if (pollType === 'nomination') {
      const nominationLabels: Record<string, string> = {
        location: 'Place',
        movie: 'Movie',
        video_game: 'Video Game',
      };
      const prefix = nominationLabels[category] || (category !== 'custom' ? category : '');
      const base = prefix ? `${prefix} Suggestions` : 'Suggestions';
      return icon ? `${icon} ${base}` : base;
    }

    if (pollType === 'poll') {
      const filled = options.filter(o => o.trim());
      let base: string;
      if (filled.length === 0) base = 'Quick Vote';
      else if (filled.length === 1) base = filled[0];
      else if (filled.length === 2) base = `${filled[0]} or ${filled[1]}?`;
      else base = `${filled[0]}, ${filled[1]}, or ...?`;
      return icon ? `${icon} ${base}` : base;
    }

    // participation
    if (locationMode === 'set' && locationValue.trim()) {
      return `Who's going to ${locationValue.trim()}?`;
    }
    return "Who's in?";
  }, [pollType, category, options, locationMode, locationValue]);

  // Auto-update title when form fields change (if user hasn't manually edited)
  useEffect(() => {
    if (isAutoTitle) {
      const generated = generateTitle();
      setTitle(generated.slice(0, 50));
    }
  }, [isAutoTitle, generateTitle]);

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

  // Save poll type preference separately (persists across submissions)
  const savePollTypePreference = useCallback((type: 'poll' | 'nomination' | 'participation') => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('pollTypePreference', type);
    }
  }, []);

  // Save form state to localStorage (excluding poll type which is saved separately)
  const saveFormState = useCallback(() => {
    if (typeof window !== 'undefined') {
      const formState = {
        title,
        details,
        options,
        deadlineOption,
        customDate,
        customTime,
        creatorName,
        isAutoTitle,
        minParticipants,
        maxParticipants,
        maxEnabled,
        durationMinValue,
        durationMaxValue,
        durationMinEnabled,
        durationMaxEnabled,
        dayTimeWindows
      };
      localStorage.setItem('pollFormState', JSON.stringify(formState));
    }
  }, [title, details, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, minParticipants, maxParticipants, maxEnabled, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows]);

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

  // Load poll type preference from localStorage
  const loadPollTypePreference = () => {
    if (typeof window !== 'undefined') {
      const savedPollType = localStorage.getItem('pollTypePreference');
      if (savedPollType && (savedPollType === 'poll' || savedPollType === 'nomination' || savedPollType === 'participation')) {
        setPollType(savedPollType as 'poll' | 'nomination' | 'participation');
      }
      // Delay enabling transitions to avoid animation on initial load
      setTimeout(() => {
        setHasLoadedPollType(true);
      }, 50);
    }
  };

  // Load form state from localStorage (excluding poll type which is loaded separately)
  const loadFormState = () => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pollFormState');
      if (saved) {
        try {
          const formState = JSON.parse(saved);
          setTitle(formState.title || '');
          if (formState.isAutoTitle === false) setIsAutoTitle(false);
          setDetails(formState.details || '');
          setOptions(formState.options || ['']);
          setDeadlineOption(formState.deadlineOption || '10min');
          setCustomDate(formState.customDate || '');
          setCustomTime(formState.customTime || '');
          setCreatorName(formState.creatorName || '');

          // Restore participation poll conditions
          if (formState.minParticipants !== undefined) setMinParticipants(formState.minParticipants);
          if (formState.maxParticipants !== undefined) setMaxParticipants(formState.maxParticipants);
          if (formState.maxEnabled !== undefined) setMaxEnabled(formState.maxEnabled);
          if (formState.durationMinValue !== undefined) setDurationMinValue(formState.durationMinValue);
          if (formState.durationMaxValue !== undefined) setDurationMaxValue(formState.durationMaxValue);
          if (formState.durationMinEnabled !== undefined) setDurationMinEnabled(formState.durationMinEnabled);
          if (formState.durationMaxEnabled !== undefined) setDurationMaxEnabled(formState.durationMaxEnabled);
          if (formState.dayTimeWindows !== undefined) setDayTimeWindows(formState.dayTimeWindows);

          return formState;
        } catch (error) {
          console.error('Failed to load form state:', error);
          return null;
        }
      }
    }
    return null;
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

    const dbPollType = getPollType();

    // Options validation only applies to ranked_choice (poll tab) — nomination
    // and participation polls don't use the options array.
    if (dbPollType !== 'nomination' && dbPollType !== 'participation') {
      const filledOptions = options.filter(opt => opt.trim() !== '');

      // Check for options that exceed character limit (relaxed for autocomplete types)
      const maxOptionLength = category === 'custom' ? 35 : 200;
      const longOptions = filledOptions.filter(opt => opt.length > maxOptionLength);
      if (longOptions.length > 0) {
        return `Poll options must be ${maxOptionLength} characters or less.`;
      }

      // If we have any filled options, check that there are no empty fields in between
      if (filledOptions.length > 0) {
        let lastFilledIndex = -1;
        for (let i = options.length - 1; i >= 0; i--) {
          if (options[i].trim() !== '') {
            lastFilledIndex = i;
            break;
          }
        }

        for (let i = 0; i <= lastFilledIndex; i++) {
          if (options[i].trim() === '') {
            return "Please fill in all option fields or remove empty ones.";
          }
        }
      }

      if (filledOptions.length === 1) {
        return "Add at least one more option for a ranked choice poll, or leave all options blank for a yes/no poll.";
      }

      const uniqueOptions = new Set(filledOptions.map(opt => opt.trim()));
      if (uniqueOptions.size !== filledOptions.length) {
        return "All poll options must be unique (no duplicates).";
      }
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
    debugLog.logObject('Create poll page loaded with params', { followUpTo: followUpToParam, forkOf: forkOfParam, duplicateOf: duplicateOfParam, voteFromNomination: voteFromNominationParam }, 'CreatePoll');
    if (followUpToParam) setFollowUpTo(followUpToParam);
    if (forkOfParam) setForkOf(forkOfParam);
    if (duplicateOfParam) setDuplicateOf(duplicateOfParam);
    if (voteFromNominationParam) setVoteFromNomination(voteFromNominationParam);
  }, [followUpToParam, forkOfParam, duplicateOfParam, voteFromNominationParam]);

  // Load poll type preference first (runs once on mount)
  useEffect(() => {
    loadPollTypePreference();
  }, []); // Empty deps - only run once on mount

  // Initialize client-side state
  useEffect(() => {
    setIsClient(true);

    // Only load form state if this is NOT a follow-up, fork, duplicate, or vote-from-nomination
    // (these special cases load their own data from URL params)
    // Load saved user name
    const savedName = getUserName();
    if (savedName) {
      setCreatorName(savedName);
    }

    if (!followUpToParam && !forkOfParam && !duplicateOfParam && !voteFromNominationParam) {
      const savedFormState = loadFormState();

      // Initialize dayTimeWindows with today if no saved form state has them
      if (!savedFormState || !savedFormState.dayTimeWindows || savedFormState.dayTimeWindows.length === 0) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        setDayTimeWindows([{ day: todayStr, windows: [] }]);
      }
    }
  }, [followUpToParam, forkOfParam, duplicateOfParam, voteFromNominationParam]);

  // Save poll type preference and emit poll type changes to update the header
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Only save after initial load to avoid overwriting saved preference
      if (hasLoadedPollType) {
        savePollTypePreference(pollType);
      }

      // Emit event to update the header
      window.dispatchEvent(new CustomEvent('pollTypeChange', {
        detail: { pollType }
      }));
    }
  }, [pollType, hasLoadedPollType, savePollTypePreference]);

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
          if (forkData.title) setIsAutoTitle(false);
          setDetails(forkData.details || "");

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
          if (forkData.auto_close_after != null) {
            setAutoCloseAfter(forkData.auto_close_after);
          } else if (forkData.total_votes) {
            setAutoCloseAfter(forkData.total_votes);
          }
          if (forkData.category) {
            setCategory(forkData.category);
          }
          if (forkData.options_metadata) {
            setOptionsMetadata(forkData.options_metadata);
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
          if (duplicateData.title) setIsAutoTitle(false);
          setDetails(duplicateData.details || "");

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
          if (duplicateData.auto_close_after != null) {
            setAutoCloseAfter(duplicateData.auto_close_after);
          } else if (duplicateData.total_votes) {
            setAutoCloseAfter(duplicateData.total_votes);
          }
          if (duplicateData.category) {
            setCategory(duplicateData.category);
          }
          if (duplicateData.options_metadata) {
            setOptionsMetadata(duplicateData.options_metadata);
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
          if (voteData.title) setIsAutoTitle(false);
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

  // Save form state whenever form data changes (pollType is saved separately)
  useEffect(() => {
    if (isClient) {
      saveFormState();
    }
  }, [title, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, duplicateOf, forkOf, isClient, saveFormState, minParticipants, maxParticipants, maxEnabled, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows]);

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

      // Add details if provided
      if (details.trim()) {
        pollData.details = details.trim();
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

      // Add category for nomination and ranked_choice polls
      if ((dbPollType === 'nomination' || dbPollType === 'ranked_choice') && category !== 'custom') {
        pollData.category = category;
      }

      // Add reference location if set
      if (refLatitude !== undefined && refLongitude !== undefined) {
        pollData.reference_latitude = refLatitude;
        pollData.reference_longitude = refLongitude;
        pollData.reference_location_label = refLocationLabel;
      }

      // Add options metadata (thumbnails & info links from autocomplete)
      if (Object.keys(optionsMetadata).length > 0) {
        pollData.options_metadata = optionsMetadata;
      }

      // Add options for ranked choice polls only
      // For nomination polls, initial options become the creator's vote (not poll content)
      if (dbPollType === 'ranked_choice') {
        pollData.options = filledOptions;
      }

      // Add auto-create preferences settings for nomination polls
      if (dbPollType === 'nomination' && autoCreatePreferences) {
        pollData.auto_create_preferences = true;
        pollData.auto_preferences_deadline_minutes =
          baseDeadlineOptions.find(o => o.value === autoPreferencesDeadline)?.minutes || 10;
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

        // Add day_time_windows
        if (dayTimeWindows.length > 0) {
          pollData.day_time_windows = dayTimeWindows;
        }

        // Add duration_window if either min or max is enabled
        if (durationMinEnabled || durationMaxEnabled) {
          pollData.duration_window = {
            minValue: durationMinValue,
            maxValue: durationMaxValue,
            minEnabled: durationMinEnabled,
            maxEnabled: durationMaxEnabled
          };
        }
      }

      // Add location field for participation polls
      if (dbPollType === 'participation') {
        const addFieldData = (
          fieldName: 'location',
          mode: string,
          fieldValue: string,
          fieldOptions: string[],
          sugDeadline: string,
          prefDeadline: string,
        ) => {
          if (mode === 'none') return;
          pollData[`${fieldName}_mode`] = mode;
          if (mode === 'set') {
            pollData[`${fieldName}_value`] = fieldValue.trim();
          } else if (mode === 'preferences') {
            pollData[`${fieldName}_options`] = fieldOptions.filter(o => o.trim() !== '');
            pollData[`${fieldName}_preferences_deadline_minutes`] =
              baseDeadlineOptions.find(o => o.value === prefDeadline)?.minutes || 10;
          } else if (mode === 'suggestions') {
            pollData[`${fieldName}_suggestions_deadline_minutes`] =
              baseDeadlineOptions.find(o => o.value === sugDeadline)?.minutes || 10;
            pollData[`${fieldName}_preferences_deadline_minutes`] =
              baseDeadlineOptions.find(o => o.value === prefDeadline)?.minutes || 10;
          }
        };
        addFieldData('location', locationMode, locationValue, locationOptions, locationSuggestionsDeadline, locationPreferencesDeadline);
      }

      // Add auto-close after N respondents
      if (autoCloseAfter !== null && autoCloseAfter > 0) {
        pollData.auto_close_after = autoCloseAfter;
      }

      // Check for duplicate follow-up poll before creating
      if (followUpTo) {
        try {
          const existing = await apiFindDuplicatePoll(title, followUpTo);
          if (existing) {
            const shortId = existing.short_id || existing.id;
            router.push(`/p/${shortId}`);
            return;
          }
        } catch {
          // If the check fails, proceed with creation
        }
      }

      let createdPoll;
      try {
        createdPoll = await apiCreatePoll(pollData);
      } catch (apiError: any) {
        console.error("Error creating poll:", apiError);
        setError(apiError.message || "Failed to create poll. Please try again.");
        setIsLoading(false);
        isSubmittingRef.current = false;
        reEnableForm(form);
        return;
      }

      // Record poll creation in browser storage
      recordPollCreation(createdPoll.id, creatorSecret);

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

      // Use short_id if available, fall back to UUID
      const redirectId = createdPoll.short_id || createdPoll.id;
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
                className={`absolute top-0.5 bottom-0.5 rounded-full shadow-sm ${
                  hasLoadedPollType ? 'transition-all duration-200 ease-in-out' : ''
                } ${
                  pollType === 'nomination'
                    ? 'bg-blue-100 dark:bg-blue-700/50'
                    : pollType === 'poll'
                    ? 'bg-green-100 dark:bg-green-700/50'
                    : 'bg-purple-100 dark:bg-purple-700/50'
                }`}
                style={{
                  width: 'calc(33.333% - 4px)',
                  left: pollType === 'nomination' ? '2px' : pollType === 'poll' ? 'calc(33.333% + 1px)' : 'calc(66.666% - 0px)'
                }}
              />
              <div className="relative flex w-full">
                <button
                  type="button"
                  onClick={() => setPollType('nomination')}
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
                  onClick={() => setPollType('poll')}
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
                  onClick={() => setPollType('participation')}
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

          {/* Category selector for suggestion and poll types */}
          {pollType !== 'participation' && (
            <div>
              <label htmlFor="category" className="block text-sm font-medium mb-1">
                Category
              </label>
              <TypeFieldInput
                value={category}
                onChange={setCategory}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Reference location for location polls */}
          {(category === 'location' || (pollType === 'participation' && locationMode !== 'none')) && (
            <ReferenceLocationInput
              latitude={refLatitude}
              longitude={refLongitude}
              label={refLocationLabel}
              onLocationChange={(lat, lng, lbl) => {
                setRefLatitude(lat);
                setRefLongitude(lng);
                setRefLocationLabel(lbl);
              }}
              searchRadius={searchRadius}
              onSearchRadiusChange={setSearchRadius}
              disabled={isLoading}
            />
          )}

          {/* Participant counters for participation polls */}
          {pollType === 'participation' && (
            <ParticipationConditions
              minValue={minParticipants}
              maxValue={maxParticipants}
              maxEnabled={maxEnabled}
              onMinChange={setMinParticipants}
              onMaxChange={setMaxParticipants}
              onMaxEnabledChange={setMaxEnabled}
              disabled={isLoading}
              durationMinValue={durationMinValue}
              durationMaxValue={durationMaxValue}
              durationMinEnabled={durationMinEnabled}
              durationMaxEnabled={durationMaxEnabled}
              onDurationMinChange={setDurationMinValue}
              onDurationMaxChange={setDurationMaxValue}
              onDurationMinEnabledChange={setDurationMinEnabled}
              onDurationMaxEnabledChange={setDurationMaxEnabled}
              dayTimeWindows={dayTimeWindows}
              onDayTimeWindowsChange={setDayTimeWindows}
              isCreationForm={true}
            />
          )}

          {/* Location field for participation polls */}
          {pollType === 'participation' && (
            <div className="space-y-3">
              <LocationTimeFieldConfig
                label="Location"
                mode={locationMode}
                onModeChange={setLocationMode}
                value={locationValue}
                onValueChange={setLocationValue}
                options={locationOptions}
                onOptionsChange={setLocationOptions}
                suggestionsDeadline={locationSuggestionsDeadline}
                onSuggestionsDeadlineChange={setLocationSuggestionsDeadline}
                preferencesDeadline={locationPreferencesDeadline}
                onPreferencesDeadlineChange={setLocationPreferencesDeadline}
                deadlineOptions={baseDeadlineOptions}
                isLoading={isLoading}
              />
            </div>
          )}

          {/* Options field for poll type (ranked choice / yes-no) */}
          {pollType !== 'nomination' && pollType !== 'participation' && (
            <OptionsInput
              options={options}
              setOptions={setOptions}
              isLoading={isLoading}
              pollType="poll"
              category={category}
              optionsMetadata={optionsMetadata}
              onMetadataChange={setOptionsMetadata}
              referenceLatitude={refLatitude}
              referenceLongitude={refLongitude}
              searchRadius={searchRadius}
              label={<>Options{' '}<span className="text-gray-500 font-normal">(blank for yes/no)</span></>}
            />
          )}

          <div>
            <label htmlFor="deadline" className="block text-sm font-medium mb-1">
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
              <label className="block text-sm font-medium mb-1">
                Custom Deadline<span className="text-gray-500 font-normal">{getCustomDeadlineDisplay()}</span>
              </label>
              <div className="flex justify-between gap-2">
                <div className="w-auto">
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
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs text-center"
                    style={{ fontSize: '14px' }}
                    required
                  />
                </div>
                <div className="w-auto">
                  <label htmlFor="customTime" className="block text-xs text-gray-500 mb-1 text-right">
                    Time
                  </label>
                  <input
                    type="time"
                    id="customTime"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    disabled={isLoading}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs text-center"
                    style={{ fontSize: '14px' }}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Auto-close after N responses */}
          <div>
            <label className="block text-sm font-medium mb-1">Auto-close</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">After</span>
              <input
                type="number"
                min="1"
                value={autoCloseAfter ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setAutoCloseAfter(val === '' ? null : Math.max(1, parseInt(val, 10) || 1));
                }}
                disabled={isLoading}
                placeholder="—"
                className="w-16 px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm text-center"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">responses</span>
              {autoCloseAfter !== null && (
                <button
                  type="button"
                  onClick={() => setAutoCloseAfter(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-1"
                  title="Disable auto-close"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Auto-create preferences poll checkbox - nomination polls only */}
          {pollType === 'nomination' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCreatePreferences}
                  onChange={(e) => setAutoCreatePreferences(e.target.checked)}
                  disabled={isLoading}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Ask for preferences when closed
                </span>
              </label>
              {autoCreatePreferences && (
                <div className="ml-6">
                  <label htmlFor="autoPreferencesDeadline" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Preferences poll deadline
                  </label>
                  <select
                    id="autoPreferencesDeadline"
                    value={autoPreferencesDeadline}
                    onChange={(e) => setAutoPreferencesDeadline(e.target.value)}
                    disabled={isLoading}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    <option value="5min">5 minutes</option>
                    <option value="10min">10 minutes</option>
                    <option value="15min">15 minutes</option>
                    <option value="30min">30 minutes</option>
                    <option value="1hr">1 hour</option>
                    <option value="2hr">2 hours</option>
                    <option value="4hr">4 hours</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1">
              Title
            </label>
            <div className="relative">
              <input
                type="text"
                id="title"
                ref={titleInputRef}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setIsAutoTitle(false);
                }}
                disabled={isLoading}
                maxLength={50}
                className="w-full px-3 py-2 pr-9 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Enter your title..."
                required
              />
              {!isAutoTitle && (
                <button
                  type="button"
                  onClick={() => setIsAutoTitle(true)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Auto-generate title"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Optional details field */}
          <div>
            <label htmlFor="details" className="block text-sm font-medium mb-1">
              Details{' '}
              <span className="text-gray-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="details"
              value={details}
              onChange={(e) => {
                setDetails(e.target.value);
                const el = e.target;
                el.style.height = `${SINGLE_LINE_INPUT_HEIGHT}px`;
                const maxH = 5 * 20 + 16; // 5 lines + padding
                el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
                el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
              }}
              disabled={isLoading}
              style={{ height: SINGLE_LINE_INPUT_HEIGHT }}
              className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
              placeholder="Add more context or instructions..."
            />
          </div>

          <div>
            <label htmlFor="creatorName" className="block text-sm font-medium mb-1">
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
            className="w-full py-3 px-4 rounded-lg bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] active:bg-[#2a2a2a] dark:active:bg-[#e0e0e0] active:scale-95 font-medium text-base transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center"
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
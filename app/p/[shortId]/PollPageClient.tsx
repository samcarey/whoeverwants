"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAppPrefetch } from "@/lib/prefetch";
import Countdown from "@/components/Countdown";
import SuccessPopup from "@/components/SuccessPopup";
import RankableOptions from "@/components/RankableOptions";
import PollResultsDisplay from "@/components/PollResults";
import ConfirmationModal from "@/components/ConfirmationModal";
import FloatingHomeButton from "@/components/FloatingHomeButton";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import FollowUpButton from "@/components/FollowUpButton";
import { Poll, supabase, PollResults, getPollResults, closePoll, reopenPoll } from "@/lib/supabase";
import { isCreatedByThisBrowser, getCreatorSecret } from "@/lib/browserPollAccess";
import { forgetPoll, hasPollData } from "@/lib/forgetPoll";
import { debugLog } from "@/lib/debugLogger";

interface PollPageClientProps {
  poll: Poll;
  createdDate: string;
  pollId: string | null;
}

export default function PollPageClient({ poll, createdDate, pollId }: PollPageClientProps) {
  const router = useRouter();
  const { prefetch } = useAppPrefetch();
  const searchParams = useSearchParams();
  const isNewPoll = searchParams.get("new") === "true";
  const [showSuccessPopup, setShowSuccessPopup] = useState(isNewPoll);
  const [pollUrl, setPollUrl] = useState("");
  const [rankedChoices, setRankedChoices] = useState<string[]>([]);
  const [optionsInitialized, setOptionsInitialized] = useState(false);
  const [yesNoChoice, setYesNoChoice] = useState<'yes' | 'no' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [pollResults, setPollResults] = useState<PollResults | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [isClosingPoll, setIsClosingPoll] = useState(false);
  const [isReopeningPoll, setIsReopeningPoll] = useState(false);
  const [pollClosed, setPollClosed] = useState(poll.is_closed ?? false);
  const [manuallyReopened, setManuallyReopened] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [showVoteConfirmModal, setShowVoteConfirmModal] = useState(false);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);
  const [showReopenConfirmModal, setShowReopenConfirmModal] = useState(false);
  const [userVoteId, setUserVoteId] = useState<string | null>(null);
  const [userVoteData, setUserVoteData] = useState<any>(null);
  const [isLoadingVoteData, setIsLoadingVoteData] = useState(false);
  const [isEditingVote, setIsEditingVote] = useState(false);
  const [showForgetConfirmModal, setShowForgetConfirmModal] = useState(false);
  const [hasPollDataState, setHasPollDataState] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const isPollExpired = useMemo(() => 
    poll.response_deadline && new Date(poll.response_deadline) <= currentTime, 
    [poll.response_deadline, currentTime]
  );
  
  const isPollClosed = useMemo(() => {
    // If manually reopened, stay open regardless of deadline
    if (manuallyReopened && !pollClosed) return false;
    
    // Otherwise, use normal logic: manual close OR deadline expiration
    return pollClosed || isPollExpired;
  }, [pollClosed, isPollExpired, manuallyReopened]);

  // Check if user has voted on this poll (stored in localStorage)
  const hasVotedOnPoll = useCallback((pollId: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      return votedPolls[pollId] === true;
    } catch (error) {
      console.error('Error checking vote status:', error);
      return false;
    }
  }, []);

  // Mark poll as voted (save to localStorage)
  const markPollAsVoted = useCallback((pollId: string, voteId?: string) => {
    if (typeof window === 'undefined') return;
    try {
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      votedPolls[pollId] = true;
      localStorage.setItem('votedPolls', JSON.stringify(votedPolls));
      
      // Store the vote ID if provided
      if (voteId) {
        const voteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
        voteIds[pollId] = voteId;
        localStorage.setItem('pollVoteIds', JSON.stringify(voteIds));
        debugLog.info(`Stored vote ID for poll ${pollId}: ${voteId}`, 'VoteStorage');
      }
    } catch (error) {
      console.error('Error marking poll as voted:', error);
    }
  }, []);


  // Get stored vote ID for a poll
  const getStoredVoteId = useCallback((pollId: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const voteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
      const storedVoteId = voteIds[pollId] || null;
      debugLog.info(`Retrieved stored vote ID for poll ${pollId}: ${storedVoteId}`, 'VoteStorage');
      return storedVoteId;
    } catch (error) {
      console.error('Error getting stored vote ID:', error);
      return null;
    }
  }, []);

  // Fetch vote data from database by vote ID
  const fetchVoteData = useCallback(async (voteId: string) => {
    debugLog.info(`Fetching vote data for ID: ${voteId}`, 'VoteFetch');
    
    try {
      const { data, error } = await supabase
        .from('votes')
        .select('poll_id, vote_type, yes_no_choice, ranked_choices')
        .eq('id', voteId)
        .single();

      if (error) {
        debugLog.error(`Error fetching vote data for ${voteId}: ${error.message}`, 'VoteFetch');
        return null;
      }

      debugLog.logObject(`Vote data fetched for ${voteId}`, data, 'VoteFetch');
      return data || null;
    } catch (error) {
      debugLog.error(`Exception fetching vote data for ${voteId}: ${error}`, 'VoteFetch');
      return null;
    }
  }, []);

  const fetchPollResults = useCallback(async () => {
    setLoadingResults(true);
    try {
      const results = await getPollResults(poll.id);
      setPollResults(results);
    } catch (error) {
      console.error('Error fetching poll results:', error);
    } finally {
      setLoadingResults(false);
    }
  }, [poll.id]);

  // Initialize ranked choices with randomized options - runs only once
  useEffect(() => {
    if (poll.poll_type === 'ranked_choice' && poll.options && !optionsInitialized) {
      // Don't initialize if we already have choices from localStorage
      if (hasVoted && rankedChoices.length > 0) {
        setOptionsInitialized(true);
        return;
      }
      
      // Parse options if they're stored as JSON string
      const parsedOptions = typeof poll.options === 'string' 
        ? JSON.parse(poll.options) 
        : poll.options;
      
      // Randomize the order of options for voters (Fisher-Yates shuffle)
      const shuffledOptions = [...parsedOptions];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
      }
      
      setRankedChoices(shuffledOptions);
      setOptionsInitialized(true);
    }
  }, [poll.poll_type, poll.options, optionsInitialized, hasVoted, rankedChoices.length]);

  // Clean up URL parameter when success popup is shown
  useEffect(() => {
    if (isNewPoll && showSuccessPopup) {
      // Remove the ?new=true parameter from the URL without refreshing the page
      const newUrl = window.location.pathname + window.location.hash;
      router.replace(newUrl, { scroll: false });
    }
  }, [isNewPoll, showSuccessPopup, router]);

  // Effect to load vote data when poll loads or when hasVoted changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Use the current page URL (always full UUID now)
      setPollUrl(window.location.href.split('?')[0]);
    }
    
    // Check if this browser created the poll
    setIsCreator(isCreatedByThisBrowser(poll.id));
    
    // Check if browser has any data for this poll
    setHasPollDataState(hasPollData(poll.id));
    
    // Load vote data if user has voted (either from localStorage check or hasVoted state)
    const shouldLoadVoteData = hasVoted || hasVotedOnPoll(poll.id);
    
    if (shouldLoadVoteData) {
      setHasVoted(true);
      
      // Get the vote ID if available
      const voteId = getStoredVoteId(poll.id);
      setUserVoteId(voteId);
      
      // Fetch vote data from database if we have a vote ID
      if (voteId) {
        setIsLoadingVoteData(true);
        debugLog.info(`Starting vote data load for vote ID: ${voteId}`, 'VoteLoad');
        fetchVoteData(voteId).then(voteData => {
          if (voteData) {
            setUserVoteData(voteData);
            
            // Set UI state based on vote data from database columns
            if (poll.poll_type === 'yes_no' && voteData.yes_no_choice) {
              setYesNoChoice(voteData.yes_no_choice);
              debugLog.info(`Loaded yes/no vote: ${voteData.yes_no_choice}`, 'VoteLoad');
            } else if (poll.poll_type === 'ranked_choice' && voteData.ranked_choices) {
              setRankedChoices(voteData.ranked_choices);
              debugLog.info(`Loaded ranked choices: ${JSON.stringify(voteData.ranked_choices)}`, 'VoteLoad');
            }
          } else {
            debugLog.warn(`No vote data found for ID: ${voteId}`, 'VoteLoad');
          }
        }).catch(err => {
          debugLog.error(`Error loading vote data: ${err.message}`, 'VoteLoad');
        }).finally(() => {
          setIsLoadingVoteData(false);
        });
      }
    }
  }, [poll.id, poll.poll_type, hasVoted, hasVotedOnPoll, getStoredVoteId, fetchVoteData]);

  // Separate effect to fetch results when poll closes
  useEffect(() => {
    // Fetch results if poll is closed (reactive to state changes)
    const isClosed = pollClosed || (poll.response_deadline && new Date(poll.response_deadline) <= new Date());
    if (isClosed) {
      fetchPollResults();
    }
  }, [pollClosed, poll.response_deadline, fetchPollResults]);

  // Real-time timer to check for poll expiration
  useEffect(() => {
    if (!poll.response_deadline || pollClosed) {
      return; // No deadline or already manually closed
    }

    const deadline = new Date(poll.response_deadline);
    const updateTimer = () => {
      const now = new Date();
      setCurrentTime(now);
      
      // If poll just expired, automatically fetch results
      if (now >= deadline && !isPollClosed) {
        console.log('Poll expired, fetching results...');
        fetchPollResults();
      }
    };

    // Update immediately
    updateTimer();

    // Set up interval to check every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [poll.response_deadline, pollClosed, isPollClosed, fetchPollResults]);

  // Real-time subscription to listen for poll status changes (with polling fallback)
  useEffect(() => {
    console.log(`🎬 Setting up real-time subscription for poll ${poll.id}`);
    
    let realtimeWorking = false;
    let pollInterval: NodeJS.Timeout | null = null;
    
    // Polling fallback function
    const pollForChanges = async () => {
      try {
        const { data, error } = await supabase
          .from('polls')
          .select('is_closed')
          .eq('id', poll.id)
          .single();
        
        if (data && data.is_closed && !pollClosed) {
          console.log('🔒 Poll closed detected - updating to show results!');
          setPollClosed(true);
          setManuallyReopened(false); // Reset flag when closed
          fetchPollResults();
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };
    
    const subscription = supabase
      .channel(`poll-changes-${poll.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'polls',
          filter: `id=eq.${poll.id}`,
        },
        (payload) => {
          console.log('🔄 Poll updated in real-time:', payload);
          console.log('📝 Current pollClosed state:', pollClosed);
          
          // Check if the poll was manually closed
          if (payload.new && payload.new.is_closed && !pollClosed) {
            console.log('🔒 Poll was manually closed by creator, updating UI...');
            setPollClosed(true);
            setManuallyReopened(false); // Reset flag when closed by someone else
            fetchPollResults();
          } else if (payload.new && payload.new.is_closed && pollClosed) {
            console.log('ℹ️ Poll already marked as closed locally');
          } else if (payload.new && !payload.new.is_closed) {
            console.log('🔓 Poll is still open according to database');
          }
          
          // Also handle other potential updates like title changes
          if (payload.new && payload.old) {
            const changedFields = Object.keys(payload.new).filter(key => 
              payload.new[key] !== payload.old[key]
            );
            console.log('📊 Poll data updated:', { changed: changedFields });
            
            // Log specific field changes
            changedFields.forEach(field => {
              console.log(`   ${field}: ${payload.old[field]} → ${payload.new[field]}`);
            });
          }
        }
      )
      .subscribe((status: any) => {
        console.log(`🔗 Real-time subscription status for poll ${poll.id}:`, status);
        
        // Status is either a string or an object with status property
        const statusValue = typeof status === 'string' ? status : status?.status;
        
        if (statusValue === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to real-time updates!');
          console.log('📡 Listening for changes to poll:', poll.id);
          realtimeWorking = true;
          
          // Clear polling if real-time is working
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
            console.log('🛑 Stopping polling - real-time is working');
          }
        } else if (statusValue === 'CHANNEL_ERROR') {
          console.warn('⚠️ Real-time subscription not available. Using polling fallback...');
          console.log('💡 Note: Real-time may need to be enabled in Supabase dashboard');
          console.log('✅ No worries - polling will automatically detect changes every 2 seconds');
          
          // Start polling as fallback (every 2 seconds)
          if (!pollInterval && !pollClosed) {
            console.log('🔄 Starting automatic polling (checking every 2 seconds)');
            pollInterval = setInterval(pollForChanges, 2000);
            // Check immediately as well
            pollForChanges();
          }
        } else if (statusValue === 'TIMED_OUT') {
          console.warn('⏰ Real-time subscription timed out');
        } else if (statusValue === 'CLOSED') {
          console.log('🚪 Real-time subscription closed');
        }
      });

    return () => {
      console.log(`🔌 Unsubscribing from poll ${poll.id} real-time updates`);
      subscription.unsubscribe();
      
      // Clean up polling interval
      if (pollInterval) {
        clearInterval(pollInterval);
        console.log('🛑 Stopped polling on cleanup');
      }
    };
  }, [poll.id, pollClosed, fetchPollResults]);

  const handleRankingChange = useCallback((newRankedChoices: string[]) => {
    setRankedChoices(newRankedChoices);
  }, []);

  // Memoize parsed options to prevent re-parsing on every render
  const pollOptions = useMemo(() => {
    if (!poll.options) return [];
    return typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
  }, [poll.options]);

  const handleYesNoVote = (choice: 'yes' | 'no') => {
    setYesNoChoice(choice);
  };

  const handleCloseClick = () => {
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isClosingPoll || (!isCreator && !isDev)) return;
    
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret && !isDev) {
      alert('You do not have permission to close this poll.');
      return;
    }
    
    setShowCloseConfirmModal(true);
  };

  const handleReopenClick = () => {
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isReopeningPoll || !isDev) return;
    
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret && !isDev) {
      alert('You do not have permission to reopen this poll.');
      return;
    }
    
    setShowReopenConfirmModal(true);
  };

  const handleClosePoll = async () => {
    setShowCloseConfirmModal(false);
    
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isClosingPoll || (!isCreator && !isDev)) return;
    
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret && !isDev) {
      alert('You do not have permission to close this poll.');
      return;
    }
    
    setIsClosingPoll(true);
    try {
      // In development mode, use empty string if no creator secret
      const secretToUse = isDev && !creatorSecret ? '' : creatorSecret || '';
      const success = await closePoll(poll.id, secretToUse);
      if (success) {
        // Refetch the poll data to get the updated is_closed value
        const { data: updatedPoll, error } = await supabase
          .from("polls")
          .select("*")
          .eq("id", poll.id)
          .single();
        
        // Poll updated successfully
        
        setPollClosed(true);
        setManuallyReopened(false); // Reset manually reopened flag when closing
        await fetchPollResults();
      } else {
        alert('Failed to close poll. Please try again.');
      }
    } catch (error) {
      console.error('Error closing poll:', error);
      alert('Failed to close poll. Please try again.');
    } finally {
      setIsClosingPoll(false);
    }
  };

  const handleReopenPoll = async () => {
    setShowReopenConfirmModal(false);
    
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isReopeningPoll || !isDev) return;
    
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret && !isDev) {
      alert('You do not have permission to reopen this poll.');
      return;
    }
    
    setIsReopeningPoll(true);
    try {
      // In development mode, use empty string if no creator secret
      const secretToUse = isDev && !creatorSecret ? '' : creatorSecret || '';
      const success = await reopenPoll(poll.id, secretToUse);
      if (success) {
        // Refetch the poll data to get the updated is_closed value
        const { data: updatedPoll, error } = await supabase
          .from("polls")
          .select("*")
          .eq("id", poll.id)
          .single();
        
        // Poll updated successfully
        setPollClosed(false);
        setManuallyReopened(true); // Set flag to override deadline expiration
        setPollResults(null); // Clear results since poll is now open
      } else {
        alert('Failed to reopen poll. Please try again.');
      }
    } catch (error) {
      console.error('Error reopening poll:', error);
      alert('Failed to reopen poll. Please try again.');
    } finally {
      setIsReopeningPoll(false);
    }
  };

  const handleVoteClick = () => {
    if (isSubmitting || (hasVoted && !isEditingVote) || isPollClosed) return;
    
    // Validate vote choice first
    if (poll.poll_type === 'yes_no' && !yesNoChoice) {
      setVoteError("Please select Yes or No");
      return;
    }
    
    if (poll.poll_type === 'ranked_choice') {
      const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
      if (filteredRankedChoices.length === 0) {
        setVoteError("Please rank at least one option");
        return;
      }
    }
    
    setVoteError(null);
    setShowVoteConfirmModal(true);
  };

  const submitVote = async () => {
    setShowVoteConfirmModal(false);
    
    if (isSubmitting || (hasVoted && !isEditingVote) || isPollClosed) return;

    setIsSubmitting(true);
    setVoteError(null);

    try {
      let voteData;
      
      if (poll.poll_type === 'yes_no') {
        if (!yesNoChoice) {
          setVoteError("Please select Yes or No");
          return;
        }
        voteData = {
          poll_id: poll.id,
          vote_type: 'yes_no' as const,
          yes_no_choice: yesNoChoice
        };
      } else {
        // Filter and validate ranked choices (No Preference items already filtered by RankableOptions)
        const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
        
        if (filteredRankedChoices.length === 0) {
          setVoteError("Please rank at least one option");
          return;
        }
        
        // Additional validation: ensure choices are valid poll options
        const pollOptions = typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
        const invalidChoices = filteredRankedChoices.filter(choice => !pollOptions.includes(choice));
        
        if (invalidChoices.length > 0) {
          console.error('Invalid choices detected:', invalidChoices);
          setVoteError("Invalid options detected. Please refresh and try again.");
          return;
        }
        
        voteData = {
          poll_id: poll.id,
          vote_type: 'ranked_choice' as const,
          ranked_choices: filteredRankedChoices
        };
      }

      let voteId;
      let error;

      debugLog.info(`Vote Submit: ${isEditingVote ? 'EDIT' : 'NEW'} mode, voteId: ${userVoteId}`, 'VoteSubmit');
      debugLog.logObject('Vote data being submitted', voteData, 'VoteSubmit');

      if (isEditingVote && userVoteId) {
        debugLog.info(`Taking UPDATE path for existing vote ${userVoteId}`, 'VoteSubmit');
        
        // Create update data with only the vote choice (don't update vote_type or poll_id)
        const updateData = poll.poll_type === 'yes_no' 
          ? { yes_no_choice: yesNoChoice }
          : { ranked_choices: rankedChoices };
        
        debugLog.logObject('Update data being sent (without poll_id)', updateData, 'VoteSubmit');
        
        // Update existing vote
        const { error: updateError, data: returnedData } = await supabase
          .from('votes')
          .update(updateData)
          .eq('id', userVoteId)
          .select(); // Add select to see what was updated

        error = updateError;
        voteId = userVoteId;
        
        // Update local userVoteData to reflect the changes
        if (!updateError && returnedData && returnedData.length > 0) {
          setUserVoteData(voteData);
          debugLog.info(`✅ Vote UPDATE SUCCESS! Updated vote ${userVoteId}`, 'VoteSubmit');
          debugLog.logObject('Updated vote data returned from DB', returnedData, 'VoteSubmit');
        } else if (!updateError && (!returnedData || returnedData.length === 0)) {
          debugLog.error(`❌ Vote UPDATE returned no data - vote may not exist with ID: ${userVoteId}`, 'VoteSubmit');
          setVoteError("Failed to update vote. Vote may not exist.");
        } else {
          debugLog.error(`❌ Vote UPDATE FAILED: ${updateError?.message || 'Unknown error'}`, 'VoteSubmit');
        }
      } else {
        debugLog.info(`Taking INSERT path for new vote`, 'VoteSubmit');
        
        // Insert new vote
        const { data: insertedVote, error: insertError } = await supabase
          .from('votes')
          .insert([voteData])
          .select('id')
          .single();

        error = insertError;
        voteId = insertedVote?.id;

        if (!voteId) {
          debugLog.error(`❌ Vote INSERT FAILED: No vote ID returned`, 'VoteSubmit');
          setVoteError("Failed to submit vote. Please try again.");
          return;
        } else {
          debugLog.info(`✅ Vote INSERT SUCCESS! New vote ID: ${voteId}`, 'VoteSubmit');
        }
      }

      if (error) {
        console.error('Error submitting vote:', error);
        setVoteError("Failed to submit vote. Please try again.");
        return;
      }

      setHasVoted(true);
      setUserVoteId(voteId);
      
      // Save vote to localStorage so user can't vote again (only for new votes)
      if (!isEditingVote) {
        markPollAsVoted(poll.id, voteId);
        // Update hasPollData state
        setHasPollDataState(true);
      }
      
      setIsEditingVote(false);
      
      // If the poll is closed, fetch results immediately after voting
      if (isPollClosed) {
        await fetchPollResults();
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setVoteError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Fixed header bar */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center pt-3 pb-2">
          <h1 className="text-xl font-bold text-center px-4 break-words select-none">{poll.title}</h1>
        </div>
      </div>
      
      <div className="max-w-md mx-auto pb-20 pt-16">
          
          
          {!isPollClosed && <Countdown deadline={poll.response_deadline || null} />}
          
          {/* Poll Content Based on Type */}
          {poll.poll_type === 'yes_no' ? (
            <div>
              {isPollClosed ? (
                <div className="py-6">
                  {loadingResults ? (
                    <div className="flex justify-center items-center py-8">
                      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : pollResults ? (
                    <>
                      <PollResultsDisplay results={pollResults} isPollClosed={isPollClosed} userVoteData={userVoteData} />
                      <div className="mt-6 text-center">
                        <FollowUpButton pollId={poll.id} isPollClosed={isPollClosed} />
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
                </div>
              ) : hasVoted && !isEditingVote ? (
                <div className="text-center py-6">
                  <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-lg py-4 px-4 mb-4">
                    <h3 className="font-semibold text-green-800 dark:text-green-200 text-center">Vote Submitted!</h3>
                  </div>
                  <div className="text-left">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Your vote:</h4>
                      {!isLoadingVoteData && !isPollClosed && (
                        <button
                          onClick={() => setIsEditingVote(true)}
                          className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {isLoadingVoteData ? (
                      <div className="flex items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center mr-3">
                          <svg className="animate-spin h-4 w-4 text-gray-600 dark:text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        </div>
                        <span className="font-medium text-gray-600 dark:text-gray-400">Loading your vote...</span>
                      </div>
                    ) : (
                      <div className={`flex items-center p-3 rounded-lg ${
                        yesNoChoice === 'yes' 
                          ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700' 
                          : 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700'
                      }`}>
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mr-3 ${
                          yesNoChoice === 'yes'
                            ? 'bg-green-600 text-white'
                            : 'bg-red-600 text-white'
                        }`}>
                          {yesNoChoice === 'yes' ? '✓' : '✗'}
                        </span>
                        <span className={`font-medium ${
                          yesNoChoice === 'yes'
                            ? 'text-green-800 dark:text-green-200'
                            : 'text-red-800 dark:text-red-200'
                        }`}>
                          {yesNoChoice === 'yes' ? 'Yes' : 'No'}
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Follow-up button for open polls when voted */}
                  {!isPollClosed && (
                    <div className="mt-4 text-center">
                      <FollowUpButton pollId={poll.id} isPollClosed={false} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex gap-3 mb-4">
                    <button 
                      onClick={() => handleYesNoVote('yes')}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                        yesNoChoice === 'yes' 
                          ? 'bg-green-200 dark:bg-green-800 text-green-900 dark:text-green-100 border-2 border-green-400 dark:border-green-600' 
                          : 'bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200 border-2 border-transparent'
                      }`}
                    >
                      Yes
                    </button>
                    <button 
                      onClick={() => handleYesNoVote('no')}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                        yesNoChoice === 'no' 
                          ? 'bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100 border-2 border-red-400 dark:border-red-600' 
                          : 'bg-red-100 hover:bg-red-200 dark:bg-red-900 dark:hover:bg-red-800 text-red-800 dark:text-red-200 border-2 border-transparent'
                      }`}
                    >
                      No
                    </button>
                  </div>
                  
                  {voteError && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                      {voteError}
                    </div>
                  )}
                  
                  <button
                    onClick={handleVoteClick}
                    disabled={isSubmitting || !yesNoChoice}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>
                  
                  {/* Follow-up button for open polls */}
                  <div className="mt-4 text-center">
                    <FollowUpButton pollId={poll.id} isPollClosed={false} />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div>
              {isPollClosed ? (
                <div>
                  {loadingResults ? (
                    <div className="flex justify-center items-center py-8">
                      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : pollResults ? (
                    <>
                      <PollResultsDisplay results={pollResults} isPollClosed={isPollClosed} userVoteData={userVoteData} />
                      <div className="mt-6 text-center">
                        <FollowUpButton pollId={poll.id} isPollClosed={isPollClosed} />
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
                </div>
              ) : hasVoted && !isEditingVote ? (
                <div className="text-center py-6">
                  <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-lg py-4 px-4 mb-4">
                    <h3 className="font-semibold text-green-800 dark:text-green-200 text-center">Vote Submitted!</h3>
                  </div>
                  <div className="text-left">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Your ranking:</h4>
                      {!isLoadingVoteData && !isPollClosed && (
                        <button
                          onClick={() => setIsEditingVote(true)}
                          className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {isLoadingVoteData ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((num) => (
                          <div key={num} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded animate-pulse">
                            <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium mr-3">
                              <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
                          </div>
                        ))}
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Loading your ranking...</div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {rankedChoices.map((choice, index) => (
                          <div key={index} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
                            <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
                              {index + 1}
                            </span>
                            <span>{choice}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Follow-up button for open polls when voted */}
                  {!isPollClosed && (
                    <div className="mt-4 text-center">
                      <FollowUpButton pollId={poll.id} isPollClosed={false} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {pollOptions.length > 0 && (
                    <RankableOptions 
                      key={isEditingVote ? 'editing' : 'new'}
                      options={pollOptions} 
                      onRankingChange={handleRankingChange}
                      disabled={isSubmitting}
                      storageKey={pollId ? `poll-ranking-${pollId}` : undefined}
                      initialRanking={isEditingVote && userVoteData?.ranked_choices ? userVoteData.ranked_choices : undefined}
                    />
                  )}
                  
                  {voteError && (
                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                      {voteError}
                    </div>
                  )}
                  
                  <button
                    onClick={handleVoteClick}
                    disabled={isSubmitting || rankedChoices.length === 0}
                    className="w-full mt-4 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>
                  
                  {/* Follow-up button for open polls */}
                  <div className="mt-4 text-center">
                    <FollowUpButton pollId={poll.id} isPollClosed={false} />
                  </div>
                </>
              )}
            </div>
          )}
          
          {/* Close Poll Button for Poll Creators (or anyone in dev mode) */}
          {!isPollClosed && (isCreator || process.env.NODE_ENV === 'development') && (
            <div className="mt-4 text-center">
              <button
                onClick={handleCloseClick}
                disabled={isClosingPoll}
                className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {isClosingPoll ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Closing Poll...
                  </>
                ) : (
                  'Close Poll'
                )}
              </button>
            </div>
          )}

          {/* Reopen Poll Button for Dev Mode Only */}
          {isPollClosed && process.env.NODE_ENV === 'development' && (
            <div className="mt-4 text-center">
              <button
                onClick={handleReopenClick}
                disabled={isReopeningPoll}
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {isReopeningPoll ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Reopening Poll...
                  </>
                ) : (
                  'Reopen Poll (Dev)'
                )}
              </button>
            </div>
          )}
          
          {/* Created date line */}
          <div className="flex justify-between items-center text-gray-600 dark:text-gray-300 mt-4 mb-4">
            <p className="text-xs">
              Created {createdDate}
              {isPollClosed && pollResults && (
                <span> • {pollResults.total_votes} vote{pollResults.total_votes !== 1 ? 's' : ''}</span>
              )}
            </p>
{poll.response_deadline && (
              <p className="text-xs">
                {isPollClosed ? 'Closed' : 'Expires'} {(() => {
                  const deadline = new Date(poll.response_deadline);
                  const now = new Date();
                  const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
                  
                  if (hoursUntilDeadline <= 24 && hoursUntilDeadline > 0) {
                    // Within 24 hours, show date and time
                    return deadline.toLocaleString("en-US", {
                      month: "numeric",
                      day: "numeric",
                      year: "2-digit",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true
                    });
                  } else {
                    // More than 24 hours away or expired, just show date
                    return deadline.toLocaleDateString("en-US", {
                      month: "numeric",
                      day: "numeric",
                      year: "2-digit"
                    });
                  }
                })()}
              </p>
            )}
          </div>
          
          {/* Forget Poll Button */}
          {hasPollDataState && (
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
              <button
                onClick={() => setShowForgetConfirmModal(true)}
                className="inline-flex py-2 px-4 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:border-red-300 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:border-red-600 dark:hover:text-red-400 transition-all duration-200"
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Forget this poll</span>
                </div>
              </button>
            </div>
          )}

      </div>

      <SuccessPopup 
        show={showSuccessPopup} 
        onClose={() => setShowSuccessPopup(false)} 
      />
      
      <ConfirmationModal
        isOpen={showVoteConfirmModal}
        onConfirm={submitVote}
        onCancel={() => setShowVoteConfirmModal(false)}
        title="Submit Vote"
        message={poll.poll_type === 'yes_no' 
          ? `Are you sure you want to vote "${yesNoChoice?.toUpperCase()}"?` 
          : `Are you sure you want to submit your ranking?`}
        confirmText="Submit Vote"
        cancelText="Cancel"
        confirmButtonClass="bg-blue-600 hover:bg-blue-700 text-white"
      />
      
      <ConfirmationModal
        isOpen={showCloseConfirmModal}
        onConfirm={handleClosePoll}
        onCancel={() => setShowCloseConfirmModal(false)}
        title="Close Poll"
        message="Are you sure you want to close this poll? This action cannot be undone and voting will end immediately."
        confirmText="Close Poll"
        cancelText="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
      />
      
      <ConfirmationModal
        isOpen={showReopenConfirmModal}
        onConfirm={handleReopenPoll}
        onCancel={() => setShowReopenConfirmModal(false)}
        title="Reopen Poll"
        message="Are you sure you want to reopen this poll? This will allow voting to resume and results will be hidden until the poll is closed again."
        confirmText="Reopen Poll"
        cancelText="Cancel"
        confirmButtonClass="bg-green-600 hover:bg-green-700 text-white"
      />
      
      <ConfirmationModal
        isOpen={showForgetConfirmModal}
        onConfirm={() => {
          forgetPoll(poll.id);
          setShowForgetConfirmModal(false);
          router.push('/');
        }}
        onCancel={() => setShowForgetConfirmModal(false)}
        title="Forget Poll"
        message="This will remove the poll from your browser's history. You won't see it in your poll list anymore, and any vote data stored locally will be deleted. You can still access it again with the direct link."
        confirmText="Forget Poll"
        cancelText="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
      />
      
      <FloatingHomeButton />
      <FloatingCopyLinkButton url={pollUrl} />
    </>
  );
}
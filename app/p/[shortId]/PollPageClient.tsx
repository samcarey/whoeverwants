"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAppPrefetch } from "@/lib/prefetch";
import Countdown from "@/components/Countdown";
import RankableOptions from "@/components/RankableOptions";
import PollResultsDisplay from "@/components/PollResults";
import NominationVotingInterface from "@/components/NominationVotingInterface";
import ConfirmationModal from "@/components/ConfirmationModal";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import FollowUpHeader from "@/components/FollowUpHeader";
import ForkHeader from "@/components/ForkHeader";
import PollList from "@/components/PollList";
import ProfileButton from "@/components/ProfileButton";
import FollowUpModal from "@/components/FollowUpModal";
import VoterList from "@/components/VoterList";
import PollManagementButtons from "@/components/PollManagementButtons";
import GradientBorderButton from "@/components/GradientBorderButton";
import YesNoAbstainButtons from "@/components/YesNoAbstainButtons";
import { Poll, supabase, PollResults, getPollResults, getParticipatingVoters, closePoll, reopenPoll } from "@/lib/supabase";
import { isCreatedByThisBrowser, getCreatorSecret } from "@/lib/browserPollAccess";
import { forgetPoll, hasPollData } from "@/lib/forgetPoll";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { usePageTitle } from "@/lib/usePageTitle";
import ParticipationConditions from "@/components/ParticipationConditions";

interface PollPageClientProps {
  poll: Poll;
  createdDate: string;
  pollId: string | null;
}

export default function PollPageClient({ poll, createdDate, pollId }: PollPageClientProps) {
  // Set the page title in the template header
  usePageTitle(poll.title);
  
  const router = useRouter();
  const { prefetch } = useAppPrefetch();
  const searchParams = useSearchParams();
  const isNewPoll = searchParams.get("new") === "true";
  const [pollUrl, setPollUrl] = useState("");
  const [rankedChoices, setRankedChoices] = useState<string[]>([]);
  const [optionsInitialized, setOptionsInitialized] = useState(false);
  const [yesNoChoice, setYesNoChoice] = useState<'yes' | 'no' | null>(null);
  const [isAbstaining, setIsAbstaining] = useState(false);
  const [nominationChoices, setNominationChoices] = useState<string[]>([]);
  const [existingNominations, setExistingNominations] = useState<string[]>([]);
  const [justCancelledAbstain, setJustCancelledAbstain] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [pollResults, setPollResults] = useState<PollResults | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [isClosingPoll, setIsClosingPoll] = useState(false);
  const [isReopeningPoll, setIsReopeningPoll] = useState(false);
  const [pollClosed, setPollClosed] = useState(poll.is_closed ?? false);
  // Don't automatically assume poll was reopened just because deadline passed
  // Only set manuallyReopened when explicitly reopened by creator action
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
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  // Generate unique session ID for logging
  const [sessionId] = useState(() => `vote-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  // Debug logging utility
  const logToServer = async (logType: string, level: string, message: string, data: any = {}) => {
    try {
      // Only access window if we're in the browser
      const url = typeof window !== 'undefined' ? window.location.href : '';

      await fetch('/api/debug-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          logType,
          level,
          message,
          data,
          url,
          timestamp: new Date().toISOString()
        })
      });
    } catch (error) {
      console.error('Failed to log to server:', error);
    }
  };
  const [followUpPolls, setFollowUpPolls] = useState<Poll[]>([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [voterName, setVoterName] = useState<string>("");
  const [voterListRefresh, setVoterListRefresh] = useState(0);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [nominations, setNominations] = useState<string[]>([]);
  const [loadingNominations, setLoadingNominations] = useState(false);

  // Participation poll voter conditions
  const [voterMinParticipants, setVoterMinParticipants] = useState<number | null>(1);
  const [voterMaxParticipants, setVoterMaxParticipants] = useState<number | null>(null);
  const [voterMaxEnabled, setVoterMaxEnabled] = useState(false);

  const isPollExpired = useMemo(() => {
    // Use server-safe check
    const now = currentTime || new Date();
    return poll.response_deadline && new Date(poll.response_deadline) <= now;
  }, [poll.response_deadline, currentTime]);

  // Track which voters are participating (for participation polls)
  const [participatingVoterIds, setParticipatingVoterIds] = useState<string[]>([]);

  // Check if this voter is actually participating (based on priority algorithm)
  const areVoterConditionsMet = useMemo(() => {
    if (poll.poll_type !== 'participation' || !userVoteData) {
      return null;
    }

    // Check if this voter's ID is in the list of participating voters
    return participatingVoterIds.includes(userVoteData.id);
  }, [poll.poll_type, userVoteData, participatingVoterIds]);
  
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
      return votedPolls[pollId] === true || votedPolls[pollId] === 'abstained';
    } catch (error) {
      console.error('Error checking vote status:', error);
      return false;
    }
  }, []);

  // Mark poll as voted (save to localStorage)
  const markPollAsVoted = useCallback((pollId: string, voteId?: string, abstained?: boolean) => {
    if (typeof window === 'undefined') return;
    try {
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      votedPolls[pollId] = abstained ? 'abstained' : true;
      localStorage.setItem('votedPolls', JSON.stringify(votedPolls));
      
      // Store the vote ID if provided
      if (voteId) {
        const voteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
        voteIds[pollId] = voteId;
        localStorage.setItem('pollVoteIds', JSON.stringify(voteIds));
      }
    } catch (error) {
      console.error('Error marking poll as voted:', error);
    }
  }, []);


  // Get stored vote ID for a poll
  const getStoredVoteId = useCallback((pollId: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      // Check both localStorage formats
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
      
      // Return from either format
      const voteIdFromVotedPolls = votedPolls[pollId]?.voteId;
      const voteIdFromPollVoteIds = pollVoteIds[pollId];
      
      const storedVoteId = voteIdFromVotedPolls || voteIdFromPollVoteIds || null;
      
      if (storedVoteId) {
      } else {
      }
      
      return storedVoteId;
    } catch (error) {
      console.error('Error getting stored vote ID:', error);
      return null;
    }
  }, []);

  // Fetch and aggregate all user vote data from localStorage vote IDs
  const fetchAggregatedVoteData = useCallback(async (pollId: string) => {
    if (typeof window === 'undefined') return null;

    try {
      // Get all stored vote IDs from different localStorage formats
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
      
      const voteIds = [];
      
      // Get vote ID from votedPolls format
      if (votedPolls[pollId]?.voteId) {
        voteIds.push(votedPolls[pollId].voteId);
      }
      
      // Get vote ID from pollVoteIds format
      if (pollVoteIds[pollId]) {
        voteIds.push(pollVoteIds[pollId]);
      }

      if (voteIds.length === 0) {
        // No localStorage vote ID found - this browser hasn't voted
        // CRITICAL: Don't use fallback that grabs other browsers' votes
        return null;
      }


      // Fetch all votes by these IDs
      const { data: userVotes, error } = await supabase
        .from('votes')
        .select('id, poll_id, vote_type, yes_no_choice, ranked_choices, nominations, is_abstain, created_at, min_participants, max_participants')
        .in('id', voteIds)
        .eq('poll_id', pollId);

      if (error || !userVotes || userVotes.length === 0) {
        return null;
      }

      // ONLY use votes from this browser's localStorage - no cross-browser contamination
      const allVotes = [...userVotes];

      if (poll.poll_type === 'nomination') {
        // For nominations, use only the LATEST vote (not aggregated)
        // When a user edits their vote, the vote record is updated in place
        // So we should only use the most recent version, not combine multiple votes
        const sortedVotes = allVotes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const latestVote = sortedVotes[0];
        
        const aggregatedVoteData = {
          ...latestVote,
          nominations: latestVote.nominations || [],
          aggregatedFrom: 1
        };

        return aggregatedVoteData;
      } else {
        // For non-nomination polls, just return the most recent vote
        const sortedVotes = allVotes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return sortedVotes[0];
      }
    } catch (error) {
      console.error('Error fetching aggregated vote data:', error);
      return null;
    }
  }, [poll.poll_type]);

  // Fetch vote data from database by vote ID (legacy function)
  const fetchVoteData = useCallback(async (voteId: string) => {

    try {
      const { data, error } = await supabase
        .from('votes')
        .select('id, poll_id, vote_type, yes_no_choice, ranked_choices, nominations, is_abstain, min_participants, max_participants')
        .eq('id', voteId)
        .single();

      if (error) {
        return null;
      }

      return data || null;
    } catch (error) {
      return null;
    }
  }, []);

  // Fetch and aggregate all user vote data for this poll (for newly created polls)
  const fetchLatestUserVote = useCallback(async (pollId: string) => {
    // CRITICAL: Return null to prevent cross-browser vote contamination
    // This function was aggregating votes from ALL browsers, causing vote isolation issues
    // Force use of localStorage-based vote tracking only
    return null;
  }, []);

  const fetchPollResults = useCallback(async () => {
    setLoadingResults(true);
    try {
      const results = await getPollResults(poll.id);
      setPollResults(results);

      // For participation polls, also fetch the list of participating voters
      if (poll.poll_type === 'participation') {
        const participatingIds = await getParticipatingVoters(poll.id);
        setParticipatingVoterIds(participatingIds);
      }
    } catch (error) {
      console.error('Error fetching poll results:', error);
    } finally {
      setLoadingResults(false);
    }
  }, [poll.id, poll.poll_type]);

  // Initialize currentTime on client side to avoid hydration issues
  useEffect(() => {
    setCurrentTime(new Date());

    // Load existing nominations for nomination polls
    if (poll.poll_type === 'nomination') {
      loadExistingNominations();
      // Also fetch results to show vote counts for nomination polls
      fetchPollResults();
    }
  }, [poll.poll_type, fetchPollResults]);

  // Load existing nominations from other votes
  const loadExistingNominations = async (excludeUserVote = false) => {
    try {
      // Force fresh data by adding a timestamp to bypass any caching
      const { data: votes, error } = await supabase
        .from('votes')
        .select('id, nominations, voter_name, created_at, is_abstain')
        .eq('poll_id', poll.id)
        .not('nominations', 'is', null)
        .eq('is_abstain', false)  // Only get non-abstaining votes
        .order('created_at', { ascending: false })
        .limit(100); // Add limit to ensure fresh query

      if (error) {
        console.error('Error loading existing nominations:', error);
        return;
      }

      // Debug logging to understand what votes we're getting
      console.log('[DEBUG] loadExistingNominations - fetched votes:', votes);
      console.log('[DEBUG] loadExistingNominations - excludeUserVote:', excludeUserVote, 'userVoteId:', userVoteId);

      const allNominations = new Set<string>();
      
      // Add starting options from poll creation
      if (poll.options && Array.isArray(poll.options)) {
        poll.options.forEach((option: string) => allNominations.add(option));
      }
      
      // For nomination polls, to handle edited votes properly, we use only the latest vote
      // If there are multiple voters in the future, this logic would need to be enhanced
      // to track the latest vote per unique voter
      
      let validVotes = votes || [];
      
      // Skip user's vote if we're in edit mode
      if (excludeUserVote && userVoteId) {
        validVotes = votes?.filter(vote => vote.id !== userVoteId) || [];
      }
      
      // Each vote record represents a unique voter's current nominations
      // When a voter edits their vote, their record is updated in place
      // So we should aggregate all current nominations from all voters
      validVotes.forEach(vote => {
        if (vote.nominations && Array.isArray(vote.nominations)) {
          console.log('[DEBUG] Adding nominations from vote:', vote.id, 'nominations:', vote.nominations);
          vote.nominations.forEach((nom: string) => allNominations.add(nom));
        }
      });

      const nominationsArray = Array.from(allNominations);
      console.log('[DEBUG] Final aggregated nominations:', nominationsArray);
      setExistingNominations(nominationsArray);
    } catch (error) {
      console.error('Error loading nominations:', error);
    }
  };

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

  // Clean up URL parameter when new poll is shown
  useEffect(() => {
    if (isNewPoll) {
      // Remove the ?new=true parameter from the URL without refreshing the page
      const newUrl = window.location.pathname + window.location.hash;
      router.replace(newUrl, { scroll: false });
    }
  }, [isNewPoll, router]);

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
    // Only load if this browser has actually voted - don't assume ownership of other users' votes
    const shouldLoadVoteData = hasVoted || hasVotedOnPoll(poll.id);
    
    if (shouldLoadVoteData) {
      setHasVoted(true);
      
      // Get the vote ID if available
      const voteId = getStoredVoteId(poll.id);
      setUserVoteId(voteId);
      
      // Fetch vote data from database if we have a vote ID
      // OR if this is a nomination poll (to handle creator votes and aggregation)
      if (voteId || poll.poll_type === 'nomination') {
        setIsLoadingVoteData(true);
        
        // For nomination polls, always use aggregated data to handle multiple votes
        // For other poll types, fetch by voteId or latest vote
        const fetchPromise = poll.poll_type === 'nomination'
          ? fetchAggregatedVoteData(poll.id)
          : (voteId ? fetchVoteData(voteId) : fetchLatestUserVote(poll.id));
          
        fetchPromise.then(voteData => {
          if (voteData) {
            setUserVoteData(voteData);

            // CRITICAL FIX: Set userVoteId from the fetched vote data
            // This ensures that vote editing updates the existing record instead of creating new ones
            if (voteData && 'id' in voteData && voteData.id) {
              setUserVoteId(voteData.id);
            }

            // For nomination polls, fetch results to show vote counts even when poll is open
            if (poll.poll_type === 'nomination' && !isPollClosed) {
              fetchPollResults();
            }
            
            // Set UI state based on vote data from database columns
            setIsAbstaining(voteData.is_abstain || false);
            if (voteData.is_abstain) {
              // Don't set choices for abstain votes
            } else if (poll.poll_type === 'yes_no' && voteData.yes_no_choice) {
              setYesNoChoice(voteData.yes_no_choice);
            } else if (poll.poll_type === 'participation' && voteData.yes_no_choice) {
              setYesNoChoice(voteData.yes_no_choice);
              // Load voter's participation conditions
              if (voteData.min_participants !== null && voteData.min_participants !== undefined) {
                setVoterMinParticipants(voteData.min_participants);
              }
              if (voteData.max_participants !== null && voteData.max_participants !== undefined) {
                setVoterMaxParticipants(voteData.max_participants);
                setVoterMaxEnabled(true);
              } else {
                setVoterMaxEnabled(false);
              }
            } else if (poll.poll_type === 'ranked_choice' && voteData.ranked_choices) {
              setRankedChoices(voteData.ranked_choices);
            } else if (poll.poll_type === 'nomination' && voteData.nominations) {
              setNominationChoices(voteData.nominations);
            }
          } else {
          }
        }).catch(err => {
        }).finally(() => {
          setIsLoadingVoteData(false);
        });
      }
    }
  }, [poll.id, poll.poll_type, hasVoted, hasVotedOnPoll, getStoredVoteId, fetchVoteData, fetchAggregatedVoteData, fetchLatestUserVote, isNewPoll]);

  // Separate effect to fetch results when poll closes or for participation polls
  useEffect(() => {
    // Fetch results if poll is closed (reactive to state changes)
    const isClosed = pollClosed || (poll.response_deadline && new Date(poll.response_deadline) <= new Date());

    // Also fetch results for participation polls when voted (to show condition status)
    const shouldFetchForParticipation = poll.poll_type === 'participation' && hasVoted && !isClosed;

    if (isClosed || shouldFetchForParticipation) {
      fetchPollResults();
    }
  }, [pollClosed, poll.response_deadline, poll.poll_type, hasVoted, fetchPollResults]);

  // Load saved user name
  useEffect(() => {
    const savedName = getUserName();
    if (savedName) {
      setVoterName(savedName);
    }
  }, []);

  // Fetch follow-up polls
  useEffect(() => {
    async function fetchFollowUpPolls() {
      try {
        setLoadingFollowUps(true);
        const { data, error } = await supabase
          .from('polls')
          .select('*')
          .eq('follow_up_to', poll.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching follow-up polls:', error);
          return;
        }

        setFollowUpPolls(data || []);
      } catch (error) {
        console.error('Unexpected error fetching follow-up polls:', error);
      } finally {
        setLoadingFollowUps(false);
      }
    }

    fetchFollowUpPolls();
  }, [poll.id]);

  // Fetch nominations for nomination polls to show "Vote on it" button
  const fetchNominations = useCallback(async () => {
    if (poll.poll_type !== 'nomination') {
      setNominations([]);
      return;
    }

    setLoadingNominations(true);
    try {
      const { data: votes, error } = await supabase
        .from('votes')
        .select('nominations')
        .eq('poll_id', poll.id)
        .eq('vote_type', 'nomination')
        .eq('is_abstain', false)
        .not('nominations', 'is', null);

      if (error) {
        console.error('Error fetching nominations:', error);
        setNominations([]);
        return;
      }

      // Collect all unique nominations
      const nominationSet = new Set<string>();
      votes?.forEach(vote => {
        if (vote.nominations && Array.isArray(vote.nominations)) {
          vote.nominations.forEach((nom: any) => {
            const nomString = typeof nom === 'string' ? nom : nom?.option || nom?.toString() || '';
            if (nomString) {
              nominationSet.add(nomString);
            }
          });
        }
      });

      setNominations(Array.from(nominationSet));
    } catch (error) {
      console.error('Error loading nominations:', error);
      setNominations([]);
    } finally {
      setLoadingNominations(false);
    }
  }, [poll.poll_type, poll.id]);

  useEffect(() => {
    fetchNominations();
  }, [fetchNominations]);

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
          
          // Check if the poll was manually closed
          if (payload.new && payload.new.is_closed && !pollClosed) {
            setPollClosed(true);
            setManuallyReopened(false); // Reset flag when closed by someone else
            fetchPollResults();
          } else if (payload.new && payload.new.is_closed && pollClosed) {
          } else if (payload.new && !payload.new.is_closed) {
          }
          
          // Also handle other potential updates like title changes
          if (payload.new && payload.old) {
            const changedFields = Object.keys(payload.new).filter(key => 
              payload.new[key] !== payload.old[key]
            );
            
            // Log specific field changes
            changedFields.forEach(field => {
            });
          }
        }
      )
      .subscribe((status: any) => {
        
        // Status is either a string or an object with status property
        const statusValue = typeof status === 'string' ? status : status?.status;
        
        if (statusValue === 'SUBSCRIBED') {
          realtimeWorking = true;
          
          // Clear polling if real-time is working
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        } else if (statusValue === 'CHANNEL_ERROR') {
          
          // Start polling as fallback (every 2 seconds)
          if (!pollInterval && !pollClosed) {
            pollInterval = setInterval(pollForChanges, 2000);
            // Check immediately as well
            pollForChanges();
          }
        } else if (statusValue === 'TIMED_OUT') {
        } else if (statusValue === 'CLOSED') {
        }
      });

    return () => {
      subscription.unsubscribe();
      
      // Clean up polling interval
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [poll.id, pollClosed, fetchPollResults]);

  const handleRankingChange = useCallback((newRankedChoices: string[]) => {
    setRankedChoices(newRankedChoices);
    // Clear the flag when user interacts with rankings after cancelling abstain
    if (justCancelledAbstain) {
      setJustCancelledAbstain(false);
    }
  }, [justCancelledAbstain]);

  // Memoize parsed options to prevent re-parsing on every render
  const pollOptions = useMemo(() => {
    if (!poll.options) return [];
    return typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
  }, [poll.options]);

  const handleYesNoVote = (choice: 'yes' | 'no') => {
    setYesNoChoice(choice);
    setIsAbstaining(false); // Deselect abstain when making a yes/no choice
  };

  const handleAbstain = () => {
    const wasAbstaining = isAbstaining;
    setIsAbstaining(!isAbstaining);
    
    if (!wasAbstaining) {
      // Starting to abstain
      setJustCancelledAbstain(false);
      // Clear previous choices when abstaining
      if (poll.poll_type === 'ranked_choice') {
        setRankedChoices([]);
      } else if (poll.poll_type === 'yes_no') {
        setYesNoChoice(null); // Clear yes/no choice to prevent both appearing selected
      } else if (poll.poll_type === 'nomination') {
        setNominationChoices([]);
      }
    } else {
      // Cancelling abstain
      if (poll.poll_type === 'ranked_choice') {
        setJustCancelledAbstain(true);
      }
    }
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

  const handleVoteClick = async () => {
    await logToServer('nomination-vote', 'info', 'handleVoteClick started', {
      isSubmitting,
      hasVoted,
      isEditingVote,
      isPollClosed,
      pollType: poll.poll_type,
      isAbstaining,
      nominationChoices: nominationChoices.length,
      nominationChoicesData: nominationChoices
    });

    if (isSubmitting || (hasVoted && !isEditingVote) || isPollClosed) {
      await logToServer('nomination-vote', 'warn', 'handleVoteClick early return', {
        reason: isSubmitting ? 'isSubmitting' : (hasVoted && !isEditingVote) ? 'hasVoted and not editing' : 'isPollClosed'
      });
      return;
    }

    // Validate vote choice first
    if ((poll.poll_type === 'yes_no' || poll.poll_type === 'participation') && !yesNoChoice && !isAbstaining) {
      await logToServer('nomination-vote', 'error', 'Yes/No validation failed', { yesNoChoice, isAbstaining });
      setVoteError("Please select Yes, No, or Abstain");
      return;
    }

    if (poll.poll_type === 'ranked_choice' && !isAbstaining) {
      const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
      if (filteredRankedChoices.length === 0) {
        await logToServer('nomination-vote', 'error', 'Ranked choice validation failed', { rankedChoices, isAbstaining });
        setVoteError("Please rank at least one option or select Abstain");
        return;
      }
    }

    if (poll.poll_type === 'nomination') {
      const filteredNominations = nominationChoices.filter(choice => choice && choice.trim().length > 0);
      await logToServer('nomination-vote', 'info', 'Nomination validation check', {
        originalNominations: nominationChoices,
        filteredNominations,
        willAbstain: filteredNominations.length === 0
      });
      // No validation error - empty nominations will be treated as abstain
    }

    await logToServer('nomination-vote', 'info', 'handleVoteClick validation passed, showing confirmation modal', {
      pollType: poll.poll_type,
      isAbstaining,
      choicesReady: poll.poll_type === 'nomination' ? nominationChoices.filter(choice => choice && choice.trim().length > 0).length : 'n/a'
    });

    setVoteError(null);
    setShowVoteConfirmModal(true);
  };

  const handleVoteOnNominationsClick = () => {
    // Store data for the new preference poll
    const voteData = {
      title: poll.title,
      options: nominations,
      followUpTo: poll.id
    };
    localStorage.setItem(`vote-from-nomination-${poll.id}`, JSON.stringify(voteData));

    // Navigate to create-poll page with vote parameter
    router.push(`/create-poll?voteFromNomination=${poll.id}`);
  };

  const submitVote = async () => {
    await logToServer('nomination-vote', 'info', 'submitVote started', {
      isSubmitting,
      hasVoted,
      isEditingVote,
      isPollClosed,
      pollType: poll.poll_type,
      userVoteId
    });

    setShowVoteConfirmModal(false);

    if (isSubmitting || (hasVoted && !isEditingVote) || isPollClosed) {
      await logToServer('nomination-vote', 'warn', 'submitVote early return', {
        reason: isSubmitting ? 'isSubmitting' : (hasVoted && !isEditingVote) ? 'hasVoted and not editing' : 'isPollClosed'
      });
      return;
    }

    setIsSubmitting(true);
    setVoteError(null);

    let voteData: any = {}; // Initialize voteData outside try block for error logging

    await logToServer('nomination-vote', 'info', 'submitVote setup complete', {
      pollId: poll.id,
      pollType: poll.poll_type,
      isAbstaining,
      voterName: voterName.trim()
    });

    try {
      if (poll.poll_type === 'yes_no') {
        if (!yesNoChoice && !isAbstaining) {
          setVoteError("Please select Yes, No, or Abstain");
          setIsSubmitting(false);
          return;
        }
        voteData = {
          poll_id: poll.id,
          vote_type: 'yes_no' as const,
          yes_no_choice: isAbstaining ? null : yesNoChoice,
          is_abstain: isAbstaining,
          voter_name: voterName.trim() || null
        };
      } else if (poll.poll_type === 'participation') {
        if (!yesNoChoice && !isAbstaining) {
          setVoteError("Please select Yes, No, or Abstain");
          setIsSubmitting(false);
          return;
        }
        voteData = {
          poll_id: poll.id,
          vote_type: 'participation' as const,
          yes_no_choice: isAbstaining ? null : yesNoChoice,
          is_abstain: isAbstaining,
          voter_name: voterName.trim() || null,
          min_participants: voterMinParticipants,
          max_participants: voterMaxEnabled ? voterMaxParticipants : null
        };
      } else if (poll.poll_type === 'ranked_choice') {
        // Filter and validate ranked choices (No Preference items already filtered by RankableOptions)
        const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
        
        if (filteredRankedChoices.length === 0 && !isAbstaining) {
          setVoteError("Please rank at least one option or select Abstain");
          setIsSubmitting(false);
          return;
        }
        
        // Additional validation: ensure choices are valid poll options
        const pollOptions = typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
        const invalidChoices = filteredRankedChoices.filter(choice => !pollOptions.includes(choice));
        
        if (invalidChoices.length > 0) {
          console.error('Invalid choices detected:', invalidChoices);
          setVoteError("Invalid options detected. Please refresh and try again.");
          setIsSubmitting(false);
          return;
        }
        
        voteData = {
          poll_id: poll.id,
          vote_type: 'ranked_choice' as const,
          ranked_choices: isAbstaining ? null : filteredRankedChoices,
          is_abstain: isAbstaining,
          voter_name: voterName.trim() || null
        };
      } else if (poll.poll_type === 'nomination') {
        const filteredNominations = nominationChoices.filter(choice => choice && choice.trim().length > 0);

        await logToServer('nomination-vote', 'info', 'Processing nomination vote data', {
          originalNominations: nominationChoices,
          filteredNominations,
          isAbstaining
        });

        // Empty nominations will be treated as abstain
        const willAbstain = filteredNominations.length === 0;
        await logToServer('nomination-vote', 'info', 'Nomination vote processing', {
          nominationChoices,
          filteredNominations,
          willAbstain,
          isAbstaining
        });

        // Send null for nominations when abstaining, array with nominations when voting
        // Abstain if explicitly set OR if no nominations provided
        const finalAbstain = isAbstaining || willAbstain;
        voteData = {
          poll_id: poll.id,
          vote_type: 'nomination' as const,
          nominations: finalAbstain ? null : filteredNominations,
          is_abstain: finalAbstain,
          voter_name: voterName.trim() || null
        };

        await logToServer('nomination-vote', 'info', 'Nomination voteData created', voteData);
      }

      let voteId;
      let error;


      if (isEditingVote && userVoteId) {

        // Create update data with only the vote choice (don't update vote_type or poll_id)
        // Use the same filtered data that was prepared in voteData to ensure consistency
        const updateData = poll.poll_type === 'yes_no'
          ? { yes_no_choice: isAbstaining ? null : yesNoChoice, is_abstain: isAbstaining, voter_name: voterName.trim() || null }
          : poll.poll_type === 'participation'
          ? { yes_no_choice: isAbstaining ? null : yesNoChoice, is_abstain: isAbstaining, voter_name: voterName.trim() || null }
          : poll.poll_type === 'ranked_choice'
          ? { ranked_choices: isAbstaining ? null : rankedChoices, is_abstain: isAbstaining, voter_name: voterName.trim() || null }
          : { nominations: voteData.nominations, is_abstain: voteData.is_abstain, voter_name: voterName.trim() || null };
        
        
        
        // Update existing vote
        const { error: updateError, data: returnedData } = await supabase
          .from('votes')
          .update(updateData)
          .eq('id', userVoteId)
          .select(); // Add select to see what was updated


        error = updateError;
        voteId = userVoteId;
        
        // Log the update response for debugging
        await logToServer('nomination-vote', 'info', 'Vote update response', {
          updateError,
          returnedDataExists: !!returnedData,
          returnedDataLength: returnedData?.length,
          returnedData: returnedData
        });

        // Update local userVoteData with the actual returned data from database
        if (!updateError && returnedData && returnedData.length > 0) {
          // Use the actual data returned from the database, not the local voteData
          setUserVoteData(returnedData[0]);
        } else if (updateError) {
          // Only show error if there was an actual database error
          setVoteError("Failed to update vote. Please try again.");
        } else {
          // Update succeeded but no data returned - this is actually okay for updates
          // Manually construct the updated vote data and set it in state
          await logToServer('nomination-vote', 'info', 'Update succeeded but no returned data, manually updating state', {
            voteData,
            userVoteId
          });

          // Construct the updated vote object based on what we sent
          const updatedVote = {
            id: userVoteId,
            poll_id: poll.id,
            vote_type: poll.poll_type,
            ...updateData // This contains the updated fields
          };

          setUserVoteData(updatedVote);

          // CRITICAL FIX: When RLS blocks UPDATE response, immediately refresh results
          // This ensures deleted nominations (abstained votes) are removed from display
          if (poll.poll_type === 'nomination') {
            await fetchPollResults();
          }
        }
      } else {
        await logToServer('nomination-vote', 'info', 'Attempting to insert new vote', { voteData });

        // Insert new vote
        const { data: insertedVote, error: insertError } = await supabase
          .from('votes')
          .insert([voteData])
          .select('id')
          .single();

        error = insertError;
        voteId = insertedVote?.id;

        await logToServer('nomination-vote', 'info', 'Database insert result', {
          insertedVote,
          insertError,
          voteId,
          hasError: !!insertError
        });

        if (insertError) {
          const detailedError = {
            error: insertError,
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint,
            code: insertError.code
          };
          console.error('Detailed insert error:', detailedError);
          await logToServer('nomination-vote', 'error', 'Database insert error', detailedError);
        }

        if (!voteId && !insertError) {
          await logToServer('nomination-vote', 'error', 'No vote ID returned but no error', { insertedVote, insertError });
          setVoteError("Failed to submit vote. Please try again.");
          return;
        } else {
          await logToServer('nomination-vote', 'info', 'Vote insert successful', { voteId });
        }
      }

      if (error) {
        await logToServer('nomination-vote', 'error', 'Vote submission error', {
          error,
          voteData,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        console.error('Error submitting vote:', error);
        console.error('Vote data that failed:', voteData);
        setVoteError("Failed to submit vote. Please try again.");
        return;
      }

      await logToServer('nomination-vote', 'info', 'Vote submission successful', {
        voteId,
        isEditingVote,
        pollType: poll.poll_type
      });

      setHasVoted(true);
      setUserVoteId(voteId);
      
      // Trigger voter list refresh immediately
      setVoterListRefresh(prev => prev + 1);
      
      // Refresh nomination list for nomination polls with a small delay to ensure DB update is complete
      if (poll.poll_type === 'nomination') {
        // Add a small delay to ensure the database update is fully committed
        setTimeout(async () => {
          // Refresh nominations after DB update is complete
          await loadExistingNominations(false);
          // Also fetch poll results to show vote counts
          await fetchPollResults();
          // Fetch nominations to update "Vote on it" button visibility
          await fetchNominations();
        }, 500);
      }
      
      // Save vote to localStorage so user can't vote again (only for new votes)
      if (!isEditingVote) {
        markPollAsVoted(poll.id, voteId, isAbstaining);
        // Update hasPollData state
        setHasPollDataState(true);
      }
      
      // Save the user's name if they provided one
      if (voterName.trim()) {
        saveUserName(voterName.trim());
      }
      
      setIsEditingVote(false);
      
      // Refetch vote data for nomination polls to ensure UI shows latest data
      if (poll.poll_type === 'nomination' && isEditingVote) {
        const updatedVoteData = await fetchAggregatedVoteData(poll.id);
        if (updatedVoteData) {
          setUserVoteData(updatedVoteData);
        }

        // CRITICAL FIX: Always refresh results after editing nominations
        // This ensures that deleted nominations (abstained votes) are removed from display
        await fetchPollResults();
        // Fetch nominations to update "Vote on it" button visibility
        await fetchNominations();
      }

      // If the poll is closed, fetch results immediately after voting
      if (isPollClosed && !isEditingVote) {
        await fetchPollResults();
      }
    } catch (error) {
      await logToServer('nomination-vote', 'error', 'Unexpected error in submitVote', {
        error,
        stack: error instanceof Error ? error.stack : 'No stack trace',
        message: error instanceof Error ? error.message : 'Unknown error',
        voteData
      });
      console.error('Unexpected error:', error);
      setVoteError("An unexpected error occurred. Please try again.");
    } finally {
      await logToServer('nomination-vote', 'info', 'submitVote finally block', { isSubmitting: false });
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="poll-content">
        
        {/* Show creation info */}
        <div className="text-center text-sm text-gray-600 dark:text-gray-400 mb-4">
          {poll.creator_name ? (
            <>Created by <span className="text-blue-600 dark:text-blue-400">{poll.creator_name}</span> {createdDate}</>
          ) : (
            <>Created {createdDate}</>
          )}
        </div>

        {/* Poll status card - show expired, expiring, or manually closed */}
        {(() => {
          const deadline = poll.response_deadline ? new Date(poll.response_deadline) : null;
          const now = currentTime || new Date();
          const isExpired = deadline && deadline <= now;
          
          // Case 1: Poll was automatically closed due to max capacity
          if (pollClosed && poll.close_reason === 'max_capacity') {
            return (
              <div className="mb-3 text-center">
                <span className="text-sm font-bold text-red-700 dark:text-red-300">
                  Poll auto-closed. Capacity reached.
                </span>
              </div>
            );
          }

          // Case 2: Poll was manually closed (is_closed is true, but might not have reached deadline)
          if (pollClosed && deadline && deadline > now) {
            // Manually closed before deadline
            const closedDate = new Date(); // We'd need to track when it was closed, for now use current
            return (
              <div className="mb-3 text-center">
                <span className="text-sm font-bold text-red-700 dark:text-red-300">
                  Closed manually on {closedDate.toLocaleString("en-US", {
                    month: "numeric",
                    day: "numeric",
                    year: "2-digit",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true
                  })}
                </span>
              </div>
            );
          }
          
          // Case 3: Poll expired and is closed
          if (isPollClosed && isExpired) {
            return (
              <div className="mb-3 text-center">
                <span className="text-sm font-bold text-red-700 dark:text-red-300">
                  Expired on {deadline.toLocaleString("en-US", {
                    month: "numeric",
                    day: "numeric",
                    year: "2-digit",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true
                  })}
                </span>
              </div>
            );
          }

          // Case 4: Poll is still open and not expired - show countdown
          if (!isPollClosed && !isExpired && deadline) {
            return <Countdown deadline={poll.response_deadline || null} />;
          }

          // Case 5: Timer expired but poll is still open - don't show a card
          if (!isPollClosed && isExpired) {
            return null;
          }
          
          // No deadline set
          return null;
        })()}
        
        {/* For closed polls, show results first */}
        {isPollClosed && (
          <div className="pt-2.5">
            {loadingResults ? (
              <div className="flex justify-center items-center py-3">
                <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            ) : pollResults ? (
              <PollResultsDisplay results={pollResults} isPollClosed={isPollClosed} userVoteData={userVoteData} />
            ) : (
              <div className="text-center py-1.5">
                <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
              </div>
            )}
          </div>
        )}

        {/* Follow-up button for closed polls - always shown after results */}
        {isPollClosed && (
          <div className="my-4 flex justify-between items-center">
              <GradientBorderButton
                onClick={() => setShowFollowUpModal(true)}
                gradient="blue-purple"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                <span className="font-semibold">Follow up</span>
              </GradientBorderButton>
            {poll.poll_type === 'nomination' && nominations.length >= 2 && (
              <GradientBorderButton
                onClick={handleVoteOnNominationsClick}
                disabled={loadingNominations}
                gradient="red-orange"
              >
                {loadingNominations ? (
                  <>
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="font-semibold">Loading...</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Vote on it</span>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                    </svg>
                  </>
                )}
              </GradientBorderButton>
            )}
          </div>
        )}

        {/* Show follow-up/fork header after Follow up button for closed polls */}
        {isPollClosed && (
          <div className="mt-4">
            {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
            {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
          </div>
        )}

        {/* Voter list for closed polls - always shown after Follow-up button */}
        {isPollClosed && (
          <div className="mt-8">
            <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
          </div>
        )}

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
                      {/* Results are now shown at the top, only show abstained bubble and button here */}
                      {userVoteData?.is_abstain && (
                        <div className="mt-4 flex justify-center">
                          <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                              You Abstained
                            </span>
                          </div>
                        </div>
                      )}

                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
                </div>
              ) : hasVoted && !isEditingVote ? (
                <div className="text-center py-3">
                  <div className="text-left">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Your vote:</h4>
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
                        userVoteData?.is_abstain || isAbstaining
                          ? 'bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700'
                          : userVoteData?.yes_no_choice === 'yes'
                            ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700'
                            : 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700'
                      }`}>
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mr-3 ${
                          userVoteData?.is_abstain || isAbstaining
                            ? 'bg-yellow-600 text-white'
                            : userVoteData?.yes_no_choice === 'yes'
                              ? 'bg-green-600 text-white'
                              : 'bg-red-600 text-white'
                        }`}>
                          {userVoteData?.is_abstain || isAbstaining ? '' : userVoteData?.yes_no_choice === 'yes' ? '✓' : '✗'}
                        </span>
                        <span className={`font-medium ${
                          userVoteData?.is_abstain || isAbstaining
                            ? 'text-yellow-800 dark:text-yellow-200'
                            : userVoteData?.yes_no_choice === 'yes'
                              ? 'text-green-800 dark:text-green-200'
                              : 'text-red-800 dark:text-red-200'
                        }`}>
                          {userVoteData?.is_abstain || isAbstaining ? 'Abstained' : userVoteData?.yes_no_choice === 'yes' ? 'Yes' : 'No'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Follow Up Button and Edit Button row - shown when poll is open and user has voted */}
                  {!isPollClosed && !isLoadingVoteData && (
                    <div className="my-4 flex justify-between items-center">
                      <GradientBorderButton
                          onClick={() => setShowFollowUpModal(true)}
                          gradient="blue-purple"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          <span className="font-semibold">Follow up</span>
                        </GradientBorderButton>
                      <div className="flex items-center gap-2">
                        {false && nominations.length >= 2 && (
                          <GradientBorderButton
                            onClick={handleVoteOnNominationsClick}
                            disabled={loadingNominations}
                            gradient="red-orange"
                          >
                          {loadingNominations ? (
                            <>
                              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span className="font-semibold">Loading...</span>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">Vote on it</span>
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                              </svg>
                            </>
                          )}
                          </GradientBorderButton>
                        )}
                        <button
                          onClick={() => setIsEditingVote(true)}
                          className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Show follow-up/fork header after Follow up button when voted */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-4">
                      {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                      {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                    </div>
                  )}

                  {/* Voter list for open yes/no polls - shown after Follow-up button when voted */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-8">
                      <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
                    <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
                      Select your preference
                    </h4>
                    
                    <div className="mb-4">
                      <YesNoAbstainButtons
                        yesNoChoice={yesNoChoice}
                        isAbstaining={isAbstaining}
                        onYesClick={() => handleYesNoVote('yes')}
                        onNoClick={() => handleYesNoVote('no')}
                        onAbstainClick={handleAbstain}
                      />
                    </div>
                    
                    {voteError && (
                      <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                        {voteError}
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <label htmlFor="voterName" className="block text-sm font-medium mb-2">
                      Your Name (optional)
                    </label>
                    <input
                      type="text"
                      id="voterName"
                      value={voterName}
                      onChange={(e) => setVoterName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                      placeholder="Enter your name..."
                      maxLength={50}
                    />
                  </div>
                  
                  <button
                    onClick={handleVoteClick}
                    disabled={isSubmitting || (!yesNoChoice && !isAbstaining)}
                    className="w-full py-3 px-4 rounded-lg bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] active:bg-[#2a2a2a] dark:active:bg-[#e0e0e0] font-medium text-base transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>

                  {/* Show follow-up/fork header after submit button */}
                  <div className="mt-4">
                    {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                    {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                  </div>
                </>
              )}
            </div>
          ) : poll.poll_type === 'participation' ? (
            <div>
              {isPollClosed ? (
                <div className="py-6">
                  {loadingResults ? (
                    <div className="flex justify-center items-center py-8">
                      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : pollResults ? (
                    <>
                      {userVoteData?.is_abstain && (
                        <div className="mt-4 flex justify-center">
                          <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                              You Abstained
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
                </div>
              ) : hasVoted && !isEditingVote ? (
                <div className="text-center py-1.5">
                  <div className="text-left">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Your response:</h4>
                    </div>
                    {isLoadingVoteData ? (
                      <div className="flex items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                        <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center mr-3">
                          <svg className="animate-spin h-4 w-4 text-gray-600 dark:text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        </div>
                        <span className="font-medium text-gray-600 dark:text-gray-400">Loading your response...</span>
                      </div>
                    ) : (
                      <>
                        <div className={`flex items-center p-3 rounded-lg ${
                          userVoteData?.is_abstain || isAbstaining
                            ? 'bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700'
                            : userVoteData?.yes_no_choice === 'yes'
                              ? 'bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700'
                              : 'bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700'
                        }`}>
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mr-3 ${
                            userVoteData?.is_abstain || isAbstaining
                              ? 'bg-yellow-600 text-white'
                              : userVoteData?.yes_no_choice === 'yes'
                                ? 'bg-green-600 text-white'
                                : 'bg-red-600 text-white'
                          }`}>
                            {userVoteData?.is_abstain || isAbstaining ? '' : userVoteData?.yes_no_choice === 'yes' ? '✓' : '✗'}
                          </span>
                          <span className={`font-medium ${
                            userVoteData?.is_abstain || isAbstaining
                              ? 'text-yellow-800 dark:text-yellow-200'
                              : userVoteData?.yes_no_choice === 'yes'
                                ? 'text-green-800 dark:text-green-200'
                                : 'text-red-800 dark:text-red-200'
                          }`}>
                            {userVoteData?.is_abstain || isAbstaining ? 'Abstained' : userVoteData?.yes_no_choice === 'yes' ? "I'm in!" : "Can't make it"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {!isPollClosed && !isLoadingVoteData && (
                    <div className="my-4 flex justify-between items-center">
                      <GradientBorderButton
                          onClick={() => setShowFollowUpModal(true)}
                          gradient="blue-purple"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          <span className="font-semibold">Follow up</span>
                        </GradientBorderButton>
                      <button
                        onClick={() => setIsEditingVote(true)}
                        className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  )}

                  {/* Show follow-up/fork header after Follow up button when voted */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-4">
                      {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                      {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                    </div>
                  )}

                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-8">
                      <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-4 text-center">
                    <h3 className="text-lg font-semibold mb-4">Are you in?</h3>
                  </div>

                  <div className="mb-4">
                    <h4 className="text-base font-medium mb-3">Your conditions</h4>
                    <ParticipationConditions
                      minValue={voterMinParticipants}
                      maxValue={voterMaxParticipants}
                      maxEnabled={voterMaxEnabled}
                      onMinChange={setVoterMinParticipants}
                      onMaxChange={setVoterMaxParticipants}
                      onMaxEnabledChange={setVoterMaxEnabled}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="mb-4 text-center">
                    <YesNoAbstainButtons
                      yesNoChoice={yesNoChoice}
                      onYesClick={() => handleYesNoVote('yes')}
                      onNoClick={() => handleYesNoVote('no')}
                      disabled={isSubmitting}
                      showAbstain={false}
                    />
                  </div>

                  {voteError && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                      <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
                    </div>
                  )}

                  <div className="mb-4">
                    <label htmlFor="voterName" className="block text-sm font-medium mb-2">
                      Your Name <span className="text-gray-500 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      id="voterName"
                      value={voterName}
                      onChange={(e) => setVoterName(e.target.value)}
                      disabled={isSubmitting}
                      maxLength={30}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="Enter your name..."
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleVoteClick}
                    disabled={isSubmitting || (!yesNoChoice && !isAbstaining)}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>

                  {/* Show follow-up/fork header after submit button */}
                  <div className="mt-4">
                    {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                    {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                  </div>
                </>
              )}
            </div>
          ) : poll.poll_type === 'nomination' ? (
            <NominationVotingInterface
              poll={poll}
              existingNominations={existingNominations}
              nominationChoices={nominationChoices}
              setNominationChoices={setNominationChoices}
              isAbstaining={isAbstaining}
              handleAbstain={handleAbstain}
              voteError={voteError}
              voterName={voterName}
              setVoterName={setVoterName}
              handleVoteClick={handleVoteClick}
              isSubmitting={isSubmitting}
              isPollClosed={!!isPollClosed}
              isCreator={isCreator}
              handleCloseClick={handleCloseClick}
              isClosingPoll={isClosingPoll}
              hasVoted={hasVoted}
              isEditingVote={isEditingVote}
              setIsEditingVote={setIsEditingVote}
              userVoteData={userVoteData}
              isLoadingVoteData={isLoadingVoteData}
              pollResults={pollResults}
              loadingResults={loadingResults}
              loadExistingNominations={loadExistingNominations}
              onFollowUpClick={() => setShowFollowUpModal(true)}
              nominations={nominations}
              loadingNominations={loadingNominations}
              onVoteOnNominationsClick={handleVoteOnNominationsClick}
            />
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
                      {/* Results are now shown at the top, only show abstained bubble and button here */}
                      {userVoteData?.is_abstain && (
                        <div className="mt-4 flex justify-center">
                          <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                              You Abstained
                            </span>
                          </div>
                        </div>
                      )}

                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
                    </div>
                  )}
                </div>
              ) : hasVoted && !isEditingVote ? (
                <div className="text-center py-3">
                  <div className="text-left">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Your ranking:</h4>
                    </div>
                    {isLoadingVoteData ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((num) => (
                          <div key={num} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded animate-pulse">
                            <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium mr-3">
                              <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
                          </div>
                        ))}
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Loading your ranking...</div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {userVoteData?.is_abstain || isAbstaining ? (
                          <div className="flex items-center p-3 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                            <span className="w-8 h-8 bg-yellow-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">
                            </span>
                            <span className="font-medium text-yellow-800 dark:text-yellow-200">Abstained</span>
                          </div>
                        ) : (
                          rankedChoices.map((choice, index) => (
                            <div key={index} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
                              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
                                {index + 1}
                              </span>
                              <span>{choice}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Follow Up Button and Edit Button row - shown when poll is open and user has voted */}
                  {!isPollClosed && !isLoadingVoteData && (
                    <div className="my-4 flex justify-between items-center">
                      <GradientBorderButton
                          onClick={() => setShowFollowUpModal(true)}
                          gradient="blue-purple"
                        >
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          <span className="font-semibold">Follow up</span>
                        </GradientBorderButton>
                      <div className="flex items-center gap-2">
                        {false && nominations.length >= 2 && (
                        <GradientBorderButton
                          onClick={handleVoteOnNominationsClick}
                          disabled={loadingNominations}
                          gradient="red-orange"
                        >
                          {loadingNominations ? (
                            <>
                              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              <span className="font-semibold">Loading...</span>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">Vote on it</span>
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                              </svg>
                            </>
                          )}
                        </GradientBorderButton>
                        )}
                        <button
                        onClick={() => setIsEditingVote(true)}
                        className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors"
                      >
                        Edit
                      </button>
                      </div>
                    </div>
                  )}

                  {/* Show follow-up/fork header after Follow up button when voted */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-4">
                      {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                      {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                    </div>
                  )}

                  {/* Voter list for open ranked choice polls - shown after Follow-up button when voted */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-8">
                      <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg mb-2">
                    <h4 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                      Reorder from most to least preferred
                    </h4>
                    
                    {pollOptions.length > 0 && (
                      <RankableOptions 
                        key={isEditingVote ? 'editing' : 'new'}
                        options={pollOptions} 
                        onRankingChange={handleRankingChange}
                        disabled={isSubmitting || isAbstaining}
                        storageKey={pollId ? `poll-ranking-${pollId}` : undefined}
                        initialRanking={isEditingVote && userVoteData?.ranked_choices ? userVoteData.ranked_choices : undefined}
                      />
                    )}
                    
                    {/* Abstain button for ranked choice */}
                    <div className="mt-4">
                      <button 
                        onClick={() => handleAbstain()}
                        className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                          isAbstaining
                            ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 border-2 border-yellow-400 dark:border-yellow-600' 
                            : 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 text-yellow-800 dark:text-yellow-200 border-2 border-transparent'
                        }`}
                      >
                        {isAbstaining ? 'Abstaining (click to cancel)' : 'Abstain from this vote'}
                      </button>
                    </div>
                    
                    {voteError && (
                      <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                        {voteError}
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <label htmlFor="voterNameRanked" className="block text-sm font-medium mb-2">
                      Your Name (optional)
                    </label>
                    <input
                      type="text"
                      id="voterNameRanked"
                      value={voterName}
                      onChange={(e) => setVoterName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                      placeholder="Enter your name..."
                      maxLength={50}
                    />
                  </div>
                  
                  <button
                    onClick={handleVoteClick}
                    disabled={isSubmitting || (!isAbstaining && !justCancelledAbstain && rankedChoices.filter(choice => choice && choice.trim().length > 0).length === 0)}
                    className="w-full mt-4 py-3 px-4 rounded-lg bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] active:bg-[#2a2a2a] dark:active:bg-[#e0e0e0] font-medium text-base transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                  </button>

                  {/* Show follow-up/fork header after submit button */}
                  <div className="mt-4">
                    {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                    {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                  </div>
                </>
              )}
            </div>
          )}



          {/* Follow ups to this poll section */}
          {followUpPolls.length > 0 && (
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold mb-4 text-center text-gray-900 dark:text-white">Follow ups to this poll</h2>
              <PollList polls={followUpPolls} showSections={false} />
            </div>
          )}


          {/* Poll Management Buttons - Close, Reopen, and Forget Poll */}
          {(hasPollDataState || (isPollClosed && process.env.NODE_ENV === 'development') || (!isPollClosed && (isCreator || process.env.NODE_ENV === 'development'))) && (
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
              <PollManagementButtons
                showCloseButton={!isPollClosed && (isCreator || process.env.NODE_ENV === 'development')}
                showReopenButton={!!(isPollClosed && process.env.NODE_ENV === 'development')}
                showForgetButton={hasPollDataState}
                onCloseClick={handleCloseClick}
                onReopenClick={handleReopenClick}
                onForgetClick={() => setShowForgetConfirmModal(true)}
                isClosingPoll={isClosingPoll}
                isReopeningPoll={isReopeningPoll}
              />
            </div>
          )}
      </div>

      <ConfirmationModal
        isOpen={showVoteConfirmModal}
        onConfirm={submitVote}
        onCancel={() => setShowVoteConfirmModal(false)}
        title="Submit Vote"
        message={poll.poll_type === 'yes_no' 
          ? (isAbstaining 
              ? `Are you sure you want to abstain from this vote?`
              : `Are you sure you want to vote "${yesNoChoice?.toUpperCase()}"?`)
          : poll.poll_type === 'nomination'
          ? (isAbstaining
              ? `Are you sure you want to abstain from this vote?`
              : isEditingVote
                ? `Are you sure you want to update your suggestions?`
                : `Are you sure you want to submit your suggestions?`)
          : (isAbstaining
              ? `Are you sure you want to abstain from this vote?`
              : `Are you sure you want to submit your ranking?`)}
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

      {/* Follow-up Modal */}
      <FollowUpModal
        isOpen={showFollowUpModal}
        poll={poll}
        onClose={() => setShowFollowUpModal(false)}
      />

    </>
  );
}
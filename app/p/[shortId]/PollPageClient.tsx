"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAppPrefetch } from "@/lib/prefetch";
import Countdown from "@/components/Countdown";
import CompactNameField from "@/components/CompactNameField";
import PollResultsDisplay from "@/components/PollResults";
import SuggestionVotingInterface from "@/components/SuggestionVotingInterface";
import RankingSection from "@/components/RankingSection";
import ConfirmationModal from "@/components/ConfirmationModal";
import FloatingCopyLinkButton from "@/components/FloatingCopyLinkButton";
import FollowUpHeader from "@/components/FollowUpHeader";
import ForkHeader from "@/components/ForkHeader";
import PollList from "@/components/PollList";
import ProfileButton from "@/components/ProfileButton";

import VoterList from "@/components/VoterList";
import PollManagementButtons from "@/components/PollManagementButtons";

import OptionLabel from "@/components/OptionLabel";
import YesNoAbstainButtons from "@/components/YesNoAbstainButtons";
import AbstainButton from "@/components/AbstainButton";
import { Poll, PollResults, OptionsMetadata, DayTimeWindow } from "@/lib/types";
import { apiGetPollResults, apiGetVotes, apiSubmitVote, apiEditVote, apiClosePoll, apiCutoffSuggestions, apiCutoffAvailability, apiReopenPoll, apiGetPollById, apiGetParticipants, ApiVote } from "@/lib/api";
import RankableOptions from "@/components/RankableOptions";
import ReadOnlyTierCards from "@/components/ReadOnlyTierCards";
import TimeSlotBubbles, { SlotState } from "@/components/TimeSlotBubbles";

import { isCreatedByThisBrowser, getCreatorSecret, recordPollCreation } from "@/lib/browserPollAccess";
import { forgetPoll, hasPollData } from "@/lib/forgetPoll";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { usePageTitle } from "@/lib/usePageTitle";
import ParticipationConditions from "@/components/ParticipationConditions";
import TimeSlotRoundsDisplay from "@/components/TimeSlotRoundsDisplay";
import PollDetails from "@/components/PollDetails";
import SubPollField from "@/components/SubPollField";
import { loadBallotDraft, saveBallotDraft, clearBallotDraft, BallotDraft } from "@/lib/ballotDraft";
import { windowDurationMinutes, formatDurationLabel, formatTimeSlot } from "@/lib/timeUtils";

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
  // Tiered ballot (equal-ranking groups). Each inner array is a tier of
  // options tied for the same rank. When it has no ties, every inner array
  // is a singleton and this is equivalent to rankedChoices.
  const [rankedChoiceTiers, setRankedChoiceTiers] = useState<string[][]>([]);
  // Time poll preferences: liked/disliked slot sets (null = not yet submitted)
  const [likedSlots, setLikedSlots] = useState<string[] | null>(null);
  const [dislikedSlots, setDislikedSlots] = useState<string[] | null>(null);
  const [optionsInitialized, setOptionsInitialized] = useState(false);
  const [yesNoChoice, setYesNoChoice] = useState<'yes' | 'no' | null>(null);
  const [isAbstaining, setIsAbstaining] = useState(false);
  const [suggestionChoices, setSuggestionChoices] = useState<string[]>([]);
  const [suggestionMetadata, setSuggestionMetadata] = useState<OptionsMetadata>({});
  const [optionsMetadataLocal, setOptionsMetadataLocal] = useState<OptionsMetadata | null>(poll.options_metadata ?? null);

  // Sync local metadata when poll prop changes (e.g., navigating between polls)
  useEffect(() => {
    setOptionsMetadataLocal(poll.options_metadata ?? null);
  }, [poll.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [existingSuggestions, setExistingSuggestions] = useState<string[]>([]);
  const [justCancelledAbstain, setJustCancelledAbstain] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [pollResults, setPollResults] = useState<PollResults | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [isClosingPoll, setIsClosingPoll] = useState(false);
  const [isReopeningPoll, setIsReopeningPoll] = useState(false);
  const [isCuttingOffSuggestions, setIsCuttingOffSuggestions] = useState(false);
  const [showCutoffConfirmModal, setShowCutoffConfirmModal] = useState(false);
  const [isCuttingOffAvailability, setIsCuttingOffAvailability] = useState(false);
  const [showCutoffAvailabilityConfirmModal, setShowCutoffAvailabilityConfirmModal] = useState(false);
  const [suggestionDeadlineOverride, setSuggestionDeadlineOverride] = useState<string | null>(null);
  const [optionsOverride, setOptionsOverride] = useState<string[] | null>(null);
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
  const [isEditingVote, setIsEditingVote] = useState(false); // For suggestion editing
  const [isEditingRanking, setIsEditingRanking] = useState(false); // For ranking editing (independent)
  const [showForgetConfirmModal, setShowForgetConfirmModal] = useState(false);
  const [hasPollDataState, setHasPollDataState] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  // Suggestion phase helpers: a ranked_choice poll with suggestion_deadline or suggestion_deadline_minutes
  // has an optional suggestion collection phase before ranking begins.
  // When suggestion_deadline_minutes is set but suggestion_deadline is null, the timer hasn't started yet
  // (waiting for first suggestion). This is still considered "in suggestion phase".
  const hasSuggestionPhase = poll.poll_type === 'ranked_choice' && !!(poll.suggestion_deadline || poll.suggestion_deadline_minutes);
  const effectiveSuggestionDeadline = suggestionDeadlineOverride || poll.suggestion_deadline;
  const suggestionTimerStarted = !!effectiveSuggestionDeadline;
  const inSuggestionPhase = hasSuggestionPhase && (
    !suggestionTimerStarted // Timer hasn't started yet (waiting for first suggestion)
    || (currentTime ? currentTime < new Date(effectiveSuggestionDeadline!) : true)
  );
  const canSubmitSuggestions = hasSuggestionPhase && inSuggestionPhase;
  const canSubmitRankings = poll.poll_type === 'ranked_choice' && (
    !hasSuggestionPhase || !inSuggestionPhase || poll.allow_pre_ranking !== false
  );

  // Time poll phase helpers: availability phase while options haven't been generated yet
  const inAvailabilityPhase = poll.poll_type === 'time' && (!optionsOverride?.length) && (!poll.options || poll.options.length === 0);
  const availabilityTimerStarted = !!(suggestionDeadlineOverride || poll.suggestion_deadline);
  const inActiveAvailabilityPhase = inAvailabilityPhase && (
    !availabilityTimerStarted
    || (currentTime ? currentTime < new Date((suggestionDeadlineOverride || poll.suggestion_deadline)!) : true)
  );
  // Whether the user has completed ranking (or abstained) — for suggestion-phase polls,
  // this distinguishes "voted with suggestions only" from "voted with rankings"
  const hasCompletedRanking = !hasSuggestionPhase || userVoteData?.ranked_choices?.length > 0 || userVoteData?.is_abstain || userVoteData?.is_ranking_abstain;
  const userAbstainedFromRanking = !!(userVoteData?.is_abstain || userVoteData?.is_ranking_abstain);

  // Debug logging utility (output captured by CommitInfo Logs tab)
  const logToServer = (_logType: string, level: string, message: string, data: unknown = {}) => {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${_logType}] ${message}`, data);
  };
  const [followUpPolls, setFollowUpPolls] = useState<Poll[]>([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [voterName, setVoterName] = useState<string>("");
  const [voterListRefresh, setVoterListRefresh] = useState(0);

  // Stable filter callbacks for VoterList
  const suggestionsVoterFilter = useCallback((v: ApiVote) => !!(v.suggestions && v.suggestions.length > 0), []);

  const autoCloseTriggeredRef = useRef(false);
  const fetchResultsInFlight = useRef(false);
  const fetchResultsLastCall = useRef(0);

  // Participation poll voter conditions - initialized with poll's constraints, draft restored in useEffect
  const [voterMinParticipants, setVoterMinParticipants] = useState<number | null>(poll.min_participants ?? 1);
  const [voterMaxParticipants, setVoterMaxParticipants] = useState<number | null>(poll.max_participants ?? null);
  const [voterMaxEnabled, setVoterMaxEnabled] = useState(poll.max_participants !== null && poll.max_participants !== undefined);
  const [voterDayTimeWindows, setVoterDayTimeWindows] = useState<any[]>(poll.day_time_windows || []);
  const [durationMinValue, setDurationMinValue] = useState<number | null>(poll.duration_window?.minValue ?? 1);
  const [durationMaxValue, setDurationMaxValue] = useState<number | null>(poll.duration_window?.maxValue ?? 2);
  const [durationMinEnabled, setDurationMinEnabled] = useState(poll.duration_window?.minEnabled ?? false);
  const [durationMaxEnabled, setDurationMaxEnabled] = useState(poll.duration_window?.maxEnabled ?? false);

  // Restore ballot draft from localStorage on mount (participation and time polls)
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    if (poll.poll_type !== 'participation' && poll.poll_type !== 'time') return;
    try {
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      if (votedPolls[poll.id]) return;
    } catch { /* ignore */ }
    const draft = loadBallotDraft(poll.id);
    if (!draft) return;
    if (draft.yesNoChoice !== undefined) setYesNoChoice(draft.yesNoChoice ?? null);
    if (draft.isAbstaining !== undefined) setIsAbstaining(draft.isAbstaining);
    if (draft.voterMinParticipants !== undefined) setVoterMinParticipants(draft.voterMinParticipants);
    if (draft.voterMaxParticipants !== undefined) setVoterMaxParticipants(draft.voterMaxParticipants);
    if (draft.voterMaxEnabled !== undefined) setVoterMaxEnabled(draft.voterMaxEnabled);
    if (draft.voterDayTimeWindows !== undefined) setVoterDayTimeWindows(draft.voterDayTimeWindows);
    if (draft.durationMinValue !== undefined) setDurationMinValue(draft.durationMinValue);
    if (draft.durationMaxValue !== undefined) setDurationMaxValue(draft.durationMaxValue);
    if (draft.durationMinEnabled !== undefined) setDurationMinEnabled(draft.durationMinEnabled);
    if (draft.durationMaxEnabled !== undefined) setDurationMaxEnabled(draft.durationMaxEnabled);
  }, [poll.id, poll.poll_type]);

  // Persist ballot draft to localStorage (debounced to avoid rapid writes during wheel/counter interactions)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if ((poll.poll_type !== 'participation' && poll.poll_type !== 'time') || hasVoted) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveBallotDraft(poll.id, {
        yesNoChoice, isAbstaining,
        voterMinParticipants, voterMaxParticipants, voterMaxEnabled,
        voterDayTimeWindows,
        durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled,
      });
    }, 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [poll.id, poll.poll_type, hasVoted, yesNoChoice, isAbstaining,
      voterMinParticipants, voterMaxParticipants, voterMaxEnabled,
      voterDayTimeWindows, durationMinValue, durationMaxValue,
      durationMinEnabled, durationMaxEnabled]);

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
  
  // Check if poll has time windows but none are enabled (voter voted Yes with all days unchecked)
  const hasNoEnabledTimeWindows = useMemo(() => {
    if (poll.poll_type !== 'participation') return false;
    if (!poll.day_time_windows?.some((dtw: DayTimeWindow) => dtw.windows.length > 0)) return false;
    return !voterDayTimeWindows.some(
      (dtw: DayTimeWindow) => dtw.windows.some(w => w.enabled !== false)
    );
  }, [poll.poll_type, poll.day_time_windows, voterDayTimeWindows]);

  // Check if any enabled voter time window is shorter than the minimum duration
  const hasTimeWindowTooShort = useMemo(() => {
    if (poll.poll_type !== 'participation') return false;
    const minDurMinutes = durationMinEnabled && durationMinValue != null
      ? Math.round(durationMinValue * 60) : null;
    if (minDurMinutes == null || minDurMinutes <= 0) return false;
    return voterDayTimeWindows.some((dtw: DayTimeWindow) =>
      dtw.windows.some(w =>
        w.enabled !== false && windowDurationMinutes(w) < minDurMinutes
      )
    );
  }, [poll.poll_type, voterDayTimeWindows, durationMinEnabled, durationMinValue]);

  const isPollClosed = useMemo(() => {
    // If manually reopened, stay open regardless of deadline
    if (manuallyReopened && !pollClosed) return false;

    // Otherwise, use normal logic: manual close OR deadline expiration
    return pollClosed || isPollExpired;
  }, [pollClosed, isPollExpired, manuallyReopened]);

  // Track response count for preliminary results
  const [responseCount, setResponseCount] = useState<number>(poll.response_count ?? 0);

  // Whether preliminary results should be shown (open poll, threshold met)
  const showPrelimResults = useMemo(() => {
    if (isPollClosed) return false; // Closed polls show results via the normal path
    if (!poll.show_preliminary_results) return false;
    const minResp = poll.min_responses ?? 1;
    return responseCount >= minResp;
  }, [isPollClosed, poll.show_preliminary_results, poll.min_responses, responseCount]);

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
      
      const voteIds: string[] = [];
      
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


      // Fetch all votes for this poll and filter by localStorage IDs
      const allPollVotes = await apiGetVotes(pollId);
      const userVotes = allPollVotes.filter(v => voteIds.includes(v.id));

      if (userVotes.length === 0) {
        return null;
      }

      // ONLY use votes from this browser's localStorage - no cross-browser contamination
      const allVotes = [...userVotes];

      // Return the most recent vote
      const sortedVotes = allVotes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return sortedVotes[0];
    } catch (error) {
      console.error('Error fetching aggregated vote data:', error);
      return null;
    }
  }, [poll.poll_type]);

  // Fetch vote data from database by vote ID (legacy function)
  const fetchVoteData = useCallback(async (voteId: string) => {

    try {
      const allVotes = await apiGetVotes(poll.id);
      const vote = allVotes.find(v => v.id === voteId);
      return vote || null;
    } catch (error) {
      return null;
    }
  }, [poll.id]);

  // Fetch and aggregate all user vote data for this poll (for newly created polls)
  const fetchLatestUserVote = useCallback(async (pollId: string) => {
    // CRITICAL: Return null to prevent cross-browser vote contamination
    // This function was aggregating votes from ALL browsers, causing vote isolation issues
    // Force use of localStorage-based vote tracking only
    return null;
  }, []);

  const fetchPollResults = useCallback(async () => {
    // Prevent rapid-fire calls: skip if already in-flight or called within last 2s.
    // The 1-second timer and multiple effects can trigger this in quick succession
    // (especially after Fast Refresh), leading to 429 rate-limit errors.
    const now = Date.now();
    if (fetchResultsInFlight.current || now - fetchResultsLastCall.current < 2000) return;
    fetchResultsInFlight.current = true;
    fetchResultsLastCall.current = now;
    setLoadingResults(true);
    try {
      const results = await apiGetPollResults(poll.id);
      setPollResults(results);

      // For participation polls, also fetch the list of participating voters
      if (poll.poll_type === 'participation') {
        const participants = await apiGetParticipants(poll.id);
        setParticipatingVoterIds(participants.map(p => p.vote_id));
      }
    } catch (error) {
      console.error('Error fetching poll results:', error);
    } finally {
      setLoadingResults(false);
      fetchResultsInFlight.current = false;
    }
  }, [poll.id, poll.poll_type]);

  // Initialize currentTime on client side to avoid hydration issues
  useEffect(() => {
    setCurrentTime(new Date());

    // Load existing suggestions for polls with suggestion phase
    if (hasSuggestionPhase) {
      loadExistingSuggestions();
      // Also fetch results to show vote counts for suggestion polls
      fetchPollResults();
    }
  }, [poll.poll_type, fetchPollResults]);

  // Fetch preliminary results when threshold is met
  useEffect(() => {
    if (showPrelimResults && !pollResults) {
      fetchPollResults();
    }
  }, [showPrelimResults, pollResults, fetchPollResults]);

  // Load existing suggestions from other votes
  const loadExistingSuggestions = async (excludeUserVote = false) => {
    try {
      // Fetch all votes and filter for suggestion votes with suggestions
      const allVotes = await apiGetVotes(poll.id);
      const votes = allVotes
        .filter(v => v.suggestions && v.suggestions.length > 0 && !v.is_abstain)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 100);

      // Debug logging to understand what votes we're getting
      console.log('[DEBUG] loadExistingSuggestions - fetched votes:', votes);
      console.log('[DEBUG] loadExistingSuggestions - excludeUserVote:', excludeUserVote, 'userVoteId:', userVoteId);

      const allSuggestions = new Set<string>();
      
      // Add starting options from poll creation
      if (poll.options && Array.isArray(poll.options)) {
        poll.options.forEach((option: string) => allSuggestions.add(option));
      }
      
      // For suggestion polls, to handle edited votes properly, we use only the latest vote
      // If there are multiple voters in the future, this logic would need to be enhanced
      // to track the latest vote per unique voter
      
      let validVotes = votes || [];
      
      // Skip user's vote if we're in edit mode
      if (excludeUserVote && userVoteId) {
        validVotes = votes?.filter(vote => vote.id !== userVoteId) || [];
      }
      
      // Each vote record represents a unique voter's current suggestions
      // When a voter edits their vote, their record is updated in place
      // So we should aggregate all current suggestions from all voters
      validVotes.forEach(vote => {
        if (vote.suggestions && Array.isArray(vote.suggestions)) {
          console.log('[DEBUG] Adding suggestions from vote:', vote.id, 'suggestions:', vote.suggestions);
          vote.suggestions.forEach((sug: string) => allSuggestions.add(sug));
        }
      });

      const suggestionsArray = Array.from(allSuggestions);
      console.log('[DEBUG] Final aggregated suggestions:', suggestionsArray);
      setExistingSuggestions(suggestionsArray);
    } catch (error) {
      console.error('Error loading suggestions:', error);
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

      // For 2-option polls, start with no selection (user must choose)
      if (parsedOptions.length === 2) {
        setOptionsInitialized(true);
        return;
      }

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
    
    // Auto-created follow-up polls share the parent's creator_secret.
    // Propagate so close/reopen work on the child too.
    if (!getCreatorSecret(poll.id) && poll.follow_up_to) {
      const parentSecret = getCreatorSecret(poll.follow_up_to);
      if (parentSecret) recordPollCreation(poll.id, parentSecret);
    }
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
      
      // Fetch vote data from database if we have a vote ID or for specific poll types
      if (voteId || hasSuggestionPhase || poll.poll_type === 'participation') {
        setIsLoadingVoteData(true);

        // For participation polls without a stored vote ID, find the vote via participant name match
        const fetchParticipationVoteByName = async (pollId: string) => {
          const savedName = getUserName();
          if (!savedName) return null;
          const participants = await apiGetParticipants(pollId);
          const match = participants.find(p => p.voter_name === savedName);
          if (!match) return null;
          return fetchVoteData(match.vote_id);
        };

        let fetchPromise;
        if (voteId) {
          fetchPromise = fetchVoteData(voteId);
        } else if (poll.poll_type === 'participation') {
          fetchPromise = fetchParticipationVoteByName(poll.id);
        } else {
          fetchPromise = fetchLatestUserVote(poll.id);
        }
          
        fetchPromise.then(voteData => {
          if (voteData) {
            setUserVoteData(voteData);

            // CRITICAL FIX: Set userVoteId from the fetched vote data
            // This ensures that vote editing updates the existing record instead of creating new ones
            if (voteData && 'id' in voteData && voteData.id) {
              setUserVoteId(voteData.id);
              // Backfill pollVoteIds localStorage so the poll list can show personalized badges
              try {
                const voteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
                if (!voteIds[poll.id]) {
                  voteIds[poll.id] = voteData.id;
                  localStorage.setItem('pollVoteIds', JSON.stringify(voteIds));
                }
              } catch (e) { /* ignore */ }
            }

            // For polls with suggestion phase, fetch results to show vote counts even when poll is open
            if (hasSuggestionPhase && !isPollClosed) {
              fetchPollResults();
            }

            // Set UI state based on vote data from database columns
            // is_ranking_abstain always restores abstain state.
            // is_abstain only restores for non-suggestion polls — in suggestion polls
            // it means "abstained from suggestions", not "abstained from ranking".
            const shouldRestoreAbstain = voteData.is_ranking_abstain || (voteData.is_abstain && !hasSuggestionPhase);
            setIsAbstaining(shouldRestoreAbstain);
            if (voteData.is_abstain) {
              // Don't set choices for abstain votes
            } else if (poll.poll_type === 'yes_no' && voteData.yes_no_choice) {
              setYesNoChoice(voteData.yes_no_choice as 'yes' | 'no');
            } else if (poll.poll_type === 'participation' && voteData.yes_no_choice) {
              setYesNoChoice(voteData.yes_no_choice as 'yes' | 'no');
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
              // Load voter's time window conditions
              if (voteData.voter_day_time_windows && Array.isArray(voteData.voter_day_time_windows)) {
                setVoterDayTimeWindows(voteData.voter_day_time_windows);
              }
              if (voteData.voter_duration) {
                const { minValue, maxValue, minEnabled, maxEnabled } = voteData.voter_duration;
                if (minValue !== undefined) setDurationMinValue(minValue);
                if (maxValue !== undefined) setDurationMaxValue(maxValue);
                if (minEnabled !== undefined) setDurationMinEnabled(minEnabled);
                if (maxEnabled !== undefined) setDurationMaxEnabled(maxEnabled);
              }
            } else if (poll.poll_type === 'ranked_choice') {
              if (voteData.ranked_choices) setRankedChoices(voteData.ranked_choices);
              if (voteData.ranked_choice_tiers) {
                setRankedChoiceTiers(voteData.ranked_choice_tiers);
              } else if (voteData.ranked_choices) {
                // No tiers present — synthesize singleton tiers so the
                // current state is internally consistent.
                setRankedChoiceTiers(voteData.ranked_choices.map((c: string) => [c]));
              }
              if (voteData.suggestions) setSuggestionChoices(voteData.suggestions);
            } else if (poll.poll_type === 'time') {
              // Restore time poll availability windows
              if (voteData.voter_day_time_windows && Array.isArray(voteData.voter_day_time_windows)) {
                setVoterDayTimeWindows(voteData.voter_day_time_windows);
              }
              // Restore preferences phase reactions (null = not yet submitted)
              if (voteData.liked_slots !== null && voteData.liked_slots !== undefined) {
                setLikedSlots(voteData.liked_slots);
              }
              if (voteData.disliked_slots !== null && voteData.disliked_slots !== undefined) {
                setDislikedSlots(voteData.disliked_slots);
              }
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

  // Separate effect to fetch results when poll closes or for participation/time polls
  useEffect(() => {
    // Fetch results if poll is closed (reactive to state changes)
    const isClosed = pollClosed || (poll.response_deadline && new Date(poll.response_deadline) <= new Date());

    // Also fetch results for participation polls when voted (to show condition status)
    const shouldFetchForParticipation = poll.poll_type === 'participation' && hasVoted && !isClosed;

    // Fetch results for time polls in preferences phase (to get availability_counts for caution symbols)
    const shouldFetchForTimePoll = poll.poll_type === 'time' && !inAvailabilityPhase;

    if (isClosed || shouldFetchForParticipation || shouldFetchForTimePoll) {
      fetchPollResults();
    }
  }, [pollClosed, poll.response_deadline, poll.poll_type, hasVoted, fetchPollResults, inAvailabilityPhase]);

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
        // TODO Phase 2E: Add a dedicated endpoint for fetching follow-up polls
        // For now, this feature is not available until the related polls API is built
        setFollowUpPolls([]);
      } catch (error) {
        console.error('Unexpected error fetching follow-up polls:', error);
      } finally {
        setLoadingFollowUps(false);
      }
    }

    fetchFollowUpPolls();
  }, [poll.id]);


  // Real-time timer to check for poll expiration
  useEffect(() => {
    if (!poll.response_deadline || pollClosed) {
      return; // No deadline or already manually closed
    }

    const deadline = new Date(poll.response_deadline);
    const updateTimer = () => {
      const now = new Date();
      setCurrentTime(now);

      // If poll just expired, automatically fetch results.
      if (now >= deadline && !isPollClosed) {
        fetchPollResults();
      }
    };

    // Update immediately
    updateTimer();

    // Set up interval to check every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [poll.response_deadline, pollClosed, isPollClosed, fetchPollResults, poll.poll_type, poll.id]);

  // Real-time subscription to listen for poll status changes (with polling fallback)
  useEffect(() => {
    
    let pollInterval: NodeJS.Timeout | null = null;
    
    // Polling fallback function — polls the Python API for status changes
    const pollForChanges = async () => {
      try {
        const pollData = await apiGetPollById(poll.id);

        if (pollData && pollData.is_closed && !pollClosed) {
          setPollClosed(true);
          setManuallyReopened(false); // Reset flag when closed
          fetchPollResults();
        }
        // Update response count for preliminary results
        if (pollData?.response_count != null) {
          setResponseCount(pollData.response_count);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // No real-time subscription — use polling to detect status changes
    if (!pollClosed) {
      pollInterval = setInterval(pollForChanges, 5000);
      pollForChanges(); // Check immediately
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [poll.id, pollClosed, fetchPollResults]);

  const handleRankingChange = useCallback((newRankedChoices: string[], newTiers: string[][]) => {
    setRankedChoices(newRankedChoices);
    setRankedChoiceTiers(newTiers);
    // Clear the flag when user interacts with rankings after cancelling abstain
    if (justCancelledAbstain) {
      setJustCancelledAbstain(false);
    }
  }, [justCancelledAbstain]);

  // Memoize parsed options to prevent re-parsing on every render
  // During suggestion phase (poll.options is null), derive options from suggestion_counts
  const pollOptions = useMemo(() => {
    if (optionsOverride) {
      return optionsOverride;
    }
    if (poll.options) {
      return typeof poll.options === 'string' ? JSON.parse(poll.options) : poll.options;
    }
    if (hasSuggestionPhase && pollResults?.suggestion_counts) {
      return pollResults.suggestion_counts.map((sc: { option: string }) => sc.option);
    }
    return [];
  }, [optionsOverride, poll.options, hasSuggestionPhase, pollResults?.suggestion_counts]);

  // Randomize display order for 2-option polls (client-only to avoid hydration mismatch)
  const [twoOptionDisplayOrder, setTwoOptionDisplayOrder] = useState<string[]>([]);
  useEffect(() => {
    if (pollOptions.length === 2) {
      setTwoOptionDisplayOrder(
        Math.random() < 0.5 ? [pollOptions[0], pollOptions[1]] : [pollOptions[1], pollOptions[0]]
      );
    }
  }, [pollOptions]);

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
        setSuggestionChoices([]);
      } else if (poll.poll_type === 'yes_no') {
        setYesNoChoice(null); // Clear yes/no choice to prevent both appearing selected
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
      const updatedPoll = await apiClosePoll(poll.id, secretToUse);
      if (updatedPoll) {
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

  const handleCutoffSuggestionsClick = () => {
    if (isCuttingOffSuggestions || !isCreator) return;
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret) {
      alert('You do not have permission to cutoff suggestions.');
      return;
    }
    setShowCutoffConfirmModal(true);
  };

  const handleCutoffSuggestions = async () => {
    setShowCutoffConfirmModal(false);
    if (isCuttingOffSuggestions || !isCreator) return;
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret) return;

    setIsCuttingOffSuggestions(true);
    try {
      const updatedPoll = await apiCutoffSuggestions(poll.id, creatorSecret);
      if (updatedPoll) {
        // Update the suggestion deadline so the UI exits suggestion phase
        setSuggestionDeadlineOverride(updatedPoll.suggestion_deadline || new Date().toISOString());
        // Update options from the finalized poll so the ranking ballot can render
        if (updatedPoll.options) {
          const opts = typeof updatedPoll.options === 'string' ? JSON.parse(updatedPoll.options) : updatedPoll.options;
          setOptionsOverride(opts);
        }
        await fetchPollResults();
      }
    } catch (error) {
      console.error('Error cutting off suggestions:', error);
      alert('Failed to cutoff suggestions. Please try again.');
    } finally {
      setIsCuttingOffSuggestions(false);
    }
  };

  const handleCutoffAvailabilityClick = () => {
    if (isCuttingOffAvailability || !isCreator) return;
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret) {
      alert('You do not have permission to end the availability phase.');
      return;
    }
    setShowCutoffAvailabilityConfirmModal(true);
  };

  const handleCutoffAvailability = async () => {
    setShowCutoffAvailabilityConfirmModal(false);
    if (isCuttingOffAvailability || !isCreator) return;
    const creatorSecret = getCreatorSecret(poll.id);
    if (!creatorSecret) return;

    setIsCuttingOffAvailability(true);
    try {
      const updatedPoll = await apiCutoffAvailability(poll.id, creatorSecret);
      if (updatedPoll) {
        setSuggestionDeadlineOverride(updatedPoll.suggestion_deadline || new Date().toISOString());
        if (updatedPoll.options) {
          const opts = typeof updatedPoll.options === 'string' ? JSON.parse(updatedPoll.options) : updatedPoll.options;
          setOptionsOverride(opts);
        }
        await fetchPollResults();
      }
    } catch (error) {
      console.error('Error cutting off availability:', error);
      alert('Failed to end availability phase. Please try again.');
    } finally {
      setIsCuttingOffAvailability(false);
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
      const updatedPoll = await apiReopenPoll(poll.id, secretToUse);
      if (updatedPoll) {
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
    await logToServer('suggestion-vote', 'info', 'handleVoteClick started', {
      isSubmitting,
      hasVoted,
      isEditingVote,
      isPollClosed,
      pollType: poll.poll_type,
      isAbstaining,
      suggestionChoices: suggestionChoices.length,
      suggestionChoicesData: suggestionChoices
    });

    // Either suggestion editing or ranking editing counts as "editing"
    const isAnyEditing = isEditingVote || isEditingRanking;

    // During suggestion phase with pre-ranking, submitting rankings after the initial
    // suggestion vote is an implicit edit (updating the existing vote with rankings).
    // Also applies after suggestion cutoff: user submitted suggestions but hasn't ranked yet.
    // Includes users who abstained from suggestions (is_abstain) — they should still be able to rank.
    const hasNotRankedYet = hasVoted && hasSuggestionPhase && !userVoteData?.ranked_choices?.length && !userVoteData?.is_ranking_abstain;
    // For time polls in preferences phase: not yet reacted if liked_slots is still null
    const hasNotReactedYet = poll.poll_type === 'time' && !inAvailabilityPhase && hasVoted
      && userVoteData?.liked_slots === null && userVoteData?.disliked_slots === null && !userVoteData?.is_abstain;
    const isImplicitEdit = hasVoted && !isAnyEditing && (
      (canSubmitSuggestions && canSubmitRankings) || hasNotRankedYet || hasNotReactedYet
    );
    if (isImplicitEdit) {
      setIsEditingVote(true);
    }

    if (isSubmitting || (hasVoted && !isAnyEditing && !isImplicitEdit) || isPollClosed) {
      await logToServer('suggestion-vote', 'warn', 'handleVoteClick early return', {
        reason: isSubmitting ? 'isSubmitting' : (hasVoted && !isAnyEditing) ? 'hasVoted and not editing' : 'isPollClosed'
      });
      return;
    }

    // Validate vote choice first
    if ((poll.poll_type === 'yes_no' || poll.poll_type === 'participation') && !yesNoChoice && !isAbstaining) {
      await logToServer('suggestion-vote', 'error', 'Yes/No validation failed', { yesNoChoice, isAbstaining });
      setVoteError("Please select Yes, No, or Abstain");
      return;
    }

    // Participation poll time window validation
    if (poll.poll_type === 'participation' && yesNoChoice === 'yes' && !isAbstaining) {
      const pollHasTimeWindows = poll.day_time_windows && poll.day_time_windows.some(
        (dtw: DayTimeWindow) => dtw.windows.length > 0
      );
      if (pollHasTimeWindows) {
        const enabledWindows = voterDayTimeWindows.flatMap(
          (dtw: DayTimeWindow) => dtw.windows.filter(w => w.enabled !== false)
        );
        if (enabledWindows.length === 0) {
          setVoteError("Please enable at least one time window, or vote No.");
          return;
        }
        const minDurMinutes = durationMinEnabled && durationMinValue != null
          ? Math.round(durationMinValue * 60) : null;
        if (minDurMinutes != null && minDurMinutes > 0) {
          const tooShort = enabledWindows.some(w =>
            windowDurationMinutes(w) < minDurMinutes
          );
          if (tooShort) {
            setVoteError(`Each enabled time window must be at least ${formatDurationLabel(minDurMinutes)} long.`);
            return;
          }
        }
      }
    }

    if (poll.poll_type === 'ranked_choice' && !isAbstaining) {
      const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
      const filteredSuggestions = suggestionChoices.filter(choice => choice && choice.trim().length > 0);
      if (filteredRankedChoices.length === 0 && (!canSubmitSuggestions || filteredSuggestions.length === 0)) {
        if (canSubmitSuggestions) {
          // During suggestion phase, submitting with nothing selected is an implicit abstain
          setIsAbstaining(true);
        } else {
          await logToServer('suggestion-vote', 'error', 'Ranked choice validation failed', { rankedChoices, suggestionChoices, isAbstaining, canSubmitSuggestions });
          setVoteError("Please rank at least one option or select Abstain");
          return;
        }
      }
    }

    await logToServer('vote', 'info', 'handleVoteClick validation passed, showing confirmation modal', {
      pollType: poll.poll_type,
      isAbstaining,
      hasSuggestionPhase,
    });

    setVoteError(null);
    setShowVoteConfirmModal(true);
  };



  const submitVote = async () => {
    await logToServer('suggestion-vote', 'info', 'submitVote started', {
      isSubmitting,
      hasVoted,
      isEditingVote,
      isPollClosed,
      pollType: poll.poll_type,
      userVoteId
    });

    setShowVoteConfirmModal(false);

    const isAnyEditingForSubmit = isEditingVote || isEditingRanking;
    if (isSubmitting || (hasVoted && !isAnyEditingForSubmit) || isPollClosed) {
      await logToServer('suggestion-vote', 'warn', 'submitVote early return', {
        reason: isSubmitting ? 'isSubmitting' : (hasVoted && !isAnyEditingForSubmit) ? 'hasVoted and not editing' : 'isPollClosed'
      });
      return;
    }

    setIsSubmitting(true);
    setVoteError(null);

    let voteData: any = {}; // Initialize voteData outside try block for error logging

    await logToServer('suggestion-vote', 'info', 'submitVote setup complete', {
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
          max_participants: voterMaxEnabled ? voterMaxParticipants : null,
          voter_day_time_windows: voterDayTimeWindows.length > 0 ? voterDayTimeWindows : null,
          voter_duration: (durationMinEnabled || durationMaxEnabled) ? {
            minValue: durationMinValue,
            maxValue: durationMaxValue,
            minEnabled: durationMinEnabled,
            maxEnabled: durationMaxEnabled
          } : null,
        };
      } else if (poll.poll_type === 'ranked_choice') {
        // Filter and validate ranked choices (No Preference items already filtered by RankableOptions)
        const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
        const filteredSuggestionsForValidation = suggestionChoices.filter(choice => choice && choice.trim().length > 0);
        // Filter and validate tiers in lockstep with ranked_choices. Drop
        // empty strings from each tier and drop empty tiers.
        const filteredTiers: string[][] = rankedChoiceTiers
          .map(tier => tier.filter(c => c && c.trim().length > 0))
          .filter(tier => tier.length > 0);
        // Only send tiers if they actually encode ties (at least one tier has
        // size > 1). Otherwise the flat ranked_choices list is sufficient and
        // we avoid storing redundant singleton tiers.
        const hasTies = filteredTiers.some(tier => tier.length > 1);

        if (filteredRankedChoices.length === 0 && !isAbstaining && (!canSubmitSuggestions || filteredSuggestionsForValidation.length === 0)) {
          if (!canSubmitSuggestions) {
            setVoteError("Please rank at least one option or select Abstain");
            setIsSubmitting(false);
            return;
          }
          // During suggestion phase, empty submission is treated as abstain (handled by finalAbstain below)
        }
        
        // Additional validation: ensure choices are valid poll options
        const invalidChoices = filteredRankedChoices.filter(choice => !pollOptions.includes(choice));
        
        if (invalidChoices.length > 0) {
          console.error('Invalid choices detected:', invalidChoices);
          setVoteError("Invalid options detected. Please refresh and try again.");
          setIsSubmitting(false);
          return;
        }
        
        // Include suggestions if poll has a suggestion phase
        const filteredSuggestions = hasSuggestionPhase
          ? suggestionChoices.filter(choice => choice && choice.trim().length > 0)
          : null;
        const filteredMetadata = hasSuggestionPhase && filteredSuggestions && filteredSuggestions.length > 0 && Object.keys(suggestionMetadata).length > 0
          ? Object.fromEntries(Object.entries(suggestionMetadata).filter(([key]) => filteredSuggestions.includes(key)))
          : null;

        // During suggestion phase with no rankings and no suggestions: abstain
        const hasRankings = filteredRankedChoices.length > 0;
        const hasSuggestions = filteredSuggestions && filteredSuggestions.length > 0;
        const previousSuggestions = userVoteData?.suggestions;
        const hasPreviousSuggestions = previousSuggestions && previousSuggestions.length > 0;
        const hasAnyContent = hasRankings || hasSuggestions || hasPreviousSuggestions;
        const finalAbstain = !hasAnyContent;
        // Ranking-specific abstain: user explicitly abstained from ranking but has suggestions
        const rankingAbstain = isAbstaining && !hasRankings && (hasSuggestions || hasPreviousSuggestions);

        voteData = {
          poll_id: poll.id,
          vote_type: 'ranked_choice' as const,
          ranked_choices: isAbstaining || !hasRankings ? null : filteredRankedChoices,
          ranked_choice_tiers:
            isAbstaining || !hasRankings || !hasTies ? null : filteredTiers,
          suggestions: hasSuggestions ? filteredSuggestions : (hasPreviousSuggestions ? previousSuggestions : null),
          is_abstain: finalAbstain,
          is_ranking_abstain: rankingAbstain,
          voter_name: voterName.trim() || null,
          options_metadata: filteredMetadata && Object.keys(filteredMetadata).length > 0 ? filteredMetadata : null,
        };
      } else if (poll.poll_type === 'time') {
        if (inAvailabilityPhase) {
          voteData = {
            vote_type: 'time' as const,
            voter_day_time_windows: voterDayTimeWindows.length > 0 ? voterDayTimeWindows : null,
            voter_duration: (durationMinEnabled || durationMaxEnabled) ? {
              minValue: durationMinValue,
              maxValue: durationMaxValue,
              minEnabled: durationMinEnabled,
              maxEnabled: durationMaxEnabled
            } : null,
            is_abstain: isAbstaining,
            voter_name: voterName.trim() || null,
          };
        } else {
          // Preferences phase: submit liked/disliked reactions
          voteData = {
            vote_type: 'time' as const,
            liked_slots: isAbstaining ? null : (likedSlots ?? []),
            disliked_slots: isAbstaining ? null : (dislikedSlots ?? []),
            is_abstain: isAbstaining,
            voter_name: voterName.trim() || null,
          };
        }
      }

      let voteId: string | undefined;
      let error: any; // eslint-disable-line


      if ((isEditingVote || isEditingRanking) && userVoteId) {

        // Create update data with only the vote choice (don't update vote_type or poll_id)
        // Use the same filtered data that was prepared in voteData to ensure consistency
        const updateData = poll.poll_type === 'yes_no'
          ? { yes_no_choice: isAbstaining ? null : yesNoChoice, is_abstain: isAbstaining, voter_name: voterName.trim() || null }
          : poll.poll_type === 'participation'
          ? { yes_no_choice: isAbstaining ? null : yesNoChoice, is_abstain: isAbstaining, voter_name: voterName.trim() || null, min_participants: voterMinParticipants, max_participants: voterMaxEnabled ? voterMaxParticipants : null, voter_day_time_windows: voterDayTimeWindows.length > 0 ? voterDayTimeWindows : null, voter_duration: (durationMinEnabled || durationMaxEnabled) ? { minValue: durationMinValue, maxValue: durationMaxValue, minEnabled: durationMinEnabled, maxEnabled: durationMaxEnabled } : null }
          : poll.poll_type === 'time'
          ? { voter_day_time_windows: voteData.voter_day_time_windows, voter_duration: voteData.voter_duration, liked_slots: voteData.liked_slots, disliked_slots: voteData.disliked_slots, is_abstain: voteData.is_abstain, voter_name: voterName.trim() || null }
          : { ranked_choices: voteData.ranked_choices, ranked_choice_tiers: voteData.ranked_choice_tiers, suggestions: canSubmitSuggestions ? voteData.suggestions : undefined, is_abstain: voteData.is_abstain, is_ranking_abstain: voteData.is_ranking_abstain, voter_name: voterName.trim() || null };
        
        
        
        // Update existing vote via API
        try {
          const returnedVote = await apiEditVote(poll.id, userVoteId, updateData);
          voteId = userVoteId;

          await logToServer('suggestion-vote', 'info', 'Vote update response', {
            returnedVote
          });

          setUserVoteData(returnedVote);
        } catch (updateErr: any) {
          error = updateErr;
          voteId = userVoteId;
          setVoteError("Failed to update vote. Please try again.");
        }
      } else {
        await logToServer('suggestion-vote', 'info', 'Attempting to insert new vote', { voteData });

        // Insert new vote via API
        try {
          const insertedVote = await apiSubmitVote(poll.id, voteData);
          voteId = insertedVote.id;

          await logToServer('suggestion-vote', 'info', 'Vote insert successful', { voteId });
        } catch (insertErr: any) {
          error = insertErr;
          console.error('Vote insert error:', insertErr);
          await logToServer('suggestion-vote', 'error', 'Database insert error', {
            message: insertErr.message
          });
        }
      }

      if (error) {
        await logToServer('suggestion-vote', 'error', 'Vote submission error', {
          error,
          voteData,
          message: error.message
        });
        console.error('Error submitting vote:', error);
        console.error('Vote data that failed:', voteData);
        setVoteError("Failed to submit vote. Please try again.");
        return;
      }

      await logToServer('suggestion-vote', 'info', 'Vote submission successful', {
        voteId,
        isEditingVote,
        pollType: poll.poll_type
      });

      setHasVoted(true);
      setUserVoteId(voteId ?? null);

      // Update response count for preliminary results
      if (!isEditingVote) {
        setResponseCount(prev => prev + 1);
      }

      // Merge submitted metadata into local state so it's available immediately
      if (suggestionMetadata && Object.keys(suggestionMetadata).length > 0) {
        setOptionsMetadataLocal(prev => ({ ...prev, ...suggestionMetadata }));
      }

      // Trigger voter list refresh immediately
      setVoterListRefresh(prev => prev + 1);

      // Start deferred availability deadline on first time poll availability submission
      if (poll.poll_type === 'time' && inAvailabilityPhase && !availabilityTimerStarted && poll.suggestion_deadline_minutes && !isEditingVote) {
        const newDeadline = new Date(Date.now() + poll.suggestion_deadline_minutes * 60 * 1000);
        setSuggestionDeadlineOverride(newDeadline.toISOString());
      }

      // Refresh suggestion list for polls with suggestion phase
      if (hasSuggestionPhase) {
        // If this is the first suggestion on a deferred-deadline poll, start the timer
        if (!suggestionTimerStarted && poll.suggestion_deadline_minutes && !isEditingVote) {
          const newDeadline = new Date(Date.now() + poll.suggestion_deadline_minutes * 60 * 1000);
          setSuggestionDeadlineOverride(newDeadline.toISOString());
        }
        // Reset abstain so the ranking ballot is usable after suggestion submission
        // (abstaining from suggestions shouldn't block ranking)
        if (isAbstaining && canSubmitRankings) {
          setIsAbstaining(false);
        }
        setTimeout(async () => {
          await loadExistingSuggestions(false);
          await fetchPollResults();
        }, 500);
      }
      
      // Save vote to localStorage so user can't vote again (only for new votes)
      if (!isEditingVote) {
        markPollAsVoted(poll.id, voteId, isAbstaining);
        // Update hasPollData state
        setHasPollDataState(true);
      }
      // Clear ballot draft now that vote is saved to the database
      clearBallotDraft(poll.id);
      
      // Save the user's name if they provided one
      if (voterName.trim()) {
        saveUserName(voterName.trim());
      }
      
      setIsEditingVote(false);
      setIsEditingRanking(false);

      // Refresh results after editing votes with suggestions
      if (hasSuggestionPhase && (isEditingVote || isEditingRanking)) {
        await fetchPollResults();
      }

      // If the poll is closed or preliminary results threshold met, fetch results
      if (isPollClosed || showPrelimResults) {
        await fetchPollResults();
      }
    } catch (error) {
      await logToServer('suggestion-vote', 'error', 'Unexpected error in submitVote', {
        error,
        stack: error instanceof Error ? error.stack : 'No stack trace',
        message: error instanceof Error ? error.message : 'Unknown error',
        voteData
      });
      console.error('Unexpected error:', error);
      setVoteError("An unexpected error occurred. Please try again.");
    } finally {
      await logToServer('suggestion-vote', 'info', 'submitVote finally block', { isSubmitting: false });
      setIsSubmitting(false);
    }
  };

  const editVoteButton = !isPollClosed && !isLoadingVoteData ? (
    <button
      onClick={() => setIsEditingVote(true)}
      className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors flex-shrink-0"
    >
      Edit
    </button>
  ) : null;

  const preliminaryResultsBlock = (className: string) => (
    showPrelimResults && !isPollClosed ? (
      <div className={className}>
        <div className="mb-2 text-xs text-gray-500 dark:text-gray-400 text-center font-medium uppercase tracking-wide">
          Preliminary Results
        </div>
        {loadingResults ? (
          <div className="flex justify-center items-center py-3">
            <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : pollResults ? (
          <PollResultsDisplay results={pollResults} isPollClosed={false} userVoteData={userVoteData} optionsMetadata={optionsMetadataLocal} />
        ) : null}
      </div>
    ) : null
  );

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

        {/* Poll details (expandable) */}
        {poll.details && <PollDetails details={poll.details} />}

        {/* Reference location badge */}
        {poll.reference_location_label && (
          <div className="mb-3 flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Near {poll.reference_location_label}</span>
          </div>
        )}

        {/* Sub-poll back navigation */}
        {poll.is_sub_poll && poll.parent_participation_poll_id && (
          <div className="mb-3 text-center">
            <Link href={`/p/${poll.parent_participation_poll_id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              Back to main poll
            </Link>
          </div>
        )}

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
            // During suggestion phase, show suggestion deadline instead of response deadline
            if (inSuggestionPhase) {
              if (poll.suggestion_deadline) {
                return <Countdown deadline={poll.suggestion_deadline} label="Suggestions cutoff" />;
              }
              // Deferred deadline: timer starts when first suggestion is submitted
              if (poll.suggestion_deadline_minutes) {
                const durationLabel = formatDurationLabel(poll.suggestion_deadline_minutes);
                return (
                  <div className="mb-3 text-center">
                    <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                      Suggestions cutoff {durationLabel} after first suggestion
                    </span>
                  </div>
                );
              }
            }
            // Time poll in availability phase: show availability deadline
            if (poll.poll_type === 'time' && inAvailabilityPhase) {
              const effectiveAvailDeadline = suggestionDeadlineOverride || poll.suggestion_deadline;
              if (effectiveAvailDeadline) {
                return <Countdown deadline={effectiveAvailDeadline} label="Availability cutoff" />;
              }
              if (poll.suggestion_deadline_minutes) {
                const durationLabel = formatDurationLabel(poll.suggestion_deadline_minutes);
                return (
                  <div className="mb-3 text-center">
                    <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                      Availability cutoff {durationLabel} after first response
                    </span>
                  </div>
                );
              }
            }
            return <Countdown deadline={poll.response_deadline || null} />;
          }

          // Case 5: Timer expired but poll is still open - don't show a card
          if (!isPollClosed && isExpired) {
            return null;
          }
          
          // No deadline set
          return null;
        })()}
        
        {/* Preliminary results shown ABOVE ballot when user has already voted (hidden during suggestion phase) */}
        {/* For suggestion-phase polls, only show after user has submitted rankings, not just suggestions */}
        {hasVoted && !isEditingVote && !inSuggestionPhase && hasCompletedRanking && preliminaryResultsBlock("pt-2.5")}

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
              <>
                <PollResultsDisplay results={pollResults} isPollClosed={isPollClosed} userVoteData={userVoteData} optionsMetadata={optionsMetadataLocal} />
                {pollResults.time_slot_rounds && pollResults.time_slot_rounds.length > 0 && (
                  <div className="mt-4">
                    <TimeSlotRoundsDisplay
                      allRounds={pollResults.time_slot_rounds}
                      allVoters={[]}
                      currentUserVoteId={userVoteData?.id || null}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-1.5">
                <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
              </div>
            )}
          </div>
        )}

        {/* Show follow-up/fork header for closed polls */}
        {isPollClosed && (
          <div className="mt-4">
            {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
            {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
          </div>
        )}

        {/* Voter list for closed polls - always shown after Follow-up button */}
        {isPollClosed && (
          <div className="mt-4">
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
                      {editVoteButton}
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
                        <span className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-sm font-bold mr-3 ${
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

                  {/* Voter list for open yes/no polls */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-4">
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
                        onYesClick={() => handleYesNoVote('yes')}
                        onNoClick={() => handleYesNoVote('no')}
                      />
                      <AbstainButton
                        isAbstaining={isAbstaining}
                        onClick={handleAbstain}
                      />
                    </div>
                    
                    {voteError && (
                      <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                        {voteError}
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <CompactNameField name={voterName} setName={setVoterName} />
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
              {(poll.location_mode || poll.time_mode) && (
                <SubPollField poll={poll} />
              )}
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
                      {editVoteButton}
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
                          <span className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-sm font-bold mr-3 ${
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

                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-4">
                      <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-4 text-center">
                    <YesNoAbstainButtons
                      yesNoChoice={yesNoChoice}
                      onYesClick={() => handleYesNoVote('yes')}
                      onNoClick={() => handleYesNoVote('no')}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
                    style={{
                      gridTemplateRows: yesNoChoice === 'no' ? '0fr' : '1fr',
                      opacity: yesNoChoice === 'no' ? 0 : 1,
                    }}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="mb-4">
                      <h3 className="text-lg font-semibold mb-4 text-center">Your Conditions</h3>
                      <ParticipationConditions
                        minValue={voterMinParticipants}
                        maxValue={voterMaxParticipants}
                        maxEnabled={voterMaxEnabled}
                        onMinChange={setVoterMinParticipants}
                        onMaxChange={setVoterMaxParticipants}
                        onMaxEnabledChange={setVoterMaxEnabled}
                        disabled={isSubmitting}
                        pollMinParticipants={poll.min_participants}
                        pollMaxParticipants={poll.max_participants}
                        durationMinValue={durationMinValue}
                        durationMaxValue={durationMaxValue}
                        durationMinEnabled={durationMinEnabled}
                        durationMaxEnabled={durationMaxEnabled}
                        onDurationMinChange={setDurationMinValue}
                        onDurationMaxChange={setDurationMaxValue}
                        onDurationMinEnabledChange={setDurationMinEnabled}
                        onDurationMaxEnabledChange={setDurationMaxEnabled}
                        dayTimeWindows={voterDayTimeWindows}
                        onDayTimeWindowsChange={setVoterDayTimeWindows}
                        pollDayTimeWindows={poll.day_time_windows || undefined}
                        pollDurationWindow={poll.duration_window || undefined}
                      />
                      </div>
                    </div>
                  </div>

                  {voteError && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                      <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
                    </div>
                  )}

                  <div className="mb-4">
                    <CompactNameField name={voterName} setName={setVoterName} disabled={isSubmitting} maxLength={30} />
                  </div>

                  {hasTimeWindowTooShort && (
                    <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md">
                      <p className="text-sm text-red-700 dark:text-red-300">Time window cannot be shorter than minimum duration.</p>
                    </div>
                  )}

                  {yesNoChoice === 'yes' && hasNoEnabledTimeWindows && (
                    <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-600 rounded-md">
                      <p className="text-sm text-yellow-700 dark:text-yellow-300">Enable at least one time window, or vote No.</p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleVoteClick}
                    disabled={isSubmitting || (!yesNoChoice && !isAbstaining) || (yesNoChoice === 'yes' && hasNoEnabledTimeWindows)}
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
          ) : poll.poll_type === 'time' ? (
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
                      {userVoteData?.is_abstain && (
                        <div className="mt-4 flex justify-center">
                          <div className="inline-flex items-center px-3 py-2 bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-full">
                            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">You Abstained</span>
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
                <div className="py-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">{inAvailabilityPhase ? 'Your availability:' : 'Your preferences:'}</h4>
                    {editVoteButton}
                  </div>
                  {isLoadingVoteData ? (
                    <div className="flex items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                      <svg className="animate-spin h-4 w-4 text-gray-600 dark:text-gray-400 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="font-medium text-gray-600 dark:text-gray-400">Loading your response...</span>
                    </div>
                  ) : userVoteData?.is_abstain ? (
                    <div className="flex items-center p-3 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                      <span className="font-medium text-yellow-800 dark:text-yellow-200">Abstained</span>
                    </div>
                  ) : inAvailabilityPhase && userVoteData?.voter_day_time_windows ? (
                    <div className="p-3 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg">
                      <p className="text-sm text-green-800 dark:text-green-200">Availability submitted for {userVoteData.voter_day_time_windows.length} day(s).</p>
                    </div>
                  ) : !inAvailabilityPhase && (userVoteData?.liked_slots !== null || userVoteData?.disliked_slots !== null) ? (
                    <div className="p-3 bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg text-sm text-green-800 dark:text-green-200">
                      {(userVoteData?.liked_slots?.length ?? 0) > 0 && (
                        <p>Liked: {userVoteData!.liked_slots!.map(formatTimeSlot).join(', ')}</p>
                      )}
                      {(userVoteData?.disliked_slots?.length ?? 0) > 0 && (
                        <p>Disliked: {userVoteData!.disliked_slots!.map(formatTimeSlot).join(', ')}</p>
                      )}
                      {(userVoteData?.liked_slots?.length ?? 0) === 0 && (userVoteData?.disliked_slots?.length ?? 0) === 0 && (
                        <p>Preferences submitted (all neutral).</p>
                      )}
                    </div>
                  ) : null}

                  {!isPollClosed && hasVoted && !isLoadingVoteData && (
                    <div className="mt-4">
                      <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {inAvailabilityPhase ? (
                    <>
                      {/* Availability phase: show time window picker */}
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold mb-3 text-center">Your Availability</h3>
                        <ParticipationConditions
                          hideParticipantCounters={true}
                          disabled={isSubmitting}
                          durationMinValue={durationMinValue}
                          durationMaxValue={durationMaxValue}
                          durationMinEnabled={durationMinEnabled}
                          durationMaxEnabled={durationMaxEnabled}
                          onDurationMinChange={setDurationMinValue}
                          onDurationMaxChange={setDurationMaxValue}
                          onDurationMinEnabledChange={setDurationMinEnabled}
                          onDurationMaxEnabledChange={setDurationMaxEnabled}
                          dayTimeWindows={voterDayTimeWindows}
                          onDayTimeWindowsChange={setVoterDayTimeWindows}
                          pollDayTimeWindows={poll.day_time_windows || undefined}
                          pollDurationWindow={poll.duration_window || undefined}
                        />
                      </div>

                      {inActiveAvailabilityPhase && isCreator && (
                        <div className="mb-3 flex justify-end">
                          <button
                            type="button"
                            onClick={handleCutoffAvailabilityClick}
                            disabled={isCuttingOffAvailability}
                            className="px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-md disabled:opacity-50"
                          >
                            {isCuttingOffAvailability ? 'Ending...' : 'End Availability Phase'}
                          </button>
                        </div>
                      )}

                      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                        Select time slots to fine-tune
                      </p>
                      <div className="mb-6">
                        <AbstainButton isAbstaining={isAbstaining} onClick={handleAbstain} />
                      </div>

                      {voteError && (
                        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                          <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
                        </div>
                      )}

                      <div className="mb-4">
                        <CompactNameField name={voterName} setName={setVoterName} disabled={isSubmitting} maxLength={30} />
                      </div>

                      <button
                        type="button"
                        onClick={handleVoteClick}
                        disabled={isSubmitting || (!isAbstaining && voterDayTimeWindows.filter(d => d.windows.length > 0).length === 0)}
                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        {isSubmitting ? 'Submitting...' : 'Submit Availability'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Preferences phase: tap bubbles to like/dislike time slots */}
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold mb-3 text-center">Mark Your Preferences</h3>
                        <TimeSlotBubbles
                          options={pollOptions}
                          likedSlots={likedSlots ?? []}
                          dislikedSlots={dislikedSlots ?? []}
                          onToggle={(slot, nextState) => {
                            setLikedSlots(prev => {
                              const s = new Set(prev ?? []);
                              if (nextState === 'liked') s.add(slot); else s.delete(slot);
                              return Array.from(s);
                            });
                            setDislikedSlots(prev => {
                              const s = new Set(prev ?? []);
                              if (nextState === 'disliked') s.add(slot); else s.delete(slot);
                              return Array.from(s);
                            });
                          }}
                          availabilityCounts={pollResults?.availability_counts}
                          maxAvailability={pollResults?.max_availability}
                          disabled={isSubmitting}
                        />
                      </div>

                      <div className="mb-6">
                        <AbstainButton isAbstaining={isAbstaining} onClick={handleAbstain} />
                      </div>

                      {voteError && (
                        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-md">
                          <p className="text-sm text-red-800 dark:text-red-200">{voteError}</p>
                        </div>
                      )}

                      <div className="mb-4">
                        <CompactNameField name={voterName} setName={setVoterName} disabled={isSubmitting} maxLength={30} />
                      </div>

                      <button
                        type="button"
                        onClick={handleVoteClick}
                        disabled={isSubmitting}
                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        {isSubmitting ? 'Submitting...' : 'Submit Preferences'}
                      </button>
                    </>
                  )}

                  <div className="mt-4">
                    {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                    {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
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
                      {/* Results are now shown at the top, only show abstained bubble and button here */}
                      {userAbstainedFromRanking && (
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
              ) : hasVoted && !isEditingVote && !canSubmitSuggestions && hasCompletedRanking ? (
                <div className="text-center py-3">
                  <div className="text-left">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <h4 className="font-medium flex-shrink-0">{pollOptions.length === 2 ? 'Your choice:' : 'Your ranking:'}</h4>
                        {pollOptions.length === 2 && !isLoadingVoteData && (
                          (userAbstainedFromRanking || isAbstaining) ? (
                            <span className="inline-flex items-center px-3 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-sm font-medium">
                              Abstained
                            </span>
                          ) : rankedChoices[0] ? (
                            <span className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium truncate">
                              {rankedChoices[0]}
                            </span>
                          ) : null
                        )}
                      </div>
                      {editVoteButton}
                    </div>
                    {isLoadingVoteData ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((num) => (
                          <div key={num} className="flex items-center p-2 bg-gray-50 dark:bg-gray-800 rounded animate-pulse">
                            <div className="w-6 h-6 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium mr-2">
                              <svg className="animate-spin h-3 w-3 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-24"></div>
                          </div>
                        ))}
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">{pollOptions.length === 2 ? 'Loading your choice...' : 'Loading your ranking...'}</div>
                      </div>
                    ) : pollOptions.length !== 2 ? (
                      /* 2-option choice is shown inline in the header */
                      <div className="space-y-2">
                        {userAbstainedFromRanking || isAbstaining ? (
                          <div className="flex items-center p-3 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                            <span className="w-8 h-8 flex-shrink-0 bg-yellow-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3">
                            </span>
                            <span className="font-medium text-yellow-800 dark:text-yellow-200">Abstained</span>
                          </div>
                        ) : (
                          <ReadOnlyTierCards
                            tiers={rankedChoiceTiers && rankedChoiceTiers.length > 0 ? rankedChoiceTiers : rankedChoices.map(c => [c])}
                            optionsMetadata={optionsMetadataLocal}
                          />
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* Voter list for non-suggestion ranked choice polls */}
                  {!isPollClosed && hasVoted && !isLoadingVoteData && !hasSuggestionPhase && (
                    <div className="mt-4">
                      <VoterList pollId={poll.id} refreshTrigger={voterListRefresh} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Suggestion phase UI for polls with suggestion deadline */}
                  {canSubmitSuggestions && (
                    <SuggestionVotingInterface
                      poll={poll}
                      existingSuggestions={existingSuggestions}
                      suggestionChoices={suggestionChoices}
                      setSuggestionChoices={setSuggestionChoices}
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
                      loadExistingSuggestions={loadExistingSuggestions}
                      suggestionMetadata={suggestionMetadata}
                      onSuggestionMetadataChange={setSuggestionMetadata}
                      optionsMetadata={optionsMetadataLocal}
                      showCutoffButton={!isPollClosed && isCreator && canSubmitSuggestions && existingSuggestions.length > 0}
                      onCutoffClick={handleCutoffSuggestionsClick}
                      isCuttingOff={isCuttingOffSuggestions}
                    />
                  )}

                  {/* Ranking section — independent component with its own edit state */}
                  <RankingSection
                    poll={poll}
                    pollId={pollId || ''}
                    pollOptions={pollOptions}
                    rankedChoices={rankedChoices}
                    handleRankingChange={handleRankingChange}
                    isAbstaining={isAbstaining}
                    setIsAbstaining={setIsAbstaining}
                    handleAbstain={handleAbstain}
                    isSubmitting={isSubmitting}
                    isPollClosed={!!isPollClosed}
                    hasVoted={hasVoted}
                    isEditingRanking={isEditingRanking}
                    setIsEditingRanking={setIsEditingRanking}
                    userVoteData={userVoteData}
                    isLoadingVoteData={isLoadingVoteData}
                    voterName={voterName}
                    setVoterName={setVoterName}
                    handleVoteClick={handleVoteClick}
                    voteError={voteError}
                    voterListRefresh={voterListRefresh}
                    optionsMetadata={optionsMetadataLocal}
                    canSubmitSuggestions={canSubmitSuggestions}
                    canSubmitRankings={canSubmitRankings}
                    hasSuggestionPhase={hasSuggestionPhase}
                    suggestionChoices={suggestionChoices}
                    justCancelledAbstain={justCancelledAbstain}
                    twoOptionDisplayOrder={twoOptionDisplayOrder}
                    isEditingSuggestions={isEditingVote}
                  />

                  {/* Show follow-up/fork header after submit button */}
                  <div className="mt-4">
                    {poll.follow_up_to && <FollowUpHeader followUpToPollId={poll.follow_up_to} />}
                    {poll.fork_of && <ForkHeader forkOfPollId={poll.fork_of} />}
                  </div>
                </>
              )}
            </div>
          )}



          {/* Preliminary results shown BELOW ballot when user hasn't voted yet (hidden during suggestion phase) */}
          {/* For suggestion-phase polls, hide until user has submitted rankings */}
          {(!hasVoted || isEditingVote) && !inSuggestionPhase && !hasSuggestionPhase && preliminaryResultsBlock("mt-6")}

          {/* Follow ups to this poll section */}
          {followUpPolls.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold mb-4 text-center text-gray-900 dark:text-white">Follow ups to this poll</h2>
              <PollList polls={followUpPolls} showSections={false} />
            </div>
          )}


          {/* Poll Management Buttons - Close, Cutoff Suggestions, Reopen, and Forget Poll */}
          {(hasPollDataState || (isPollClosed && process.env.NODE_ENV === 'development') || (!isPollClosed && isCreator)) && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <PollManagementButtons
                showCloseButton={!isPollClosed && isCreator}
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
        isOpen={showCutoffConfirmModal}
        onConfirm={handleCutoffSuggestions}
        onCancel={() => setShowCutoffConfirmModal(false)}
        title="Cutoff Suggestions"
        message="Are you sure you want to end the suggestion phase now? No more suggestions will be accepted and ranking will begin immediately."
        confirmText="Cutoff Now"
        cancelText="Cancel"
        confirmButtonClass="bg-amber-500 hover:bg-amber-600 text-white"
      />

      <ConfirmationModal
        isOpen={showCutoffAvailabilityConfirmModal}
        onConfirm={handleCutoffAvailability}
        onCancel={() => setShowCutoffAvailabilityConfirmModal(false)}
        title="End Availability Phase"
        message="Are you sure you want to end the availability phase now? Time slots will be generated and preference ranking will begin immediately."
        confirmText="End Now"
        cancelText="Cancel"
        confirmButtonClass="bg-amber-500 hover:bg-amber-600 text-white"
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




    </>
  );
}
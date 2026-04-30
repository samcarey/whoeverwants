"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAppPrefetch } from "@/lib/prefetch";
import CompactNameField from "@/components/CompactNameField";
import QuestionResultsDisplay from "@/components/QuestionResults";
import SuggestionVotingInterface from "@/components/SuggestionVotingInterface";
import RankingSection from "@/components/RankingSection";
import ConfirmationModal from "@/components/ConfirmationModal";

import OptionLabel from "@/components/OptionLabel";
import YesNoAbstainButtons from "@/components/YesNoAbstainButtons";
import AbstainButton from "@/components/AbstainButton";
import { Question, QuestionResults, OptionsMetadata, DayTimeWindow, Poll } from "@/lib/types";
import { apiGetQuestionResults, apiGetVotes, apiSubmitPollVotes, apiCutoffPollSuggestions, apiGetQuestionById, apiGetPollById, QUESTION_VOTES_CHANGED_EVENT, type PollVoteItem } from "@/lib/api";
import { invalidateQuestion, getCachedQuestionById, getCachedQuestionResults, getCachedVotes } from "@/lib/questionCache";
import RankableOptions from "@/components/RankableOptions";

import { isCreatedByThisBrowser, getCreatorSecret, recordQuestionCreation, storeSeenQuestionOptions, getSeenQuestionOptions } from "@/lib/browserQuestionAccess";
import { hasQuestionData } from "@/lib/forgetQuestion";
import { getUserName, saveUserName } from "@/lib/userProfile";
import { usePageTitle } from "@/lib/usePageTitle";
import QuestionDetails from "@/components/QuestionDetails";
import SearchRadiusBubble from "@/components/SearchRadiusBubble";
import { loadQuestionDraft, saveQuestionDraft, clearQuestionDraft, QuestionDraft } from "@/lib/ballotDraft";
import { formatDurationLabel, isVoterAvailableForSlot } from "@/lib/timeUtils";
import { isLocationLikeCategory } from "@/components/TypeFieldInput";
import { hasVotedOnQuestion, getStoredVoteId, setStoredVoteId, setVotedQuestionFlag } from "@/lib/votedQuestionsStorage";
import { buildVoteData, buildPollVoteItem, type BallotInputs } from "./QuestionBallot/voteDataBuilders";
import TimeBallotSection from "./QuestionBallot/TimeBallotSection";

interface QuestionBallotProps {
  question: Question;
  // Phase 5b: wrapper-level fields (response_deadline, is_closed,
  // close_reason, prephase_deadline / legacy suggestion_deadline) live on the
  // parent poll. Caller passes it so this component can source those
  // fields directly per the addressability paradigm.
  poll: Poll;
  createdDate: string;
  questionId: string | null;
  // When true, this component skips rendering YesNoResults itself — the
  // caller (thread view) is rendering them in a stable DOM position above
  // the expand clip to avoid winner-card flicker across expand/collapse.
  externalYesNoResults?: boolean;
  // Thread-view cards pre-mount QuestionBallot in a collapsed grid clip.
  // When the card collapses while the ballot is being edited, we cancel
  // the edit so it doesn't persist for the next expansion.
  isExpanded?: boolean;
  // Suppresses the inner <QuestionDetails> when the thread-page section label
  // already shows question.details.
  partOfPollGroup?: boolean;
  // Phase 3.4 follow-up B: parent poll wrapper owns Submit + voter
  // name + confirmation copy. When set, QuestionBallot hides its inline
  // Submit/voter-name and exposes triggerSubmit() via ref.
  wrapperHandlesSubmit?: boolean;
  externalVoterName?: string;
  setExternalVoterName?: (name: string) => void;
  // Mirrors QuestionBallot's "would the inline Submit show + what does it
  // say" so the wrapper's Submit visibility/label match the original
  // gating across initial-vote / voted / edit-mode transitions.
  onWrapperSubmitStateChange?: (questionId: string, state: { visible: boolean; label: string }) => void;
}

export type PrepareBatchVoteItemResult =
  | {
      ok: true;
      item: PollVoteItem;
      commit: (vote: import("@/lib/api").ApiVote) => void;
      fail: (errorMessage: string) => void;
    }
  | { skip: true }
  | { ok: false; error: string };

export interface QuestionBallotHandle {
  triggerSubmit: () => void;
  prepareBatchVoteItem: () => PrepareBatchVoteItemResult;
}

const QuestionBallot = forwardRef<QuestionBallotHandle, QuestionBallotProps>(function QuestionBallot({ question, poll, createdDate, questionId, externalYesNoResults, isExpanded = true, partOfPollGroup = false, wrapperHandlesSubmit = false, externalVoterName, setExternalVoterName, onWrapperSubmitStateChange }: QuestionBallotProps, ref) {
  // Set the page title in the template header
  usePageTitle(question.title);

  const router = useRouter();
  const { prefetch } = useAppPrefetch();
  const searchParams = useSearchParams();
  const isNewQuestion = searchParams.get("new") === "true";
  const [questionUrl, setQuestionUrl] = useState("");
  const [rankedChoices, setRankedChoices] = useState<string[]>([]);
  // Tiered ballot (equal-ranking groups). Each inner array is a tier of
  // options tied for the same rank. When it has no ties, every inner array
  // is a singleton and this is equivalent to rankedChoices.
  const [rankedChoiceTiers, setRankedChoiceTiers] = useState<string[][]>([]);
  // Time question preferences: liked/disliked slot sets (null = not yet submitted)
  const [likedSlots, setLikedSlots] = useState<string[] | null>(null);
  const [dislikedSlots, setDislikedSlots] = useState<string[] | null>(null);
  const [optionsInitialized, setOptionsInitialized] = useState(false);
  const [yesNoChoice, setYesNoChoice] = useState<'yes' | 'no' | null>(null);
  const [isAbstaining, setIsAbstaining] = useState(false);
  const [suggestionChoices, setSuggestionChoices] = useState<string[]>([]);
  const [suggestionMetadata, setSuggestionMetadata] = useState<OptionsMetadata>({});
  const [searchRadius, setSearchRadius] = useState(25);
  const [optionsMetadataLocal, setOptionsMetadataLocal] = useState<OptionsMetadata | null>(question.options_metadata ?? null);

  // Sync local metadata when question prop changes (e.g., navigating between questions)
  useEffect(() => {
    setOptionsMetadataLocal(question.options_metadata ?? null);
  }, [question.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [existingSuggestions, setExistingSuggestions] = useState<string[]>([]);
  const [justCancelledAbstain, setJustCancelledAbstain] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [questionResults, setQuestionResults] = useState<QuestionResults | null>(() => {
    // Initialize from cache so the first render shows results immediately
    // (no loading flicker during view transitions).
    if (typeof window === 'undefined') return null;
    return getCachedQuestionResults(question.id) ?? null;
  });
  const [loadingResults, setLoadingResults] = useState(false);
  const [isCuttingOffSuggestions, setIsCuttingOffSuggestions] = useState(false);
  const [showCutoffConfirmModal, setShowCutoffConfirmModal] = useState(false);
  const [suggestionDeadlineOverride, setSuggestionDeadlineOverride] = useState<string | null>(null);
  const [optionsOverride, setOptionsOverride] = useState<string[] | null>(null);
  const [questionClosed, setQuestionClosed] = useState(poll.is_closed ?? false);
  // Don't automatically assume question was reopened just because deadline passed
  // Only set manuallyReopened when explicitly reopened by creator action
  const [manuallyReopened, setManuallyReopened] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [showVoteConfirmModal, setShowVoteConfirmModal] = useState(false);
  const [userVoteId, setUserVoteId] = useState<string | null>(null);
  const [userVoteData, setUserVoteData] = useState<any>(null);
  const [isLoadingVoteData, setIsLoadingVoteData] = useState(false);
  const [isEditingVote, setIsEditingVote] = useState(false); // For suggestion editing
  const [isEditingRanking, setIsEditingRanking] = useState(false); // For ranking editing (independent)

  useEffect(() => {
    if (!isExpanded) {
      setIsEditingVote(false);
      setIsEditingRanking(false);
    }
  }, [isExpanded]);
  const [hasQuestionDataState, setHasQuestionDataState] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  // Options the user saw when they last voted — used to detect newly added suggestions
  const [seenQuestionOptions, setSeenQuestionOptions] = useState<string[]>([]);

  // Suggestion phase helpers: a ranked_choice question with suggestion_deadline or suggestion_deadline_minutes
  // has an optional suggestion collection phase before ranking begins.
  // When suggestion_deadline_minutes is set but suggestion_deadline is null, the timer hasn't started yet
  // (waiting for first suggestion). This is still considered "in suggestion phase".
  // Phase 5b: prephase_deadline lives on the poll wrapper (was
  // questions.suggestion_deadline). Local naming sticks with "suggestion" since
  // the rest of this component already uses that vocabulary.
  const wrapperSuggestionDeadline = poll.prephase_deadline ?? null;
  const hasSuggestionPhase = question.question_type === 'ranked_choice' && !!(wrapperSuggestionDeadline || question.suggestion_deadline_minutes);
  const effectiveSuggestionDeadline = suggestionDeadlineOverride || wrapperSuggestionDeadline;
  const suggestionTimerStarted = !!effectiveSuggestionDeadline;
  const inSuggestionPhase = hasSuggestionPhase && (
    !suggestionTimerStarted // Timer hasn't started yet (waiting for first suggestion)
    || (currentTime ? currentTime < new Date(effectiveSuggestionDeadline!) : true)
  );
  const canSubmitSuggestions = hasSuggestionPhase && inSuggestionPhase;
  // Migration 098: allow_pre_ranking lives on the poll wrapper now.
  const canSubmitRankings = question.question_type === 'ranked_choice' && (
    !hasSuggestionPhase || !inSuggestionPhase || poll.allow_pre_ranking !== false
  );

  // Time question phase helpers: availability phase while options haven't been generated yet
  const inAvailabilityPhase = question.question_type === 'time' && (!optionsOverride?.length) && (!question.options || question.options.length === 0);
  const availabilityTimerStarted = !!(suggestionDeadlineOverride || wrapperSuggestionDeadline);
  // Whether the user has completed ranking (or abstained) — for suggestion-phase questions,
  // this distinguishes "voted with suggestions only" from "voted with rankings"
  const hasCompletedRanking = !hasSuggestionPhase || userVoteData?.ranked_choices?.length > 0 || userVoteData?.is_abstain || userVoteData?.is_ranking_abstain;
  const userAbstainedFromRanking = !!(userVoteData?.is_abstain || userVoteData?.is_ranking_abstain);

  // Reference location is stored on every question (auto-filled from the creator's profile),
  // so the "Near X" badge only makes sense for categories where proximity is part of the decision.
  const showReferenceLocation =
    !!question.reference_location_label &&
    isLocationLikeCategory(question.category ?? '');

  const [internalVoterName, setInternalVoterName] = useState<string>("");
  // When the wrapper owns the voter name input (Phase 3.4 follow-up B),
  // mirror its value/setter so submitVote keeps reading `voterName` and
  // CompactNameField callsites keep calling `setVoterName` unchanged.
  const voterName = wrapperHandlesSubmit && externalVoterName !== undefined ? externalVoterName : internalVoterName;
  const setVoterName: (name: string) => void = wrapperHandlesSubmit && setExternalVoterName
    ? setExternalVoterName
    : setInternalVoterName;

  const autoCloseTriggeredRef = useRef(false);
  const fetchResultsInFlight = useRef(false);
  const fetchResultsLastCall = useRef(0);

  // Time-question voter state — initialized with question's constraints, draft restored in useEffect
  const [voterDayTimeWindows, setVoterDayTimeWindows] = useState<any[]>(question.day_time_windows || []);
  const [durationMinValue, setDurationMinValue] = useState<number | null>(question.duration_window?.minValue ?? 1);
  const [durationMaxValue, setDurationMaxValue] = useState<number | null>(question.duration_window?.maxValue ?? 2);
  const [durationMinEnabled, setDurationMinEnabled] = useState(question.duration_window?.minEnabled ?? false);
  const [durationMaxEnabled, setDurationMaxEnabled] = useState(question.duration_window?.maxEnabled ?? false);

  // Restore ballot draft from localStorage on mount (time questions only)
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    if (question.question_type !== 'time') return;
    try {
      const votedQuestions = JSON.parse(localStorage.getItem('votedQuestions') || '{}');
      if (votedQuestions[question.id]) return;
    } catch { /* ignore */ }
    const draft = loadQuestionDraft(question.poll_id ?? null, question.id);
    if (!draft) return;
    if (draft.isAbstaining !== undefined) setIsAbstaining(draft.isAbstaining);
    if (draft.voterDayTimeWindows !== undefined) setVoterDayTimeWindows(draft.voterDayTimeWindows);
    if (draft.durationMinValue !== undefined) setDurationMinValue(draft.durationMinValue);
    if (draft.durationMaxValue !== undefined) setDurationMaxValue(draft.durationMaxValue);
    if (draft.durationMinEnabled !== undefined) setDurationMinEnabled(draft.durationMinEnabled);
    if (draft.durationMaxEnabled !== undefined) setDurationMaxEnabled(draft.durationMaxEnabled);
  }, [question.id, question.poll_id, question.question_type]);

  // Persist ballot draft to localStorage (debounced to avoid rapid writes during wheel/counter interactions)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (question.question_type !== 'time' || hasVoted) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveQuestionDraft(question.poll_id ?? null, question.id, {
        isAbstaining,
        voterDayTimeWindows,
        durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled,
      });
    }, 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [question.id, question.poll_id, question.question_type, hasVoted, isAbstaining,
      voterDayTimeWindows, durationMinValue, durationMaxValue,
      durationMinEnabled, durationMaxEnabled]);

  const isQuestionExpired = useMemo(() => {
    // Use server-safe check
    const now = currentTime || new Date();
    return poll.response_deadline && new Date(poll.response_deadline) <= now;
  }, [poll.response_deadline, currentTime]);

  const isQuestionClosed = useMemo(() => {
    // If manually reopened, stay open regardless of deadline
    if (manuallyReopened && !questionClosed) return false;

    // Otherwise, use normal logic: manual close OR deadline expiration
    return questionClosed || isQuestionExpired;
  }, [questionClosed, isQuestionExpired, manuallyReopened]);

  // Track response count for preliminary results
  const [responseCount, setResponseCount] = useState<number>(question.response_count ?? 0);

  // Whether preliminary results should be shown (open question, threshold met)
  // Migration 098: these settings live on the poll wrapper now.
  const showPrelimResults = useMemo(() => {
    if (isQuestionClosed) return false; // Closed questions show results via the normal path
    if (poll.show_preliminary_results === false) return false;
    const minResp = poll.min_responses ?? 1;
    return responseCount >= minResp;
  }, [isQuestionClosed, poll.show_preliminary_results, poll.min_responses, responseCount]);

  // Mark question as voted: writes both the votedQuestions flag and questionVoteIds in
  // one call. Listeners that re-read localStorage on QUESTION_VOTES_CHANGED_EVENT
  // (e.g. the thread page's awaiting-response border) need both writes
  // visible before the dispatch.
  const markQuestionAsVoted = useCallback((questionId: string, voteId?: string, abstained?: boolean) => {
    setVotedQuestionFlag(questionId, abstained ? 'abstained' : true);
    if (voteId) setStoredVoteId(questionId, voteId);
  }, []);

  const fetchVoteData = useCallback(async (voteId: string) => {
    try {
      const allVotes = await apiGetVotes(question.id);
      const vote = allVotes.find(v => v.id === voteId);
      return vote || null;
    } catch {
      return null;
    }
  }, [question.id]);

  const fetchQuestionResults = useCallback(async () => {
    // Prevent rapid-fire calls: skip if already in-flight or called within last 2s.
    // The 1-second timer and multiple effects can trigger this in quick succession
    // (especially after Fast Refresh), leading to 429 rate-limit errors.
    const now = Date.now();
    if (fetchResultsInFlight.current || now - fetchResultsLastCall.current < 2000) return;
    fetchResultsInFlight.current = true;
    fetchResultsLastCall.current = now;

    // Skip the loading state if we already have cached data — the fetch will
    // return the same cached value instantly, but the setLoadingResults(true)
    // → setLoadingResults(false) cycle causes a mid-transition flicker.
    const hasCached = !!getCachedQuestionResults(question.id);
    if (!hasCached) setLoadingResults(true);
    try {
      const results = await apiGetQuestionResults(question.id);
      setQuestionResults(results);
    } catch (error) {
      console.error('Error fetching question results:', error);
    } finally {
      if (!hasCached) setLoadingResults(false);
      fetchResultsInFlight.current = false;
    }
  }, [question.id, question.question_type]);

  // Initialize currentTime on client side to avoid hydration issues
  useEffect(() => {
    setCurrentTime(new Date());

    // Load existing suggestions for questions with suggestion phase
    if (hasSuggestionPhase) {
      loadExistingSuggestions();
      // Also fetch results to show vote counts for suggestion questions
      fetchQuestionResults();
    }
  }, [question.question_type, fetchQuestionResults]);

  // Fetch preliminary results when threshold is met
  useEffect(() => {
    if (showPrelimResults && !questionResults) {
      fetchQuestionResults();
    }
  }, [showPrelimResults, questionResults, fetchQuestionResults]);

  // Load existing suggestions from other votes
  const loadExistingSuggestions = async (excludeUserVote = false) => {
    try {
      // Fetch all votes and filter for suggestion votes with suggestions
      const allVotes = await apiGetVotes(question.id);
      const votes = allVotes
        .filter(v => v.suggestions && v.suggestions.length > 0 && !v.is_abstain)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 100);

      const allSuggestions = new Set<string>();
      
      // Add starting options from question creation
      if (question.options && Array.isArray(question.options)) {
        question.options.forEach((option: string) => allSuggestions.add(option));
      }
      
      // For suggestion questions, to handle edited votes properly, we use only the latest vote
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
          vote.suggestions.forEach((sug: string) => allSuggestions.add(sug));
        }
      });

      const suggestionsArray = Array.from(allSuggestions);
      setExistingSuggestions(suggestionsArray);
    } catch (error) {
      console.error('Error loading suggestions:', error);
    }
  };

  // Initialize ranked choices with randomized options - runs only once
  useEffect(() => {
    if (question.question_type === 'ranked_choice' && question.options && !optionsInitialized) {
      // Don't initialize if we already have choices from localStorage
      if (hasVoted && rankedChoices.length > 0) {
        setOptionsInitialized(true);
        return;
      }

      // Parse options if they're stored as JSON string
      const parsedOptions = typeof question.options === 'string'
        ? JSON.parse(question.options)
        : question.options;

      // For 2-option questions, start with no selection (user must choose)
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
  }, [question.question_type, question.options, optionsInitialized, hasVoted, rankedChoices.length]);

  // Load the options seen at last vote time from localStorage (for new-options detection)
  useEffect(() => {
    if (typeof window !== 'undefined' && hasSuggestionPhase) {
      setSeenQuestionOptions(getSeenQuestionOptions(question.id));
    }
  }, [question.id, hasSuggestionPhase]);

  // Clean up URL parameter when new question is shown
  useEffect(() => {
    if (isNewQuestion) {
      // Remove the ?new=true parameter from the URL without refreshing the page
      const newUrl = window.location.pathname + window.location.hash;
      router.replace(newUrl, { scroll: false });
    }
  }, [isNewQuestion, router]);

  // Effect to load vote data when question loads or when hasVoted changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Use the current page URL (always full UUID now)
      setQuestionUrl(window.location.href.split('?')[0]);
    }
    
    // Phase 5: auto-created follow-up questions inherited the parent's
    // creator_secret via questions.follow_up_to; that column is gone. Sub-questions
    // of a poll all share the wrapper's creator_secret, which is
    // recorded per question id on the create-question page when the poll
    // is created. No fallback inheritance is needed.
    setIsCreator(isCreatedByThisBrowser(question.id));

    // Check if browser has any data for this question
    setHasQuestionDataState(hasQuestionData(question.id));
    
    // Load vote data if user has voted (either from localStorage check or hasVoted state)
    // Only load if this browser has actually voted - don't assume ownership of other users' votes
    const shouldLoadVoteData = hasVoted || hasVotedOnQuestion(question.id);
    
    if (shouldLoadVoteData) {
      setHasVoted(true);
      
      // Get the vote ID if available
      const voteId = getStoredVoteId(question.id);
      setUserVoteId(voteId);
      
      // Fetch vote data from database if we have a vote ID. Without one we
      // can't tell which row in `votes` belongs to this browser, so we skip
      // — the suggestion-phase branch used to fall back to fetchLatestUserVote
      // but that was disabled to avoid cross-browser vote contamination.
      if (voteId) {
        // Skip the loading state if we already have cached votes — the fetch
        // will return instantly but the loading→loaded re-render cycle causes
        // a flicker during view transitions.
        const hasCachedData = !!getCachedVotes(question.id);
        if (!hasCachedData) setIsLoadingVoteData(true);

        fetchVoteData(voteId).then(voteData => {
          if (voteData) {
            setUserVoteData(voteData);

            // CRITICAL FIX: Set userVoteId from the fetched vote data
            // This ensures that vote editing updates the existing record instead of creating new ones
            if (voteData && 'id' in voteData && voteData.id) {
              setUserVoteId(voteData.id);
              // Backfill questionVoteIds localStorage so the question list can show personalized badges
              if (!getStoredVoteId(question.id)) setStoredVoteId(question.id, voteData.id);
            }

            // For questions with suggestion phase, fetch results to show vote counts even when question is open
            if (hasSuggestionPhase && !isQuestionClosed) {
              fetchQuestionResults();
            }

            // Set UI state based on vote data from database columns
            // is_ranking_abstain always restores abstain state.
            // is_abstain only restores for non-suggestion questions — in suggestion questions
            // it means "abstained from suggestions", not "abstained from ranking".
            const shouldRestoreAbstain = voteData.is_ranking_abstain || (voteData.is_abstain && !hasSuggestionPhase);
            setIsAbstaining(shouldRestoreAbstain);
            if (voteData.is_abstain) {
              // Don't set choices for abstain votes
            } else if (question.question_type === 'yes_no' && voteData.yes_no_choice) {
              setYesNoChoice(voteData.yes_no_choice as 'yes' | 'no');
            } else if (question.question_type === 'ranked_choice') {
              if (voteData.ranked_choices) setRankedChoices(voteData.ranked_choices);
              if (voteData.ranked_choice_tiers) {
                setRankedChoiceTiers(voteData.ranked_choice_tiers);
              } else if (voteData.ranked_choices) {
                // No tiers present — synthesize singleton tiers so the
                // current state is internally consistent.
                setRankedChoiceTiers(voteData.ranked_choices.map((c: string) => [c]));
              }
              if (voteData.suggestions) setSuggestionChoices(voteData.suggestions);
            } else if (question.question_type === 'time') {
              // Restore time question availability windows
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
          if (!hasCachedData) setIsLoadingVoteData(false);
        });
      }
    }
  }, [question.id, question.question_type, hasVoted, fetchVoteData, isNewQuestion]);

  // Fetch results when question closes or for time questions in preferences phase
  useEffect(() => {
    const isClosed = questionClosed || (poll.response_deadline && new Date(poll.response_deadline) <= new Date());
    const shouldFetchForTimeQuestion = question.question_type === 'time' && !inAvailabilityPhase;

    if (isClosed || shouldFetchForTimeQuestion) {
      fetchQuestionResults();
    }
  }, [questionClosed, poll.response_deadline, question.question_type, fetchQuestionResults, inAvailabilityPhase]);

  // Load saved user name. Skip when the wrapper owns the voter name input
  // (Phase 3.4 follow-up B) — the wrapper seeds its own state from
  // getUserName() and we don't want to fire its setter from inside the
  // child component on mount.
  useEffect(() => {
    if (wrapperHandlesSubmit) return;
    const savedName = getUserName();
    if (savedName) {
      setVoterName(savedName);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time timer to check for question expiration
  useEffect(() => {
    if (!poll.response_deadline || questionClosed) {
      return; // No deadline or already manually closed
    }

    const deadline = new Date(poll.response_deadline);
    const updateTimer = () => {
      const now = new Date();
      setCurrentTime(now);

      // If question just expired, automatically fetch results.
      if (now >= deadline && !isQuestionClosed) {
        fetchQuestionResults();
      }
    };

    // Update immediately
    updateTimer();

    // Set up interval to check every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [poll.response_deadline, questionClosed, isQuestionClosed, fetchQuestionResults, question.question_type, question.id]);

  // Real-time subscription to listen for question status changes (with questioning fallback)
  useEffect(() => {
    
    let questionInterval: NodeJS.Timeout | null = null;
    
    // Questioning fallback function — questions the Python API for status changes.
    // Phase 5b: is_closed lives on the poll wrapper, so fetch it from
    // there. Response count still lives on the per-question QuestionResponse, so
    // grab it via apiGetQuestionById.
    const questionForChanges = async () => {
      try {
        const [wrapper, questionData] = await Promise.all([
          question.poll_id ? apiGetPollById(question.poll_id).catch(() => null) : Promise.resolve(null),
          apiGetQuestionById(question.id).catch(() => null),
        ]);

        if (wrapper?.is_closed && !questionClosed) {
          setQuestionClosed(true);
          setManuallyReopened(false);
          fetchQuestionResults();
        }
        if (questionData?.response_count != null) {
          setResponseCount(questionData.response_count);
        }
      } catch (error) {
        console.error('Questioning error:', error);
      }
    };

    // No real-time subscription — use questioning to detect status changes
    if (!questionClosed) {
      questionInterval = setInterval(questionForChanges, 5000);
      questionForChanges(); // Check immediately
    }

    return () => {
      if (questionInterval) {
        clearInterval(questionInterval);
      }
    };
  }, [question.id, questionClosed, fetchQuestionResults]);

  const handleRankingChange = useCallback((newRankedChoices: string[], newTiers: string[][]) => {
    setRankedChoices(newRankedChoices);
    setRankedChoiceTiers(newTiers);
    // Clear the flag when user interacts with rankings after cancelling abstain
    if (justCancelledAbstain) {
      setJustCancelledAbstain(false);
    }
  }, [justCancelledAbstain]);

  // Memoize parsed options to prevent re-parsing on every render
  // During suggestion phase (question.options is null), derive options from suggestion_counts
  const questionOptions = useMemo(() => {
    if (optionsOverride) {
      return optionsOverride;
    }
    if (question.options) {
      return typeof question.options === 'string' ? JSON.parse(question.options) : question.options;
    }
    if (hasSuggestionPhase && questionResults?.suggestion_counts) {
      return questionResults.suggestion_counts.map((sc: { option: string }) => sc.option);
    }
    return [];
  }, [optionsOverride, question.options, hasSuggestionPhase, questionResults?.suggestion_counts]);

  // For the time-question preferences phase, only present slots the voter said they're
  // available for. A voter who hasn't submitted availability sees every slot.
  const voterAvailability = userVoteData?.voter_day_time_windows;
  const preferenceSlotsForVoter = useMemo(() => {
    if (question.question_type !== 'time') return questionOptions as string[];
    if (!voterAvailability || !Array.isArray(voterAvailability) || voterAvailability.length === 0) {
      return questionOptions as string[];
    }
    return (questionOptions as string[]).filter(slot =>
      isVoterAvailableForSlot(slot, voterAvailability)
    );
  }, [question.question_type, questionOptions, voterAvailability]);

  // Options added since the user last voted — shown as a "new options available" alert.
  // Only meaningful for users who have already submitted rankings (no-op for suggestion-only voters).
  // Also excludes options the user themselves suggested so their own submissions don't trigger it.
  const newOptions = useMemo(() => {
    if (!hasSuggestionPhase || !hasVoted || isQuestionClosed || seenQuestionOptions.length === 0) return [];
    if (!userVoteData?.ranked_choices?.length) return []; // hasn't ranked yet — banner irrelevant
    const ownSuggestions: string[] = userVoteData?.suggestions ?? [];
    return (questionOptions as string[]).filter(
      o => !seenQuestionOptions.includes(o) && !ownSuggestions.includes(o)
    );
  }, [hasSuggestionPhase, hasVoted, isQuestionClosed, seenQuestionOptions, questionOptions, userVoteData]);

  // Randomize display order for 2-option questions (client-only to avoid hydration mismatch)
  const [twoOptionDisplayOrder, setTwoOptionDisplayOrder] = useState<string[]>([]);
  useEffect(() => {
    if (questionOptions.length === 2) {
      setTwoOptionDisplayOrder(
        Math.random() < 0.5 ? [questionOptions[0], questionOptions[1]] : [questionOptions[1], questionOptions[0]]
      );
    }
  }, [questionOptions]);

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
      if (question.question_type === 'ranked_choice') {
        setRankedChoices([]);
        setSuggestionChoices([]);
      } else if (question.question_type === 'yes_no') {
        setYesNoChoice(null); // Clear yes/no choice to prevent both appearing selected
      }
    } else {
      // Cancelling abstain
      if (question.question_type === 'ranked_choice') {
        setJustCancelledAbstain(true);
      }
    }
  };

  const handleCutoffSuggestionsClick = () => {
    if (isCuttingOffSuggestions || !isCreator) return;
    const creatorSecret = getCreatorSecret(question.id);
    if (!creatorSecret) {
      alert('You do not have permission to cutoff suggestions.');
      return;
    }
    setShowCutoffConfirmModal(true);
  };

  const handleCutoffSuggestions = async () => {
    setShowCutoffConfirmModal(false);
    if (isCuttingOffSuggestions || !isCreator) return;
    const creatorSecret = getCreatorSecret(question.id);
    if (!creatorSecret) return;
    const pollId = question.poll_id;
    if (!pollId) {
      console.error('Cannot cutoff suggestions without poll_id');
      return;
    }

    setIsCuttingOffSuggestions(true);
    try {
      const wrapper = await apiCutoffPollSuggestions(pollId, creatorSecret);
      const updatedQuestion = wrapper.questions.find((sp) => sp.id === question.id) ?? null;
      invalidateQuestion(question.id);
      // Phase 5b: prephase_deadline lives on the poll wrapper. Use the
      // wrapper's value as the new override so the UI exits suggestion phase
      // immediately.
      setSuggestionDeadlineOverride(wrapper.prephase_deadline || new Date().toISOString());
      if (updatedQuestion) {
        if (updatedQuestion.options) {
          const opts = typeof updatedQuestion.options === 'string' ? JSON.parse(updatedQuestion.options) : updatedQuestion.options;
          setOptionsOverride(opts);
        }
        await fetchQuestionResults();
      }
    } catch (error) {
      console.error('Error cutting off suggestions:', error);
      alert('Failed to cutoff suggestions. Please try again.');
    } finally {
      setIsCuttingOffSuggestions(false);
    }
  };

  // Snapshot the per-question state into the shape `buildVoteData` expects.
  // Both `submitVote` and `prepareBatchVoteItem` call this so they read
  // exactly the same inputs.
  const getBallotInputs = (): BallotInputs => ({
    questionId: question.id,
    questionType: question.question_type,
    isAbstaining,
    yesNoChoice,
    rankedChoices,
    rankedChoiceTiers,
    suggestionChoices,
    suggestionMetadata,
    hasSuggestionPhase,
    canSubmitSuggestions,
    inAvailabilityPhase,
    voterDayTimeWindows,
    durationMinValue,
    durationMaxValue,
    durationMinEnabled,
    durationMaxEnabled,
    likedSlots,
    dislikedSlots,
    voterName,
    questionOptions,
    userVoteData,
  });

  const handleVoteClick = async () => {
    // Either suggestion editing or ranking editing counts as "editing"
    const isAnyEditing = isEditingVote || isEditingRanking;

    // During suggestion phase with pre-ranking, submitting rankings after the initial
    // suggestion vote is an implicit edit (updating the existing vote with rankings).
    // Also applies after suggestion cutoff: user submitted suggestions but hasn't ranked yet.
    // Includes users who abstained from suggestions (is_abstain) — they should still be able to rank.
    const hasNotRankedYet = hasVoted && hasSuggestionPhase && !userVoteData?.ranked_choices?.length && !userVoteData?.is_ranking_abstain;
    // For time questions in preferences phase: not yet reacted if liked_slots is still null
    const hasNotReactedYet = question.question_type === 'time' && !inAvailabilityPhase && hasVoted
      && userVoteData?.liked_slots === null && userVoteData?.disliked_slots === null && !userVoteData?.is_abstain;
    const isImplicitEdit = hasVoted && !isAnyEditing && (
      (canSubmitSuggestions && canSubmitRankings) || hasNotRankedYet || hasNotReactedYet
    );
    if (isImplicitEdit) {
      setIsEditingVote(true);
    }

    if (isSubmitting || (hasVoted && !isAnyEditing && !isImplicitEdit) || isQuestionClosed) {
      return;
    }

    // Validate vote choice first
    if (question.question_type === 'yes_no' && !yesNoChoice && !isAbstaining) {
      setVoteError("Please select Yes, No, or Abstain");
      return;
    }

    if (question.question_type === 'ranked_choice' && !isAbstaining) {
      const filteredRankedChoices = rankedChoices.filter(choice => choice && choice.trim().length > 0);
      const filteredSuggestions = suggestionChoices.filter(choice => choice && choice.trim().length > 0);
      if (filteredRankedChoices.length === 0 && (!canSubmitSuggestions || filteredSuggestions.length === 0)) {
        if (canSubmitSuggestions) {
          // During suggestion phase, submitting with nothing selected is an implicit abstain
          setIsAbstaining(true);
        } else {
          setVoteError("Please rank at least one option or select Abstain");
          return;
        }
      }
    }

    setVoteError(null);
    setShowVoteConfirmModal(true);
  };



  const submitVote = async () => {
    setShowVoteConfirmModal(false);

    const isAnyEditingForSubmit = isEditingVote || isEditingRanking;
    if (isSubmitting || (hasVoted && !isAnyEditingForSubmit) || isQuestionClosed) {
      return;
    }

    setIsSubmitting(true);
    setVoteError(null);

    try {
      const buildResult = buildVoteData(getBallotInputs());
      if (!buildResult.ok) {
        setVoteError(buildResult.error);
        setIsSubmitting(false);
        return;
      }
      const voteData = buildResult.voteData;

      const isEditing = (isEditingVote || isEditingRanking) && !!userVoteId;
      const pollId = question.poll_id ?? null;
      const trimmedVoterName = voterName.trim() || null;
      const submitErrorMessage = isEditing
        ? "Failed to update vote. Please try again."
        : "Failed to submit vote. Please try again.";

      let voteId: string | undefined;

      if (pollId) {
        // Route through the unified poll endpoint per the architectural
        // rule that vote submission is always atomic across the poll
        // (see CLAUDE.md → Poll System). Single-item batch from this
        // ballot — the poll has only one question being touched here.
        const item = buildPollVoteItem(voteData, question.id, userVoteId, {
          questionType: question.question_type,
          canSubmitSuggestions,
          isEditing,
        });
        try {
          const returned = await apiSubmitPollVotes(pollId, {
            voter_name: trimmedVoterName,
            items: [item],
          });
          const v = returned.find(r => r.question_id === question.id);
          if (!v) throw new Error('Vote response missing for question');
          voteId = v.id;
          if (isEditing) setUserVoteData(v);
        } catch (submitErr) {
          console.error('Vote submission error:', submitErr);
          console.error('Vote data that failed:', voteData);
          setVoteError(submitErrorMessage);
          return;
        }
      } else {
        // Phase 5: every question has a poll wrapper, so this branch is
        // unreachable. Surface as an error if the wrapper is somehow missing.
        console.error('Cannot submit vote without poll_id', { questionId: question.id });
        setVoteError(submitErrorMessage);
        return;
      }

      invalidateQuestion(question.id);
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

      // Sync voted/abstained status to localStorage. Must happen BEFORE the
      // QUESTION_VOTES_CHANGED_EVENT dispatch below so listeners that re-read
      // localStorage (e.g. the thread page's awaiting-response border) see
      // the updated value. Also runs on edits so abstain-via-edit transitions
      // get recorded (the flag is a one-way set otherwise).
      markQuestionAsVoted(question.id, voteId, isAbstaining);
      if (!isEditingVote) {
        setHasQuestionDataState(true);
      }

      window.dispatchEvent(new CustomEvent(QUESTION_VOTES_CHANGED_EVENT, { detail: { questionId: question.id } }));

      // Start deferred availability deadline on first time question availability submission
      if (question.question_type === 'time' && inAvailabilityPhase && !availabilityTimerStarted && question.suggestion_deadline_minutes && !isEditingVote) {
        const newDeadline = new Date(Date.now() + question.suggestion_deadline_minutes * 60 * 1000);
        setSuggestionDeadlineOverride(newDeadline.toISOString());
      }

      // Refresh suggestion list for questions with suggestion phase
      if (hasSuggestionPhase) {
        // If this is the first suggestion on a deferred-deadline question, start the timer
        if (!suggestionTimerStarted && question.suggestion_deadline_minutes && !isEditingVote) {
          const newDeadline = new Date(Date.now() + question.suggestion_deadline_minutes * 60 * 1000);
          setSuggestionDeadlineOverride(newDeadline.toISOString());
        }
        // Reset abstain so the ranking ballot is usable after suggestion submission
        // (abstaining from suggestions shouldn't block ranking)
        if (isAbstaining && canSubmitRankings) {
          setIsAbstaining(false);
        }
        setTimeout(async () => {
          await loadExistingSuggestions(false);
          await fetchQuestionResults();
        }, 500);
      }

      // Record which options the user saw at vote/edit time so we can detect newly added
      // suggestions on future visits and show a "new options available" banner.
      if (hasSuggestionPhase && questionOptions.length > 0) {
        storeSeenQuestionOptions(question.id, questionOptions);
        setSeenQuestionOptions(questionOptions);
      }
      // Clear ballot draft now that vote is saved to the database
      clearQuestionDraft(question.poll_id ?? null, question.id);
      
      // Save the user's name if they provided one
      if (voterName.trim()) {
        saveUserName(voterName.trim());
      }
      
      setIsEditingVote(false);
      setIsEditingRanking(false);

      // Refresh results after editing votes with suggestions
      if (hasSuggestionPhase && (isEditingVote || isEditingRanking)) {
        await fetchQuestionResults();
      }

      // If the poll is closed or preliminary results threshold met, fetch results
      if (isQuestionClosed || showPrelimResults) {
        await fetchQuestionResults();
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setVoteError("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // handleVoteClick captures fresh state every render; the ref-stashed
  // closure lets the imperative handle stay stable while still calling
  // the latest version. Wrapper-level Submit calls triggerSubmit() which
  // routes through the same validation + ConfirmationModal flow the
  // per-question button used to invoke.
  const handleVoteClickRef = useRef(handleVoteClick);
  handleVoteClickRef.current = handleVoteClick;

  // Validation + voteData/PollVoteItem construction is shared with
  // submitVote via voteDataBuilders. The two callers diverge only on the
  // POST-build side effects: submitVote calls the API itself; this returns
  // a deferred commit/fail pair the wrapper invokes after batching.
  const prepareBatchVoteItem = (): PrepareBatchVoteItemResult => {
    const isAnyEditing = isEditingVote || isEditingRanking;
    if (isSubmitting || (hasVoted && !isAnyEditing) || isQuestionClosed) {
      return { skip: true };
    }

    const buildResult = buildVoteData(getBallotInputs());
    if (!buildResult.ok) {
      setVoteError(buildResult.error);
      return { ok: false, error: buildResult.error };
    }
    const { voteData, effectiveIsAbstaining } = buildResult;
    setVoteError(null);

    const isEditing = isAnyEditing && !!userVoteId;
    const item = buildPollVoteItem(voteData, question.id, userVoteId, {
      questionType: question.question_type,
      canSubmitSuggestions,
      isEditing,
    });

    // Snapshot per-question state at build time so the post-submit
    // side effects in commit() don't read whatever the user edited
    // between button-tap and API-resolution.
    const capturedSuggestionMetadata = suggestionMetadata;
    const capturedIsAbstaining = effectiveIsAbstaining;
    const capturedIsEditing = isEditing;
    const capturedQuestionOptions = questionOptions;
    const capturedSuggestionTimerStarted = suggestionTimerStarted;
    const capturedAvailabilityTimerStarted = availabilityTimerStarted;

    // commit handles QuestionBallot-internal state only. The wrapper-level
    // confirmPollSubmit owns shared cross-question work — votedQuestions /
    // questionVoteIds localStorage, QUESTION_VOTES_CHANGED_EVENT dispatch, and
    // saveUserName — so commit doesn't duplicate them on the batch path.
    const commit = (vote: import("@/lib/api").ApiVote) => {
      invalidateQuestion(question.id);
      setHasVoted(true);
      setUserVoteId(vote.id);
      if (capturedIsEditing) setUserVoteData(vote);
      if (!capturedIsEditing) {
        setResponseCount(prev => prev + 1);
      }
      if (capturedSuggestionMetadata && Object.keys(capturedSuggestionMetadata).length > 0) {
        setOptionsMetadataLocal(prev => ({ ...prev, ...capturedSuggestionMetadata }));
      }
      if (!capturedIsEditing) {
        setHasQuestionDataState(true);
      }
      if (question.question_type === 'time' && inAvailabilityPhase && !capturedAvailabilityTimerStarted && question.suggestion_deadline_minutes && !capturedIsEditing) {
        const newDeadline = new Date(Date.now() + question.suggestion_deadline_minutes * 60 * 1000);
        setSuggestionDeadlineOverride(newDeadline.toISOString());
      }
      if (hasSuggestionPhase) {
        if (!capturedSuggestionTimerStarted && question.suggestion_deadline_minutes && !capturedIsEditing) {
          const newDeadline = new Date(Date.now() + question.suggestion_deadline_minutes * 60 * 1000);
          setSuggestionDeadlineOverride(newDeadline.toISOString());
        }
        if (capturedIsAbstaining && canSubmitRankings) {
          setIsAbstaining(false);
        }
        setTimeout(async () => {
          await loadExistingSuggestions(false);
          await fetchQuestionResults();
        }, 500);
      }
      if (hasSuggestionPhase && capturedQuestionOptions.length > 0) {
        storeSeenQuestionOptions(question.id, capturedQuestionOptions);
        setSeenQuestionOptions(capturedQuestionOptions);
      }
      clearQuestionDraft(question.poll_id ?? null, question.id);
      setIsEditingVote(false);
      setIsEditingRanking(false);
      if (hasSuggestionPhase && capturedIsEditing) {
        void fetchQuestionResults();
      }
      if (isQuestionClosed || showPrelimResults) {
        void fetchQuestionResults();
      }
    };

    const fail = (errorMessage: string) => {
      setVoteError(errorMessage);
    };

    return { ok: true, item, commit, fail };
  };
  const prepareBatchVoteItemRef = useRef(prepareBatchVoteItem);
  prepareBatchVoteItemRef.current = prepareBatchVoteItem;

  useImperativeHandle(ref, () => ({
    triggerSubmit: () => { void handleVoteClickRef.current(); },
    prepareBatchVoteItem: () => prepareBatchVoteItemRef.current(),
  }), []);

  const wrapperShouldShowSubmit = useMemo(() => {
    if (!wrapperHandlesSubmit) return false;
    if (isQuestionClosed) return false;
    if (question.question_type === 'yes_no') return false; // external rendering uses tap-to-change
    if (hasVoted && !isEditingVote && !isEditingRanking) return false;
    return true;
  }, [wrapperHandlesSubmit, isQuestionClosed, question.question_type, hasVoted, isEditingVote, isEditingRanking]);

  const wrapperSubmitLabel = useMemo(() => {
    if (question.question_type === 'time') {
      return inAvailabilityPhase ? 'Submit Availability' : 'Submit Preferences';
    }
    return 'Submit Vote';
  }, [question.question_type, inAvailabilityPhase]);

  useEffect(() => {
    if (!wrapperHandlesSubmit || !onWrapperSubmitStateChange) return;
    onWrapperSubmitStateChange(question.id, { visible: wrapperShouldShowSubmit, label: wrapperSubmitLabel });
  }, [question.id, wrapperShouldShowSubmit, wrapperSubmitLabel, wrapperHandlesSubmit, onWrapperSubmitStateChange]);

  const editVoteButton = !isQuestionClosed && !isLoadingVoteData ? (
    <button
      onClick={() => setIsEditingVote(true)}
      className="px-3 py-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-medium text-sm rounded-md transition-colors flex-shrink-0"
    >
      Edit
    </button>
  ) : null;

  // When the thread view renders yes/no results externally (to keep the
  // winner card DOM-stable across expand/collapse), the internal copies of
  // QuestionResultsDisplay would duplicate them — so skip them entirely for
  // yes_no questions in that context.
  const suppressYesNoHere = !!externalYesNoResults && question.question_type === 'yes_no';

  const preliminaryResultsBlock = (className: string) => (
    showPrelimResults && !isQuestionClosed && !suppressYesNoHere ? (
      <div className={className}>
        {loadingResults ? (
          <div className="flex justify-center items-center py-3">
            <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : questionResults ? (
          <QuestionResultsDisplay results={questionResults} isQuestionClosed={false} userVoteData={userVoteData} optionsMetadata={optionsMetadataLocal} />
        ) : null}
      </div>
    ) : null
  );

  return (
    <>
      <div className="question-content">
        {/* Creation info lives on the compact card header (creator name + relative time);
             full timestamp is available via the tooltip on that time. */}

        {/* Question details (expandable). Suppressed in multi-question groups
             because the thread-page section label already renders
             question.details (used there as the disambiguating context). */}
        {question.details && !partOfPollGroup && <QuestionDetails details={question.details} />}

        {showReferenceLocation && (
          <div className="mb-3 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Near {question.reference_location_label}</span>
            </div>
            {canSubmitSuggestions && isLocationLikeCategory(question.category ?? '') && (
              <SearchRadiusBubble searchRadius={searchRadius} onSearchRadiusChange={setSearchRadius} />
            )}
          </div>
        )}

        {/* Question status card — only renders deferred-deadline notices. Closed
             states (max-capacity, manual, expired) are surfaced in the
             long-press modal so the card body stays focused on results. */}
        {(() => {
          const deadline = poll.response_deadline ? new Date(poll.response_deadline) : null;
          const now = currentTime || new Date();
          const isExpired = deadline && deadline <= now;

          // Case 1 (max_capacity), 2 (manual close), 3 (expired + closed) all
          // render nothing here — the modal owns those labels now.

          // Case 4: Question open, not expired. Live countdown is rendered
          // above the card in the thread view; only deferred-deadline
          // notices render here, since they convey run-duration info
          // ("X minutes after first submission") that the above-card
          // "Taking Suggestions" label doesn't surface.
          if (!isQuestionClosed && !isExpired && deadline) {
            const mins = question.suggestion_deadline_minutes;
            const isDeferredAvailability =
              question.question_type === 'time' &&
              inAvailabilityPhase &&
              !suggestionDeadlineOverride &&
              !wrapperSuggestionDeadline &&
              mins;
            if (isDeferredAvailability) {
              return (
                <div className="mb-3 text-center">
                  <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    {`Availability cutoff ${formatDurationLabel(mins!)} after first response`}
                  </span>
                </div>
              );
            }
            return null;
          }

          // Case 5: Timer expired but question is still open - don't show a card
          if (!isQuestionClosed && isExpired) {
            return null;
          }
          
          // No deadline set
          return null;
        })()}
        
        {/* Preliminary results shown ABOVE ballot when user has already voted (hidden during suggestion phase) */}
        {/* For suggestion-phase questions, only show after user has submitted rankings, not just suggestions */}
        {hasVoted && !isEditingVote && !inSuggestionPhase && hasCompletedRanking && preliminaryResultsBlock("")}

        {/* For closed questions, show results first */}
        {isQuestionClosed && !suppressYesNoHere && (
          <div>
            {loadingResults ? (
              <div className="flex justify-center items-center py-3">
                <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            ) : questionResults ? (
              <QuestionResultsDisplay results={questionResults} isQuestionClosed={isQuestionClosed} userVoteData={userVoteData} optionsMetadata={optionsMetadataLocal} />
            ) : (
              <div className="text-center py-1.5">
                <p className="text-gray-600 dark:text-gray-400">Unable to load results.</p>
              </div>
            )}
          </div>
        )}

        {/* Question Content Based on Type */}
        {question.question_type === 'yes_no' ? (
          <div>
              {suppressYesNoHere ? (
                // All yes_no UI (voting, changing, results) is rendered by
                // the thread view's external YesNoResults — nothing to show
                // here for any state.
                null
              ) : isQuestionClosed ? (
                null
              ) : hasVoted && !isEditingVote ? (
                null
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

                </>
              )}
            </div>
          ) : question.question_type === 'time' ? (
            <TimeBallotSection
              question={question}
              isQuestionClosed={!!isQuestionClosed}
              loadingResults={loadingResults}
              questionResults={questionResults}
              userVoteData={userVoteData}
              isLoadingVoteData={isLoadingVoteData}
              hasVoted={hasVoted}
              isEditingVote={isEditingVote}
              editVoteButton={editVoteButton}
              inAvailabilityPhase={inAvailabilityPhase}
              isSubmitting={isSubmitting}
              voteError={voteError}
              isAbstaining={isAbstaining}
              handleAbstain={handleAbstain}
              durationMinValue={durationMinValue}
              durationMaxValue={durationMaxValue}
              durationMinEnabled={durationMinEnabled}
              durationMaxEnabled={durationMaxEnabled}
              setDurationMinValue={setDurationMinValue}
              setDurationMaxValue={setDurationMaxValue}
              setDurationMinEnabled={setDurationMinEnabled}
              setDurationMaxEnabled={setDurationMaxEnabled}
              voterDayTimeWindows={voterDayTimeWindows}
              setVoterDayTimeWindows={setVoterDayTimeWindows}
              preferenceSlotsForVoter={preferenceSlotsForVoter}
              likedSlots={likedSlots}
              setLikedSlots={setLikedSlots}
              dislikedSlots={dislikedSlots}
              setDislikedSlots={setDislikedSlots}
              voterName={voterName}
              setVoterName={setVoterName}
              wrapperHandlesSubmit={!!wrapperHandlesSubmit}
              handleVoteClick={handleVoteClick}
            />
          ) : (
            <div>
              {isQuestionClosed ? (
                <div>
                  {loadingResults ? (
                    <div className="flex justify-center items-center py-8">
                      <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : questionResults ? (
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
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setIsEditingVote(true)}
                    disabled={isLoadingVoteData}
                    className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70 disabled:opacity-50"
                  >
                    Your Ballot
                  </button>
                </div>
              ) : (
                <>
                  {/* Suggestion phase UI for questions with suggestion deadline */}
                  {canSubmitSuggestions && (
                    <SuggestionVotingInterface
                      question={question}
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
                      isQuestionClosed={!!isQuestionClosed}
                      isCreator={isCreator}
                      hasVoted={hasVoted}
                      isEditingVote={isEditingVote}
                      setIsEditingVote={setIsEditingVote}
                      userVoteData={userVoteData}
                      isLoadingVoteData={isLoadingVoteData}
                      questionResults={questionResults}
                      loadingResults={loadingResults}
                      loadExistingSuggestions={loadExistingSuggestions}
                      suggestionMetadata={suggestionMetadata}
                      onSuggestionMetadataChange={setSuggestionMetadata}
                      optionsMetadata={optionsMetadataLocal}
                      showCutoffButton={!isQuestionClosed && isCreator && canSubmitSuggestions && existingSuggestions.length > 0}
                      onCutoffClick={handleCutoffSuggestionsClick}
                      isCuttingOff={isCuttingOffSuggestions}
                      searchRadius={searchRadius}
                      wrapperHandlesSubmit={wrapperHandlesSubmit}
                    />
                  )}

                  {/* Ranking section — independent component with its own edit state */}
                  <RankingSection
                    question={question}
                    suggestionDeadline={effectiveSuggestionDeadline ?? null}
                    responseDeadline={poll.response_deadline ?? null}
                    questionId={questionId || ''}
                    questionOptions={questionOptions}
                    rankedChoices={rankedChoices}
                    handleRankingChange={handleRankingChange}
                    isAbstaining={isAbstaining}
                    setIsAbstaining={setIsAbstaining}
                    handleAbstain={handleAbstain}
                    isSubmitting={isSubmitting}
                    isQuestionClosed={!!isQuestionClosed}
                    hasVoted={hasVoted}
                    isEditingRanking={isEditingRanking}
                    setIsEditingRanking={setIsEditingRanking}
                    userVoteData={userVoteData}
                    isLoadingVoteData={isLoadingVoteData}
                    voterName={voterName}
                    setVoterName={setVoterName}
                    handleVoteClick={handleVoteClick}
                    voteError={voteError}
                    optionsMetadata={optionsMetadataLocal}
                    canSubmitSuggestions={canSubmitSuggestions}
                    canSubmitRankings={canSubmitRankings}
                    hasSuggestionPhase={hasSuggestionPhase}
                    suggestionChoices={suggestionChoices}
                    justCancelledAbstain={justCancelledAbstain}
                    twoOptionDisplayOrder={twoOptionDisplayOrder}
                    isEditingSuggestions={isEditingVote}
                    newOptions={newOptions}
                    wrapperHandlesSubmit={wrapperHandlesSubmit}
                  />

                </>
              )}
            </div>
          )}

          {/* Preliminary results shown BELOW ballot when user hasn't voted yet (hidden during suggestion phase) */}
          {/* For suggestion-phase questions, hide until user has submitted rankings */}
          {/* When editing an existing ranked_choice ballot, skip the below block — the user is focused on revising their ranks. */}
          {(!hasVoted || isEditingVote) && !inSuggestionPhase && !hasSuggestionPhase && !(isEditingVote && question.question_type === 'ranked_choice') && preliminaryResultsBlock("mt-6")}

      </div>

      <ConfirmationModal
        isOpen={showVoteConfirmModal}
        onConfirm={submitVote}
        onCancel={() => setShowVoteConfirmModal(false)}
        title="Submit Vote"
        message={question.question_type === 'yes_no' 
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
        isOpen={showCutoffConfirmModal}
        onConfirm={handleCutoffSuggestions}
        onCancel={() => setShowCutoffConfirmModal(false)}
        title="Cutoff Suggestions"
        message="Are you sure you want to end the suggestion phase now? No more suggestions will be accepted and ranking will begin immediately."
        confirmText="Cutoff Now"
        cancelText="Cancel"
        confirmButtonClass="bg-amber-500 hover:bg-amber-600 text-white"
      />

    </>
  );
});

export default QuestionBallot;
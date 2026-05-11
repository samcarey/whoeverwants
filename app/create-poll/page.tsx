"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  apiCreatePoll,
  apiFindDuplicateQuestion,
  CreateQuestionParams,
} from "@/lib/api";
import type { Poll, OptionsMetadata, Question } from "@/lib/types";
import TypeFieldInput, { BUILT_IN_TYPES, FOR_FIELD_PLACEHOLDERS, getBuiltInType, isLocationLikeCategory } from "@/components/TypeFieldInput";
import ModalPortal from "@/components/ModalPortal";
import ConfirmationModal from "@/components/ConfirmationModal";
import { useAppPrefetch } from "@/lib/prefetch";
import { generateCreatorSecret, getCreatorSecret, recordQuestionCreation } from "@/lib/browserQuestionAccess";
import { getUserName, saveUserName, getUserMinResponses, saveUserMinResponses } from "@/lib/userProfile";
import { debugLog } from "@/lib/debugLogger";
import OptionsInput from "@/components/OptionsInput";
import CompactMinResponsesField from "@/components/CompactMinResponsesField";
import { VOTING_CUTOFF_OPTIONS } from "@/components/VotingCutoffConditionsModal";
import VotingCutoffField from "@/components/VotingCutoffField";
import MinimumParticipationModal from "@/components/MinimumParticipationModal";
import TimeQuestionFields from "@/components/TimeQuestionFields";
import DayTimeWindowsInput from "@/components/DayTimeWindowsInput";
import DaysSelector from "@/components/DaysSelector";
import ReferenceLocationInput from "@/components/ReferenceLocationInput";
import type { DayTimeWindow, TimeWindow } from "@/lib/types";
import { windowDurationMinutes, formatDurationLabel, formatDeadlineLabel } from "@/lib/timeUtils";
import { getGroupHrefForPoll, resolveGroupRootRouteId } from "@/lib/groupUtils";
import * as questionBackTarget from "@/lib/questionBackTarget";
import { cachePoll, getCachedGroupIdForQuestion, invalidatePoll, updateAccessiblePollsIfFresh } from "@/lib/questionCache";
import {
  POLL_PENDING_EVENT,
  POLL_HYDRATED_EVENT,
  POLL_FAILED_EVENT,
  type PollPendingDetail,
  type PollHydratedDetail,
  type PollFailedDetail,
} from "@/lib/eventChannels";
import { DRAFT_POLL_PORTAL_ID, GROUP_ID_ATTR } from "@/lib/groupDomMarkers";
import {
  pollLookup,
  shortenOption,
  shortenLocation,
  validateRankedChoiceOptions,
  BASE_DEADLINE_OPTIONS,
  FRACTIONAL_CUTOFF_OPTIONS,
  ABSOLUTE_CUTOFF_OPTIONS,
  DEV_DEADLINE_OPTIONS,
  type QuestionDraft,
  emptyDraft,
  draftDbQuestionType,
  draftToQuestionParams,
  anyDraftUsesPrephase,
  anyDraftIsRankedChoice,
  sharedDraftContext,
  synthesizePlaceholderPoll,
} from "./createPollHelpers";
export const dynamic = 'force-dynamic';

// Matches the rendered height of a single-line <input> with py-2 padding.
// Used for the Details textarea initial height and auto-grow reset.
const SINGLE_LINE_INPUT_HEIGHT = 42;

// Order matches the dropdown inside the modal so muscle memory carries over.
const BUBBLE_ENTRIES: Array<{ value: string; label: string; icon?: string }> = [
  ...BUILT_IN_TYPES,
  { value: 'custom', label: 'Other' },
];

export function CreateQuestionContent() {
  const { prefetch } = useAppPrefetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const followUpToParam = searchParams.get('followUpTo');
  const duplicateOfParam = searchParams.get('duplicate');
  const voteFromSuggestionParam = searchParams.get('voteFromSuggestion');

  // Track relationship to source question as part of form state
  const [followUpTo, setFollowUpTo] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [voteFromSuggestion, setVoteFromSuggestion] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  // The legacy URL `?mode=time` switch is gone — pick the time question via
  // the category dropdown ("Time" built-in). `questionType` still tracks
  // whether the form is in time-question mode locally so the duplicate flow
  // can pre-load a copied question of any type.
  const [questionType, setQuestionType] = useState<'question' | 'time'>('question');
  const [options, setOptions] = useState<string[]>(['']);
  const [durationMinValue, setDurationMinValue] = useState<number | null>(1);
  const [durationMaxValue, setDurationMaxValue] = useState<number | null>(2);
  const [durationMinEnabled, setDurationMinEnabled] = useState(true);
  const [durationMaxEnabled, setDurationMaxEnabled] = useState(true);
  const [dayTimeWindows, setDayTimeWindows] = useState<DayTimeWindow[]>([]);
  const [minimumParticipation, setMinimumParticipation] = useState<number>(95);
  const [showMinParticipationModal, setShowMinParticipationModal] = useState(false);
  const [isDaysPickerOpen, setIsDaysPickerOpen] = useState(false);
  // Preserves windows for removed days so re-adding the same day restores
  // them (mirrors the cache TimeQuestionFields owns for its embedded days
  // section). Survives across re-renders via useRef.
  const removedDaysCache = useRef<Record<string, TimeWindow[]>>({});
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
  const [creatorName, setCreatorName] = useState<string>("");
  const [isAutoTitle, setIsAutoTitle] = useState(true);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const loadedTitleRef = useRef<string | null>(null);

  const [suggestionCutoff, setSuggestionCutoff] = useState("0.5x");
  const [customSuggestionDate, setCustomSuggestionDate] = useState('');
  const [customSuggestionTime, setCustomSuggestionTime] = useState('');
  const [allowPreRanking, setAllowPreRanking] = useState(true);
  const [details, setDetails] = useState("");
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const [category, setCategory] = useState<string>('custom');
  const [forField, setForField] = useState("");
  const [optionsMetadata, setOptionsMetadata] = useState<OptionsMetadata>({});
  // Reference location for proximity-based search
  const [refLatitude, setRefLatitude] = useState<number | undefined>(undefined);
  const [refLongitude, setRefLongitude] = useState<number | undefined>(undefined);
  const [refLocationLabel, setRefLocationLabel] = useState("");
  const [searchRadius, setSearchRadius] = useState(25);
  const [minResponses, setMinResponses] = useState<number>(1);
  const [showPreliminaryResults, setShowPreliminaryResults] = useState(true);

  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const hasNoOptions = options.filter(o => o.trim()).length === 0;
  const isSuggestionMode = questionType === 'question' && category !== 'yes_no' && category !== 'time' && hasNoOptions;

  // Generate a title from the current form state
  const generateTitle = useCallback(() => {
    const builtIn = getBuiltInType(category);
    const limit = 40;
    const catLabel = builtIn?.label || (category !== 'custom' ? category : 'one');
    const trimmedFor = forField.trim();
    const forSuffix = trimmedFor ? ` for ${trimmedFor}` : '';

    const joinWithOr = (items: string[]) => {
      if (items.length === 2) return `${items[0]} or ${items[1]}?`;
      return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}?`;
    };
    const buildTitle = (items: string[]) => {
      const included = [items[0]];
      for (let i = 1; i < items.length; i++) {
        const isLast = i === items.length - 1;
        const candidate = isLast
          ? joinWithOr([...included, items[i]])
          : `${[...included, items[i]].join(', ')}, or ...?`;
        if (candidate.length > limit && included.length >= 2) break;
        included.push(items[i]);
      }
      const allFit = included.length === items.length;
      const text = allFit
        ? joinWithOr(included)
        : `${included.join(', ')}, or ...?`;
      return { text, allFit };
    };
    const buildFromOptions = (filled: string[], fallback: string) => {
      if (filled.length === 0) return fallback;
      if (filled.length === 1) return filled[0];
      const full = buildTitle(filled);
      if (full.allFit) return full.text;
      return `Which ${catLabel}?`;
    };

    const appendFor = (base: string) => {
      if (!forSuffix || !base) return base;
      // Insert " for X" before trailing "?" if present
      if (base.endsWith('?')) return base.slice(0, -1) + forSuffix + '?';
      return base + forSuffix;
    };

    if (questionType === 'question') {
      if (category === 'yes_no') {
        return '';
      }
      if (category === 'time') {
        return appendFor("Time?");
      }
      const shorten = isLocationLikeCategory(category) ? shortenLocation : shortenOption;
      const filled = options.filter(o => o.trim()).map(shorten);
      if (filled.length === 0) {
        // Suggestion mode (no options) — use category name as title
        const prefix = category === 'location' ? 'Place'
          : builtIn?.label || (category !== 'custom' ? category : '');
        if (prefix) return appendFor(prefix + '?');
        // No category but has "for" field → "Options for X?"
        if (forSuffix) return `Options${forSuffix}?`;
        return '';
      }
      return appendFor(buildFromOptions(filled, 'Quick Vote'));
    }

    // time
    return appendFor("Time?");
  }, [questionType, category, options, forField]);

  // Auto-update title when form fields change (if user hasn't manually edited)
  useEffect(() => {
    if (isAutoTitle) {
      const generated = generateTitle();
      setTitle(generated.slice(0, 100));
    }
  }, [isAutoTitle, generateTitle]);

  // Detect auto-generated titles from copied questions (handles old snapshots without is_auto_title)
  useEffect(() => {
    const loaded = loadedTitleRef.current;
    if (!isAutoTitle && loaded) {
      const generated = generateTitle();
      if (generated && loaded === generated.slice(0, 100)) {
        loadedTitleRef.current = null;
        setIsAutoTitle(true);
      }
    }
  }, [isAutoTitle, generateTitle]);

  // Handle category changes
  const handleCategoryChange = useCallback((val: string) => {
    setCategory(val);
    if (val === 'yes_no') {
      setIsAutoTitle(false);
      setTitle('');
    } else {
      setIsAutoTitle(true);
    }
  }, []);

  // Set default deadline based on question type
  const isPreferenceQuestion = questionType === 'question' && category !== 'yes_no';
  const prevIsPreferenceQuestionRef = useRef(isPreferenceQuestion);
  useEffect(() => {
    if (isPreferenceQuestion === prevIsPreferenceQuestionRef.current) return;
    prevIsPreferenceQuestionRef.current = isPreferenceQuestion;
    if (isPreferenceQuestion) {
      // Switching to preference/suggestion question: default to 4 weeks, force auto-title
      if (BASE_DEADLINE_OPTIONS.some(o => o.value === deadlineOption)) {
        setDeadlineOption('1week');
      }
      setIsAutoTitle(true);
    } else {
      // Switching away: revert to inline default if it's a voting cutoff modal option
      if (VOTING_CUTOFF_OPTIONS.some(o => o.value === deadlineOption) && deadlineOption !== 'custom') {
        setDeadlineOption('10min');
      }
    }
  }, [isPreferenceQuestion, deadlineOption]);

  // Resolve voting deadline to minutes (null if no deadline or custom date/time)
  const getVotingDeadlineMinutes = useCallback((): number | null => {
    if (deadlineOption === 'none') return null;
    if (deadlineOption === 'custom') {
      if (!customDate || !customTime) return null;
      const dt = new Date(`${customDate}T${customTime}`);
      const diffMs = dt.getTime() - Date.now();
      return diffMs > 0 ? diffMs / 60000 : null;
    }
    const opt = VOTING_CUTOFF_OPTIONS.find(o => o.value === deadlineOption)
      || BASE_DEADLINE_OPTIONS.find(o => o.value === deadlineOption);
    return opt?.minutes ?? null;
  }, [deadlineOption, customDate, customTime]);

  // Resolve suggestion cutoff to minutes based on current selection
  const getSuggestionCutoffMinutes = useCallback((): number | null => {
    const frac = FRACTIONAL_CUTOFF_OPTIONS.find(o => o.value === suggestionCutoff);
    if (frac) {
      const votingMin = getVotingDeadlineMinutes();
      if (votingMin == null) return null;
      return votingMin * frac.fraction;
    }
    const abs = ABSOLUTE_CUTOFF_OPTIONS.find(o => o.value === suggestionCutoff);
    if (abs) return abs.minutes;
    // 'custom' — computed from customSuggestionDate/Time at submit time
    return null;
  }, [suggestionCutoff, getVotingDeadlineMinutes]);

  // Single-unit label using truncation: uses the largest unit where the value is >= 2,
  // except minutes which is always used below 2 hours.
  const formatMinutesLabel = (minutes: number): string => {
    if (minutes < 1) return `${Math.floor(minutes * 60)} sec`;
    const hours = minutes / 60;
    if (hours < 2) return `${Math.floor(minutes)} min`;
    const days = hours / 24;
    if (days < 2) return `${Math.floor(hours)} hr`;
    const weeks = days / 7;
    if (weeks < 2) { const d = Math.floor(days); return `${d} day${d !== 1 ? 's' : ''}`; }
    const months = days / 30;
    if (months < 2) { const w = Math.floor(weeks); return `${w} week${w !== 1 ? 's' : ''}`; }
    const m = Math.floor(months);
    return `${m} month${m !== 1 ? 's' : ''}`;
  };

  // Save form state to localStorage. The per-question fields (title, options,
  // category, etc.) double-duty as both the in-progress top-modal form and
  // the source-of-truth for new draft creation; we still persist them so a
  // mid-edit refresh is recoverable. `drafts` is the committed list.
  const saveFormState = useCallback(() => {
    if (typeof window !== 'undefined') {
      const formState = {
        title,
        questionType,
        details,
        options,
        deadlineOption,
        customDate,
        customTime,
        creatorName,
        isAutoTitle,
        category,
        forField,
        durationMinValue,
        durationMaxValue,
        durationMinEnabled,
        durationMaxEnabled,
        dayTimeWindows,
        minResponses,
        showPreliminaryResults,
        allowPreRanking,
        drafts,
      };
      localStorage.setItem('questionFormState', JSON.stringify(formState));
    }
  }, [title, questionType, details, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, category, forField, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, minResponses, showPreliminaryResults, allowPreRanking, drafts]);

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
      const saved = localStorage.getItem('questionFormState');
      if (saved) {
        try {
          const formState = JSON.parse(saved);
          setTitle(formState.title || '');
          if (formState.isAutoTitle === false) setIsAutoTitle(false);
          if (formState.questionType === 'time') setQuestionType('time');
          setDetails(formState.details || '');
          setOptions(formState.options || ['']);
          setDeadlineOption(formState.deadlineOption || '10min');
          setCustomDate(formState.customDate || '');
          setCustomTime(formState.customTime || '');
          setCreatorName(formState.creatorName || '');
          if (formState.category) setCategory(formState.category);
          if (formState.forField) setForField(formState.forField);

          if (formState.durationMinValue !== undefined) setDurationMinValue(formState.durationMinValue);
          if (formState.durationMaxValue !== undefined) setDurationMaxValue(formState.durationMaxValue);
          if (formState.durationMinEnabled !== undefined) setDurationMinEnabled(formState.durationMinEnabled);
          if (formState.durationMaxEnabled !== undefined) setDurationMaxEnabled(formState.durationMaxEnabled);
          if (formState.dayTimeWindows !== undefined) setDayTimeWindows(formState.dayTimeWindows);
          if (formState.minResponses !== undefined) setMinResponses(formState.minResponses);
          if (formState.showPreliminaryResults !== undefined) setShowPreliminaryResults(formState.showPreliminaryResults);
          if (formState.allowPreRanking !== undefined) setAllowPreRanking(formState.allowPreRanking);
          if (Array.isArray(formState.drafts)) setDrafts(formState.drafts);

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
      localStorage.removeItem('questionFormState');

      // Also clean up any special question creation data
      if (voteFromSuggestion) {
        localStorage.removeItem(`vote-from-suggestion-${voteFromSuggestion}`);
      }
      if (duplicateOf) {
        localStorage.removeItem(`duplicate-data-${duplicateOf}`);
      }
    }
  };

  // Determine question type based on form selection and options
  const getQuestionType = (): 'yes_no' | 'ranked_choice' | 'time' => {
    if (questionType === 'time' || category === 'time') return 'time';
    if (category === 'yes_no') return 'yes_no';
    return 'ranked_choice';
  };



  // Whether any staged draft (or the in-progress inline form, when the
  // modal is open) uses the poll-level prephase cutoff (suggestion mode
  // or time question). Drives whether the suggestion/availability-cutoff
  // field and the "allow pre-vote" toggle are rendered in Settings.
  // The inline form is gated on isModalOpen because confirm/dismiss
  // reset it to empty defaults (questionType='question',
  // category='custom', no options) which would otherwise look like
  // "suggestion mode" and wrongly surface the prephase fields after
  // every staged draft.
  const inlineFormUsesPrephase = isModalOpen && (
    isSuggestionMode || questionType === 'time' || category === 'time'
  );
  const pollHasPrephase = anyDraftUsesPrephase(drafts) || inlineFormUsesPrephase;

  // Migration 098: poll-level results-display + ranked-choice settings.
  // The min-responses + show-results pair is meaningful iff the poll
  // contains at least one ranked_choice question.
  const inlineFormIsRankedChoice = isModalOpen
    && questionType === 'question'
    && category !== 'yes_no'
    && category !== 'time';
  const pollHasRankedChoice = anyDraftIsRankedChoice(drafts) || inlineFormIsRankedChoice;

  // Validates the whole poll at submit time: drafts exist + poll-level
  // cutoffs are sane. Per-question fields are validated when each draft is
  // staged (and the in-progress form is validated separately at submit).
  const getValidationErrorFor = (effectiveDrafts: QuestionDraft[]): string | null => {
    if (effectiveDrafts.length === 0) {
      return "Add at least one question.";
    }
    if (deadlineOption === "custom") {
      if (!customDate || !customTime) {
        return "Please select both a custom deadline date and time.";
      }
      const customDateTime = new Date(`${customDate}T${customTime}`);
      if (customDateTime <= new Date()) {
        return "Custom deadline must be in the future.";
      }
    }
    // Mirror the server's same-kind / distinct-context check so the user gets
    // an immediate error inside the draft card instead of a silent 400 after
    // the optimistic UI has already cleared the form. Server logic
    // (server/routers/polls.py: _validate_request) groups by
    // (question_type, category) and requires the per-question contexts in
    // each group to be unique (case-insensitive); empty contexts collide
    // with each other.
    if (effectiveDrafts.length > 1) {
      const groups = new Map<string, string[]>();
      for (const d of effectiveDrafts) {
        const dbType = draftDbQuestionType(d);
        const cat = dbType === 'ranked_choice' && d.category !== 'custom' ? d.category : '';
        const key = `${dbType}:${cat.toLowerCase()}`;
        const ctx = d.forField.trim().toLowerCase();
        const list = groups.get(key) ?? [];
        list.push(ctx);
        groups.set(key, list);
      }
      for (const ctxs of groups.values()) {
        if (ctxs.length <= 1) continue;
        if (new Set(ctxs).size !== ctxs.length) {
          return "Questions of the same kind need a distinct “for X” context to tell them apart.";
        }
      }
    }
    if (anyDraftUsesPrephase(effectiveDrafts)) {
      if (suggestionCutoff === 'custom') {
        if (!customSuggestionDate || !customSuggestionTime) {
          return "Please select both a suggestion cutoff date and time.";
        }
        const sugDt = new Date(`${customSuggestionDate}T${customSuggestionTime}`);
        if (sugDt <= new Date()) {
          return "Suggestion cutoff must be in the future.";
        }
        const votingDeadline = calculateDeadline();
        if (votingDeadline) {
          const votingDt = new Date(votingDeadline);
          if (sugDt >= votingDt) {
            return "Suggestion cutoff must be before the voting cutoff.";
          }
        }
      } else {
        const cutoffMin = getSuggestionCutoffMinutes();
        const votingMin = getVotingDeadlineMinutes();
        if (cutoffMin != null && votingMin != null && cutoffMin >= votingMin) {
          return "Suggestion cutoff must be before the voting cutoff.";
        }
      }
    }
    return null;
  };

  // Whether the inline form has user input that should be auto-staged on
  // Submit. We treat the form as "empty" only if it matches the default
  // empty draft for its question type — otherwise any user input counts.
  const inlineFormHasContent = useCallback((): boolean => {
    if (title.trim()) return true;
    if (forField.trim()) return true;
    if (category !== 'custom') return true;
    if (options.some(o => o.trim() !== '')) return true;
    if (questionType === 'time' && dayTimeWindows.some(d => d.windows.length > 0)) return true;
    return false;
  }, [title, forField, category, options, questionType, dayTimeWindows]);

  // Lighter gate for the inline save-as-draft check button: enabled once the
  // user has provided enough signal that they meant to start a question (a
  // chosen category, a "for X" context, or 2+ options). Click still runs full
  // validation via stageCurrentQuestion and surfaces any per-question error.
  const inlineFormHasDraftableContent =
    category !== 'custom' ||
    forField.trim() !== '' ||
    options.filter(o => o.trim() !== '').length >= 2;

  // Validates only the per-question fields the top modal can edit. Used by
  // stageCurrentQuestion + the auto-stage path on Submit + the projected-
  // drafts preview. Different from getValidationErrorFor (which validates
  // poll-level fields too).
  const getCurrentQuestionFormError = (): string | null => {
    const dbQuestionType = getQuestionType();
    if (dbQuestionType === 'yes_no') {
      if (!title.trim()) return "Please enter a yes/no question.";
      if (title.length > 100) return "Title must be 100 characters or less.";
      if (/https?:\/\/\S+|www\.\S+/i.test(title)) {
        return "Links aren't allowed in the title. Use the Notes field for links.";
      }
      return null;
    }
    if (dbQuestionType === 'ranked_choice') {
      return validateRankedChoiceOptions(options, category);
    }
    if (dbQuestionType === 'time') {
      if (dayTimeWindows.length === 0) return "Please select at least one day.";
      const emptyDays = dayTimeWindows.filter(dtw => dtw.windows.length === 0);
      if (emptyDays.length > 0) {
        return "Every selected day must have at least one time slot. Add time slots or remove empty days.";
      }
      if (durationMinEnabled && durationMinValue != null) {
        const minDurMinutes = Math.round(durationMinValue * 60);
        if (minDurMinutes > 0) {
          const tooShort = dayTimeWindows.some(dtw =>
            dtw.windows.some(w => windowDurationMinutes(w) < minDurMinutes)
          );
          if (tooShort) {
            return `Each time window must be at least ${formatDurationLabel(minDurMinutes)} long (the minimum duration).`;
          }
        }
      }
    }
    return null;
  };

  // Read the current per-question form state into a QuestionDraft snapshot.
  // Migration 098: minResponses / showPreliminaryResults / allowPreRanking
  // live at the poll level (not per-draft).
  const readCurrentDraft = useCallback((): QuestionDraft => ({
    questionType,
    title,
    isAutoTitle,
    category,
    forField,
    options: [...options],
    optionsMetadata: { ...optionsMetadata },
    refLatitude,
    refLongitude,
    refLocationLabel,
    searchRadius,
    durationMinValue,
    durationMaxValue,
    durationMinEnabled,
    durationMaxEnabled,
    dayTimeWindows: [...dayTimeWindows],
    minimumParticipation,
  }), [questionType, title, isAutoTitle, category, forField, options, optionsMetadata, refLatitude, refLongitude, refLocationLabel, searchRadius, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, minimumParticipation]);

  // Push a draft into the per-question form state for editing.
  const applyDraftToState = useCallback((d: QuestionDraft) => {
    setQuestionType(d.questionType);
    setTitle(d.title);
    setIsAutoTitle(d.isAutoTitle);
    setCategory(d.category);
    setForField(d.forField);
    setOptions(d.options.length ? [...d.options] : ['']);
    setOptionsMetadata({ ...d.optionsMetadata });
    setRefLatitude(d.refLatitude);
    setRefLongitude(d.refLongitude);
    setRefLocationLabel(d.refLocationLabel);
    setSearchRadius(d.searchRadius);
    setDurationMinValue(d.durationMinValue);
    setDurationMaxValue(d.durationMaxValue);
    setDurationMinEnabled(d.durationMinEnabled);
    setDurationMaxEnabled(d.durationMaxEnabled);
    setDayTimeWindows([...d.dayTimeWindows]);
    setMinimumParticipation(d.minimumParticipation);
  }, []);

  // Backdrop + Escape preserve form state; only the explicit X-confirm
  // path resets it. The retained state survives in React + the
  // questionFormState localStorage auto-save.
  const closeKeepState = useCallback(() => {
    setError(null);
    setIsModalOpen(false);
  }, []);

  const discardAndClose = useCallback(() => {
    applyDraftToState(emptyDraft());
    setError(null);
    setIsModalOpen(false);
    setDrafts([]);
    setShowDiscardConfirm(false);
  }, [applyDraftToState]);

  const handleCloseClick = useCallback(() => {
    if (inlineFormHasContent() || drafts.length > 0) {
      setShowDiscardConfirm(true);
    } else {
      closeKeepState();
    }
  }, [inlineFormHasContent, drafts.length, closeKeepState]);

  const openModalFor = useCallback((cat: string) => {
    // When the poll already has staged drafts AND they share a context,
    // inherit it as the new question's forField so the auto-title can
    // collapse to "Cat1, Cat2 for SharedContext" without the user retyping.
    // Still editable — they can clear or change it freely.
    const inheritedForField = sharedDraftContext(drafts) ?? '';
    applyDraftToState(emptyDraft({ category: cat, forField: inheritedForField }));
    setError(null);
    setIsModalOpen(true);
  }, [applyDraftToState, drafts]);

  // Read showDiscardConfirm via a ref inside the Escape handler so toggling
  // the inner confirm dialog doesn't tear down + rebuild the body-position
  // lock on every open/close.
  const showDiscardConfirmRef = useRef(showDiscardConfirm);
  useEffect(() => {
    showDiscardConfirmRef.current = showDiscardConfirm;
  }, [showDiscardConfirm]);

  // `position: fixed` on body (vs. `overflow: hidden`) is required to
  // block iOS pull-to-refresh from bypassing the lock. Mirrors the
  // pattern in TimeGridModal / DaysSelector / RankableOptions.
  useEffect(() => {
    if (!isModalOpen) return;
    const scrollY = window.scrollY;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    // Skip when the inner ConfirmationModal is open — its own document-level
    // Escape handler runs too, and we don't want one Escape to dismiss both.
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showDiscardConfirmRef.current) closeKeepState();
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isModalOpen, closeKeepState]);

  // Portal target for the in-progress draft poll card, rendered in the page
  // body by the group / empty-group routes. Re-queried via a
  // MutationObserver that stays armed for the full component lifetime —
  // page navigations swap the portal target node (and the loading-spinner
  // early-return inside GroupContent unmounts it transiently), so a
  // self-disconnecting observer can leave us holding a stale reference
  // pointing at a detached node and the draft card stops rendering.
  // The mutation callback is coalesced into one rAF per frame, so the
  // always-on listener doesn't run getElementById hundreds of times during
  // typing / scroll / animation.
  const [draftPollPortal, setDraftPollPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let scheduled = false;
    const check = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const el = document.getElementById(DRAFT_POLL_PORTAL_ID);
        setDraftPollPortal(prev => (prev === el ? prev : el));
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);

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

  // Set default custom suggestion date/time when switching to custom
  useEffect(() => {
    if (suggestionCutoff === 'custom' && !customSuggestionDate && isClient) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setCustomSuggestionDate(`${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`);
      setCustomSuggestionTime('12:00');
    }
  }, [suggestionCutoff, customSuggestionDate, isClient]);

  // Initialize state from URL params
  useEffect(() => {
    debugLog.logObject('Create question page loaded with params', { followUpTo: followUpToParam, duplicateOf: duplicateOfParam, voteFromSuggestion: voteFromSuggestionParam }, 'CreateQuestion');
    if (followUpToParam) setFollowUpTo(followUpToParam);
    if (duplicateOfParam) setDuplicateOf(duplicateOfParam);
    if (voteFromSuggestionParam) setVoteFromSuggestion(voteFromSuggestionParam);
  }, [followUpToParam, duplicateOfParam, voteFromSuggestionParam]);

  // Initialize client-side state
  useEffect(() => {
    setIsClient(true);

    // Only load form state if this is NOT a follow-up, duplicate, or vote-from-suggestion
    // (these special cases load their own data from URL params)
    // Load saved user name
    const savedName = getUserName();
    if (savedName) {
      setCreatorName(savedName);
    }
    const savedMinResponses = getUserMinResponses();
    if (savedMinResponses !== null) {
      setMinResponses(savedMinResponses);
    }

    if (!followUpToParam && !duplicateOfParam && !voteFromSuggestionParam) {
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
  }, [followUpToParam, duplicateOfParam, voteFromSuggestionParam]);

  // Load duplicate data if this is a duplicate (for follow-up questions)
  useEffect(() => {
    debugLog.logObject('Duplicate useEffect running', { duplicateOfParam, windowExists: typeof window !== 'undefined' }, 'CreateQuestion');

    if (duplicateOfParam && typeof window !== 'undefined') {
      // Set the duplicate relationship in state
      setDuplicateOf(duplicateOfParam);

      const duplicateDataKey = `duplicate-data-${duplicateOfParam}`;
      const savedDuplicateData = localStorage.getItem(duplicateDataKey);

      debugLog.logObject('Duplicate data lookup', { duplicateDataKey, found: !!savedDuplicateData, data: savedDuplicateData }, 'CreateQuestion');

      if (savedDuplicateData) {
        try {
          const duplicateData = JSON.parse(savedDuplicateData);
          debugLog.logObject('Parsed duplicate data', duplicateData, 'CreateQuestion');

          // Auto-fill form with duplicate data. Title is intentionally NOT
          // copied — it regenerates fresh from the new input fields (or stays
          // empty for user-typed yes_no prompts). See buildQuestionSnapshot.
          setDetails(duplicateData.details || "");

          // Set question type based on duplicated question
          if (duplicateData.question_type === 'ranked_choice') {
            setQuestionType('question');
            setOptions(duplicateData.options || ['']);
          } else if (duplicateData.question_type === 'time') {
            setQuestionType('time');
            setOptions(['']);
            if (duplicateData.min_availability_percent != null) setMinimumParticipation(duplicateData.min_availability_percent);
          } else {
            // yes_no question
            setQuestionType('question');
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
          if (duplicateData.category) {
            setCategory(duplicateData.category);
          }
          if (duplicateData.options_metadata) {
            setOptionsMetadata(duplicateData.options_metadata);
          }
          if (duplicateData.min_responses != null) setMinResponses(duplicateData.min_responses);
          if (duplicateData.show_preliminary_results != null) setShowPreliminaryResults(duplicateData.show_preliminary_results);
          if (duplicateData.allow_pre_ranking != null) setAllowPreRanking(duplicateData.allow_pre_ranking);

          // Auto-open: prefill is invisible until the user opens the modal.
          setIsModalOpen(true);

          // Don't clean up the duplicate data yet - keep it until question is created
          // so that refresh doesn't lose the data
          // Keep the duplicate URL parameter so refresh works correctly
          debugLog.info('Loaded duplicate data from localStorage (will clean up after submission)', 'CreateQuestion');
        } catch (error) {
          console.error('Error loading duplicate data:', error);
        }
      }
    }
  }, [duplicateOfParam]);

  // Load vote-from-suggestion data if creating preference question from suggestions
  useEffect(() => {
    debugLog.logObject('VoteFromSuggestion useEffect running', { voteFromSuggestionParam, windowExists: typeof window !== 'undefined' }, 'CreateQuestion');

    if (voteFromSuggestionParam && typeof window !== 'undefined') {
      // Set the vote-from-suggestion relationship in state
      setVoteFromSuggestion(voteFromSuggestionParam);

      const voteDataKey = `vote-from-suggestion-${voteFromSuggestionParam}`;
      const savedVoteData = localStorage.getItem(voteDataKey);

      debugLog.logObject('Vote data lookup', { voteDataKey, found: !!savedVoteData, data: savedVoteData }, 'CreateQuestion');

      if (savedVoteData) {
        try {
          const voteData = JSON.parse(savedVoteData);
          debugLog.logObject('Parsed vote data', voteData, 'CreateQuestion');

          // Auto-fill form with preference question type and nominated options
          setTitle(voteData.title || "");
          if (!voteData.is_auto_title && voteData.title) {
            setIsAutoTitle(false);
            loadedTitleRef.current = voteData.title;
          }
          setQuestionType('question'); // Set to preference question
          setOptions(voteData.options && voteData.options.length > 0 ? voteData.options : ['']);

          // Auto-open: prefill is invisible until the user opens the modal.
          setIsModalOpen(true);

          // Don't clean up the vote data yet - keep it until question is created
          // so that refresh doesn't lose the data
          debugLog.info('Loaded vote data from localStorage (will clean up after submission)', 'CreateQuestion');

          // Keep the voteFromSuggestion parameter so refresh works
          // Also set followUpTo parameter to link the new question
          if (voteData.followUpTo) {
            const url = new URL(window.location.href);
            url.searchParams.set('followUpTo', voteData.followUpTo);
            window.history.replaceState({}, '', url.toString());
          }
        } catch (error) {
          console.error('Error loading vote-from-suggestion data:', error);
        }
      }
    }
  }, [voteFromSuggestionParam]);

  // Set default date/time values after client initialization
  useEffect(() => {
    if (isClient && !customDate && !customTime) {
      const defaultDateTime = getDefaultDateTime();
      setCustomDate(defaultDateTime.date);
      setCustomTime(defaultDateTime.time);
    }
  }, [isClient, customDate, customTime]);

  // Save form state whenever form data changes (questionType is saved separately)
  useEffect(() => {
    if (isClient) {
      saveFormState();
    }
  }, [title, details, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, category, duplicateOf, isClient, saveFormState, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, drafts]);

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


  const deadlineOptions = process.env.NODE_ENV === 'development'
    ? DEV_DEADLINE_OPTIONS
    : BASE_DEADLINE_OPTIONS;

  const calculateDeadline = () => {
    const now = new Date();

    // No deadline if disabled via voting cutoff modal
    if (deadlineOption === "none") return null;

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

    // Check both inline deadline options and voting cutoff modal options
    const option = deadlineOptions.find(opt => opt.value === deadlineOption)
      || VOTING_CUTOFF_OPTIONS.find(opt => opt.value === deadlineOption);
    if (!option) return null;

    const deadline = new Date(now.getTime() + option.minutes * 60 * 1000);
    return deadline.toISOString();
  };

  const getTimeLabel = (option: string) => {
    const selected = deadlineOptions.find(opt => opt.value === option);
    if (!selected || option === "custom") return selected?.label || "";
    // 10-second dev option: include seconds in the time
    if (option === "10sec" && typeof window !== 'undefined') {
      const deadline = new Date(Date.now() + selected.minutes * 60 * 1000);
      const timeString = deadline.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      return `${selected.label} (${timeString})`;
    }
    return formatDeadlineLabel(selected.minutes, selected.label);
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

  const handleSubmitClick = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isSubmittingRef.current) {
      return;
    }

    // Auto-stage the inline form when it carries valid content. Lets the
    // user submit a single-question poll without first tapping "+ Question".
    // We compute the effective drafts list locally because setDrafts won't
    // be visible later in this function (React batches state updates).
    // Don't reset the form state here either — if poll-level validation or
    // the API call fails, the user keeps their typed values in the modal.
    let effectiveDrafts = drafts;
    if (inlineFormHasContent()) {
      const subErr = getCurrentQuestionFormError();
      if (subErr) { setError(subErr); return; }
      effectiveDrafts = [...drafts, readCurrentDraft()];
    }

    const validationError = getValidationErrorFor(effectiveDrafts);
    if (validationError) {
      setError(validationError);
      return;
    }

    isSubmittingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const responseDeadline = calculateDeadline();

      const creatorSecret = generateCreatorSecret();

      // Implicit follow-up: pick up the group's latest question id from
      // The group the new poll attaches to: either the body marker (set
      // by the group page on mount) or, for the legacy duplicate /
      // vote-on-it / FollowUpButton flows, the group of the question id
      // the caller passed. Skip the body marker on /t (empty placeholder)
      // — by construction the user is starting a new group, and the
      // attribute can be stale (the group route's cleanup is a useEffect
      // return that React/HMR/view-transitions can delay).
      const onEmptyGroup = typeof window !== 'undefined' && /^\/g\/?$/.test(window.location.pathname);
      const bodyGroupId = !onEmptyGroup && typeof document !== 'undefined'
        ? document.body.getAttribute(GROUP_ID_ATTR)
        : null;
      const effectiveGroupId = followUpTo
        ? getCachedGroupIdForQuestion(followUpTo)
        : bodyGroupId;

      // Resolve the poll-level prephase cutoff once. Used both for the wrapper
      // field and for each draft that has a prephase (suggestion mode + time).
      const prephaseMinutes = pollHasPrephase ? getSuggestionCutoffMinutes() : null;
      // Custom prephase deadline (absolute, not deferred): bypass minutes.
      let prephaseDeadlineIso: string | null = null;
      if (pollHasPrephase && suggestionCutoff === 'custom' && customSuggestionDate && customSuggestionTime) {
        prephaseDeadlineIso = new Date(`${customSuggestionDate}T${customSuggestionTime}`).toISOString();
      }

      // Wrapper title rule: when there's exactly one staged question and the
      // user typed its title (yes_no questions, where the prompt IS the
      // title), use that as the wrapper title. Otherwise send null and let
      // the server auto-generate from question categories + poll context.
      // The standalone wrapper-title input was removed when the form moved
      // inline; users can override the title later via /g/<id>/edit-title.
      const onlyDraft = effectiveDrafts.length === 1 ? effectiveDrafts[0] : null;
      const wrapperTitle = onlyDraft && !onlyDraft.isAutoTitle ? onlyDraft.title.trim() : null;

      const questionsForRequest: CreateQuestionParams[] =
        effectiveDrafts.map(d => draftToQuestionParams(d, prephaseMinutes));

      // Accidental-double-submit guard. We allow duplicate titles in
      // general — different users (or the same user later) might
      // legitimately want a fresh "Movie?" suggestion round in the same
      // group. The redirect only fires when both:
      //   1. The current browser is the creator of the existing
      //      question (a creator_secret for it lives in localStorage),
      //   2. The existing question was created within the last 30s.
      // That narrows the rule to its real purpose: catching the
      // user who tapped Submit twice in quick succession.
      const DUPLICATE_REDIRECT_WINDOW_MS = 30_000;
      const dedupTitle = wrapperTitle || onlyDraft?.title || '';
      if (effectiveGroupId && dedupTitle.trim()) {
        try {
          const existing = await apiFindDuplicateQuestion(dedupTitle, effectiveGroupId);
          const isOwnRecentDuplicate = !!existing
            && !!getCreatorSecret(existing.id)
            && (Date.now() - new Date(existing.created_at).getTime()) < DUPLICATE_REDIRECT_WINDOW_MS;
          if (existing && isOwnRecentDuplicate) {
            const wrapper = existing.poll_id ? pollLookup()(existing.poll_id) : null;
            const shortId = wrapper?.short_id || existing.id;
            const rootRouteId = wrapper ? resolveGroupRootRouteId(wrapper) : shortId;
            questionBackTarget.set(shortId, rootRouteId);
            const href = wrapper ? getGroupHrefForPoll(wrapper) : `/g/${shortId}`;
            // Tear down the submit state BEFORE navigating away. Without
            // this the spinner spins forever + the modal stays open
            // covering the destination group (the duplicate of the poll
            // the user just typed).
            isSubmittingRef.current = false;
            setIsLoading(false);
            setIsModalOpen(false);
            applyDraftToState(emptyDraft());
            setError(null);
            router.replace(href);
            return;
          }
        } catch {
          // If the check fails, proceed with creation
        }
      }

      // Build a placeholder Poll from the draft data so the group can render
      // a real card in the destination position immediately, before the API
      // call resolves. The card mounts with only the title visible (other
      // fields empty / default) and FLIP-animates from the draft card's
      // bbox to its natural collapsed-card slot. apiCreatePoll runs in
      // parallel and dispatches POLL_HYDRATED_EVENT on success so the
      // group page can swap placeholder fields for real ones in place.
      const placeholderPoll = synthesizePlaceholderPoll(effectiveDrafts, {
        wrapperTitle,
        responseDeadline,
        groupId: effectiveGroupId ?? null,
        creatorName: creatorName.trim() || null,
        details: details.trim() || null,
      });

      // For new-root submissions on /g/ (the empty placeholder), the
      // placeholder card needs to be visible. The placeholder route doesn't
      // render a poll list, so we still navigate first; the destination
      // GroupContent mounts with the placeholder in cache and FLIP-animates.
      // We use router.replace with a placeholder id route — once apiCreatePoll
      // resolves, we router.replace again to the real shortId.
      // For follow-ups, the current group page is already rendering and
      // takes the placeholder via POLL_PENDING_EVENT inline.
      const draftCardEl = document.querySelector('[data-draft-poll-card]') as HTMLElement | null;
      const draftBbox = draftCardEl?.getBoundingClientRect();
      const fromBbox = draftBbox
        ? { x: draftBbox.x, y: draftBbox.y, width: draftBbox.width, height: draftBbox.height }
        : { x: 0, y: 0, width: 0, height: 0 };

      // Cache the placeholder so destination group render can find it.
      cachePoll(placeholderPoll);
      updateAccessiblePollsIfFresh(existing => [
        ...existing.filter(p => p.id !== placeholderPoll.id),
        placeholderPoll,
      ]);

      // Dispatch BEFORE we clear the draft state so listeners can read the
      // bbox in time.
      window.dispatchEvent(
        new CustomEvent<PollPendingDetail>(POLL_PENDING_EVENT, {
          detail: { poll: placeholderPoll, fromBbox },
        }),
      );

      // Clear staged drafts immediately so the in-card list resets to the
      // empty inline form for the user's next poll.
      flushSync(() => {
        setDrafts([]);
      });

      // Stay on /t until the API resolves on empty-group submits — the
      // placeholder id (`pending-...`) doesn't resolve as a UUID/short_id,
      // so redirecting eagerly would render "Group Not Found" and lose the
      // draft-poll-portal that hosts restored drafts + error on failure.
      // Success redirects to the real short_id below.
      // duplicateOf carries a question id from the "duplicate this poll"
      // flow; resolve it to its group_id (we want the duplicate to land
      // in the original's group) and prefer that when no group context
      // is set via the body marker / props.
      const duplicateGroupId = duplicateOf
        ? getCachedGroupIdForQuestion(duplicateOf)
        : null;
      const requestGroupId = effectiveGroupId ?? duplicateGroupId ?? null;

      let createdPoll: Poll;
      try {
        createdPoll = await apiCreatePoll({
          creator_secret: creatorSecret,
          creator_name: creatorName.trim() || undefined,
          response_deadline: responseDeadline,
          prephase_deadline: prephaseDeadlineIso,
          prephase_deadline_minutes: prephaseDeadlineIso ? null : prephaseMinutes != null ? Math.round(prephaseMinutes) : null,
          group_id: requestGroupId,
          title: wrapperTitle,
          context: null,
          details: details.trim() || null,
          // Migration 098: poll-level results-display + ranked-choice settings.
          min_responses: minResponses,
          show_preliminary_results: showPreliminaryResults,
          allow_pre_ranking: allowPreRanking,
          questions: questionsForRequest,
        });
      } catch (apiError: any) {
        console.error("Error creating question:", apiError);
        setError(apiError.message || "Failed to create question. Please try again.");
        setIsLoading(false);
        isSubmittingRef.current = false;
        // Clean up the optimistic state so the user doesn't see a stuck
        // placeholder card with no chrome (just a title) lingering in the
        // group, with the form cleared and seemingly nothing to retry. The
        // POLL_FAILED listener on the group page removes the placeholder
        // from group state; here we evict it from cache and restore the
        // staged drafts so the user can edit and resubmit.
        invalidatePoll(placeholderPoll.id);
        updateAccessiblePollsIfFresh(existing => existing.filter(p => p.id !== placeholderPoll.id));
        window.dispatchEvent(
          new CustomEvent<PollFailedDetail>(POLL_FAILED_EVENT, {
            detail: { placeholderId: placeholderPoll.id },
          }),
        );
        return;
      }

      // Record creation for every question so the creator gets access +
      // creator_secret for all of them. The wrapper's secret is shared across
      // questions server-side; recordQuestionCreation just persists the mapping
      // locally per question id (used by FollowUp/Close/Reopen actions).
      for (const sp of createdPoll.questions) {
        recordQuestionCreation(sp.id, creatorSecret);
      }

      if (creatorName.trim()) {
        saveUserName(creatorName.trim());
      }
      clearFormState();
      setIsSubmitted(false);
      isSubmittingRef.current = false;
      setIsLoading(false);
      setIsModalOpen(false);
      applyDraftToState(emptyDraft());
      setError(null);

      // Cache the real poll, then notify group state so it swaps placeholder
      // fields for real ones in place (same DOM node — no remount mid-FLIP).
      cachePoll(createdPoll);
      updateAccessiblePollsIfFresh(existing => [
        ...existing.filter(p => p.id !== placeholderPoll.id && p.id !== createdPoll.id),
        createdPoll,
      ]);
      window.dispatchEvent(
        new CustomEvent<PollHydratedDetail>(POLL_HYDRATED_EVENT, {
          detail: { placeholderId: placeholderPoll.id, poll: createdPoll },
        }),
      );

      if (onEmptyGroup) {
        // Land on the real group URL with the new poll expanded. The cache is
        // hot from the just-completed POLL_HYDRATED so re-mount is instant.
        const redirectId = createdPoll.short_id ?? createdPoll.id;
        questionBackTarget.set(redirectId, resolveGroupRootRouteId(createdPoll));
        router.replace(getGroupHrefForPoll(createdPoll));
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const titleField = (
    <div className="flex items-center justify-between gap-3 h-12">
      <label htmlFor="title" className="text-sm font-medium shrink-0">
        Title
      </label>
      <input
        type="text"
        id="title"
        ref={titleInputRef}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setIsAutoTitle(false);
        }}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed !== title) setTitle(trimmed);
        }}
        disabled={isLoading}
        maxLength={100}
        className="flex-1 min-w-0 text-sm bg-transparent text-blue-600 dark:text-blue-400 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:italic"
        placeholder={isAutoTitle ? "auto" : "Enter your title..."}
        required={!isAutoTitle}
      />
    </div>
  );

  // Compact suggestion/availability cutoff field — used in the BOTTOM modal
  // when the poll has at least one prephase question, since the cutoff is
  // poll-level. Mirrors the legacy per-question rendering.
  const suggestionCutoffField = (
    <div>
      <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
        <span className="text-sm font-medium">Suggestion/Availability Cutoff</span>
        <span className="relative inline-flex">
          <span className="text-sm font-normal text-blue-600 dark:text-blue-400 text-right">
            {(() => {
              if (suggestionCutoff === 'custom') return 'Custom';
              const frac = FRACTIONAL_CUTOFF_OPTIONS.find(o => o.value === suggestionCutoff);
              if (frac) {
                const votingMin = getVotingDeadlineMinutes();
                if (votingMin != null) return formatMinutesLabel(votingMin * frac.fraction);
                return `${frac.fraction}x`;
              }
              const absOpt = ABSOLUTE_CUTOFF_OPTIONS.find(o => o.value === suggestionCutoff);
              if (!absOpt) return suggestionCutoff;
              return formatDeadlineLabel(absOpt.minutes, absOpt.label);
            })()}
          </span>
          <select
            value={suggestionCutoff}
            onChange={(e) => setSuggestionCutoff(e.target.value)}
            disabled={isLoading}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Prephase cutoff duration"
          >
            {getVotingDeadlineMinutes() != null && (
              <optgroup label="Relative to Voting Cutoff">
                {FRACTIONAL_CUTOFF_OPTIONS.map(opt => {
                  const votingMin = getVotingDeadlineMinutes()!;
                  const mins = votingMin * opt.fraction;
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.fraction}x ({formatMinutesLabel(mins)})
                    </option>
                  );
                })}
              </optgroup>
            )}
            <optgroup label="Fixed Duration">
              {ABSOLUTE_CUTOFF_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {formatDeadlineLabel(opt.minutes, opt.label)}
                </option>
              ))}
            </optgroup>
            <option value="custom">Custom</option>
          </select>
        </span>
      </label>
      {isClient && (() => {
        const warnings: string[] = [];
        const cutoffMin = getSuggestionCutoffMinutes();
        if (cutoffMin != null && cutoffMin < 5) {
          warnings.push("Cutoff is less than 5 minutes from now.");
        }
        const votingMin = getVotingDeadlineMinutes();
        if (cutoffMin != null && votingMin != null && (votingMin - cutoffMin) < 5) {
          warnings.push("Cutoff is less than 5 minutes before voting cutoff.");
        }
        if (warnings.length === 0) return null;
        return (
          <div className="mt-1.5">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
            ))}
          </div>
        );
      })()}
      {suggestionCutoff === 'custom' && (
        <div className="mt-2 flex justify-between gap-2">
          <div className="w-auto">
            <label htmlFor="customSuggestionDate" className="block text-xs text-gray-500 mb-1">Date</label>
            <input
              type="date"
              id="customSuggestionDate"
              value={customSuggestionDate}
              onChange={(e) => setCustomSuggestionDate(e.target.value)}
              disabled={isLoading}
              min={isClient ? getTodayDate() : ''}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs text-center"
              style={{ fontSize: '14px' }}
              required
            />
          </div>
          <div className="w-auto">
            <label htmlFor="customSuggestionTime" className="block text-xs text-gray-500 mb-1 text-right">Time</label>
            <input
              type="time"
              id="customSuggestionTime"
              value={customSuggestionTime}
              onChange={(e) => setCustomSuggestionTime(e.target.value)}
              disabled={isLoading}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs text-center"
              style={{ fontSize: '14px' }}
              required
            />
          </div>
        </div>
      )}
    </div>
  );

  // Question-specific JSX rendered inline at the top of the draft poll card,
  // right above the staged-questions list and the "+ Question" button.
  // The form gets a top hairline + matching py-3 when it has content, so
  // Context → first form field keeps the same vertical rhythm as the
  // divide-y rows above it.
  const showTimeFields =
    questionType === 'time' || (questionType === 'question' && category === 'time');
  const formHasContent = isLocationLikeCategory(category) || showTimeFields;

  // Day Time Windows handlers — mirror the logic that used to live inside
  // TimeQuestionFields. Lifted here so the "Time Windows" card (rendered
  // alongside Notes / Min Availability further down) can drive the days
  // picker + the days list directly.
  const selectedDays = dayTimeWindows.map(dtw => dtw.day);
  const minDurationMinutesForWindows = durationMinEnabled && durationMinValue != null
    ? Math.round(durationMinValue * 60)
    : null;
  const handleDaysSelected = (newDays: string[]) => {
    const existingDays = dayTimeWindows.map(dtw => dtw.day);
    const removedDays = existingDays.filter(d => !newDays.includes(d));
    for (const d of removedDays) {
      const dtw = dayTimeWindows.find(x => x.day === d);
      if (dtw && dtw.windows.length > 0) {
        removedDaysCache.current[d] = dtw.windows;
      }
    }
    const addedDays = newDays.filter(d => !existingDays.includes(d));
    const newEntries: DayTimeWindow[] = addedDays.map(d => {
      const cached = removedDaysCache.current[d];
      if (cached) delete removedDaysCache.current[d];
      return { day: d, windows: cached || [] };
    });
    const updated = [
      ...dayTimeWindows.filter(dtw => !removedDays.includes(dtw.day)),
      ...newEntries,
    ];
    updated.sort((a, b) => a.day.localeCompare(b.day));
    setDayTimeWindows(updated);
  };
  const handleDayWindowsChange = (day: string, windows: TimeWindow[]) => {
    setDayTimeWindows(dayTimeWindows.map(dtw =>
      dtw.day === day ? { ...dtw, windows } : dtw
    ));
  };
  const handleDeleteDay = (day: string) => {
    setDayTimeWindows(dayTimeWindows.filter(dtw => dtw.day !== day));
  };
  const questionFormBody = (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }} className={`space-y-4${formHasContent ? ' border-t border-gray-200 dark:border-gray-700 py-3' : ''}`}>
      {isLocationLikeCategory(category) && (
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

      {showTimeFields && (
        <TimeQuestionFields
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
          highlightDaysButton={dayTimeWindows.length === 0}
          renderDaysSection={false}
        />
      )}

    </form>
  );

  // Options card — rendered as a separate card below the bottom card,
  // with an external left-justified "Options" header. Only meaningful
  // for ranked-choice (non-yes_no, non-time) questions.
  const showOptionsCard = questionType === 'question' && category !== 'yes_no' && category !== 'time';
  const optionsCard = showOptionsCard ? (
    <div>
      <label className="block text-sm font-medium mb-1 px-1">
        Options <span className="font-normal text-xs text-gray-500 dark:text-gray-400">(leave blank to ask for suggestions)</span>
      </label>
      <section className="rounded-3xl bg-white dark:bg-gray-800 px-4">
        <OptionsInput
          options={options}
          setOptions={setOptions}
          isLoading={isLoading}
          category={category}
          optionsMetadata={optionsMetadata}
          onMetadataChange={setOptionsMetadata}
          referenceLatitude={refLatitude}
          referenceLongitude={refLongitude}
          searchRadius={searchRadius}
          variant="compact"
        />
      </section>
    </div>
  ) : null;

  return (
    <div className="question-content">
      {draftPollPortal && createPortal(
        <>
          {/* Category bubble bar — pt-* is the gap above; pb-4 supplements
              the page's outer paddingBottom (template.tsx) so iOS Safari's
              bottom URL bar (~50–64px, overlays the viewport at max scroll)
              doesn't clip the last bubble row. env(safe-area-inset-bottom)
              isn't usable here — it returns 0 when the URL bar is visible
              (the case we need to handle) and feeds scrollHeight. */}
          <div className="px-3 pt-3 pb-4 flex flex-wrap justify-center gap-2">
            {BUBBLE_ENTRIES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => openModalFor(entry.value)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 border border-blue-300 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium select-none"
                aria-label={`Add ${entry.label} question`}
              >
                {entry.icon && (
                  <span className="text-base leading-none" aria-hidden>{entry.icon}</span>
                )}
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

        </>,
        draftPollPortal
      )}

      {/* New-poll bottom sheet — slides up from the bottom edge. Top half
          holds the question form; bottom half holds poll-level settings
          (voting cutoff, prephase cutoff, notes, voter name). Each section
          is a borderless rounded card with a lighter bg than the sheet so
          the two read as stacked panels. The check button submits the
          whole poll immediately (single-question mode); backdrop / Escape
          dismisses. */}
      {isModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[60] flex items-end justify-center">
            {/* Backdrop — tap to close the sheet (state retained). */}
            <div
              className="absolute inset-0 bg-black/40 dark:bg-black/60 animate-fade-in"
              onClick={closeKeepState}
              aria-hidden="true"
            />
            {/* Sheet panel — anchored to the bottom edge with rounded top
                corners. Slides up on mount via the shared `slide-up`
                keyframe in globals.css. */}
            <div
              className="relative w-full sm:max-w-md bg-gray-100 dark:bg-gray-900 rounded-t-3xl shadow-2xl flex flex-col animate-slide-up"
              style={{ height: 'calc(100dvh - 3rem)' }}
              role="dialog"
              aria-modal="true"
              aria-label="New poll"
            >
              <div className="relative flex items-center justify-center px-4 py-2 min-h-[3.75rem]">
                <button
                  type="button"
                  onClick={handleCloseClick}
                  disabled={isLoading}
                  aria-label="Close poll form"
                  className="absolute left-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 select-none">
                  New Poll
                </span>
                <button
                  type="button"
                  onClick={handleSubmitClick}
                  disabled={isLoading || isSubmitted || !inlineFormHasDraftableContent}
                  aria-label="Submit poll"
                  className="absolute right-2 top-2 w-11 h-11 flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitted || isLoading ? (
                    <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Sheet body — scrollable when content overflows. Holds the
                  two stacked section cards with a small gap between them.
                  The bottom padding matches the group-like page's outer
                  `paddingBottom: '4.5rem'` so elements have the same
                  breathing room above the sheet edge that the bubbles
                  have above the screen edge. */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-[4.5rem] space-y-3">
                <div className="text-center px-2 pt-1 break-words">
                  <span
                    className="text-xl font-bold text-blue-600 dark:text-blue-400"
                    style={{ fontFamily: "'M PLUS 1 Code', monospace" }}
                  >
                    {title.trim() || "‹title›"}
                  </span>
                </div>

                {/* Top card: question form. Simple fields (Category, Context,
                    Title) sit as inline rows in a divide-y container — labels
                    left, values right, hairlines between. Complex widgets
                    (reference location, time fields, options list) render
                    full-width below the simple-row group. */}
                <section
                  data-draft-poll-card
                  className="rounded-3xl bg-white dark:bg-gray-800 px-4"
                >
                  {questionType === 'question' && (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                      <div className="flex items-center justify-between gap-3 h-12">
                        <label className="text-sm font-medium shrink-0">
                          Category
                        </label>
                        <div className="flex-1 min-w-0">
                          <TypeFieldInput
                            value={category}
                            onChange={handleCategoryChange}
                            disabled={isLoading}
                            borderless
                          />
                        </div>
                      </div>
                      {category !== 'yes_no' && (
                        <div className="flex items-center justify-between gap-3 h-12">
                          <label htmlFor="forField" className="text-sm font-medium shrink-0">
                            Context
                          </label>
                          <input
                            id="forField"
                            type="text"
                            value={forField}
                            onChange={(e) => setForField(e.target.value)}
                            onBlur={(e) => {
                              const trimmed = e.target.value.trim();
                              if (trimmed !== forField) setForField(trimmed);
                            }}
                            disabled={isLoading}
                            maxLength={100}
                            placeholder={FOR_FIELD_PLACEHOLDERS[category] || "Context"}
                            className="flex-1 min-w-0 text-sm bg-transparent text-blue-600 dark:text-blue-400 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:italic"
                          />
                        </div>
                      )}
                      {category === 'yes_no' && titleField}
                    </div>
                  )}
                  {questionFormBody}
                </section>

                {optionsCard}

                {/* Bottom card: poll-level settings. Each setting is a row
                    with label left, value right; hairlines between rows
                    (inset to the card's px-4 padding). */}
                <section className="rounded-3xl bg-white dark:bg-gray-800 px-4">
                  <form
                    onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    className="divide-y divide-gray-200 dark:divide-gray-700"
                  >
                    <VotingCutoffField
                      deadlineOption={deadlineOption}
                      setDeadlineOption={setDeadlineOption}
                      customDate={customDate}
                      setCustomDate={setCustomDate}
                      customTime={customTime}
                      setCustomTime={setCustomTime}
                      isLoading={isLoading}
                      isClient={isClient}
                    />

                    {pollHasPrephase && suggestionCutoffField}

                    {pollHasRankedChoice && (
                      <CompactMinResponsesField
                        value={minResponses}
                        setValue={(val) => {
                          setMinResponses(val);
                          saveUserMinResponses(val);
                        }}
                        showPreliminary={showPreliminaryResults}
                        setShowPreliminary={setShowPreliminaryResults}
                        disabled={isLoading}
                      />
                    )}

                    {pollHasPrephase && (
                      <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
                        <span className="text-sm font-medium">
                          Allow voting before options are finalized
                        </span>
                        <input
                          type="checkbox"
                          checked={allowPreRanking}
                          onChange={(e) => setAllowPreRanking(e.target.checked)}
                          disabled={isLoading}
                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        />
                      </label>
                    )}

                    {/* Voter name row — inline custom version (instead of
                        shared CompactNameField) so we can apply the
                        label-left / value-right layout without affecting
                        the voting-flow consumers of CompactNameField. */}
                    <div className="flex items-center justify-between gap-3 h-12">
                      <label htmlFor="creatorName" className="text-sm font-medium shrink-0">
                        Your Name
                      </label>
                      <input
                        id="creatorName"
                        type="text"
                        value={creatorName}
                        onChange={(e) => setCreatorName(e.target.value)}
                        onBlur={() => setCreatorName(creatorName.trim())}
                        disabled={isLoading}
                        maxLength={50}
                        className="flex-1 min-w-0 text-sm bg-transparent text-blue-600 dark:text-blue-400 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </form>
                </section>

                {showTimeFields && (
                  <div>
                    <div className="flex items-center justify-between mb-1 px-1">
                      <label className="text-sm font-medium">
                        Time Windows
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsDaysPickerOpen(true)}
                        disabled={isLoading}
                        className={`px-3 py-1 text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                          dayTimeWindows.length === 0
                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-500 hover:bg-amber-200 dark:hover:bg-amber-900/60'
                            : 'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {dayTimeWindows.length === 0 ? 'Select Days' : 'Add/Remove Days'}
                      </button>
                    </div>
                    {dayTimeWindows.length > 0 && (
                      <section className="rounded-3xl bg-white dark:bg-gray-800 px-4">
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                          {dayTimeWindows.map((dtw) => (
                            <DayTimeWindowsInput
                              key={dtw.day}
                              day={dtw.day}
                              windows={dtw.windows}
                              onChange={(windows) => handleDayWindowsChange(dtw.day, windows)}
                              onDelete={() => handleDeleteDay(dtw.day)}
                              disabled={isLoading}
                              minDurationMinutes={minDurationMinutesForWindows}
                              borderless
                            />
                          ))}
                        </div>
                      </section>
                    )}
                    <DaysSelector
                      selectedDays={selectedDays}
                      onChange={handleDaysSelected}
                      disabled={isLoading}
                      isOpen={isDaysPickerOpen}
                      onOpenChange={setIsDaysPickerOpen}
                      hideButton={true}
                    />
                  </div>
                )}

                {showTimeFields && (
                  <section className="rounded-3xl bg-white dark:bg-gray-800 px-4">
                    <div className="flex items-center justify-between gap-3 h-12">
                      <span className="text-sm font-medium shrink-0">
                        Minimum Availability{' '}
                        <span className="font-normal text-xs text-gray-500 dark:text-gray-400">of the top slot</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowMinParticipationModal(true)}
                        disabled={isLoading}
                        className="text-sm font-normal text-blue-600 dark:text-blue-400 disabled:opacity-50"
                        aria-label="Adjust minimum availability percentage"
                      >
                        {minimumParticipation}%
                      </button>
                    </div>
                  </section>
                )}

                {/* Notes card — sits at the bottom, after poll settings.
                    The label is rendered as an external left-justified
                    header above the card. The textarea is always visible
                    (no collapse/expand) and auto-grows up to ~5 rows. */}
                <div>
                  <label
                    htmlFor="details"
                    className="block text-sm font-medium mb-1 px-1"
                  >
                    Notes
                  </label>
                  <section className="rounded-3xl bg-white dark:bg-gray-800 px-4">
                    <textarea
                      ref={detailsRef}
                      id="details"
                      value={details}
                      onChange={(e) => {
                        setDetails(e.target.value);
                        const el = e.target;
                        el.style.height = `${SINGLE_LINE_INPUT_HEIGHT}px`;
                        const maxH = 5 * 20 + 16;
                        el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
                        el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
                      }}
                      onBlur={() => {
                        const trimmed = details.trim();
                        if (trimmed !== details) setDetails(trimmed);
                      }}
                      disabled={isLoading}
                      rows={3}
                      className="block w-full bg-transparent text-sm focus:outline-none dark:text-white disabled:opacity-50 disabled:cursor-not-allowed resize-none"
                    />
                  </section>
                </div>

                {error && (
                  <div className="p-2 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      <MinimumParticipationModal
        isOpen={showMinParticipationModal}
        onClose={() => setShowMinParticipationModal(false)}
        value={minimumParticipation}
        onChange={setMinimumParticipation}
        disabled={isLoading}
      />

      <ConfirmationModal
        isOpen={showDiscardConfirm}
        onConfirm={discardAndClose}
        onCancel={() => setShowDiscardConfirm(false)}
        message="Discard this poll? Your changes will be lost."
        confirmText="Discard"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
      />
    </div>
  );
}

// Redirect /create-poll to /g/ where the always-visible draft card lives.
// Forwards any duplicate / followUpTo / voteFromSuggestion params so the
// inline form can pre-fill from the original entry-point.
export default function CreateQuestionRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qs = params.toString();
    window.location.replace(`/g/${qs ? `?${qs}` : ''}`);
  }, []);

  return null;
}
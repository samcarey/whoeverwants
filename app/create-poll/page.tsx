"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import AnimatedTitle from "@/components/AnimatedTitle";
import {
  apiCreatePoll,
  apiFindDuplicateQuestion,
  CreateQuestionParams,
} from "@/lib/api";
import type { Poll, OptionsMetadata, Question } from "@/lib/types";
import CompactNameField from "@/components/CompactNameField";
import { BUILT_IN_TYPES, getBuiltInType, isLocationLikeCategory } from "@/components/TypeFieldInput";
import ModalPortal from "@/components/ModalPortal";
import { useAppPrefetch } from "@/lib/prefetch";
import { generateCreatorSecret, recordQuestionCreation } from "@/lib/browserQuestionAccess";
import { triggerDiscoveryIfNeeded } from "@/lib/questionDiscovery";
import { getUserName, saveUserName, getUserMinResponses, saveUserMinResponses } from "@/lib/userProfile";
import { debugLog } from "@/lib/debugLogger";
import OptionsInput from "@/components/OptionsInput";
import CompactMinResponsesField from "@/components/CompactMinResponsesField";
import { VOTING_CUTOFF_OPTIONS } from "@/components/VotingCutoffConditionsModal";
import VotingCutoffField from "@/components/VotingCutoffField";
import MinimumParticipationModal from "@/components/MinimumParticipationModal";
import TimeQuestionFields from "@/components/TimeQuestionFields";
import ReferenceLocationInput from "@/components/ReferenceLocationInput";
import type { DayTimeWindow } from "@/lib/types";
import CategoryForLine from "@/components/CategoryForLine";
import { windowDurationMinutes, formatDurationLabel, formatDeadlineLabel } from "@/lib/timeUtils";
import { findThreadRootRouteId } from "@/lib/threadUtils";
import * as questionBackTarget from "@/lib/questionBackTarget";
import { cachePoll, cacheAccessiblePolls, getCachedAccessiblePolls, invalidatePoll } from "@/lib/questionCache";
import {
  POLL_PENDING_EVENT,
  POLL_HYDRATED_EVENT,
  POLL_FAILED_EVENT,
  type PollPendingDetail,
  type PollHydratedDetail,
  type PollFailedDetail,
} from "@/lib/eventChannels";
import { DRAFT_POLL_PORTAL_ID, THREAD_HEADER_ATTR, THREAD_LATEST_QUESTION_ID_ATTR } from "@/lib/threadDomMarkers";
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
  anyDraftIsSuggestionMode,
  deriveDraftTitle,
  draftCardLabels,
  draftPollPreview,
  sharedDraftContext,
  synthesizePlaceholderPoll,
} from "./createPollHelpers";
export const dynamic = 'force-dynamic';

// Matches the rendered height of a single-line <input> with py-2 padding.
// Used for the Details textarea initial height and auto-grow reset.
const SINGLE_LINE_INPUT_HEIGHT = 42;

// Order matches the dropdown inside the modal so muscle memory carries over.
const BUBBLE_ENTRIES: Array<{ value: string; label: string; icon: string }> = [
  ...BUILT_IN_TYPES,
  { value: 'custom', label: 'Custom', icon: '✨' },
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  // When non-null, the modal is editing this draft index; confirm
  // replaces in place, dismiss leaves the list untouched (the draft
  // is never popped on edit-pencil click).
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  // Focus details textarea when opening
  useEffect(() => {
    if (detailsOpen) {
      detailsRef.current?.focus();
    }
  }, [detailsOpen]);

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

  // Auto-generated category text from options (shown in CategoryForLine when no explicit category)
  const generatedCategoryFromOptions = useMemo(() => {
    if (category !== 'custom') return '';
    if (questionType !== 'question') return '';
    const filled = options.filter(o => o.trim()).map(shortenOption);
    if (filled.length === 0) return '';
    if (filled.length === 1) return filled[0];
    const limit = 40;
    const joinWithOr = (items: string[]) => {
      if (items.length === 2) return `${items[0]} or ${items[1]}`;
      return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
    };
    const included = [filled[0]];
    for (let i = 1; i < filled.length; i++) {
      const isLast = i === filled.length - 1;
      const candidate = isLast
        ? joinWithOr([...included, filled[i]])
        : `${[...included, filled[i]].join(', ')}, or ...`;
      if (candidate.length > limit && included.length >= 2) break;
      included.push(filled[i]);
    }
    if (included.length === filled.length) return joinWithOr(included);
    return `${included.join(', ')}, or ...`;
  }, [category, questionType, options]);

  // Handle category changes from CategoryForLine
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
          if (formState.details) setDetailsOpen(true);
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



  // Whether any staged draft (or the in-progress inline form, when filled)
  // uses the poll-level prephase cutoff (suggestion mode or time question).
  // Drives whether the suggestion-cutoff field is rendered in Settings.
  const inlineFormUsesPrephase = isSuggestionMode
    || questionType === 'time'
    || category === 'time';
  const pollHasPrephase = anyDraftUsesPrephase(drafts) || inlineFormUsesPrephase;

  // Migration 098: poll-level results-display + ranked-choice settings.
  // The min-responses + show-results pair is meaningful iff the poll
  // contains at least one ranked_choice question. The "allow pre-rank"
  // toggle further requires at least one suggestion-mode question.
  const inlineFormIsRankedChoice = questionType === 'question'
    && category !== 'yes_no'
    && category !== 'time';
  const pollHasRankedChoice = anyDraftIsRankedChoice(drafts) || inlineFormIsRankedChoice;
  const pollHasSuggestionMode = anyDraftIsSuggestionMode(drafts) || isSuggestionMode;

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

  const handleEditDraft = useCallback((index: number) => {
    const target = drafts[index];
    if (!target) return;
    setError(null);
    setEditingDraftIndex(index);
    applyDraftToState(target);
    setIsModalOpen(true);
  }, [drafts, applyDraftToState]);

  // Bring the just-materialized draft card up under the fixed header,
  // capped at the document's natural maxScroll — never push the card
  // downward or extend the page artificially. The 12px gap leaves a
  // sliver of breathing room when the card does reach the top.
  const scrollDraftCardUnderHeader = useCallback(() => {
    const DRAFT_TOP_GAP = 12;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const card = document.querySelector('[data-draft-poll-card]') as HTMLElement | null;
        if (!card) return;
        const header = document.querySelector(`[${THREAD_HEADER_ATTR}]`) as HTMLElement | null;
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        const target = Math.max(0, window.scrollY + card.getBoundingClientRect().top - headerBottom - DRAFT_TOP_GAP);
        if (target <= window.scrollY) return;
        window.scrollTo({ top: target, behavior: 'smooth' });
      });
    });
  }, []);

  const confirmModal = useCallback((): boolean => {
    const subErr = getCurrentQuestionFormError();
    if (subErr) { setError(subErr); return false; }
    setError(null);
    const draft = readCurrentDraft();
    // Only the 0 → 1 transition materializes the card; subsequent
    // additions don't shift its position enough to warrant scrolling.
    const draftCardJustMaterialized = drafts.length === 0 && editingDraftIndex === null;
    if (editingDraftIndex !== null) {
      setDrafts(prev => {
        const next = [...prev];
        next[editingDraftIndex] = draft;
        return next;
      });
    } else {
      setDrafts(prev => [...prev, draft]);
    }
    applyDraftToState(emptyDraft());
    setEditingDraftIndex(null);
    setIsModalOpen(false);
    if (draftCardJustMaterialized) {
      scrollDraftCardUnderHeader();
    }
    return true;
  }, [drafts.length, editingDraftIndex, readCurrentDraft, applyDraftToState, scrollDraftCardUnderHeader]);

  const dismissModal = useCallback(() => {
    applyDraftToState(emptyDraft());
    setEditingDraftIndex(null);
    setError(null);
    setIsModalOpen(false);
  }, [applyDraftToState]);

  const openModalFor = useCallback((cat: string) => {
    // When the poll already has staged drafts AND they share a context,
    // inherit it as the new question's forField so the auto-title can
    // collapse to "Cat1, Cat2 for SharedContext" without the user retyping.
    // Still editable — they can clear or change it freely.
    const inheritedForField = sharedDraftContext(drafts) ?? '';
    applyDraftToState(emptyDraft({ category: cat, forField: inheritedForField }));
    setEditingDraftIndex(null);
    setError(null);
    setIsModalOpen(true);
  }, [applyDraftToState, drafts]);

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
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissModal();
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isModalOpen, dismissModal]);

  // Portal target for the in-progress draft poll card, rendered in the page
  // body by the thread / empty-thread routes. Re-queried via a
  // MutationObserver that stays armed for the full component lifetime —
  // page navigations swap the portal target node (and the loading-spinner
  // early-return inside ThreadContent unmounts it transiently), so a
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

          // Auto-fill form with duplicate data
          setTitle(duplicateData.title || "");
          if (!duplicateData.is_auto_title && duplicateData.title) {
            setIsAutoTitle(false);
            loadedTitleRef.current = duplicateData.title;
          }
          setDetails(duplicateData.details || "");
          if (duplicateData.details) setDetailsOpen(true);

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
    let effectiveDrafts = drafts;
    if (inlineFormHasContent()) {
      const subErr = getCurrentQuestionFormError();
      if (subErr) { setError(subErr); return; }
      const newDraft = readCurrentDraft();
      if (editingDraftIndex !== null) {
        const next = [...drafts];
        const at = Math.min(editingDraftIndex, next.length);
        next.splice(at, 0, newDraft);
        effectiveDrafts = next;
      } else {
        effectiveDrafts = [...drafts, newDraft];
      }
      setDrafts(effectiveDrafts);
      applyDraftToState(emptyDraft());
      setEditingDraftIndex(null);
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

      // Implicit follow-up: pick up the thread's latest question id from
      // <body> when submitting from a thread page. Skip when on /p (empty
      // placeholder) — by construction the user is starting a new thread,
      // and the body attribute can be stale (the thread route's cleanup
      // is a useEffect return that React/HMR/view-transitions can delay).
      const onEmptyThreadPath = typeof window !== 'undefined' && /^\/p\/?$/.test(window.location.pathname);
      const effectiveFollowUpTo = followUpTo
        ?? (!onEmptyThreadPath && typeof document !== 'undefined'
          ? document.body.getAttribute(THREAD_LATEST_QUESTION_ID_ATTR)
          : null);

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
      // inline; users can override the title later via /p/<id>/edit-title.
      const onlyDraft = effectiveDrafts.length === 1 ? effectiveDrafts[0] : null;
      const wrapperTitle = onlyDraft && !onlyDraft.isAutoTitle ? onlyDraft.title.trim() : null;

      const questionsForRequest: CreateQuestionParams[] =
        effectiveDrafts.map(d => draftToQuestionParams(d, prephaseMinutes));

      // Find duplicate when this is a follow-up to an existing question.
      const dedupTitle = wrapperTitle || onlyDraft?.title || '';
      if (effectiveFollowUpTo && dedupTitle.trim()) {
        try {
          const existing = await apiFindDuplicateQuestion(dedupTitle, effectiveFollowUpTo);
          if (existing) {
            const lookup = pollLookup();
            const wrapper = existing.poll_id ? lookup(existing.poll_id) : null;
            const shortId = wrapper?.short_id || existing.id;
            const rootRouteId = wrapper
              ? findThreadRootRouteId(wrapper, lookup)
              : shortId;
            questionBackTarget.set(shortId, rootRouteId);
            router.replace(`/p/${shortId}`);
            return;
          }
        } catch {
          // If the check fails, proceed with creation
        }
      }

      const onEmptyThread = typeof window !== 'undefined' && /^\/p\/?$/.test(window.location.pathname);

      // Build a placeholder Poll from the draft data so the thread can render
      // a real card in the destination position immediately, before the API
      // call resolves. The card mounts with only the title visible (other
      // fields empty / default) and FLIP-animates from the draft card's
      // bbox to its natural collapsed-card slot. apiCreatePoll runs in
      // parallel and dispatches POLL_HYDRATED_EVENT on success so the
      // thread page can swap placeholder fields for real ones in place.
      const placeholderPoll = synthesizePlaceholderPoll(effectiveDrafts, {
        wrapperTitle,
        responseDeadline,
        followUpTo: (() => {
          // For the placeholder, follow_up_to should be the parent POLL id
          // (so thread state recognizes it as part of the current thread).
          // The CreatePollRequest accepts a question id and the server
          // resolves it; here we resolve client-side via the cache.
          if (!effectiveFollowUpTo) return null;
          const cached = getCachedAccessiblePolls() ?? [];
          return cached.find(mp => mp.questions.some(q => q.id === effectiveFollowUpTo))?.id ?? null;
        })(),
        creatorName: creatorName.trim() || null,
      });

      // For new-root submissions on /p/ (the empty placeholder), the
      // placeholder card needs to be visible. The placeholder route doesn't
      // render a poll list, so we still navigate first; the destination
      // ThreadContent mounts with the placeholder in cache and FLIP-animates.
      // We use router.replace with a placeholder id route — once apiCreatePoll
      // resolves, we router.replace again to the real shortId.
      // For follow-ups, the current thread page is already rendering and
      // takes the placeholder via POLL_PENDING_EVENT inline.
      const draftCardEl = document.querySelector('[data-draft-poll-card]') as HTMLElement | null;
      const draftBbox = draftCardEl?.getBoundingClientRect();
      const fromBbox = draftBbox
        ? { x: draftBbox.x, y: draftBbox.y, width: draftBbox.width, height: draftBbox.height }
        : { x: 0, y: 0, width: 0, height: 0 };

      // Cache the placeholder so destination thread render can find it.
      cachePoll(placeholderPoll);
      const cachedAccessible = getCachedAccessiblePolls() ?? [];
      cacheAccessiblePolls([...cachedAccessible.filter(p => p.id !== placeholderPoll.id), placeholderPoll]);

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

      // Stay on /p until the API resolves on empty-thread submits — the
      // placeholder id (`pending-...`) doesn't resolve as a UUID/short_id,
      // so redirecting eagerly would render "Poll Not Found" and lose the
      // draft-poll-portal that hosts restored drafts + error on failure.
      // Success redirects to the real short_id below.
      let createdPoll: Poll;
      try {
        createdPoll = await apiCreatePoll({
          creator_secret: creatorSecret,
          creator_name: creatorName.trim() || undefined,
          response_deadline: responseDeadline,
          prephase_deadline: prephaseDeadlineIso,
          prephase_deadline_minutes: prephaseDeadlineIso ? null : prephaseMinutes != null ? Math.round(prephaseMinutes) : null,
          follow_up_to: effectiveFollowUpTo || duplicateOf || null,
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
        // thread, with the form cleared and seemingly nothing to retry. The
        // POLL_FAILED listener on the thread page removes the placeholder
        // from thread state; here we evict it from cache and restore the
        // staged drafts so the user can edit and resubmit.
        invalidatePoll(placeholderPoll.id);
        const cachedAfter = getCachedAccessiblePolls() ?? [];
        cacheAccessiblePolls(cachedAfter.filter(p => p.id !== placeholderPoll.id));
        window.dispatchEvent(
          new CustomEvent<PollFailedDetail>(POLL_FAILED_EVENT, {
            detail: { placeholderId: placeholderPoll.id },
          }),
        );
        setDrafts(effectiveDrafts);
        return;
      }

      // Record creation for every question so the creator gets access +
      // creator_secret for all of them. The wrapper's secret is shared across
      // questions server-side; recordQuestionCreation just persists the mapping
      // locally per question id (used by FollowUp/Close/Reopen actions).
      for (const sp of createdPoll.questions) {
        recordQuestionCreation(sp.id, creatorSecret);
      }

      if (effectiveFollowUpTo) {
        try {
          await triggerDiscoveryIfNeeded();
        } catch {
          // Don't fail the question creation if discovery fails
        }
      }

      if (creatorName.trim()) {
        saveUserName(creatorName.trim());
      }
      clearFormState();
      setIsSubmitted(false);
      isSubmittingRef.current = false;
      setIsLoading(false);

      // Cache the real poll, then notify thread state so it swaps placeholder
      // fields for real ones in place (same DOM node — no remount mid-FLIP).
      cachePoll(createdPoll);
      const cached2 = getCachedAccessiblePolls() ?? [];
      cacheAccessiblePolls([...cached2.filter(p => p.id !== placeholderPoll.id && p.id !== createdPoll.id), createdPoll]);
      window.dispatchEvent(
        new CustomEvent<PollHydratedDetail>(POLL_HYDRATED_EVENT, {
          detail: { placeholderId: placeholderPoll.id, poll: createdPoll },
        }),
      );

      if (onEmptyThread) {
        // Land on the real thread URL. ThreadContent's threadId will change,
        // but the cache is hot so re-mount renders instantly.
        const redirectId = createdPoll.short_id ?? createdPoll.id;
        questionBackTarget.set(redirectId, findThreadRootRouteId(createdPoll, pollLookup()));
        router.replace(`/p/${redirectId}`);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const titleField = (
    <div>
      {isAutoTitle ? (
        <button
          type="button"
          onClick={() => {
            setIsAutoTitle(false);
            setTitle('');
            setTimeout(() => titleInputRef.current?.focus(), 0);
          }}
          className="block text-sm font-medium text-left"
        >
          Title: <span className="text-blue-600 dark:text-blue-400 font-normal">{title || <span className="italic">auto</span>}</span>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="title" className="text-sm font-medium">
              Title
            </label>
            {category !== 'yes_no' && (
              <button
                type="button"
                onClick={() => setIsAutoTitle(true)}
                className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Generate
              </button>
            )}
          </div>
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
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Enter your title..."
            required
          />
        </>
      )}
    </div>
  );

  // Mirror the auto-stage logic from handleSubmitClick so the displayed error
  // and the disabled-state of the Submit button match what would actually
  // happen on tap. If the inline form has content, treat it as if it were
  // already staged for validation purposes.
  const projectedDrafts = inlineFormHasContent() && !getCurrentQuestionFormError()
    ? [...drafts, readCurrentDraft()]
    : drafts;
  const validationError = getValidationErrorFor(projectedDrafts);
  const submitDisabled = isLoading || isSubmitted || !!validationError;

  // Compact suggestion/availability cutoff field — used in the BOTTOM modal
  // when the poll has at least one prephase question, since the cutoff is
  // poll-level. Mirrors the legacy per-question rendering.
  const suggestionCutoffField = (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium cursor-pointer">
          <span>{drafts.some(d => draftDbQuestionType(d) === 'time') ? 'Availability Cutoff: ' : 'Suggestions Cutoff: '}</span>
          <span className="relative inline-flex">
            <span className="font-normal text-blue-600 dark:text-blue-400">
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
      </div>
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
  const questionFormBody = (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }} className="space-y-4">
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

      {(questionType === 'time' || (questionType === 'question' && category === 'time')) && (
        <>
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
          />

          <div className="text-sm font-medium">
            Minimum Availability:{' '}
            <button
              type="button"
              onClick={() => setShowMinParticipationModal(true)}
              disabled={isLoading}
              className="font-normal text-blue-600 dark:text-blue-400 disabled:opacity-50"
              aria-label="Adjust minimum availability percentage"
            >
              {minimumParticipation}%
            </button>{' '}
            of the top slot
          </div>
        </>
      )}

      {questionType === 'question' && category !== 'yes_no' && category !== 'time' && (
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
          label={<>Options <span className="font-normal">(leave blank to ask for suggestions)</span></>}
        />
      )}

      {category === 'yes_no' && titleField}
    </form>
  );

  const hasDrafts = drafts.length > 0;

  return (
    <div className="question-content">
      {draftPollPortal && createPortal(
        <>
          {hasDrafts && (
            <div className="pt-3">
              {/* Submit button is absolute-positioned so adding it doesn't
                  shift the centered preview-title label off-axis. */}
              <div className="relative mx-1.5 mb-2 flex items-center justify-center min-h-9">
                <span className="inline-block text-sm font-medium text-gray-500 dark:text-gray-400 select-none mt-[3px] truncate max-w-[calc(100%-4rem)]">
                  {projectedDrafts.length > 0 && !validationError
                    ? draftPollPreview(projectedDrafts, details).title
                    : 'Create Poll'}
                </span>
                <button
                  type="button"
                  onClick={handleSubmitClick}
                  disabled={submitDisabled}
                  aria-label="Submit poll"
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitted || isLoading ? (
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 11l7-7 7 7M12 4v16" />
                    </svg>
                  )}
                </button>
              </div>
              <div
                data-draft-poll-card
                className="mx-1.5 rounded-3xl border-2 border-dashed border-blue-400 dark:border-blue-500 bg-blue-50/40 dark:bg-blue-900/10"
              >
                {/* Staged questions list. */}
                <div className="px-3 pt-3 pb-1">
                  <ul className="space-y-1.5">
                    {drafts.map((d, i) => {
                      const { icon, label } = draftCardLabels(d);
                      const derivedTitle = deriveDraftTitle(d);
                      return (
                        <li
                          key={i}
                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                        >
                          <span className="text-lg leading-none" aria-hidden>{icon}</span>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
                            {derivedTitle}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleEditDraft(i)}
                            disabled={isLoading}
                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                            aria-label={`Edit ${label} section`}
                          >
                            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14.166 2.5a1.65 1.65 0 012.334 2.334L6.667 14.667 3 15.5l.833-3.667L14.166 2.5z" />
                            </svg>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Settings — voting cutoff, suggestion/availability cutoff,
                    notes, voter name. */}
                <div className="pb-3">
                  <div className="px-3 pt-2">
                    <form
                      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      className="space-y-3"
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

                      {pollHasSuggestionMode && (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowPreRanking}
                            onChange={(e) => setAllowPreRanking(e.target.checked)}
                            disabled={isLoading}
                            className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            allow pre-rank during suggestion phase
                          </span>
                        </label>
                      )}

                      <div>
                        {detailsOpen ? (
                          <>
                            <label htmlFor="details" className="block text-sm font-medium mb-1">
                              Notes
                            </label>
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
                                if (!trimmed) {
                                  setDetailsOpen(false);
                                  setDetails('');
                                } else if (trimmed !== details) {
                                  setDetails(trimmed);
                                }
                              }}
                              disabled={isLoading}
                              style={{ height: SINGLE_LINE_INPUT_HEIGHT }}
                              className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
                              placeholder="Add more context or instructions..."
                            />
                          </>
                        ) : (
                          <div className="text-sm font-medium">
                            Notes:{' '}
                            <button
                              type="button"
                              onClick={() => setDetailsOpen(true)}
                              className="font-normal text-blue-600 dark:text-blue-400"
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>

                      <CompactNameField
                        name={creatorName}
                        setName={setCreatorName}
                        disabled={isLoading}
                      />
                    </form>

                    {(error || (validationError && drafts.length > 0)) && (
                      <div className="mt-3 p-2 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
                        {error ?? validationError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Category bubble bar — pt-* is the gap above; the gap below
              comes from the page's outer paddingBottom (template.tsx). */}
          <div className={`px-3 ${hasDrafts ? 'pt-4' : 'pt-3'} flex flex-wrap justify-center gap-2`}>
            {BUBBLE_ENTRIES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => openModalFor(entry.value)}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 border border-blue-300 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium select-none"
                aria-label={`Add ${entry.label} question`}
              >
                <span className="text-base leading-none" aria-hidden>{entry.icon}</span>
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

        </>,
        draftPollPortal
      )}

      {/* Question-form modal — backdrop + rounded-corner card with the
          checkmark in the upper-right. Tap the checkmark to commit the
          in-progress question to the staged-list draft; tap the backdrop /
          X / Escape to discard. Edit flow: pencil on a staged draft loads
          it into the modal — confirm replaces at the original index,
          dismiss leaves the original draft untouched. */}
      {isModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
            {/* Backdrop — tap to dismiss. */}
            <div
              className="absolute inset-0 bg-black/40 dark:bg-black/60"
              onClick={dismissModal}
              aria-hidden="true"
            />
            {/* Modal panel — rounded corners, capped height, scrollable
                inner body. On mobile we anchor to the bottom (sheet-like);
                on sm+ screens we center it. The sheet still has rounded
                corners on every edge so it reads as a card. */}
            <div
              className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl mx-2 mb-2 sm:mb-0 flex flex-col"
              style={{ maxHeight: 'min(calc(100dvh - 5rem), 44rem)' }}
              role="dialog"
              aria-modal="true"
              aria-label={editingDraftIndex !== null ? 'Edit question' : 'New question'}
            >
              {/* Header bar — left X dismisses, right ✓ confirms. The
                  centered title gives the user a hint of what the modal is
                  for; we don't repeat the category here (the form body's
                  CategoryForLine already shows it). */}
              <div className="relative flex items-center justify-center px-4 pt-3 pb-2">
                <button
                  type="button"
                  onClick={dismissModal}
                  aria-label="Discard"
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 select-none">
                  {editingDraftIndex !== null ? 'Edit Question' : 'New Question'}
                </span>
                <button
                  type="button"
                  onClick={() => confirmModal()}
                  disabled={isLoading || !inlineFormHasDraftableContent}
                  aria-label={editingDraftIndex !== null ? 'Save question edits' : 'Save question'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>

              {/* Form body — scrollable when content overflows. The bottom
                  padding here matches the thread-like page's outer
                  `paddingBottom: '4.5rem'` (template.tsx) so elements
                  inside the sheet have the same breathing room above the
                  modal edge that the bubbles have above the screen edge. */}
              <div className="flex-1 overflow-y-auto px-4 pb-[4.5rem]">
                <div className="mb-3">
                  {questionType === 'question' ? (
                    <CategoryForLine
                      category={category}
                      onCategoryChange={handleCategoryChange}
                      forField={forField}
                      onForFieldChange={setForField}
                      generatedCategoryText={generatedCategoryFromOptions}
                      disabled={isLoading}
                    />
                  ) : (
                    <AnimatedTitle title={title} initialDelay={0} />
                  )}
                </div>
                {questionFormBody}
                {error && (
                  <div className="mt-3 p-2 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-sm">
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
    </div>
  );
}

// Redirect /create-poll to /p/ where the always-visible draft card lives.
// Forwards any duplicate / followUpTo / voteFromSuggestion params so the
// inline form can pre-fill from the original entry-point.
export default function CreateQuestionRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qs = params.toString();
    window.location.replace(`/p/${qs ? `?${qs}` : ''}`);
  }, []);

  return null;
}
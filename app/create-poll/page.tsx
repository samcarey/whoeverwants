"use client";

import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import AnimatedTitle from "@/components/AnimatedTitle";
import {
  apiCreatePoll,
  apiFindDuplicateQuestion,
  CreateQuestionParams,
} from "@/lib/api";
import type { Poll, OptionsMetadata, Question } from "@/lib/types";
import CompactNameField from "@/components/CompactNameField";
import { getBuiltInType, isLocationLikeCategory } from "@/components/TypeFieldInput";
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
  draftIsSuggestionMode,
  draftToQuestionParams,
  anyDraftUsesPrephase,
  summarizeDraft,
  draftCardLabels,
  draftPollPreview,
} from "./createPollHelpers";
import ThreadListItem from "@/components/ThreadListItem";
export const dynamic = 'force-dynamic';

// Matches the rendered height of a single-line <input> with py-2 padding.
// Used for the Details textarea initial height and auto-grow reset.
const SINGLE_LINE_INPUT_HEIGHT = 42;

export function CreateQuestionContent() {
  const { prefetch } = useAppPrefetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const followUpToParam = searchParams.get('followUpTo');
  const duplicateOfParam = searchParams.get('duplicate');
  const voteFromSuggestionParam = searchParams.get('voteFromSuggestion');
  const modeParam = searchParams.get('mode');
  // Optional category preselection from the What/When/Where bubble FAB.
  // "When" uses ?mode=time (question-type-level switch); "Where" uses ?category=restaurant.
  // Restored from URL on mount only — subsequent edits go through CategoryForLine.
  const categoryParam = searchParams.get('category');
  // `?openForm=1` is set by the bubble bar when the panel was closed at click
  // time. It tells us to auto-open the top form on first mount even when there
  // was no category/mode preselect (e.g. the "what" button).
  const openFormParam = searchParams.get('openForm');

  // Track relationship to source question as part of form state
  const [followUpTo, setFollowUpTo] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [voteFromSuggestion, setVoteFromSuggestion] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const questionType = modeParam === 'time' ? 'time' : 'question';
  const setQuestionType = useCallback((type: 'question' | 'time') => {
    const url = new URL(window.location.href);
    if (type === 'time') {
      url.searchParams.set('mode', 'time');
    } else {
      url.searchParams.delete('mode');
    }
    router.replace(url.pathname + url.search);
  }, [router]);
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
  // Poll-level "Context" — short single-line that drives the auto-title's
  // "for X" suffix. Maps to polls.context server-side. Distinct from `details`
  // (Notes) which is a long multi-line description with link support.
  const [pollContext, setPollContext] = useState("");
  const [pollContextOpen, setPollContextOpen] = useState(false);
  const pollContextRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>(categoryParam || 'custom');
  const [forField, setForField] = useState("");
  const [optionsMetadata, setOptionsMetadata] = useState<OptionsMetadata>({});
  // Reference location for proximity-based search
  const [refLatitude, setRefLatitude] = useState<number | undefined>(undefined);
  const [refLongitude, setRefLongitude] = useState<number | undefined>(undefined);
  const [refLocationLabel, setRefLocationLabel] = useState("");
  const [searchRadius, setSearchRadius] = useState(25);
  const [minResponses, setMinResponses] = useState<number>(1);
  const [showPreliminaryResults, setShowPreliminaryResults] = useState(true);

  // Drafts list — every question committed via the top-modal "check" button
  // becomes a draft. The poll is built from this list at submit time.
  // Draft 0 is the first section displayed in the bottom modal's compact list.
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  // Top modal open + which draft index it's editing.
  // editingDraftIndex === null when adding a new question.
  const [topModalOpen, setTopModalOpen] = useState(false);
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  // Bookkeeping: the draft that was popped out for editing, so X-during-edit
  // discards it (per spec). Restored on check.
  const [originalEditingDraft, setOriginalEditingDraft] = useState<QuestionDraft | null>(null);
  // Submit-time animation flag: drives the draft poll card morph (dashed
  // border + blue tint → solid border + white) and gates the bubble bar /
  // panel slide-down so the user sees the draft becoming "real" before we
  // navigate to the new poll's page.
  const [isFinalizing, setIsFinalizing] = useState(false);

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
        details,
        pollContext,
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
        drafts,
      };
      localStorage.setItem('questionFormState', JSON.stringify(formState));
    }
  }, [title, details, pollContext, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, category, forField, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, minResponses, showPreliminaryResults, drafts]);

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
          setDetails(formState.details || '');
          if (formState.details) setDetailsOpen(true);
          if (typeof formState.pollContext === 'string') {
            setPollContext(formState.pollContext);
            if (formState.pollContext) setPollContextOpen(true);
          }
          setOptions(formState.options || ['']);
          setDeadlineOption(formState.deadlineOption || '10min');
          setCustomDate(formState.customDate || '');
          setCustomTime(formState.customTime || '');
          setCreatorName(formState.creatorName || '');
          // URL ?category= preselection (from the Where bubble FAB) wins over saved drafts.
          if (formState.category && !categoryParam) setCategory(formState.category);
          if (formState.forField) setForField(formState.forField);

          if (formState.durationMinValue !== undefined) setDurationMinValue(formState.durationMinValue);
          if (formState.durationMaxValue !== undefined) setDurationMaxValue(formState.durationMaxValue);
          if (formState.durationMinEnabled !== undefined) setDurationMinEnabled(formState.durationMinEnabled);
          if (formState.durationMaxEnabled !== undefined) setDurationMaxEnabled(formState.durationMaxEnabled);
          if (formState.dayTimeWindows !== undefined) setDayTimeWindows(formState.dayTimeWindows);
          if (formState.minResponses !== undefined) setMinResponses(formState.minResponses);
          if (formState.showPreliminaryResults !== undefined) setShowPreliminaryResults(formState.showPreliminaryResults);
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



  // Whether any committed draft uses the poll-level prephase cutoff
  // (suggestion mode or time question). Drives whether the suggestion
  // cutoff field is rendered in the bottom modal.
  const pollHasPrephase = anyDraftUsesPrephase(drafts);

  // Title/preview/count for the draft poll card. Re-runs as drafts or the
  // poll-level details change so the user sees the preview update in real
  // time. Mirrors generate_poll_title() so the morph lands on the same
  // title the server will assign on submit.
  const draftPreview = useMemo(
    () => draftPollPreview(drafts, pollContext),
    [drafts, pollContext],
  );

  // Validates the whole poll at submit time: drafts exist + poll-level
  // cutoffs are sane. Per-question fields were already validated when
  // each draft was checked-in.
  const getValidationError = (): string | null => {
    if (drafts.length === 0) {
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
    if (pollHasPrephase) {
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

  const isFormValid = (): boolean => {
    return getValidationError() === null;
  };

  // Validates only the per-question fields the top modal can edit.
  // Used to gate the "check" button. Different from getValidationError
  // (which validates poll-level fields too).
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
    minResponses,
    showPreliminaryResults,
    allowPreRanking,
    durationMinValue,
    durationMaxValue,
    durationMinEnabled,
    durationMaxEnabled,
    dayTimeWindows: [...dayTimeWindows],
    minimumParticipation,
  }), [questionType, title, isAutoTitle, category, forField, options, optionsMetadata, refLatitude, refLongitude, refLocationLabel, searchRadius, minResponses, showPreliminaryResults, allowPreRanking, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, minimumParticipation]);

  // Push a draft into the per-question form state for editing.
  const applyDraftToState = useCallback((d: QuestionDraft) => {
    // questionType lives on the URL `mode` param; sync it through that.
    if (d.questionType === 'time') {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'time');
      router.replace(url.pathname + url.search);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      router.replace(url.pathname + url.search);
    }
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
    setMinResponses(d.minResponses);
    setShowPreliminaryResults(d.showPreliminaryResults);
    setAllowPreRanking(d.allowPreRanking);
    setDurationMinValue(d.durationMinValue);
    setDurationMaxValue(d.durationMaxValue);
    setDurationMinEnabled(d.durationMinEnabled);
    setDurationMaxEnabled(d.durationMaxEnabled);
    setDayTimeWindows([...d.dayTimeWindows]);
    setMinimumParticipation(d.minimumParticipation);
  }, [router]);

  // What/When/Where: open a fresh top modal with optional preselection.
  const handleOpenNewQuestion = useCallback((opts: { mode?: 'question' | 'time'; category?: string } = {}) => {
    setError(null);
    applyDraftToState(emptyDraft(opts));
    setEditingDraftIndex(null);
    setOriginalEditingDraft(null);
    setTopModalOpen(true);
  }, [applyDraftToState]);

  // Pencil: edit a committed draft. Pop it from drafts list (so it lives
  // exclusively in the top modal form), remember it for X-restore semantics.
  const handleEditDraft = useCallback((index: number) => {
    const target = drafts[index];
    if (!target) return;
    setError(null);
    setOriginalEditingDraft(target);
    setEditingDraftIndex(index);
    setDrafts(prev => prev.filter((_, i) => i !== index));
    applyDraftToState(target);
    setTopModalOpen(true);
  }, [drafts, applyDraftToState]);

  // X on top modal: discard the form. If editing, the popped draft is NOT
  // restored (per spec — "clear it from the form and it will not go back in
  // the draft").
  const handleTopModalCancel = useCallback(() => {
    setTopModalOpen(false);
    setEditingDraftIndex(null);
    setOriginalEditingDraft(null);
    setError(null);
  }, []);

  // Check on top modal: validate per-question fields, snapshot current form
  // into a draft, insert/update in drafts list, close.
  const handleCheckCommit = useCallback(() => {
    const subErr = getCurrentQuestionFormError();
    if (subErr) { setError(subErr); return; }
    setError(null);
    const draft = readCurrentDraft();
    if (editingDraftIndex !== null) {
      // Re-insert at original index to preserve display order.
      setDrafts(prev => {
        const next = [...prev];
        const at = Math.min(editingDraftIndex, next.length);
        next.splice(at, 0, draft);
        return next;
      });
    } else {
      setDrafts(prev => [...prev, draft]);
    }
    setTopModalOpen(false);
    setEditingDraftIndex(null);
    setOriginalEditingDraft(null);
  }, [editingDraftIndex, readCurrentDraft]);

  // Portal targets in the modal header (rendered by template.tsx)
  const [submitPortal, setSubmitPortal] = useState<HTMLElement | null>(null);
  const [titlePortal, setTitlePortal] = useState<HTMLElement | null>(null);
  // Portal target for the in-progress draft poll card, rendered in the page
  // body by the home / thread / empty-thread routes. Re-queried via
  // MutationObserver: page navigations swap the portal target node, so a
  // single one-shot useEffect would leave us pointing at a detached element.
  const [draftPollPortal, setDraftPollPortal] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSubmitPortal(document.getElementById('create-question-submit-portal'));
    setTitlePortal(document.getElementById('create-question-title-portal'));
    const updateDraftPollPortal = () => {
      const el = document.getElementById('draft-poll-portal');
      setDraftPollPortal(prev => (prev === el ? prev : el));
    };
    updateDraftPollPortal();
    const observer = new MutationObserver(updateDraftPollPortal);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Broadcast top-modal open/closed state so template.tsx can hide the
  // floating What/When/Where bubble bar while the question form is open
  // (per spec: either the buttons or the form are visible, never both).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('questionFormStateChange', { detail: { open: topModalOpen } }));
    return () => {
      window.dispatchEvent(new CustomEvent('questionFormStateChange', { detail: { open: false } }));
    };
  }, [topModalOpen]);

  // Listen for the floating bubble bar's runtime "open form" requests when
  // the panel is already open (so tapping a bubble pops a fresh top form
  // without re-pushing URL state).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { mode?: 'question' | 'time'; category?: string } | undefined;
      handleOpenNewQuestion(detail ?? {});
    };
    window.addEventListener('openQuestionForm', handler);
    return () => window.removeEventListener('openQuestionForm', handler);
  }, [handleOpenNewQuestion]);

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

  // Auto-open the top modal once on first mount when:
  //  - the bubble bar set `?openForm=1` (panel just opened from a bubble tap), or
  //  - the URL carries a What/When/Where preselection (category/mode), or
  //  - this is a duplicate / follow-up / vote-from-suggestion flow.
  // Plain entry (e.g. reload with saved drafts) leaves the top modal closed
  // so the user sees the draft poll card on the page first.
  // `?openForm=1` is stripped after consumption so a refresh doesn't reopen.
  const topModalAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (!isClient) return;
    if (topModalAutoOpenedRef.current) return;
    const hasPreselect = !!(categoryParam || modeParam);
    const hasSpecialFlow = !!(duplicateOfParam || voteFromSuggestionParam || followUpToParam);
    const hasOpenFormFlag = openFormParam === '1';
    topModalAutoOpenedRef.current = true;
    if (hasPreselect || hasSpecialFlow || hasOpenFormFlag) {
      setTopModalOpen(true);
    }
    if (hasOpenFormFlag) {
      // Strip the marker so refresh / view-transitions don't re-trigger.
      const url = new URL(window.location.href);
      url.searchParams.delete('openForm');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
  }, [isClient, categoryParam, modeParam, duplicateOfParam, voteFromSuggestionParam, followUpToParam, openFormParam]);

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
  }, [title, details, pollContext, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, category, duplicateOf, isClient, saveFormState, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, drafts]);

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

    const validationError = getValidationError();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsLoading(true);
    setError(null);

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
      const responseDeadline = calculateDeadline();

      const creatorSecret = generateCreatorSecret();

      // Resolve the poll-level prephase cutoff once. Used both for the wrapper
      // field and for each draft that has a prephase (suggestion mode + time).
      const prephaseMinutes = pollHasPrephase ? getSuggestionCutoffMinutes() : null;
      // Custom prephase deadline (absolute, not deferred): bypass minutes.
      let prephaseDeadlineIso: string | null = null;
      if (pollHasPrephase && suggestionCutoff === 'custom' && customSuggestionDate && customSuggestionTime) {
        prephaseDeadlineIso = new Date(`${customSuggestionDate}T${customSuggestionTime}`).toISOString();
      }

      // Wrapper title rule:
      //  - Exactly 1 draft and the user typed an explicit title: use it.
      //    Preserves legacy single-question yes_no behavior.
      //  - Otherwise: send null; the server auto-generates from question
      //    categories + poll context.
      const onlyDraft = drafts.length === 1 ? drafts[0] : null;
      const wrapperTitle = onlyDraft && !onlyDraft.isAutoTitle ? onlyDraft.title.trim() : null;

      const questionsForRequest: CreateQuestionParams[] =
        drafts.map(d => draftToQuestionParams(d, prephaseMinutes));

      // Find duplicate when this is a follow-up to an existing question.
      const dedupTitle = wrapperTitle || onlyDraft?.title || '';
      if (followUpTo && dedupTitle.trim()) {
        try {
          const existing = await apiFindDuplicateQuestion(dedupTitle, followUpTo);
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

      let createdQuestion: Question;
      let createdPoll: Poll;
      try {
        createdPoll = await apiCreatePoll({
          creator_secret: creatorSecret,
          creator_name: creatorName.trim() || undefined,
          response_deadline: responseDeadline,
          prephase_deadline: prephaseDeadlineIso,
          prephase_deadline_minutes: prephaseDeadlineIso ? null : prephaseMinutes != null ? Math.round(prephaseMinutes) : null,
          follow_up_to: followUpTo || duplicateOf || null,
          title: wrapperTitle,
          context: pollContext.trim() || null,
          details: details.trim() || null,
          questions: questionsForRequest,
        });
        createdQuestion = createdPoll.questions[0];
      } catch (apiError: any) {
        console.error("Error creating question:", apiError);
        setError(apiError.message || "Failed to create question. Please try again.");
        setIsLoading(false);
        isSubmittingRef.current = false;
        reEnableForm(form);
        return;
      }

      // Record creation for every question so the creator gets access +
      // creator_secret for all of them. The wrapper's secret is shared across
      // questions server-side; recordQuestionCreation just persists the mapping
      // locally per question id (used by FollowUp/Close/Reopen actions).
      for (const sp of createdPoll.questions) {
        recordQuestionCreation(sp.id, creatorSecret);
      }

      // For suggestion questions, creators vote after creation like any other participant
      // No initial vote is created

      // Trigger question discovery if this is a follow-up question
      if (followUpTo) {
        try {
          await triggerDiscoveryIfNeeded();
        } catch (error) {
          // Don't fail the question creation if discovery fails
        }
      }

      // Save the creator's name if they provided one
      if (creatorName.trim()) {
        saveUserName(creatorName.trim());
      }

      // Clear saved form state since question was created successfully
      clearFormState();

      // Mark as submitted to prevent further submissions
      setIsSubmitted(true);

      // Smoothie transition: morph the draft poll card from dashed/blue
      // "Draft Poll" styling to a solid normal-card style, slide the bottom
      // panel down, hide the bubble bar — then navigate to the new poll.
      // The CSS transition is 600ms (see the draft poll card className), and
      // the panel slide-down animation is 300ms (animate-slide-down). We hold
      // for 600ms so both finish before the navigation unmounts the panel.
      setIsFinalizing(true);
      window.dispatchEvent(new CustomEvent('createPanelFinalize'));
      await new Promise(r => setTimeout(r, 600));

      // Navigate to the new question. `questionBackTarget.set` records the thread
      // URL so the question page's back button leads to the thread containing
      // it (oldest ancestor on top). `router.replace` drops `?create=1`.
      // Phase 5b: short_id lives on the poll wrapper, so the redirect
      // targets the wrapper's friendly URL. The thread back target walks
      // poll-level chains via findThreadRootRouteId.
      const redirectId = createdPoll.short_id ?? createdQuestion.id;
      questionBackTarget.set(redirectId, findThreadRootRouteId(createdPoll, pollLookup()));
      router.replace(`/p/${redirectId}`);
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
      isSubmittingRef.current = false;
      reEnableForm(form);
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

  const validationError = getValidationError();
  const submitDisabled = isLoading || isSubmitted || topModalOpen || !!validationError;

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

  // Question-specific JSX rendered into the TOP MODAL portal.
  // Mirrors the legacy single-form rendering, minus voting / suggestion
  // cutoff and Notes / Name (those moved to the bottom modal as poll fields).
  const questionFormBody = (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }} className="space-y-4">
      {questionType === 'time' && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setQuestionType('question')}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Switch to Preferences Question
          </button>
        </div>
      )}

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

      {questionType === 'question' && category !== 'time' && isPreferenceQuestion && (
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

      {/* Allow pre-ranking: per-section setting for ranked_choice in suggestion mode */}
      {questionType === 'question' && category !== 'time' && isSuggestionMode && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allowPreRanking}
            onChange={(e) => setAllowPreRanking(e.target.checked)}
            disabled={isLoading}
            className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Allow voters to pre-rank during the suggestion phase
          </span>
        </label>
      )}
    </form>
  );

  return (
    <div className="question-content">
      {submitPortal && createPortal(
        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={submitDisabled}
          className="h-[43px] px-4 flex items-center justify-center rounded-full bg-blue-500 text-white font-semibold text-[15px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitted || isLoading ? (
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : 'Submit'}
        </button>,
        submitPortal
      )}

      {/* Bottom modal title portal stays empty — title display is per-section
          inside the top modal now. Leaving the portal mounted by template.tsx
          intentionally empty avoids layout shift if a future feature wants
          to inject a poll-level summary line. */}
      {error && (
        <div className="mb-4 p-2 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md">
          {error}
        </div>
      )}

      {/* Draft poll card — portal-rendered into the page's poll list at the
          bottom (`#draft-poll-portal`). Uses the SAME ThreadListItem that
          live polls use, with a draftMode flag for the dashed-blue chrome
          + DRAFT pill. Below it, a collapsible "edit drafts" section lets
          the user pencil-edit each committed question. On submit the
          draftMode chrome releases (border morphs to solid, DRAFT pill
          collapses out, edit rows fold up) so the card lands on its
          final live appearance over a single CSS transition — no swap. */}
      {draftPollPortal && drafts.length > 0 && createPortal(
        <div data-draft-poll-card className="pt-2">
          <ThreadListItem
            title={draftPreview.title}
            latestQuestionTitle={draftPreview.latestQuestionTitle}
            participantNames={[]}
            anonymousRespondentCount={0}
            questionCount={draftPreview.questionCount}
            soonestUnvotedDeadline={isClient ? calculateDeadline() : null}
            draftMode
            finalizing={isFinalizing}
            hideRespondents
            metadataExtra={isFinalizing ? 'just now' : 'ready to submit'}
          />
          {/* Collapsible edit-drafts section — the slight modification per spec
              ("don't have suggestion text input but do have the same general
              structure"). Folds up via opacity + max-height when finalizing. */}
          <div
            className={`mx-1.5 px-3 overflow-hidden transition-[max-height,opacity,padding,margin] duration-500 ease-out ${
              isFinalizing
                ? 'max-h-0 opacity-0 py-0 mb-0'
                : 'max-h-96 opacity-100 py-2 mb-3'
            }`}
          >
            <ul className="space-y-1.5">
              {drafts.map((d, i) => {
                const { icon, label } = draftCardLabels(d);
                return (
                  <li
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
                  >
                    <span className="text-lg leading-none" aria-hidden>{icon}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 shrink-0">{label}</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400 truncate flex-1 min-w-0">
                      {summarizeDraft(d)}
                    </span>
                    {!topModalOpen && (
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
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        draftPollPortal
      )}

      {/* Poll-level fields: voting cutoff, suggestion/availability cutoff
          (when applicable), notes, creator name. All shared across every
          draft. */}
      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }} className="space-y-4">
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

        {/* Context — short single-line, drives the auto-title "for X". */}
        <div>
          {pollContextOpen ? (
            <>
              <label htmlFor="pollContext" className="block text-sm font-medium mb-1">
                Context
              </label>
              <input
                type="text"
                id="pollContext"
                ref={pollContextRef}
                value={pollContext}
                onChange={(e) => setPollContext(e.target.value)}
                onBlur={() => {
                  const trimmed = pollContext.trim();
                  if (!trimmed) {
                    setPollContextOpen(false);
                    setPollContext('');
                  } else if (trimmed !== pollContext) {
                    setPollContext(trimmed);
                  }
                }}
                disabled={isLoading}
                maxLength={80}
                className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Friday night, lunch, etc."
              />
            </>
          ) : (
            <div className="text-sm font-medium">
              Context:{' '}
              <button
                type="button"
                onClick={() => {
                  setPollContextOpen(true);
                  setTimeout(() => pollContextRef.current?.focus(), 0);
                }}
                className="font-normal text-blue-600 dark:text-blue-400"
              >
                {pollContext || 'Add'}
              </button>
            </div>
          )}
        </div>

        {/* Notes — multi-line longer description. */}
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

        <CompactNameField name={creatorName} setName={setCreatorName} disabled={isLoading} />
      </form>

      {validationError && drafts.length > 0 && (
        <p className="text-sm text-red-500 dark:text-red-400 text-center mt-3">
          {validationError}
        </p>
      )}

      {/* TOP MODAL — question-specific form, opened by What/When/Where or
          pencil-edit. Anchored just above the bottom modal sheet via the
          --bottom-modal-height CSS var (set by template.tsx's ResizeObserver).
          As the bottom sheet grows/shrinks, the top sheet rides above it. The
          height cap is "viewport minus bottom sheet minus safe-area-top minus
          breathing room" so the top sheet never crosses the notch. */}
      {topModalOpen && isClient && createPortal(
        <div
          className="fixed left-2 right-2 z-[70] rounded-3xl bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-hidden"
          style={{
            bottom: 'calc(var(--bottom-modal-height, 50vh) + 8px)',
            maxHeight: 'calc(100vh - var(--bottom-modal-height, 50vh) - env(safe-area-inset-top, 0px) - 24px)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header — same X/check button style as the bottom modal. */}
          <div className="flex-shrink-0 relative flex items-center justify-between px-4 pt-3 pb-2">
            <button
              type="button"
              onClick={handleTopModalCancel}
              className="w-[43px] h-[43px] flex items-center justify-center rounded-full bg-gray-200/80 dark:bg-gray-700/80 cursor-pointer z-10"
              aria-label="Close question form"
            >
              <svg className="w-[34px] h-[34px] text-black dark:text-white" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" strokeLinecap="round" strokeWidth={0.75} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <h2 className="absolute inset-0 flex items-center justify-center text-[17px] font-semibold pointer-events-none">
              {editingDraftIndex !== null ? 'Edit Question' : 'New Question'}
            </h2>
            <button
              type="button"
              onClick={handleCheckCommit}
              disabled={isLoading || !!getCurrentQuestionFormError()}
              className="w-[43px] h-[43px] flex items-center justify-center rounded-full bg-blue-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed z-10"
              aria-label="Save question"
            >
              <svg className="w-[28px] h-[28px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
          {/* Title line — same CategoryForLine for question mode, or animated title for time. */}
          <div className="flex-shrink-0 px-4">
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
          {/* Scrollable form body */}
          <div className="overflow-auto overscroll-contain min-h-0">
            <div className="px-4 pt-2 pb-5">
              {questionFormBody}
            </div>
          </div>
        </div>,
        document.body
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

// Redirect /create-poll to /?create so the modal opens over the home page.
export default function CreateQuestionRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('create', '1');
    window.location.replace(`/?${params.toString()}`);
  }, []);

  return null;
}
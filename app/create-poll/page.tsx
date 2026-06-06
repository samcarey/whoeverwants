"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  apiCreatePoll,
  apiFindDuplicateQuestion,
  apiGetPollCategoryHistory,
  CreateQuestionParams,
} from "@/lib/api";
import type { Poll, OptionsMetadata, Question } from "@/lib/types";
import TypeFieldInput, { BUILT_IN_TYPES, FOR_FIELD_PLACEHOLDERS, getBuiltInType, isLocationLikeCategory } from "@/components/TypeFieldInput";
import ModalPortal from "@/components/ModalPortal";
import ConfirmationModal from "@/components/ConfirmationModal";
import AccountGateModal from "@/components/AccountGateModal";
import { useAppPrefetch } from "@/lib/prefetch";
import { getUserName, saveUserName, getUserMinResponses, saveUserMinResponses, getUserCollectSuggestions, saveUserCollectSuggestions, getUserCollectAvailability, saveUserCollectAvailability } from "@/lib/userProfile";
import { debugLog } from "@/lib/debugLogger";
import OptionsInput from "@/components/OptionsInput";
import CategoryEmojiField from "@/components/CategoryEmojiField";
import CompactMinResponsesField from "@/components/CompactMinResponsesField";
import ScoringAlgorithmField from "@/components/ScoringAlgorithmField";
import SliderSwitch from "@/components/SliderSwitch";
import { VOTING_CUTOFF_OPTIONS } from "@/components/VotingCutoffConditionsModal";
import VotingCutoffField from "@/components/VotingCutoffField";
import CompactNumberRow from "@/components/CompactNumberRow";
import OutcomeInfoButton from "@/components/OutcomeInfoButton";
import MinMaxCounter from "@/components/MinMaxCounter";
import DayTimeWindowsInput from "@/components/DayTimeWindowsInput";
import DaysSelector from "@/components/DaysSelector";
import ReferenceLocationInput from "@/components/ReferenceLocationInput";
import ShowtimeCreateFlow, { ShowtimeCurated } from "./ShowtimeCreateFlow";
import type { DayTimeWindow } from "@/lib/types";
import { useDayTimeWindowsState } from "@/lib/useDayTimeWindowsState";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { windowDurationMinutes, formatDurationLabel, formatDeadlineLabel, formatMonthYearLabel, shiftMonth, DEFAULT_TIME_WINDOW, formatLocalDateISO } from "@/lib/timeUtils";
import { getGroupHrefForPoll, resolveGroupRootRouteId } from "@/lib/groupUtils";
import { enterAdvancesFocus } from "@/lib/formNavigation";
import { haptic } from "@/lib/haptics";
import { isValidUserName, validateUserName } from "@/lib/nameValidation";
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
import { PANEL_HEIGHT_VAR, PANEL_OFFSET_VAR } from "@/components/BubbleBarPanel";
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
  anyDraftUsesAvailabilityPhase,
  anyDraftHasSuggestion,
  anyDraftIsRankedChoice,
  sharedDraftContext,
  synthesizePlaceholderPoll,
} from "./createPollHelpers";
export const dynamic = 'force-dynamic';

// Matches the rendered height of a single-line <input> with py-2 padding.
// Used for the Details textarea initial height and auto-grow reset.
const SINGLE_LINE_INPUT_HEIGHT = 42;

// Order matches the dropdown inside the modal so muscle memory carries over.
// The leading "New" button (rendered separately at the start of the row)
// is the catch-all that opens the modal with the default `custom` category;
// the in-row entries below cover the built-in categories. The old trailing
// "Other" entry was retired in favor of "New" since it duplicated the same
// custom-category landing experience.
const BUBBLE_ENTRIES: Array<{ value: string; label: string; icon?: string }> = [
  ...BUILT_IN_TYPES,
];

// Categories a deep-link / Siri `?category=` param is allowed to preselect.
// Anything outside this set (or absent) falls back to the catch-all `custom`
// category, so a malformed param can never push the form into an invalid state.
const VALID_PREFILL_CATEGORIES = new Set<string>([
  ...BUILT_IN_TYPES.map((t) => t.value),
  "custom",
]);
function normalizePrefillCategory(raw: string | null): string {
  return raw && VALID_PREFILL_CATEGORIES.has(raw) ? raw : "custom";
}

// Per-app-start random fallback order for category bubbles the user has
// never created a poll for. Computed ONCE at module load (a fresh page
// load / app cold-start reshuffles) so the order is stable across
// re-renders within a session but varies between sessions, per the
// spec's "random order generated each time the app is started". Module
// scope is browser-only here (the file is `"use client"` + lazy-loaded),
// so `Math.random()` never runs during SSR.
const SESSION_BUBBLE_FALLBACK_ORDER: string[] = (() => {
  const values = BUBBLE_ENTRIES.map((e) => e.value);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
})();

// Order the category bubbles by: (1) categories the user created polls
// for most recently in THIS group, (2) most recently in general, then
// (3) the per-session random fallback for everything not yet seen. Only
// the built-in category set (BUBBLE_ENTRIES) is ordered — the leading
// bold "New Poll" catch-all is pinned separately at the row start, and
// any custom-text categories in the history simply don't match a bubble.
function orderBubbleEntries(
  entries: typeof BUBBLE_ENTRIES,
  groupRecency: string[],
  generalRecency: string[],
): typeof BUBBLE_ENTRIES {
  const byValue = new Map(entries.map((e) => [e.value, e]));
  const ordered: typeof BUBBLE_ENTRIES = [];
  const seen = new Set<string>();
  const take = (value: string) => {
    const entry = byValue.get(value);
    if (entry && !seen.has(value)) {
      ordered.push(entry);
      seen.add(value);
    }
  };
  groupRecency.forEach(take);
  generalRecency.forEach(take);
  SESSION_BUBBLE_FALLBACK_ORDER.forEach(take);
  return ordered;
}

// --- Search-bar text parsing -------------------------------------------
// Split the typed text on a standalone "for": everything after the first
// " for " becomes the poll's context (prefilled into `forField` on every
// suggestion), everything before is the subject used for the category
// filter / options / custom-category name. "for" only counts as a whole
// word, so "comfortable" / "fortnite" don't trip it.
function parseForContext(raw: string): { subject: string; context: string } {
  const m = raw.match(/\bfor\b/i);
  if (!m || m.index === undefined) return { subject: raw.trim(), context: "" };
  return {
    subject: raw.slice(0, m.index).trim(),
    context: raw.slice(m.index + m[0].length).trim(),
  };
}

// Parse free text into poll options by splitting on commas and the word
// "or" (so "pizza, tacos or sushi" → ["pizza", "tacos", "sushi"]). The
// oxford "a, b, or c" form is handled by collapsing " or " to a comma
// first. Trims, drops blanks, and de-dupes case-insensitively (keeping the
// first spelling). Returns the list; callers gate on length >= 2.
function parseOptionsFromText(text: string): string[] {
  const parts = text
    .replace(/\s+or\s+/gi, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function CreateQuestionContent() {
  const { prefetch } = useAppPrefetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const followUpToParam = searchParams.get('followUpTo');
  const duplicateOfParam = searchParams.get('duplicate');
  const voteFromSuggestionParam = searchParams.get('voteFromSuggestion');
  // Deep-link / Siri prefill (Phase 1 of docs/siri-integration-plan.md). An
  // App Intent opens `/g/?create=1[&title=<spoken text>][&category=<cat>]`;
  // these open the create modal with the spoken text preset as the title.
  const prefillTitleParam = searchParams.get('title');
  const prefillCategoryParam = searchParams.get('category');
  const prefillCreateParam = searchParams.get('create');

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
  const [minParticipants, setMinParticipants] = useState<number>(2);
  const [exclusionTolerance, setExclusionTolerance] = useState<number>(0);
  const [supplyCount, setSupplyCount] = useState<number>(1);
  const [revealClaimantNames, setRevealClaimantNames] = useState<boolean>(true);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const advanceCalendarMonth = useCallback((delta: number) => {
    setCalendarMonth(prev => shiftMonth(prev, delta));
  }, []);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  // The compact view is anchored to today (a rolling 3 weeks), so whenever
  // the calendar is collapsed reset the navigable month back to today's
  // month — keeps the centered header consistent with the compact grid and
  // gives a fresh starting point the next time it's expanded.
  useEffect(() => {
    if (!calendarExpanded) {
      const now = new Date();
      setCalendarMonth(prev =>
        prev.getFullYear() === now.getFullYear() && prev.getMonth() === now.getMonth()
          ? prev
          : new Date(now.getFullYear(), now.getMonth(), 1)
      );
    }
  }, [calendarExpanded]);
  const {
    onDaysSelected: handleDaysSelected,
    onWindowsChange: handleDayWindowsChange,
    onDeleteDay: handleDeleteDay,
    reset: resetDayTimeWindowsCache,
  } = useDayTimeWindowsState(dayTimeWindows, setDayTimeWindows);
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
  // Set when the create form opens for a yes/no poll, consumed by the title
  // input's callback ref the moment it attaches. A flag (not a focus()-in-effect)
  // is required because the input mounts inside <ModalPortal>, which defers its
  // children to a later commit than the open — an effect would fire while the
  // input is still null and never re-run.
  const shouldFocusTitleRef = useRef(false);
  // Throwaway off-screen input used to keep the iOS soft keyboard open while
  // the real title input mounts (see primeKeyboard).
  const keyboardPrimerRef = useRef<HTMLInputElement | null>(null);
  const removeKeyboardPrimer = useCallback(() => {
    const el = keyboardPrimerRef.current;
    if (el) {
      keyboardPrimerRef.current = null;
      el.remove();
    }
  }, []);
  // iOS WebKit only raises the soft keyboard when focus() runs synchronously
  // inside the tap that triggered it. The title input mounts asynchronously
  // (state update + <ModalPortal>'s deferred mount), so focusing it from the
  // callback ref happens after the user-activation window closes — the caret
  // lands but the keyboard stays down. Synchronously focusing a throwaway
  // off-screen input during the tap claims the keyboard; once the real input
  // mounts, setTitleInputRef transfers focus to it and iOS keeps the keyboard
  // up across the move. Must be called within the tap handler's call stack.
  const primeKeyboard = useCallback(() => {
    if (typeof document === 'undefined') return;
    removeKeyboardPrimer();
    const tmp = document.createElement('input');
    tmp.type = 'text';
    tmp.setAttribute('aria-hidden', 'true');
    tmp.tabIndex = -1;
    // 16px font-size avoids iOS focus-zoom; opacity 0 + 1px keeps it invisible.
    tmp.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;margin:0;background:transparent;';
    document.body.appendChild(tmp);
    tmp.focus({ preventScroll: true });
    keyboardPrimerRef.current = tmp;
    // Safety net in case the real input never claims focus.
    window.setTimeout(removeKeyboardPrimer, 1500);
  }, [removeKeyboardPrimer]);
  const setTitleInputRef = useCallback((node: HTMLInputElement | null) => {
    titleInputRef.current = node;
    if (node && shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      node.focus({ preventScroll: true });
      removeKeyboardPrimer();
    }
  }, [removeKeyboardPrimer]);

  const [suggestionCutoff, setSuggestionCutoff] = useState("0.5x");
  const [customSuggestionDate, setCustomSuggestionDate] = useState('');
  const [customSuggestionTime, setCustomSuggestionTime] = useState('');
  const [allowPreRanking, setAllowPreRanking] = useState(true);
  // "Plus one/more": null = follow the type-based default (ON when the poll has
  // a time question, OFF otherwise); true/false is an explicit user override.
  const [allowPlusOnes, setAllowPlusOnes] = useState<boolean | null>(null);
  const [details, setDetails] = useState("");
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const [category, setCategory] = useState<string>('custom');
  // Emoji for a custom category (empty = use the default fallback glyph).
  const [categoryEmoji, setCategoryEmoji] = useState<string>("");
  const [forField, setForField] = useState("");
  const [optionsMetadata, setOptionsMetadata] = useState<OptionsMetadata>({});
  // Reference location for proximity-based search
  const [refLatitude, setRefLatitude] = useState<number | undefined>(undefined);
  const [refLongitude, setRefLongitude] = useState<number | undefined>(undefined);
  const [refLocationLabel, setRefLocationLabel] = useState("");
  const [searchRadius, setSearchRadius] = useState(25);
  const [minResponses, setMinResponses] = useState<number>(1);
  const [showPreliminaryResults, setShowPreliminaryResults] = useState(true);
  // "Collect Suggestions before Vote" — per-question (only shown for
  // ranked_choice). ON makes the poll collect suggestions first (typed
  // options become the creator's initial suggestions); OFF is a fixed-options
  // ranked_choice. Default ON; the last submitted value is remembered per user.
  const [collectSuggestions, setCollectSuggestions] = useState(true);
  // "Ask for Availability before Voting" — per-question (only shown for
  // time). ON keeps the two-phase availability → preferences flow; OFF starts
  // the poll directly as a preference poll over the slots derived from the
  // creator's time windows. Default ON; the last submitted value is remembered.
  const [collectAvailability, setCollectAvailability] = useState(true);
  // Ranked-choice headline method — per-question (only shown for ranked_choice).
  // 'consensus' (Borda, default): the option ranked highest across the most ballots.
  // 'favorite' (IRV): strongest core / most first-choice support.
  const [winnerMethod, setWinnerMethod] = useState<'favorite' | 'consensus'>('consensus');

  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // When the user taps a poll suggestion but hasn't saved a name, stash a
  // retry thunk and open the AccountGateModal. On save, the thunk replays
  // the exact suggestion (`openModalWithDraft(overrides)`) so the form lands
  // prefilled. A thunk (vs. a category string) is needed because suggestions
  // now carry a full draft prefill (title / options / context), not just a
  // category.
  const [pendingSearchAction, setPendingSearchAction] = useState<(() => void) | null>(null);

  // --- Poll-creation search bar (the always-visible bottom pill) ---------
  // `searchFocused` flips when the bottom text box gains/loses focus. When
  // focused the pill expands into a full-screen, keyboard-aware category
  // picker (see `pollSearchBar`). `searchQuery` filters the category rows.
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchListRef = useRef<HTMLDivElement | null>(null);
  // Visible-viewport geometry, tracked so the focused picker fills exactly
  // the area above the on-screen keyboard. iOS keeps the layout viewport at
  // full height when the keyboard opens (a `position: fixed; bottom: 0`
  // element would sit BEHIND the keyboard), so we pin the picker container
  // to `top: vv.offsetTop; height: vv.height` — its bottom edge then lands
  // flush on the keyboard's top edge and the input bar (the container's last
  // child) sits just above it.
  const [searchVv, setSearchVv] = useState<{ height: number; offsetTop: number }>({
    height: 0,
    offsetTop: 0,
  });
  const searchBarRef = useRef<HTMLDivElement | null>(null);

  // A ranked_choice question is a "suggestion poll" when the creator left the
  // "Collect Suggestions before Vote" toggle on — regardless of whether they
  // typed any initial options. Drives the poll-level prephase fields.
  const isSuggestionMode = questionType === 'question' && category !== 'yes_no' && category !== 'time' && category !== 'limited_supply' && category !== 'showtime' && collectSuggestions;

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
      // limited_supply: the title is the user-typed item name (isAutoTitle is
      // false), so there's nothing to auto-generate.
      if (category === 'limited_supply') {
        return '';
      }
      if (category === 'time') {
        return appendFor("Time?");
      }
      // showtime: "Showtime for {Film}" — the film name is in forField.
      if (category === 'showtime') {
        return appendFor("Showtime?");
      }
      const shorten = isLocationLikeCategory(category) ? shortenLocation : shortenOption;
      // Suggestion polls are titled by category, not by the typed options
      // (those are just the creator's initial suggestions), so ignore them.
      const filled = collectSuggestions ? [] : options.filter(o => o.trim()).map(shorten);
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
  }, [questionType, category, options, forField, collectSuggestions]);

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
    // Reset any chosen emoji on a category change so the always-visible emoji
    // field falls back to showing the new category's default icon (as the
    // faded placeholder) until the creator deliberately picks an override.
    setCategoryEmoji('');
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
        categoryEmoji,
        forField,
        durationMinValue,
        durationMaxValue,
        durationMinEnabled,
        durationMaxEnabled,
        dayTimeWindows,
        supplyCount,
        revealClaimantNames,
        minResponses,
        showPreliminaryResults,
        allowPreRanking,
        allowPlusOnes,
        collectSuggestions,
        winnerMethod,
        collectAvailability,
        drafts,
      };
      localStorage.setItem('questionFormState', JSON.stringify(formState));
    }
  }, [title, questionType, details, options, deadlineOption, customDate, customTime, creatorName, isAutoTitle, category, categoryEmoji, forField, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, supplyCount, revealClaimantNames, minResponses, showPreliminaryResults, allowPreRanking, allowPlusOnes, collectSuggestions, winnerMethod, collectAvailability, drafts]);

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
          if (formState.categoryEmoji !== undefined) setCategoryEmoji(formState.categoryEmoji);
          if (formState.forField) setForField(formState.forField);

          if (formState.durationMinValue !== undefined) setDurationMinValue(formState.durationMinValue);
          if (formState.durationMaxValue !== undefined) setDurationMaxValue(formState.durationMaxValue);
          if (formState.durationMinEnabled !== undefined) setDurationMinEnabled(formState.durationMinEnabled);
          if (formState.durationMaxEnabled !== undefined) setDurationMaxEnabled(formState.durationMaxEnabled);
          if (formState.dayTimeWindows !== undefined) setDayTimeWindows(formState.dayTimeWindows);
          if (formState.supplyCount !== undefined) setSupplyCount(formState.supplyCount);
          if (formState.revealClaimantNames !== undefined) setRevealClaimantNames(formState.revealClaimantNames);
          if (formState.minResponses !== undefined) setMinResponses(formState.minResponses);
          if (formState.showPreliminaryResults !== undefined) setShowPreliminaryResults(formState.showPreliminaryResults);
          if (formState.allowPreRanking !== undefined) setAllowPreRanking(formState.allowPreRanking);
          if (formState.allowPlusOnes !== undefined) setAllowPlusOnes(formState.allowPlusOnes);
          if (formState.collectSuggestions !== undefined) setCollectSuggestions(formState.collectSuggestions);
          if (formState.winnerMethod === 'favorite' || formState.winnerMethod === 'consensus') setWinnerMethod(formState.winnerMethod);
          if (formState.collectAvailability !== undefined) setCollectAvailability(formState.collectAvailability);
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
  const getQuestionType = (): 'yes_no' | 'ranked_choice' | 'time' | 'limited_supply' => {
    if (questionType === 'time' || category === 'time') return 'time';
    if (category === 'yes_no') return 'yes_no';
    if (category === 'limited_supply') return 'limited_supply';
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
  // A time question only contributes a prephase (availability) cutoff when its
  // "Ask for Availability before Voting" toggle is on. With it off the poll has
  // no availability phase, so it must NOT surface the cutoff field or the
  // allow-pre-vote toggle for that time question.
  const inlineFormUsesAvailability = isModalOpen && (questionType === 'time' || category === 'time') && collectAvailability;
  const inlineFormHasSuggestion = isModalOpen && isSuggestionMode;
  const pollHasAvailability = anyDraftUsesAvailabilityPhase(drafts) || inlineFormUsesAvailability;
  const pollHasSuggestion = anyDraftHasSuggestion(drafts) || inlineFormHasSuggestion;
  const pollHasPrephase = pollHasAvailability || pollHasSuggestion;
  const cutoffLabel = pollHasAvailability && pollHasSuggestion
    ? "Suggestion/Availability Cutoff"
    : pollHasAvailability
      ? "Availability Cutoff"
      : "Suggestion Cutoff";

  // "Plus one/more": the toggle defaults ON when the poll has a time question
  // (the common "answering for my partner too" scheduling case) or a
  // limited-supply question (claiming a scarce slot for yourself + others —
  // each represented person consumes one slot), OFF otherwise.
  // `allowPlusOnes === null` means "follow this default"; an explicit boolean is
  // the user's override. The inline form's contribution isn't gated on
  // isModalOpen — a time/limited-supply draft is that question type regardless
  // of whether the modal is open (unlike the prephase fields, whose
  // empty-default false-positive requires that gate). Must mirror the server
  // default in `routers/polls.py: create_poll` so the toggle reflects what
  // will actually persist.
  const inlineFormIsTime = questionType === 'time' || category === 'time';
  const inlineFormIsLimitedSupply = category === 'limited_supply';
  const inlineFormIsShowtime = category === 'showtime';
  const pollHasPlusOneDefaultType =
    (isModalOpen && (inlineFormIsTime || inlineFormIsLimitedSupply || inlineFormIsShowtime)) ||
    drafts.some((d) => {
      const t = draftDbQuestionType(d);
      return t === 'time' || t === 'limited_supply' || t === 'showtime';
    });
  const effectiveAllowPlusOnes = allowPlusOnes ?? pollHasPlusOneDefaultType;

  // A limited-supply poll's action is "claiming" a spot, not "voting" — so the
  // poll-level cutoff + plus-ones labels switch wording when EVERY question is
  // limited supply. Mixed polls (a limited-supply question alongside a yes/no,
  // etc.) keep the generic "voting" wording.
  const allDraftsLimitedSupply =
    drafts.length === 0 || drafts.every((d) => draftDbQuestionType(d) === 'limited_supply');
  const pollIsLimitedSupply =
    allDraftsLimitedSupply && (isModalOpen ? inlineFormIsLimitedSupply : drafts.length > 0);

  // Migration 098: poll-level results-display + ranked-choice settings.
  // The min-responses + show-results pair is meaningful iff the poll
  // contains at least one ranked_choice question.
  const inlineFormIsRankedChoice = isModalOpen
    && questionType === 'question'
    && category !== 'yes_no'
    && category !== 'time'
    && category !== 'limited_supply'
    && category !== 'showtime';
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
    // Showtime polls need at least one curated showtime to vote on.
    for (const d of effectiveDrafts) {
      if (d.category === 'showtime' && d.options.filter(o => o.trim() !== '').length === 0) {
        return "Pick a movie and select at least one showtime to vote on.";
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
    if (dbQuestionType === 'limited_supply') {
      if (!title.trim()) return "Please describe what's being handed out.";
      if (title.length > 100) return "Title must be 100 characters or less.";
      if (/https?:\/\/\S+|www\.\S+/i.test(title)) {
        return "Links aren't allowed in the title. Use the Notes field for links.";
      }
      if (!Number.isFinite(supplyCount) || supplyCount < 1) {
        return "Set at least one available spot.";
      }
      return null;
    }
    if (dbQuestionType === 'ranked_choice') {
      return validateRankedChoiceOptions(options, category, collectSuggestions);
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
    categoryIcon: categoryEmoji,
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
    minParticipants,
    exclusionTolerance,
    supplyCount,
    revealClaimantNames,
    collectSuggestions,
    winnerMethod,
    collectAvailability,
  }), [questionType, title, isAutoTitle, category, categoryEmoji, forField, options, optionsMetadata, refLatitude, refLongitude, refLocationLabel, searchRadius, durationMinValue, durationMaxValue, durationMinEnabled, durationMaxEnabled, dayTimeWindows, minParticipants, exclusionTolerance, supplyCount, revealClaimantNames, collectSuggestions, winnerMethod, collectAvailability]);

  // Push a draft into the per-question form state for editing.
  const applyDraftToState = useCallback((d: QuestionDraft) => {
    setQuestionType(d.questionType);
    setTitle(d.title);
    setIsAutoTitle(d.isAutoTitle);
    setCategory(d.category);
    setCategoryEmoji(d.categoryIcon ?? '');
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
    setMinParticipants(d.minParticipants);
    setExclusionTolerance(d.exclusionTolerance ?? 0);
    setSupplyCount(d.supplyCount ?? 1);
    setRevealClaimantNames(d.revealClaimantNames ?? true);
    // Default ON for drafts persisted before these fields existed.
    setCollectSuggestions(d.collectSuggestions ?? true);
    setWinnerMethod(d.winnerMethod ?? 'consensus');
    setCollectAvailability(d.collectAvailability ?? true);
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
    resetDayTimeWindowsCache();
    setCalendarExpanded(false);
    setError(null);
    setIsModalOpen(false);
    setDrafts([]);
    // Back to the type-based default for the next poll.
    setAllowPlusOnes(null);
    setShowDiscardConfirm(false);
  }, [applyDraftToState, resetDayTimeWindowsCache]);

  const handleCloseClick = useCallback(() => {
    if (inlineFormHasContent() || drafts.length > 0) {
      setShowDiscardConfirm(true);
    } else {
      closeKeepState();
    }
  }, [inlineFormHasContent, drafts.length, closeKeepState]);

  // Open the new-poll form prefilled from a partial draft. `overrides` carry
  // whatever a suggestion specifies — category, title, options, forField
  // (context), etc. — layered over a fresh `emptyDraft`. Also collapses the
  // search bar so the modal opens over a clean group view.
  const openModalWithDraft = useCallback((overrides: Partial<QuestionDraft>) => {
    // When the poll already has staged drafts AND they share a context,
    // inherit it as the new question's forField so the auto-title can
    // collapse to "Cat1, Cat2 for SharedContext" without the user retyping.
    const inheritedForField = sharedDraftContext(drafts) ?? '';
    const base = emptyDraft({
      category: overrides.category,
      forField: overrides.forField ?? inheritedForField,
      collectSuggestions: getUserCollectSuggestions() ?? true,
      collectAvailability: getUserCollectAvailability() ?? true,
    });
    const draft: QuestionDraft = { ...base, ...overrides };
    applyDraftToState(draft);
    setCreatorName(getUserName() ?? "");
    setError(null);
    // For yes/no the title IS the question prompt; focus it once the input
    // mounts (see setTitleInputRef) ONLY when no prompt was prefilled. Prime
    // the iOS keyboard synchronously here (still inside the tap) so it
    // survives the async mount of the real input.
    const focusTitle = draft.category === 'yes_no' && !draft.title.trim();
    shouldFocusTitleRef.current = focusTitle;
    if (focusTitle) primeKeyboard();
    // Collapse the search bar (and dismiss its keyboard) so the modal opens
    // over a clean group view and we're back to the unfocused pill when it
    // closes. Clearing the query keeps the next picker open fresh.
    searchInputRef.current?.blur();
    setSearchFocused(false);
    setSearchQuery("");
    setIsModalOpen(true);
  }, [applyDraftToState, drafts, primeKeyboard]);

  // Collapse the focused picker back to the bottom pill ("normal group
  // view") without opening anything — wired to the bar's ✕ button.
  const dismissSearch = useCallback(() => {
    searchInputRef.current?.blur();
    setSearchFocused(false);
    setSearchQuery("");
  }, []);

  // Pick a poll suggestion from the focused picker. Collapses the picker,
  // then either opens the form (valid name) or stashes a retry thunk and
  // opens the AccountGateModal (name required to create a poll).
  const chooseSuggestion = useCallback((overrides: Partial<QuestionDraft>) => {
    searchInputRef.current?.blur();
    setSearchFocused(false);
    if (!isValidUserName(getUserName())) {
      setPendingSearchAction(() => () => openModalWithDraft(overrides));
      return;
    }
    openModalWithDraft(overrides);
  }, [openModalWithDraft]);

  // Read showDiscardConfirm via a ref inside the Escape handler so toggling
  // the inner confirm dialog doesn't tear down + rebuild the body-position
  // lock on every open/close.
  const showDiscardConfirmRef = useRef(showDiscardConfirm);
  useEffect(() => {
    showDiscardConfirmRef.current = showDiscardConfirm;
  }, [showDiscardConfirm]);

  // `position: fixed` on body (vs. `overflow: hidden`) is required to
  // block iOS pull-to-refresh from bypassing the lock.
  useBodyScrollLock(isModalOpen, false);

  // Escape closes the sheet (preserving state). Skip when the inner
  // ConfirmationModal is open — its own document-level Escape handler runs
  // too, and we don't want one Escape to dismiss both.
  useEffect(() => {
    if (!isModalOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showDiscardConfirmRef.current) closeKeepState();
    };
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isModalOpen, closeKeepState]);

  // Track the visual viewport so the focused picker fills the area above the
  // keyboard. Only meaningful while the search bar is focused, but the
  // listener is cheap and the value is read into the picker's inline style.
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    const update = () => setSearchVv({ height: vp.height, offsetTop: vp.offsetTop });
    update();
    vp.addEventListener('resize', update);
    vp.addEventListener('scroll', update);
    return () => {
      vp.removeEventListener('resize', update);
      vp.removeEventListener('scroll', update);
    };
  }, []);

  // Portal targets for the in-progress draft poll card. Rendered in the
  // page body by the group / empty-group routes (one per route instance).
  // Re-queried via a MutationObserver that stays armed for the full
  // component lifetime — page navigations swap the portal target node
  // (and the loading-spinner early-return inside GroupContent unmounts it
  // transiently), so a self-disconnecting observer can leave us holding
  // a stale reference pointing at a detached node.
  //
  // We render into EVERY `#draft-poll-portal` in the DOM, not just the
  // last one. During a slide-overlay transition there are two
  // simultaneously: the real route's (inside #__next) and the overlay's
  // (createPortal'd directly under <body>, so it appears later in DOM
  // order). Both sit at the same screen position; the overlay's z=60
  // layer covers the real-route one during the slide. Rendering into
  // both means:
  //   - During the slide: user sees the overlay copy slide in (the real-
  //     route copy underneath is hidden by the overlay's opaque layer).
  //   - When the overlay unmounts, the real-route copy is already there
  //     — no portal-target swap, no React commit gap, no blink.
  // Without this, the unmount of the overlay's portal target would force
  // a setState → render → commit cycle to move the bubble bar from the
  // (now-detached) overlay portal to the real-route portal, producing
  // one frame where the bubble bar is rendered into a detached node and
  // thus invisible.
  //
  // The listener runs synchronously on every mutation (no rAF
  // coalescing). React still no-op-renders when the list of portal
  // targets is unchanged (reference-equality on every entry via the
  // arraysShallowEqual check), so typing / scrolling don't trigger
  // re-renders even though the listener fires on every body-subtree
  // mutation.
  // Stable React keys per portal target (NOT positional indexes). When a
  // target is removed from the front of the list, index-based keys would
  // shift survivors and force React to teardown + remount their bubble
  // bar subtree — exactly the kind of churn this whole effect is trying
  // to avoid. WeakMap + counter assign each DOM node a permanent id;
  // assignment happens inside the effect's callback so refs aren't read
  // during render.
  const [draftPollPortals, setDraftPollPortals] = useState<Array<{ key: string; target: HTMLElement }>>([]);
  useEffect(() => {
    const keys = new WeakMap<HTMLElement, string>();
    let nextKey = 0;
    const keyFor = (target: HTMLElement): string => {
      let k = keys.get(target);
      if (k === undefined) {
        k = String(++nextKey);
        keys.set(target, k);
      }
      return k;
    };
    const entriesShallowEqual = (
      a: Array<{ key: string; target: HTMLElement }>,
      b: Array<{ key: string; target: HTMLElement }>,
    ) => a.length === b.length && a.every((x, i) => x.target === b[i].target);
    const check = () => {
      const all = Array.from(
        document.querySelectorAll<HTMLElement>(`#${DRAFT_POLL_PORTAL_ID}`)
      ).map(target => ({ key: keyFor(target), target }));
      setDraftPollPortals(prev => (entriesShallowEqual(prev, all) ? prev : all));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);

  // Mirror the unfocused bar's height into the CSS vars the group page reads
  // for its bottom padding, so the last poll card clears the floating pill.
  // Only the unfocused height matters (the focused picker covers the page),
  // so skip writes while focused. `draftPollPortals` is in the deps so the
  // observer re-attaches when the bar (re)mounts into a portal target.
  const lastBarHeightRef = useRef(-1);
  useEffect(() => {
    if (searchFocused) return;
    const el = searchBarRef.current;
    if (!el) return;
    const write = () => {
      const h = Math.round(el.offsetHeight);
      if (h <= 0 || h === lastBarHeightRef.current) return;
      lastBarHeightRef.current = h;
      const root = document.documentElement.style;
      root.setProperty(PANEL_HEIGHT_VAR, `${h}px`);
      root.setProperty(PANEL_OFFSET_VAR, `${h}px`);
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [searchFocused, draftPollPortals]);

  // Track the current group (the group page sets `<body data-group-id>`)
  // so the category bubble bar can fetch + apply that group's recency
  // ordering. CreateQuestionContent is persistent across navigation, so
  // we observe the attribute rather than reading it once. Cleared to null
  // on the empty `/g/` placeholder (group page removes the attribute).
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const value = document.body.getAttribute(GROUP_ID_ATTR);
      setCurrentGroupId((prev) => (prev === value ? prev : value));
    };
    const observer = new MutationObserver(read);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [GROUP_ID_ATTR],
    });
    read();
    return () => observer.disconnect();
  }, []);

  // Recency ordering for the category bubbles. `categoryRefreshTick` is
  // bumped after a successful create so the just-used category floats to
  // the front without a navigation. Failures leave the previous order
  // intact (the bar must always render).
  const [bubbleRecency, setBubbleRecency] = useState<{ group: string[]; general: string[] }>({
    group: [],
    general: [],
  });
  const [categoryRefreshTick, setCategoryRefreshTick] = useState(0);
  useEffect(() => {
    let ignore = false;
    apiGetPollCategoryHistory(currentGroupId)
      .then((history) => {
        if (!ignore) setBubbleRecency(history);
      })
      .catch(() => {
        /* keep prior order — bubble bar must always render */
      });
    return () => {
      ignore = true;
    };
  }, [currentGroupId, categoryRefreshTick]);

  const orderedBubbleEntries = useMemo(
    () => orderBubbleEntries(BUBBLE_ENTRIES, bubbleRecency.group, bubbleRecency.general),
    [bubbleRecency],
  );

  // Build the focused picker's rows from the typed text. The list is
  // bottom-anchored (it stacks UP from just above the search bar). Order,
  // top→bottom:
  //   1. Yes/No (top) — frames the whole typed text as a yes/no question
  //      (only when there's text to frame).
  //   2. Filtered categories — the built-in category bubbles, filtered so
  //      every typed token (after stripping any "for …" context) prefix-
  //      matches a word in the category label ("vid ga" → "Video Game"),
  //      REVERSED so the best (most-recent / most-relevant) match sits at
  //      the bottom of the group, nearest the bar.
  //   3. Options — when the text parses into ≥2 comma/"or"-delimited options,
  //      a fixed-options poll of them (a strong match, so just above Custom).
  //   4. Custom (bottom, next to the bar) — a custom-category poll named after
  //      the typed text (or "New Poll" when empty), flagged with a "custom" tag.
  // A trailing "for …" clause sets `context`, prefilled into every suggestion
  // (and shown as a muted "for …" suffix). The yes/no row keeps the literal
  // text as its prompt, so it doesn't split off the context.
  const searchSuggestions = useMemo<Array<{
    key: string;
    icon: string;
    primary: string;
    context?: string;
    tag?: string;
    overrides: Partial<QuestionDraft>;
  }>>(() => {
    const raw = searchQuery.trim();
    const { subject, context } = parseForContext(raw);
    const ctx = context || undefined;
    const list: Array<{ key: string; icon: string; primary: string; context?: string; tag?: string; overrides: Partial<QuestionDraft> }> = [];

    // Yes/No (top).
    if (raw) {
      list.push({
        key: 'yesno',
        icon: '👍',
        primary: raw,
        tag: 'yes / no',
        overrides: { category: 'yes_no', title: raw, isAutoTitle: false },
      });
    }

    // Filtered categories, reversed so the best match is at the bottom.
    const tokens = subject.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const cats = tokens.length === 0
      ? orderedBubbleEntries
      : orderedBubbleEntries.filter((e) => {
          const words = e.label.toLowerCase().split(/\s+/);
          return tokens.every((t) => words.some((w) => w.startsWith(t)));
        });
    for (const e of [...cats].reverse()) {
      list.push({
        key: `cat:${e.value}`,
        icon: e.icon ?? '🗳️',
        primary: e.label,
        context: ctx,
        overrides: { category: e.value, forField: context },
      });
    }

    // Options — strong contextual match, sits just above Custom.
    const opts = parseOptionsFromText(subject);
    if (opts.length >= 2) {
      list.push({
        key: 'options',
        icon: '🗳️',
        primary: opts.join(' · '),
        context: ctx,
        tag: 'options',
        overrides: { category: 'custom', options: opts, collectSuggestions: false, forField: context },
      });
    }

    // Custom (bottom, next to the search bar).
    list.push({
      key: 'custom',
      icon: '✏️',
      primary: subject || 'New Poll',
      context: subject ? ctx : undefined,
      tag: 'custom',
      overrides: { category: subject || 'custom', forField: context },
    });

    return list;
  }, [searchQuery, orderedBubbleEntries]);

  // Keep the bottom of the bottom-anchored list (Custom + the best-matching
  // results, nearest the bar) in view. Re-pins to the bottom on focus, as the
  // suggestion set changes while typing, and as the keyboard animates in
  // (visual-viewport height shifts the overflow). Once stable the user can
  // scroll up freely to browse (e.g. to the Yes/No row on top).
  useEffect(() => {
    if (!searchFocused) return;
    const el = searchListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [searchFocused, searchSuggestions, searchVv]);

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
    const savedCollectSuggestions = getUserCollectSuggestions();
    if (savedCollectSuggestions !== null) {
      setCollectSuggestions(savedCollectSuggestions);
    }
    const savedCollectAvailability = getUserCollectAvailability();
    if (savedCollectAvailability !== null) {
      setCollectAvailability(savedCollectAvailability);
    }

    if (!followUpToParam && !duplicateOfParam && !voteFromSuggestionParam && !prefillTitleParam && !prefillCreateParam) {
      const savedFormState = loadFormState();

      // Initialize dayTimeWindows with today if no saved form state has them.
      // Default to a single 8 AM – 5 PM window so the "first day" rule lands
      // even when the day is auto-added by opening the time-bubble modal.
      if (!savedFormState || !savedFormState.dayTimeWindows || savedFormState.dayTimeWindows.length === 0) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        setDayTimeWindows([{ day: todayStr, windows: [{ ...DEFAULT_TIME_WINDOW }] }]);
      }
    }
  }, [followUpToParam, duplicateOfParam, voteFromSuggestionParam, prefillTitleParam, prefillCreateParam]);

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
            // Preserve the original's nature: a poll with concrete options
            // duplicates as a fixed-options ballot, not a suggestion round.
            // (Pre-toggle, "suggestion mode" was simply "zero options".)
            const dupHasOptions = Array.isArray(duplicateData.options)
              && duplicateData.options.some((o: string) => o && o.trim() !== '');
            setCollectSuggestions(!dupHasOptions);
            // Preserve the original's headline method (favorite/consensus).
            setWinnerMethod(duplicateData.winner_method === 'consensus' ? 'consensus' : 'favorite');
          } else if (duplicateData.question_type === 'time') {
            setQuestionType('time');
            setOptions(['']);
            if (duplicateData.time_min_participants != null) setMinParticipants(duplicateData.time_min_participants);
            if (duplicateData.exclusion_tolerance != null) setExclusionTolerance(duplicateData.exclusion_tolerance);
            // Carry over the creator's time windows, dropping any day that is
            // now in the past (a poll copied weeks later would otherwise seed
            // dead dates the calendar can't even select). The duration window
            // copies verbatim. If every day is in the past, seed today so the
            // form isn't left with an empty calendar.
            const todayStr = formatLocalDateISO(new Date());
            const sourceWindows: DayTimeWindow[] = Array.isArray(duplicateData.day_time_windows)
              ? duplicateData.day_time_windows
              : [];
            // duplicateData is freshly JSON-parsed local data, so the surviving
            // entries can be used directly (no defensive copy needed).
            const futureWindows = sourceWindows.filter(
              (dtw) => dtw && typeof dtw.day === 'string' && Array.isArray(dtw.windows) && dtw.day >= todayStr,
            );
            if (futureWindows.length > 0) {
              setDayTimeWindows(futureWindows);
            } else {
              setDayTimeWindows([{ day: todayStr, windows: [{ ...DEFAULT_TIME_WINDOW }] }]);
            }
            const dur = duplicateData.duration_window;
            if (dur && typeof dur === 'object') {
              if (dur.minValue != null) setDurationMinValue(dur.minValue);
              if (dur.maxValue != null) setDurationMaxValue(dur.maxValue);
              if (dur.minEnabled != null) setDurationMinEnabled(dur.minEnabled);
              if (dur.maxEnabled != null) setDurationMaxEnabled(dur.maxEnabled);
            }
            // Re-open as a fresh availability-phase poll (the default two-phase
            // flow); the copied windows give it real slots to work from.
            setCollectAvailability(true);
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
          if (duplicateData.category_icon) {
            setCategoryEmoji(duplicateData.category_icon);
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
          // This flow turns a finalized suggestion round into a fixed ranking
          // ballot of the nominated options — never re-open suggestion mode,
          // regardless of the user's remembered toggle preference.
          setCollectSuggestions(false);
          // Fresh ranking ballot follows the create-form default (Consensus).
          setWinnerMethod('consensus');

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

  // Deep-link / Siri prefill (Phase 1 of docs/siri-integration-plan.md). An
  // App Intent opens `/g/?create=1[&title=<spoken text>][&category=<cat>]`
  // (see ios/App/App/AppDelegate.swift); this opens the create modal with the
  // spoken text preset as the poll title. Mirrors the ?duplicate= /
  // ?voteFromSuggestion= auto-open flows. The params are consumed once and
  // stripped so a refresh / re-render doesn't reopen the modal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!prefillTitleParam && !prefillCreateParam) return;

    const cat = normalizePrefillCategory(prefillCategoryParam);
    // Fresh draft for the chosen category (resets any stale in-progress form).
    applyDraftToState(emptyDraft({
      category: cat,
      collectSuggestions: getUserCollectSuggestions() ?? true,
      collectAvailability: getUserCollectAvailability() ?? true,
    }));
    setCreatorName(getUserName() ?? "");

    const spoken = prefillTitleParam?.trim();
    if (spoken) {
      const t = spoken.slice(0, 100);
      setTitle(t);
      // Treat the spoken text as a user-authored title so the auto-title
      // effect doesn't overwrite it. Deliberately NOT setting loadedTitleRef —
      // that path is for duplicate snapshots and could flip back to auto mode.
      setIsAutoTitle(false);
    }

    setIsModalOpen(true);

    // Consume the prefill params so refresh / back doesn't re-trigger.
    const url = new URL(window.location.href);
    url.searchParams.delete('title');
    url.searchParams.delete('category');
    url.searchParams.delete('create');
    window.history.replaceState({}, '', url.toString());
  }, [prefillTitleParam, prefillCategoryParam, prefillCreateParam, applyDraftToState]);

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

    const nameCheck = validateUserName(creatorName);
    if (!nameCheck.ok) {
      setError(nameCheck.error);
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

    haptic.success();
    isSubmittingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const responseDeadline = calculateDeadline();

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
      // Custom prephase deadline (absolute): bypass minutes.
      let prephaseDeadlineIso: string | null = null;
      if (pollHasPrephase && suggestionCutoff === 'custom' && customSuggestionDate && customSuggestionTime) {
        prephaseDeadlineIso = new Date(`${customSuggestionDate}T${customSuggestionTime}`).toISOString();
      }
      // The prephase countdown starts at creation. Mirror the server's
      // _insert_poll resolution (minutes → now + minutes) so the optimistic
      // placeholder card shows the countdown right away.
      const effectivePrephaseDeadlineIso = prephaseDeadlineIso
        ?? (prephaseMinutes != null
          ? new Date(Date.now() + Math.round(prephaseMinutes) * 60 * 1000).toISOString()
          : null);

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
      //   1. The current viewer is the creator of the existing poll
      //      (server-computed `viewer_is_creator` on the cached wrapper —
      //      true after a double-tap since we cache the just-created poll),
      //   2. The existing question was created within the last 30s.
      // That narrows the rule to its real purpose: catching the
      // user who tapped Submit twice in quick succession.
      const DUPLICATE_REDIRECT_WINDOW_MS = 30_000;
      const dedupTitle = wrapperTitle || onlyDraft?.title || '';
      if (effectiveGroupId && dedupTitle.trim()) {
        try {
          const existing = await apiFindDuplicateQuestion(dedupTitle, effectiveGroupId);
          const wrapper = existing?.poll_id ? pollLookup()(existing.poll_id) : null;
          const isOwnRecentDuplicate = !!existing
            && wrapper?.viewer_is_creator === true
            && (Date.now() - new Date(existing.created_at).getTime()) < DUPLICATE_REDIRECT_WINDOW_MS;
          if (existing && isOwnRecentDuplicate) {
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
        prephaseDeadline: effectivePrephaseDeadlineIso,
        allowPlusOnes: effectiveAllowPlusOnes,
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
          // null → server applies the type-based default (ON for time polls).
          allow_plus_ones: allowPlusOnes,
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

      // Poll ownership is server-side now (migration 123): the create
      // recorded creator_user_id (auto-minting a lightweight account for an
      // anonymous creator) and the returned poll carries viewer_is_creator,
      // so there's no per-question secret to persist locally.

      saveUserName(creatorName);
      // Remember the suggestion toggle for the creator's next poll. The toggle
      // only renders for ranked_choice, so this no-ops the value for yes_no /
      // time polls (collectSuggestions keeps whatever it last was).
      saveUserCollectSuggestions(collectSuggestions);
      // Same for the time-question availability toggle (only renders for time
      // polls; keeps its last value otherwise).
      saveUserCollectAvailability(collectAvailability);
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

      // The server just recorded this poll's categories — refetch the
      // recency ordering so the bubble bar reflects the new most-recent
      // category on the next render.
      setCategoryRefreshTick((t) => t + 1);

      // Land on the new poll's detail page. The cache is hot from the
      // just-completed POLL_HYDRATED so the destination mounts instantly.
      const redirectId = createdPoll.short_id ?? createdPoll.id;
      questionBackTarget.set(redirectId, resolveGroupRootRouteId(createdPoll));
      const pollHref = getGroupHrefForPoll(createdPoll);
      if (onEmptyGroup) {
        // Replace so the empty `/g/` placeholder doesn't linger in history.
        router.replace(pollHref);
      } else {
        // Push so the group page stays the back target.
        router.push(pollHref);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  // Empty-state hint shown in the title-preview slot above the form card,
  // before any title exists. yes_no / limited_supply expose only a Title, so
  // they shouldn't reference Category/Context/Options the form doesn't have.
  const titlePreviewHint =
    category === 'yes_no' || category === 'limited_supply'
      ? "Enter a title"
      : category === 'showtime'
        ? "Pick a location, movie, and showtimes"
        : "Enter a Category, Context, and/or Options";

  const titleField = (
    <div className="flex items-center justify-between gap-3 h-12">
      <label htmlFor="title" className="text-base font-normal shrink-0">
        Title
      </label>
      <input
        type="text"
        id="title"
        ref={setTitleInputRef}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setIsAutoTitle(false);
        }}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed !== title) setTitle(trimmed);
        }}
        onKeyDown={enterAdvancesFocus}
        disabled={isLoading}
        maxLength={100}
        className="flex-1 min-w-0 text-base bg-transparent text-gray-500 dark:text-gray-500 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:italic"
        placeholder={
          isAutoTitle
            ? "auto"
            : category === 'limited_supply'
              ? "What's available?"
              : "Enter your title..."
        }
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
        <span className="text-base font-normal">{cutoffLabel}</span>
        <span className="relative inline-flex">
          <span className="text-base font-normal text-gray-500 dark:text-gray-500 text-right">
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
  // Time-poll fields (Duration, Days, Time Windows) render in their own
  // cards outside this form, so the form body is empty for time polls.
  const formHasContent = isLocationLikeCategory(category);

  const selectedDays = dayTimeWindows.map(dtw => dtw.day);
  const minDurationMinutesForWindows = durationMinEnabled && durationMinValue != null
    ? Math.round(durationMinValue * 60)
    : null;
  const questionFormBody = (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); }} className={`space-y-4${formHasContent ? ' border-t border-gray-200 dark:border-gray-700 py-3' : ''}`}>
      {isLocationLikeCategory(category) && (
        <div>
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
          {(refLatitude === undefined || refLongitude === undefined) && (
            <p className="mt-2 text-sm text-orange-600 dark:text-orange-400">
              Choose a reference location above to enable search.
            </p>
          )}
        </div>
      )}

    </form>
  );

  // Options card — rendered as a separate card below the bottom card,
  // with an external left-justified "Options" header. Only meaningful
  // for ranked-choice (non-yes_no, non-time) questions.
  const showOptionsCard = questionType === 'question' && category !== 'yes_no' && category !== 'time' && category !== 'limited_supply' && category !== 'showtime';
  const optionsCard = showOptionsCard ? (
    <div>
      <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
        {collectSuggestions ? 'Initial Suggestions' : 'Options'}
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
          hideReferenceLocationWarning
        />
      </section>
    </div>
  ) : null;

  // The poll-creation search bar. A pill-shaped text box pinned to the
  // bottom of the group view at ALL times (no hide-on-scroll). Tapping it
  // raises the keyboard and expands a full-screen, keyboard-aware list of
  // poll categories — one per row, filtered live as you type. Selecting a
  // row opens the existing new-poll form prefilled with that category; the
  // ✕ on the left of the bar collapses back to the bottom pill.
  //
  // Structure is a single `position: fixed` flex-column container so the
  // ONE `<input>` (the last child) never reparents across the focus toggle
  // (which would drop focus + dismiss the keyboard). Unfocused → container
  // is bottom-anchored auto-height (just the bar). Focused → container is
  // pinned to the visual viewport (`top: vv.offsetTop; height: vv.height`)
  // so its bottom edge lands flush on the keyboard and the list fills above
  // the bar. The bar's NO-transform fixed ancestor (the panel from
  // BubbleBarHost) keeps this `fixed` viewport-relative.
  const SEARCH_ROW_CLASS =
    "w-full flex items-center gap-4 px-5 py-3.5 text-left min-h-[3.5rem] border-b border-gray-100 dark:border-gray-800 active:bg-gray-100 dark:active:bg-gray-800 disabled:opacity-50";
  const pollSearchBar = (
    <div
      className="fixed left-0 right-0 z-40 flex flex-col"
      style={
        searchFocused
          ? searchVv.height > 0
            ? { top: searchVv.offsetTop, height: searchVv.height }
            : { top: 0, bottom: 0 }
          : { bottom: 0 }
      }
    >
      {searchFocused && (
        <div
          ref={searchListRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-background flex flex-col"
          // Clear the notch / status bar in standalone PWA (viewport-fit=cover),
          // where the visible viewport top sits under it. 0px elsewhere.
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {/* `mt-auto` bottom-anchors the rows: with spare room they stack up
              from just above the bar (best match at the bottom); once they
              overflow it collapses to 0 so the top stays scrollable. The
              auto-scroll effect keeps the bottom (best match) in view.
              onMouseDown preventDefault keeps the input focused through the
              tap so the click lands reliably before chooseSuggestion blurs it. */}
          <div className="mt-auto">
          {searchSuggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chooseSuggestion(s.overrides)}
              disabled={isLoading}
              className={SEARCH_ROW_CLASS}
              aria-label={`Create poll: ${s.primary}`}
            >
              <span className="w-7 text-center text-2xl leading-none shrink-0" aria-hidden>
                {s.icon}
              </span>
              <span className="flex-1 min-w-0 truncate text-base">
                {s.primary}
                {s.context && (
                  <span className="text-gray-400 dark:text-gray-500"> for {s.context}</span>
                )}
              </span>
              {s.tag && (
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-0.5">
                  {s.tag}
                </span>
              )}
            </button>
          ))}
          </div>
        </div>
      )}
      <div
        ref={searchBarRef}
        className={`shrink-0 px-3 pt-2 ${searchFocused ? 'bg-background' : ''}`}
        style={
          searchFocused
            ? { paddingBottom: '0.5rem' }
            : { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }
        }
      >
        <div className="flex items-center gap-1 h-12 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 pl-1 pr-2 shadow-lg">
          {searchFocused ? (
            <button
              type="button"
              onClick={dismissSearch}
              aria-label="Cancel"
              className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 active:bg-gray-200 dark:active:bg-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <span className="w-10 h-10 shrink-0 flex items-center justify-center text-gray-400 dark:text-gray-500" aria-hidden>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
            </span>
          )}
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            disabled={isLoading}
            placeholder="Create a poll…"
            aria-label="Create a poll"
            enterKeyHint="search"
            // `line-height: normal` (the font's natural metrics) — NOT
            // Tailwind's `text-base` 1.5rem line-height nor `leading-none`.
            // iOS Safari draws the caret on the font's natural ascent/descent;
            // forcing a custom line-height makes the caret and the text use
            // different metrics, so the caret sat below the placeholder. With
            // `normal` they share metrics and align (default-input behavior).
            // The row's items-center keeps the input vertically centered.
            style={{ lineHeight: 'normal' }}
            className="flex-1 min-w-0 bg-transparent outline-none text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="question-content">
      {draftPollPortals.map(({ key, target }) => createPortal(pollSearchBar, target, key))}

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
              style={{ height: 'calc(100dvh - 70px)' }}
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
                <span className="text-lg font-semibold select-none">
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
                  Bottom padding reserves breathing room above the sheet's
                  bottom edge so the last form field doesn't sit flush with
                  the rounded corner when scrolled to bottom. */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-[4.5rem] space-y-[14.4px]">
                <div className="text-center px-2 pt-1 break-words h-7 flex items-center justify-center">
                  {title.trim() ? (
                    <span
                      className="text-xl font-bold leading-7 text-blue-600 dark:text-blue-400"
                      style={{ fontFamily: "'M PLUS 1 Code', monospace" }}
                    >
                      {title.trim()}
                    </span>
                  ) : (
                    <span className="text-[0.9375rem] leading-7 italic text-gray-500 dark:text-gray-400">
                      {titlePreviewHint}
                    </span>
                  )}
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
                      <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
                        <span className="text-base font-normal shrink-0">
                          Category
                        </span>
                        <div className="flex-1 min-w-0">
                          <TypeFieldInput
                            value={category}
                            onChange={handleCategoryChange}
                            disabled={isLoading}
                            borderless
                          />
                        </div>
                      </label>
                      {category !== 'yes_no' && category !== 'limited_supply' && category !== 'showtime' && (
                        <div className="flex items-center justify-between gap-3 h-12">
                          <label htmlFor="forField" className="text-base font-normal shrink-0">
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
                            onKeyDown={enterAdvancesFocus}
                            disabled={isLoading}
                            maxLength={100}
                            placeholder={FOR_FIELD_PLACEHOLDERS[category] || ""}
                            className="flex-1 min-w-0 text-base bg-transparent text-gray-500 dark:text-gray-500 text-right focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:italic"
                          />
                        </div>
                      )}
                      {category !== 'yes_no' && category !== 'time' && category !== 'limited_supply' && category !== 'showtime' && (
                        <div
                          className={`flex items-center justify-between gap-3 h-12 ${isLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          onClick={() => { if (!isLoading) setCollectSuggestions(!collectSuggestions); }}
                        >
                          <span className="text-base font-normal">
                            Collect Suggestions before Vote
                          </span>
                          <SliderSwitch
                            checked={collectSuggestions}
                            onChange={setCollectSuggestions}
                            disabled={isLoading}
                            aria-label="Collect suggestions before vote"
                          />
                        </div>
                      )}
                      {category === 'time' && (
                        <div
                          className={`flex items-center justify-between gap-3 h-12 ${isLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          onClick={() => { if (!isLoading) setCollectAvailability(!collectAvailability); }}
                        >
                          <span className="text-base font-normal">
                            Ask for Availability before Voting
                          </span>
                          <SliderSwitch
                            checked={collectAvailability}
                            onChange={setCollectAvailability}
                            disabled={isLoading}
                            aria-label="Ask for availability before voting"
                          />
                        </div>
                      )}
                      {(category === 'yes_no' || category === 'limited_supply') && titleField}
                      {category === 'limited_supply' && (
                        <CompactNumberRow
                          label="Available spots"
                          value={supplyCount}
                          min={1}
                          setValue={setSupplyCount}
                          disabled={isLoading}
                        />
                      )}
                      {category === 'limited_supply' && (
                        <div
                          className={`flex items-center justify-between gap-3 h-12 ${isLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          onClick={() => { if (!isLoading) setRevealClaimantNames(!revealClaimantNames); }}
                        >
                          <span className="text-base font-normal">
                            Show who claimed
                          </span>
                          <SliderSwitch
                            checked={revealClaimantNames}
                            onChange={setRevealClaimantNames}
                            disabled={isLoading}
                            aria-label="Show who claimed to everyone"
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {questionFormBody}
                  {category === 'showtime' && (
                    <ShowtimeCreateFlow
                      refLatitude={refLatitude}
                      refLongitude={refLongitude}
                      refLocationLabel={refLocationLabel}
                      onLocationChange={(lat, lng, lbl) => {
                        setRefLatitude(lat);
                        setRefLongitude(lng);
                        setRefLocationLabel(lbl);
                      }}
                      searchRadius={searchRadius}
                      onSearchRadiusChange={setSearchRadius}
                      selectedKeys={options.filter((o) => o.includes(' '))}
                      onChange={(curated: ShowtimeCurated) => {
                        setOptions(curated.options.length ? curated.options : ['']);
                        setOptionsMetadata(curated.optionsMetadata);
                        setForField(curated.filmName);
                      }}
                      isLoading={isLoading}
                    />
                  )}
                </section>

                {showTimeFields && (
                  <>
                    <div>
                      <div className="relative flex items-center justify-center mb-1 px-1 h-8">
                        {calendarExpanded && (
                          <button
                            type="button"
                            onClick={() => advanceCalendarMonth(-1)}
                            disabled={isLoading}
                            aria-label="Previous month"
                            className="absolute left-1 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                        )}
                        {/* The month label stays centered; the toggle is anchored to
                            its right edge (absolute, so it doesn't shift the label) and
                            therefore stays put across the expand/collapse transition. */}
                        <div className="relative">
                          <span className="text-[17.5px] font-medium text-gray-500 dark:text-gray-400 tabular-nums">
                            {formatMonthYearLabel(calendarMonth)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCalendarExpanded(e => !e)}
                            disabled={isLoading}
                            aria-label={calendarExpanded ? "Show fewer weeks" : "Show full month"}
                            aria-expanded={calendarExpanded}
                            className="group absolute left-full top-1/2 -translate-y-1/2 ml-2 w-6 h-6 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {/* Touch target stays 24px (w-6 h-6); the visible
                                circle is 20% smaller via this inner span. */}
                            <span className="w-[19.2px] h-[19.2px] flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 group-hover:bg-gray-200 dark:group-hover:bg-gray-700">
                              <svg className="w-[12.8px] h-[12.8px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {calendarExpanded ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                )}
                              </svg>
                            </span>
                          </button>
                        </div>
                        {calendarExpanded && (
                          <button
                            type="button"
                            onClick={() => advanceCalendarMonth(1)}
                            disabled={isLoading}
                            aria-label="Next month"
                            className="absolute right-1 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-3">
                        <DaysSelector
                          selectedDays={selectedDays}
                          onChange={handleDaysSelected}
                          disabled={isLoading}
                          inline
                          currentMonth={calendarMonth}
                          compact={!calendarExpanded}
                        />
                      </section>
                    </div>
                    {dayTimeWindows.length > 0 && (
                      <div>
                        <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                          Time Windows
                        </label>
                        <section className="rounded-3xl bg-white dark:bg-gray-800 pl-4 pr-3">
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
                                allDays={dayTimeWindows}
                                borderless
                              />
                            ))}
                          </div>
                        </section>
                      </div>
                    )}
                    <div>
                      <label className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
                        Duration
                      </label>
                      <section className="rounded-3xl bg-white dark:bg-gray-800 px-4 py-1.5">
                        <MinMaxCounter
                          minValue={durationMinValue}
                          maxValue={durationMaxValue}
                          maxEnabled={durationMaxEnabled}
                          onMinChange={setDurationMinValue}
                          onMaxChange={setDurationMaxValue}
                          onMaxEnabledChange={setDurationMaxEnabled}
                          increment={0.25}
                          minLimit={0.25}
                          disabled={isLoading}
                          formatValue={(v) => parseFloat(v.toFixed(2)).toString()}
                          minCheckboxEnabled={durationMinEnabled}
                          onMinCheckboxChange={setDurationMinEnabled}
                          suffix="h"
                        />
                      </section>
                    </div>
                  </>
                )}

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
                      label={pollIsLimitedSupply ? 'Claiming Cutoff' : 'Voting Cutoff'}
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
                      <ScoringAlgorithmField
                        value={winnerMethod}
                        setValue={setWinnerMethod}
                        disabled={isLoading}
                      />
                    )}

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

                    {/* Time polls get "Minimum Participants" in the same slot
                        Minimum Votes occupies for other poll types. A time slot
                        counts only if at least this many people are available
                        for it; if none clears the bar the event is cancelled.
                        Only meaningful when an availability phase collects that
                        data. */}
                    {showTimeFields && collectAvailability && (
                      <CompactNumberRow
                        label="Minimum Participants"
                        value={minParticipants}
                        setValue={setMinParticipants}
                        disabled={isLoading}
                      />
                    )}

                    {/* "Attendance Leeway": how many fewer people than the
                        best-attended slot a time may have and still be offered
                        for preference voting. 0 (default) → only the
                        best-attended slot(s). Only meaningful when an
                        availability phase collects attendance to compare. */}
                    {showTimeFields && collectAvailability && (
                      <CompactNumberRow
                        label="Attendance Leeway"
                        labelInfo={
                          <OutcomeInfoButton
                            align="left"
                            text="By default only the time(s) the most people can make are offered for a final preference vote. Attendance Leeway lets times with a few fewer people stay in the running too — sometimes a slightly less-attended slot is better for other reasons. Set it to how many fewer attendees you'll tolerate: e.g. 2 keeps any time that leaves out at most 2 more people than the best slot. Voters see an orange badge on each time showing how many it excludes."
                          />
                        }
                        value={exclusionTolerance}
                        setValue={setExclusionTolerance}
                        min={0}
                        disabled={isLoading}
                      />
                    )}

                    {pollHasPrephase && (
                      <div
                        className="flex items-center justify-between gap-3 h-12 cursor-pointer"
                        onClick={() => { if (!isLoading) setAllowPreRanking(!allowPreRanking); }}
                      >
                        <span className="text-base font-normal">
                          Allow voting before options are finalized
                        </span>
                        <SliderSwitch
                          checked={allowPreRanking}
                          onChange={setAllowPreRanking}
                          disabled={isLoading}
                          aria-label="Allow voting before options are finalized"
                        />
                      </div>
                    )}

                    {/* "Plus one/more": let one person answer on behalf of
                        several. Defaults ON for time polls, OFF otherwise.
                        Limited-supply polls say "claiming" instead of
                        "voting". */}
                    {(() => {
                      const plusOnesLabel = pollIsLimitedSupply
                        ? 'Allow claiming for others (plus-ones)'
                        : 'Allow voting for others (plus-ones)';
                      return (
                        <div
                          className="flex items-center justify-between gap-3 h-12 cursor-pointer"
                          onClick={() => { if (!isLoading) setAllowPlusOnes(!effectiveAllowPlusOnes); }}
                        >
                          <span className="text-base font-normal">{plusOnesLabel}</span>
                          <SliderSwitch
                            checked={effectiveAllowPlusOnes}
                            onChange={(next) => setAllowPlusOnes(next)}
                            disabled={isLoading}
                            aria-label={plusOnesLabel}
                          />
                        </div>
                      );
                    })()}

                    {/* Emoji field — always visible, last row of the poll
                        settings card. Defaults (as the faded placeholder) to
                        the current category's icon; the creator can pick an
                        emoji to override it for any category. Shown for
                        limited supply too (placeholder = the 🎟️ default). */}
                    {category !== 'yes_no' && (
                      <CategoryEmojiField
                        value={categoryEmoji}
                        onChange={setCategoryEmoji}
                        categoryWord={category}
                        disabled={isLoading}
                        placeholder={getBuiltInType(category)?.icon}
                      />
                    )}

                  </form>
                </section>

                {/* Notes card — sits at the bottom, after poll settings.
                    The label is rendered as an external left-justified
                    header above the card. The textarea is always visible
                    (no collapse/expand) and auto-grows up to ~5 rows. */}
                <div>
                  <label
                    htmlFor="details"
                    className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1"
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

      <ConfirmationModal
        isOpen={showDiscardConfirm}
        onConfirm={discardAndClose}
        onCancel={() => setShowDiscardConfirm(false)}
        message="Discard this poll? Your changes will be lost."
        confirmText="Discard"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
      />

      <AccountGateModal
        isOpen={!!pendingSearchAction}
        message="to start a new poll"
        onSubmit={() => {
          const retry = pendingSearchAction;
          setPendingSearchAction(null);
          retry?.();
        }}
        onCancel={() => setPendingSearchAction(null)}
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
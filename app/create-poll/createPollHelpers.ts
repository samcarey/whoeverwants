/**
 * Pure helpers + constants for the create-question form.
 *
 * Lives next to page.tsx because nothing else in the app uses these;
 * they're factored out only to keep page.tsx focused on the React
 * component. If a helper grows callsites in other files, promote to
 * `lib/`.
 */
import { CreatePollParams, CreateQuestionParams } from "@/lib/api";
import { getCachedAccessiblePolls } from "@/lib/questionCache";
import { buildPollMap } from "@/lib/threadUtils";
import { getBuiltInType } from "@/components/TypeFieldInput";
import type { DayTimeWindow, OptionsMetadata } from "@/lib/types";

/**
 * Per-question form snapshot. The bottom modal holds a list of these as
 * `drafts`; the top modal edits one at a time. Captures every field the
 * top modal can edit so a draft round-trips losslessly through edit. Poll-
 * level fields (voting cutoff, notes, creator name, suggestion cutoff)
 * live on `CreateQuestionContent` itself, not on the draft.
 */
export interface QuestionDraft {
  questionType: 'question' | 'time';
  title: string;
  isAutoTitle: boolean;
  category: string;
  forField: string;
  options: string[];
  optionsMetadata: OptionsMetadata;
  refLatitude?: number;
  refLongitude?: number;
  refLocationLabel: string;
  searchRadius: number;
  minResponses: number;
  showPreliminaryResults: boolean;
  allowPreRanking: boolean;
  durationMinValue: number | null;
  durationMaxValue: number | null;
  durationMinEnabled: boolean;
  durationMaxEnabled: boolean;
  dayTimeWindows: DayTimeWindow[];
  minimumParticipation: number;
}

/** Default empty draft, optionally preselected by the What/When/Where bubble. */
export function emptyDraft(opts: { mode?: 'question' | 'time'; category?: string } = {}): QuestionDraft {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    questionType: opts.mode === 'time' ? 'time' : 'question',
    title: '',
    isAutoTitle: true,
    category: opts.category ?? 'custom',
    forField: '',
    options: [''],
    optionsMetadata: {},
    refLatitude: undefined,
    refLongitude: undefined,
    refLocationLabel: '',
    searchRadius: 25,
    minResponses: 1,
    showPreliminaryResults: true,
    allowPreRanking: true,
    durationMinValue: 1,
    durationMaxValue: 2,
    durationMinEnabled: true,
    durationMaxEnabled: true,
    dayTimeWindows: opts.mode === 'time' ? [{ day: todayStr, windows: [] }] : [],
    minimumParticipation: 95,
  };
}

/**
 * Resolve effective DB question_type for a draft. Mirrors the legacy
 * getQuestionType() in page.tsx so server-side validation rules stay aligned.
 */
export function draftDbQuestionType(d: QuestionDraft): 'yes_no' | 'ranked_choice' | 'time' {
  if (d.questionType === 'time' || d.category === 'time') return 'time';
  if (d.category === 'yes_no') return 'yes_no';
  return 'ranked_choice';
}

/** True when a draft is in "suggestion mode" (ranked_choice with no options yet). */
export function draftIsSuggestionMode(d: QuestionDraft): boolean {
  if (draftDbQuestionType(d) !== 'ranked_choice') return false;
  return d.options.filter(o => o.trim()).length === 0;
}

/** True when at least one draft needs the poll-level suggestion/availability cutoff. */
export function anyDraftUsesPrephase(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftDbQuestionType(d) === 'time' || draftIsSuggestionMode(d));
}

/**
 * Convert a draft into the `CreateQuestionParams` shape the server expects.
 * `prephaseMinutes` is the poll-level prephase cutoff resolved at submit time
 * (already accounts for fractional/absolute/custom). Returns null when not
 * applicable for the draft's type.
 */
export function draftToQuestionParams(
  d: QuestionDraft,
  prephaseMinutes: number | null,
): CreateQuestionParams {
  const dbType = draftDbQuestionType(d);
  const filledOptions = d.options.filter(o => o.trim() !== '');
  const params: CreateQuestionParams = {
    question_type: dbType,
    is_auto_title: d.isAutoTitle,
  };
  if (dbType === 'ranked_choice' && d.category !== 'custom') {
    params.category = d.category;
  }
  if (dbType === 'ranked_choice' && filledOptions.length > 0) {
    params.options = filledOptions;
  }
  if (Object.keys(d.optionsMetadata).length > 0) {
    params.options_metadata = d.optionsMetadata;
  }
  if (d.refLatitude !== undefined && d.refLongitude !== undefined) {
    params.reference_latitude = d.refLatitude;
    params.reference_longitude = d.refLongitude;
    params.reference_location_label = d.refLocationLabel;
  }
  if (dbType === 'ranked_choice') {
    params.min_responses = d.minResponses;
    params.show_preliminary_results = d.showPreliminaryResults;
  }
  if (dbType === 'ranked_choice' && filledOptions.length === 0) {
    params.suggestion_deadline_minutes = prephaseMinutes != null ? Math.round(prephaseMinutes) : 120;
    params.allow_pre_ranking = d.allowPreRanking;
  }
  if (dbType === 'time') {
    if (d.dayTimeWindows.length > 0) {
      params.day_time_windows = d.dayTimeWindows;
    }
    if (d.durationMinEnabled || d.durationMaxEnabled) {
      params.duration_window = {
        minValue: d.durationMinValue,
        maxValue: d.durationMaxValue,
        minEnabled: d.durationMinEnabled,
        maxEnabled: d.durationMaxEnabled,
      };
    }
    params.min_availability_percent = d.minimumParticipation;
    params.suggestion_deadline_minutes = prephaseMinutes != null ? Math.round(prephaseMinutes) : 120;
  }
  return params;
}

/** Compact one-line description for the draft list cards. */
export function summarizeDraft(d: QuestionDraft): string {
  const dbType = draftDbQuestionType(d);
  if (dbType === 'yes_no') {
    return d.title.trim() || 'Yes / No';
  }
  if (dbType === 'time') {
    const dayCount = d.dayTimeWindows.length;
    if (dayCount === 0) return 'When?';
    return `${dayCount} day${dayCount === 1 ? '' : 's'}`;
  }
  const filled = d.options.filter(o => o.trim() !== '');
  if (filled.length === 0) {
    const builtIn = getBuiltInType(d.category);
    if (builtIn) return `${builtIn.label} (suggestions)`;
    if (d.forField.trim()) return `Suggestions for ${d.forField.trim()}`;
    return 'Suggestions';
  }
  if (filled.length === 1) return filled[0];
  return `${filled[0]} or ${filled.length - 1} more`;
}

/** Icon + label for a draft card. Mirrors the BUILT_IN_TYPES table. */
export function draftCardLabels(d: QuestionDraft): { icon: string; label: string } {
  const dbType = draftDbQuestionType(d);
  if (dbType === 'time') return { icon: '📅', label: 'Time' };
  if (dbType === 'yes_no') return { icon: '👍', label: 'Yes / No' };
  const builtIn = getBuiltInType(d.category);
  if (builtIn) return { icon: builtIn.icon, label: builtIn.label };
  return { icon: '🗳️', label: d.category && d.category !== 'custom' ? d.category : 'Section' };
}

export function pollLookup() {
  const byPoll = buildPollMap(getCachedAccessiblePolls() ?? []);
  return (pollId: string) => byPoll.get(pollId) ?? null;
}

/**
 * Translate the existing flat questionData object into a CreatePollRequest
 * with one question. Wrapper-level fields (creator_secret, response_deadline,
 * follow_up_to, title, voting cutoff, prephase deadlines) live on the
 * poll; everything ballot-shaped stays on the question. follow_up_to is
 * a QUESTION id — the server resolves it to the parent's poll_id
 * automatically. Wrapper-level `context` carries today's `details` field;
 * per-question `context` is unused for 1-question polls and Phase 2.4
 * will start populating it for disambiguation. Pydantic supplies defaults
 * for omitted fields.
 *
 * Phase 2.4: `additionalQuestions` are prepended to the questions array so
 * staged drafts come first (display order) and the current form's question
 * is the last one. Server validates the combined list (≤1 time question,
 * distinct contexts for same-kind questions).
 */
export function questionDataToPollRequest(
  questionData: any,
  additionalQuestions: CreateQuestionParams[] = [],
): CreatePollParams {
  return {
    creator_secret: questionData.creator_secret,
    creator_name: questionData.creator_name,
    response_deadline: questionData.response_deadline,
    prephase_deadline: questionData.suggestion_deadline,
    prephase_deadline_minutes: questionData.suggestion_deadline_minutes,
    follow_up_to: questionData.follow_up_to,
    title: questionData.title,
    context: questionData.details,
    questions: [
      ...additionalQuestions,
      {
        question_type: questionData.question_type,
        category: questionData.category,
        options: questionData.options,
        options_metadata: questionData.options_metadata,
        suggestion_deadline_minutes: questionData.suggestion_deadline_minutes,
        allow_pre_ranking: questionData.allow_pre_ranking,
        min_responses: questionData.min_responses,
        show_preliminary_results: questionData.show_preliminary_results,
        min_availability_percent: questionData.min_availability_percent,
        day_time_windows: questionData.day_time_windows,
        duration_window: questionData.duration_window,
        reference_latitude: questionData.reference_latitude,
        reference_longitude: questionData.reference_longitude,
        reference_location_label: questionData.reference_location_label,
        is_auto_title: questionData.is_auto_title,
      },
    ],
  };
}

export function shortenOption(text: string) { return text.split(/[:(]/)[0].trim(); }
export function shortenLocation(text: string) { return shortenOption(text.split(',')[0].trim()); }

/**
 * Shared between full-form validation and the per-question staging validator.
 * Returns null when ranked_choice options are valid (or empty — suggestion mode).
 */
export function validateRankedChoiceOptions(
  options: string[],
  category: string,
): string | null {
  const filledOptions = options.filter(opt => opt.trim() !== '');
  const maxOptionLength = category === 'custom' ? 35 : 200;
  if (filledOptions.some(opt => opt.length > maxOptionLength)) {
    return `Question options must be ${maxOptionLength} characters or less.`;
  }
  if (filledOptions.length > 0) {
    let lastFilledIndex = -1;
    for (let i = options.length - 1; i >= 0; i--) {
      if (options[i].trim() !== '') { lastFilledIndex = i; break; }
    }
    for (let i = 0; i <= lastFilledIndex; i++) {
      if (options[i].trim() === '') {
        return "Please fill in all option fields or remove empty ones.";
      }
    }
  }
  if (filledOptions.length === 1) {
    return "Add at least one more option, or leave all options blank to ask for suggestions.";
  }
  const uniqueOptions = new Set(filledOptions.map(opt => opt.trim()));
  if (uniqueOptions.size !== filledOptions.length) {
    return "All question options must be unique (no duplicates).";
  }
  return null;
}

export const BASE_DEADLINE_OPTIONS = [
  { value: "5min", label: "5 min", minutes: 5 },
  { value: "10min", label: "10 min", minutes: 10 },
  { value: "15min", label: "15 min", minutes: 15 },
  { value: "30min", label: "30 min", minutes: 30 },
  { value: "1hr", label: "1 hr", minutes: 60 },
  { value: "2hr", label: "2 hr", minutes: 120 },
  { value: "4hr", label: "4 hr", minutes: 240 },
  { value: "custom", label: "Custom", minutes: 0 },
];

// Fractional suggestion cutoff options (relative to voting deadline).
export const FRACTIONAL_CUTOFF_OPTIONS = [
  { value: "0.25x", fraction: 0.25 },
  { value: "0.5x", fraction: 0.5 },
  { value: "0.75x", fraction: 0.75 },
];

// Absolute duration options for suggestion cutoff (base options + longer durations).
export const ABSOLUTE_CUTOFF_OPTIONS = [
  ...BASE_DEADLINE_OPTIONS.filter(o => o.value !== 'custom'),
  { value: "8hr", label: "8 hr", minutes: 480 },
  { value: "1day", label: "1 day", minutes: 1440 },
  { value: "3day", label: "3 days", minutes: 4320 },
  { value: "1week", label: "1 week", minutes: 10080 },
];

export const DEV_DEADLINE_OPTIONS = [
  { value: "10sec", label: "10 sec", minutes: 1/6 },
  ...BASE_DEADLINE_OPTIONS,
];

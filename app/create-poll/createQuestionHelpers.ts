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

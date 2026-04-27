/**
 * Pure helpers + constants for the create-poll form.
 *
 * Lives next to page.tsx because nothing else in the app uses these;
 * they're factored out only to keep page.tsx focused on the React
 * component. If a helper grows callsites in other files, promote to
 * `lib/`.
 */
import { CreateMultipollParams, CreateSubPollParams } from "@/lib/api";
import { getCachedAccessibleMultipolls } from "@/lib/pollCache";
import { buildMultipollMap } from "@/lib/threadUtils";

export function multipollLookup() {
  const byMultipoll = buildMultipollMap(getCachedAccessibleMultipolls() ?? []);
  return (multipollId: string) => byMultipoll.get(multipollId) ?? null;
}

/**
 * Translate the existing flat pollData object into a CreateMultipollRequest
 * with one sub-poll. Wrapper-level fields (creator_secret, response_deadline,
 * follow_up_to, title, voting cutoff, prephase deadlines) live on the
 * multipoll; everything ballot-shaped stays on the sub-poll. follow_up_to is
 * a POLL id — the server resolves it to the parent's multipoll_id
 * automatically. Wrapper-level `context` carries today's `details` field;
 * per-sub-poll `context` is unused for 1-sub-poll multipolls and Phase 2.4
 * will start populating it for disambiguation. Pydantic supplies defaults
 * for omitted fields.
 *
 * Phase 2.4: `additionalSubPolls` are prepended to the sub_polls array so
 * staged drafts come first (display order) and the current form's sub-poll
 * is the last one. Server validates the combined list (≤1 time sub-poll,
 * distinct contexts for same-kind sub-polls).
 */
export function pollDataToMultipollRequest(
  pollData: any,
  additionalSubPolls: CreateSubPollParams[] = [],
): CreateMultipollParams {
  return {
    creator_secret: pollData.creator_secret,
    creator_name: pollData.creator_name,
    response_deadline: pollData.response_deadline,
    prephase_deadline: pollData.suggestion_deadline,
    prephase_deadline_minutes: pollData.suggestion_deadline_minutes,
    follow_up_to: pollData.follow_up_to,
    title: pollData.title,
    context: pollData.details,
    sub_polls: [
      ...additionalSubPolls,
      {
        poll_type: pollData.poll_type,
        category: pollData.category,
        options: pollData.options,
        options_metadata: pollData.options_metadata,
        suggestion_deadline_minutes: pollData.suggestion_deadline_minutes,
        allow_pre_ranking: pollData.allow_pre_ranking,
        min_responses: pollData.min_responses,
        show_preliminary_results: pollData.show_preliminary_results,
        min_availability_percent: pollData.min_availability_percent,
        day_time_windows: pollData.day_time_windows,
        duration_window: pollData.duration_window,
        reference_latitude: pollData.reference_latitude,
        reference_longitude: pollData.reference_longitude,
        reference_location_label: pollData.reference_location_label,
        is_auto_title: pollData.is_auto_title,
      },
    ],
  };
}

export function shortenOption(text: string) { return text.split(/[:(]/)[0].trim(); }
export function shortenLocation(text: string) { return shortenOption(text.split(',')[0].trim()); }

/**
 * Shared between full-form validation and the per-sub-poll staging validator.
 * Returns null when ranked_choice options are valid (or empty — suggestion mode).
 */
export function validateRankedChoiceOptions(
  options: string[],
  category: string,
): string | null {
  const filledOptions = options.filter(opt => opt.trim() !== '');
  const maxOptionLength = category === 'custom' ? 35 : 200;
  if (filledOptions.some(opt => opt.length > maxOptionLength)) {
    return `Poll options must be ${maxOptionLength} characters or less.`;
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
    return "All poll options must be unique (no duplicates).";
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

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
import { getBuiltInType, isLocationLikeCategory } from "@/components/TypeFieldInput";
import type { DayTimeWindow, OptionsMetadata, Poll, Question } from "@/lib/types";

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
  durationMinValue: number | null;
  durationMaxValue: number | null;
  durationMinEnabled: boolean;
  durationMaxEnabled: boolean;
  dayTimeWindows: DayTimeWindow[];
  minimumParticipation: number;
}

/** Default empty draft, optionally preselected by the bubble that opened
 *  the modal. `category: 'time'` (with the default mode) is the canonical
 *  way to start a time-question draft now — questionType stays 'question'
 *  so CategoryForLine renders the inline context field, while the
 *  questionFormBody picks up time fields via `category === 'time'`. The
 *  legacy `mode: 'time'` path remains for any caller that hasn't migrated.
 *  Yes/No drafts force `isAutoTitle: false` since the title IS the prompt.
 */
export function emptyDraft(
  opts: { mode?: 'question' | 'time'; category?: string; forField?: string } = {},
): QuestionDraft {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isTime = opts.mode === 'time' || opts.category === 'time';
  const isYesNo = opts.category === 'yes_no';
  return {
    questionType: opts.mode === 'time' ? 'time' : 'question',
    title: '',
    isAutoTitle: !isYesNo,
    category: opts.category ?? 'custom',
    forField: opts.forField ?? '',
    options: [''],
    optionsMetadata: {},
    refLatitude: undefined,
    refLongitude: undefined,
    refLocationLabel: '',
    searchRadius: 25,
    durationMinValue: 1,
    durationMaxValue: 2,
    durationMinEnabled: true,
    durationMaxEnabled: true,
    dayTimeWindows: isTime ? [{ day: todayStr, windows: [] }] : [],
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

/** True when at least one draft is a ranked_choice question — these are
 *  the only ones for which "min responses to show preliminary results" is
 *  meaningful (yes/no shows results immediately, time questions don't have
 *  preliminary results). */
export function anyDraftIsRankedChoice(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftDbQuestionType(d) === 'ranked_choice');
}

/** True when at least one draft is in suggestion mode — the only case where
 *  "allow pre-ranking during the suggestion phase" is meaningful. */
export function anyDraftIsSuggestionMode(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftIsSuggestionMode(d));
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
  // `forField` → API `context` (stored on `questions.details`). Required
  // for the server's same-kind disambiguation check (otherwise 400).
  const trimmedForField = d.forField.trim();
  if (trimmedForField) {
    params.context = trimmedForField;
  }
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
  if (dbType === 'ranked_choice' && filledOptions.length === 0) {
    params.suggestion_deadline_minutes = prephaseMinutes != null ? Math.round(prephaseMinutes) : 120;
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

/**
 * Derive the question's auto-title from a draft snapshot. Mirrors
 * `generateTitle()` in page.tsx but operates on a draft (not live form
 * state) so the draft list rows can show the same title the question
 * would land on if submitted now. Returns text only — no leading icon.
 */
export function deriveDraftTitle(d: QuestionDraft): string {
  // yes_no: the user-typed question text IS the title.
  if (d.category === 'yes_no') {
    return d.title.trim() || 'Yes/No?';
  }
  // time questions: fixed "Time?" + optional " for X" suffix.
  if (d.questionType === 'time' || d.category === 'time') {
    return appendForSuffix('Time?', d.forField);
  }

  // ranked_choice: build from options if any, else fall back to the
  // category label as a placeholder.
  const builtIn = getBuiltInType(d.category);
  const shorten = isLocationLikeCategory(d.category) ? shortenLocation : shortenOption;
  const filled = d.options.filter(o => o.trim()).map(shorten);

  if (filled.length === 0) {
    const prefix = d.category === 'location' ? 'Place'
      : builtIn?.label || (d.category && d.category !== 'custom' ? d.category : '');
    if (prefix) return appendForSuffix(`${prefix}?`, d.forField);
    const trimmedFor = d.forField.trim();
    if (trimmedFor) return `Options for ${trimmedFor}?`;
    return 'Suggestions';
  }

  if (filled.length === 1) return appendForSuffix(filled[0], d.forField);

  return appendForSuffix(buildOrList(filled), d.forField);
}

const TITLE_LIMIT = 40;

function joinWithOr(items: string[]): string {
  if (items.length === 2) return `${items[0]} or ${items[1]}?`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}?`;
}

function buildOrList(items: string[]): string {
  const included = [items[0]];
  for (let i = 1; i < items.length; i++) {
    const isLast = i === items.length - 1;
    const candidate = isLast
      ? joinWithOr([...included, items[i]])
      : `${[...included, items[i]].join(', ')}, or ...?`;
    if (candidate.length > TITLE_LIMIT && included.length >= 2) break;
    included.push(items[i]);
  }
  return included.length === items.length
    ? joinWithOr(included)
    : `${included.join(', ')}, or ...?`;
}

function appendForSuffix(base: string, forField: string): string {
  const trimmed = forField.trim();
  if (!trimmed || !base) return base;
  if (base.endsWith('?')) return `${base.slice(0, -1)} for ${trimmed}?`;
  return `${base} for ${trimmed}`;
}

/**
 * Build an optimistic Poll/Question pair from the draft list at submit
 * time, before the server has responded. The thread page renders this as a
 * normal collapsed poll card while the FLIP animation runs and apiCreatePoll
 * resolves in parallel. Once the real Poll arrives, ThreadContent swaps the
 * placeholder fields for the real ones via POLL_HYDRATED_EVENT.
 *
 * IDs use a `pending-...` prefix so thread state can identify and replace
 * them on hydration. Placeholder questions get realistic-looking defaults
 * (created_at = now, is_closed = false, empty voter_names) so the
 * collapsed-card render path doesn't crash on missing fields.
 */
export function synthesizePlaceholderPoll(
  drafts: QuestionDraft[],
  args: { wrapperTitle: string | null; responseDeadline: string | null; followUpTo: string | null; creatorName: string | null },
): Poll {
  const now = new Date().toISOString();
  const pollId = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Server reuses the combined poll title across all questions; mirror
  // that so the placeholder doesn't morph the title on hydration.
  const fallbackTitle = drafts.length === 1
    ? deriveDraftTitle(drafts[0])
    : draftPollPreview(drafts, '').title;
  const titleForAllQuestions = args.wrapperTitle || fallbackTitle;
  const questions: Question[] = drafts.map((d, i) => {
    const dbType = draftDbQuestionType(d);
    const filledOptions = d.options.filter(o => o.trim() !== '');
    return {
      id: `${pollId}-q${i}`,
      title: titleForAllQuestions,
      question_type: dbType,
      options: filledOptions.length > 0 ? filledOptions : undefined,
      created_at: now,
      updated_at: now,
      poll_follow_up_to: args.followUpTo,
      category: dbType === 'ranked_choice' && d.category !== 'custom' ? d.category : null,
      is_auto_title: d.isAutoTitle,
      poll_id: pollId,
      question_index: i,
      results: null,
      voter_names: [],
      response_count: 0,
    };
  });
  return {
    id: pollId,
    short_id: null,
    creator_secret: null,
    creator_name: args.creatorName,
    response_deadline: args.responseDeadline,
    prephase_deadline: null,
    prephase_deadline_minutes: null,
    is_closed: false,
    close_reason: null,
    follow_up_to: args.followUpTo,
    thread_title: null,
    context: null,
    details: null,
    title: titleForAllQuestions,
    created_at: now,
    updated_at: now,
    questions,
    voter_names: [],
    anonymous_count: 0,
  };
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

/** Category labels used by the auto-title generator. Mirrors
 *  server/algorithms/poll_title.py so the FE preview matches whatever the
 *  server will actually pick on submit (when the user hasn't typed an
 *  explicit title). */
const _CATEGORY_LABELS: Record<string, string> = {
  yes_no: 'Yes/No',
  restaurant: 'Restaurant',
  location: 'Place',
  time: 'Time',
  movie: 'Movie',
  video_game: 'Video Game',
  videogame: 'Video Game',
  petname: 'Pet Name',
  custom: 'Custom',
};

// Match server _TITLE_CHAR_LIMIT in algorithms/poll_title.py.
const POLL_TITLE_CHAR_LIMIT = 40;

function _labelForCategory(category: string): string {
  if (!category) return '';
  const key = category.trim().toLowerCase();
  if (key in _CATEGORY_LABELS) return _CATEGORY_LABELS[key];
  return category
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function _commaJoin(parts: string[]): string {
  return parts.join(', ');
}

function _singleQuestionDefaultTitle(category: string): string {
  const key = (category || '').trim().toLowerCase();
  if (key === 'yes_no') return 'Yes/No?';
  if (key === 'time') return 'Time?';
  const label = _labelForCategory(category);
  return label ? `${label}?` : 'Question?';
}

/** Pick the category string used in title generation for a draft. yes_no /
 *  time questions ignore the user's category field. */
function _draftCategory(d: QuestionDraft): string {
  const dbType = draftDbQuestionType(d);
  if (dbType === 'yes_no') return 'yes_no';
  if (dbType === 'time') return 'time';
  return d.category || 'custom';
}

/** Returns the single shared per-question context, or null when one is
 *  missing or contexts diverge. Case-insensitive comparison; returns the
 *  first occurrence's casing.
 *  Exported so the create-poll page can inherit a shared context onto a
 *  newly-opened question form. */
export function sharedDraftContext(drafts: QuestionDraft[]): string | null {
  if (drafts.length === 0) return null;
  const normalized = drafts.map(d => d.forField.trim());
  if (normalized.some(c => !c)) return null;
  const lowered = new Set(normalized.map(c => c.toLowerCase()));
  if (lowered.size !== 1) return null;
  return normalized[0];
}

/** Greedy "Cat1 for Ctx1, Cat2 for Ctx2, etc." builder for multi-question
 *  polls whose questions have distinct per-question contexts. Mirrors
 *  _build_distinct_contexts_title in server/algorithms/poll_title.py. */
function _buildDistinctContextsTitle(
  cats: string[],
  contexts: string[],
  charLimit: number,
): string {
  const parts: string[] = cats.map((cat, i) => {
    const label = _labelForCategory(cat);
    const ctx = (contexts[i] || '').trim();
    return ctx ? `${label} for ${ctx}` : label;
  });

  const accumulated: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    const candidateFull = _commaJoin([...accumulated, part]);
    const candidateWithEtc = isLast ? candidateFull : `${candidateFull}, etc.`;
    if (accumulated.length > 0 && candidateWithEtc.length > charLimit) {
      return `${_commaJoin(accumulated)}, etc.`;
    }
    accumulated.push(part);
  }
  if (accumulated.length === 0) return 'Questions';
  return _commaJoin(accumulated);
}

/**
 * Preview values for the in-progress "Draft Poll" card in the create-poll
 * panel. Drives a `ThreadListItem` rendered in draft mode so the card
 * looks like the live poll will when submitted (just with a DRAFT pill +
 * dashed border that morph away on submit).
 *
 * Title generation mirrors server/algorithms/poll_title.py:generate_poll_title
 * — when adding a rule, update both sides. Per-question contexts come from
 * each draft's `forField`; the poll-level context is the explicit
 * `pollContext` argument (today: the inline form's `details` field).
 */
export function draftPollPreview(
  drafts: QuestionDraft[],
  pollContext: string,
): { title: string; latestQuestionTitle: string; questionCount: number } {
  const trimmedContext = pollContext.trim();
  if (drafts.length === 0) {
    return { title: trimmedContext || 'New Poll', latestQuestionTitle: '', questionCount: 0 };
  }

  let title: string;
  if (drafts.length === 1 && !drafts[0].isAutoTitle && drafts[0].title.trim()) {
    // Wrapper title: when exactly 1 draft AND the user typed an explicit
    // title (yes_no with !isAutoTitle), use it — that's what the server
    // will use too.
    title = drafts[0].title.trim();
  } else if (drafts.length === 1) {
    // 1-question poll: title = the question's own auto-title (category
    // + its own context, falling back to poll-level context).
    const ctx = trimmedContext || drafts[0].forField.trim();
    title = ctx
      ? `${_labelForCategory(_draftCategory(drafts[0]))} for ${ctx}`
      : _singleQuestionDefaultTitle(_draftCategory(drafts[0]));
  } else {
    const cats = drafts.map(d => _draftCategory(d));
    const contexts = drafts.map(d => d.forField.trim());
    const sharedFromDrafts = sharedDraftContext(drafts);
    const shared = trimmedContext || sharedFromDrafts;

    if (shared) {
      const joined = _commaJoin(cats.map(c => _labelForCategory(c)));
      const candidate = `${joined} for ${shared}`;
      title = candidate.length <= POLL_TITLE_CHAR_LIMIT
        ? candidate
        : `Questions for ${shared}`;
    } else if (contexts.some(c => c !== '')) {
      title = _buildDistinctContextsTitle(cats, contexts, POLL_TITLE_CHAR_LIMIT);
    } else {
      title = _commaJoin(cats.map(c => _labelForCategory(c)));
    }
  }

  // Preview line — same role as `latestQuestion.title` on a live thread
  // card. Use the most recently committed draft's summary so the user sees
  // their last edit reflected.
  const latest = drafts[drafts.length - 1];
  const summary = summarizeDraft(latest);
  const { label } = draftCardLabels(latest);
  const latestQuestionTitle = drafts.length === 1
    ? summary
    : `${label}: ${summary}`;

  return { title, latestQuestionTitle, questionCount: drafts.length };
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
    // Migration 098: poll-level results-display + ranked-choice settings.
    min_responses: questionData.min_responses,
    show_preliminary_results: questionData.show_preliminary_results,
    allow_pre_ranking: questionData.allow_pre_ranking,
    questions: [
      ...additionalQuestions,
      {
        question_type: questionData.question_type,
        category: questionData.category,
        options: questionData.options,
        options_metadata: questionData.options_metadata,
        suggestion_deadline_minutes: questionData.suggestion_deadline_minutes,
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

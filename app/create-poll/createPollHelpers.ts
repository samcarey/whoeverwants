/**
 * Pure helpers + constants for the create-question form.
 *
 * Lives next to page.tsx because nothing else in the app uses these;
 * they're factored out only to keep page.tsx focused on the React
 * component. If a helper grows callsites in other files, promote to
 * `lib/`.
 */
import { CreatePollParams, CreateQuestionParams } from "@/lib/api";
import type { PollSuggestion } from "@/lib/api/users";
import { getCachedAccessiblePolls } from "@/lib/questionCache";
import { buildPollMap } from "@/lib/groupUtils";
import { getBuiltInType, isLocationLikeCategory } from "@/components/TypeFieldInput";
import { DEFAULT_TIME_WINDOW, formatLocalDateISO, formatDurationLabel, windowDurationMinutes } from "@/lib/timeUtils";
import { detailsIsTypedPrompt } from "@/lib/questionListUtils";
import type { DayTimeWindow, OptionsMetadata, Poll, Question } from "@/lib/types";

export { detailsIsTypedPrompt };

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
  /** Emoji for a custom category. Empty string when none chosen / not a
   *  custom category. */
  categoryIcon: string;
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
  /** "Minimum Participants" viability gate for time questions (default 2):
   *  a slot counts only if at least this many people are available for it;
   *  if none clears the bar the event is cancelled. Maps to min_participants. */
  minParticipants: number;
  /** "Attendance Leeway" for time questions (default 0): slots within this many
   *  attendees of the best-attended slot still reach the preference phase.
   *  Maps to exclusion_tolerance. */
  exclusionTolerance: number;
  /** Number of available slots for a limited_supply question (>= 1). Maps to
   *  supply_count. Ignored for every other type. */
  supplyCount: number;
  /** limited_supply: show claimant names to everyone (true, default) or only
   *  to the creator (false). Maps to reveal_claimant_names. */
  revealClaimantNames: boolean;
  /** "Collect Suggestions before Vote" — only meaningful for ranked_choice
   *  questions. ON → suggestion poll (any typed options become the creator's
   *  initial suggestions). OFF → fixed-options ranked_choice (options
   *  required). Seeded from the user's remembered preference on open. */
  collectSuggestions: boolean;
  /** Ranked-choice headline method — only meaningful for ranked_choice
   *  questions. 'consensus' (Borda, default): the option ranked highest across
   *  the most ballots — "what everyone's most okay with". 'favorite' (IRV): the
   *  option with the strongest core / most first-choice support. Maps to the
   *  API `winner_method`. */
  winnerMethod: 'favorite' | 'consensus';
  /** "Ask for Availability before Voting" — only meaningful for time
   *  questions. ON → two-phase availability → preferences flow (current
   *  default). OFF → the poll starts directly as a preference poll over the
   *  slots derived from the creator's time windows (no availability phase).
   *  Seeded from the user's remembered preference on open. */
  collectAvailability: boolean;
  /** Showtime: the picked film's id, persisted so the create flow can restore
   *  the selection after a modal reopen (the catalog itself is re-fetched, not
   *  persisted — too big for localStorage). The film NAME lives in `forField`
   *  (→ the "Showtime for {Film}" title); the curated showtime keys live in
   *  `options` + `optionsMetadata` like any other option-based question. */
  showtimeFilmId?: string;
}

/** Default empty draft, optionally preselected by the bubble that opened
 *  the modal. `category: 'time'` (with the default mode) is the canonical
 *  way to start a time-question draft now — questionType stays 'question'
 *  so the category/for fields render normally, while the questionFormBody
 *  picks up time fields via `category === 'time'`. The legacy `mode: 'time'`
 *  path remains for any caller that hasn't migrated.
 *  Yes/No drafts force `isAutoTitle: false` since the title IS the prompt.
 */
export function emptyDraft(
  opts: { mode?: 'question' | 'time'; category?: string; forField?: string; collectSuggestions?: boolean; collectAvailability?: boolean } = {},
): QuestionDraft {
  const todayStr = formatLocalDateISO(new Date());
  const isTime = opts.mode === 'time' || opts.category === 'time';
  const isYesNo = opts.category === 'yes_no';
  // limited_supply: the title IS the thing being handed out (e.g. "Concert
  // tickets"), like a yes_no prompt — so the user types it, not auto-generated.
  const isLimitedSupply = opts.category === 'limited_supply';
  return {
    questionType: opts.mode === 'time' ? 'time' : 'question',
    title: '',
    isAutoTitle: !isYesNo && !isLimitedSupply,
    category: opts.category ?? 'custom',
    categoryIcon: '',
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
    dayTimeWindows: isTime
      ? [{ day: todayStr, windows: [{ ...DEFAULT_TIME_WINDOW }] }]
      : [],
    minParticipants: 2,
    exclusionTolerance: 0,
    supplyCount: 1,
    revealClaimantNames: true,
    collectSuggestions: opts.collectSuggestions ?? true,
    winnerMethod: 'consensus',
    collectAvailability: opts.collectAvailability ?? true,
    showtimeFilmId: undefined,
  };
}

/**
 * Resolve effective DB question_type for a draft. Mirrors the legacy
 * getQuestionType() in page.tsx so server-side validation rules stay aligned.
 */
export function draftDbQuestionType(d: QuestionDraft): 'yes_no' | 'ranked_choice' | 'time' | 'limited_supply' | 'showtime' {
  if (d.questionType === 'time' || d.category === 'time') return 'time';
  if (d.category === 'yes_no') return 'yes_no';
  if (d.category === 'limited_supply') return 'limited_supply';
  if (d.category === 'showtime') return 'showtime';
  return 'ranked_choice';
}

/** The emoji to persist for a draft's category: the trimmed chosen emoji when
 *  the creator picked one, else null (the app then falls back to the category's
 *  default icon — the built-in icon, or the generic glyph for a custom
 *  category). The emoji field is always shown now, so a chosen emoji overrides
 *  the default for ANY category. Single source of truth for the create +
 *  optimistic-placeholder paths so the API payload and the placeholder can't
 *  diverge. */
export function effectiveCategoryIcon(d: QuestionDraft): string | null {
  // Null-safe: a draft restored from a stale localStorage questionFormState
  // (saved before the categoryIcon field shipped) has no categoryIcon, and an
  // undefined .trim() would throw mid-submit.
  return (d.categoryIcon ?? '').trim() || null;
}

/** Clamp a limited_supply slot count to a whole number >= 1. */
export function normalizeSupplyCount(count: number): number {
  return Math.max(Math.round(count) || 1, 1);
}

/** True when a draft is a "suggestion poll" — a ranked_choice question with
 *  "Collect Suggestions before Vote" on. Any typed options become the
 *  creator's initial suggestions rather than fixed options. */
export function draftIsSuggestionMode(d: QuestionDraft): boolean {
  if (draftDbQuestionType(d) !== 'ranked_choice') return false;
  return d.collectSuggestions;
}

/** True when a draft is a time question with an availability phase — i.e.
 *  "Ask for Availability before Voting" is on. OFF skips the availability
 *  phase (no poll-level prephase cutoff); the server derives the candidate
 *  slots from the creator's windows at create time and the poll opens
 *  straight into the preference (like/dislike) ballot. */
export function draftUsesAvailabilityPhase(d: QuestionDraft): boolean {
  if (draftDbQuestionType(d) !== 'time') return false;
  return d.collectAvailability;
}

/** True when at least one draft needs the poll-level suggestion/availability cutoff. */
export function anyDraftUsesPrephase(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftUsesAvailabilityPhase(d) || draftIsSuggestionMode(d));
}

/** True when at least one draft is a time question using the availability
 *  phase. A time question whose "Ask for Availability before Voting" toggle is
 *  off has no prephase, so it doesn't count here. Drives the poll-level
 *  prephase cutoff + cutoff label. */
export function anyDraftUsesAvailabilityPhase(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftUsesAvailabilityPhase(d));
}

/** True when at least one draft is in suggestion mode (ranked_choice with
 *  "Collect Suggestions before Vote" on). Distinct from
 *  `anyDraftUsesAvailabilityPhase` so the cutoff label can pick the correct
 *  phrasing per poll composition. */
export function anyDraftHasSuggestion(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftIsSuggestionMode(d));
}

/** True when at least one draft is a ranked_choice question — these are
 *  the only ones for which "min responses to show preliminary results" is
 *  meaningful (yes/no shows results immediately, time questions don't have
 *  preliminary results). */
export function anyDraftIsRankedChoice(drafts: QuestionDraft[]): boolean {
  return drafts.some(d => draftDbQuestionType(d) === 'ranked_choice');
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
  const isSuggestion = draftIsSuggestionMode(d);
  const params: CreateQuestionParams = {
    question_type: dbType,
    is_auto_title: d.isAutoTitle,
  };
  // `forField` → API `context` (stored on `questions.details`). Required
  // for the server's same-kind disambiguation check (otherwise 400).
  //
  // yes_no is the exception: the FE form's "title" field IS the question's
  // own prompt (e.g. "Should we go bowling?"). For a SINGLE-question poll
  // that prompt becomes the wrapper title automatically (via the `onlyDraft
  // && !onlyDraft.isAutoTitle` branch in page.tsx); for a MULTI-question
  // poll the wrapper title is auto-built from categories+contexts, so the
  // per-question prompt has nowhere to land unless we forward it as
  // `context`. `details` is the only per-question text column in the data
  // model — re-using it for yes_no prompts lets the section header show
  // the user's prompt verbatim (no "Yes/No for X" rewrap, since "Yes/No"
  // is a category, not display text). Single-question yes_no polls still
  // pass through here too, but `details` is unused on the single-card
  // layout, so it's harmless.
  const trimmedForField = d.forField.trim();
  // yes_no AND limited_supply both use the typed title as the question's own
  // prompt/item-name (not auto-generated), so it rides along as `context` for
  // the multi-question section header + same-kind disambiguation, the same way
  // yes_no does.
  const typedPrompt = detailsIsTypedPrompt(dbType) ? d.title.trim() : '';
  const contextValue = typedPrompt || trimmedForField;
  if (contextValue) {
    params.context = contextValue;
  }
  if (dbType === 'limited_supply') {
    params.supply_count = normalizeSupplyCount(d.supplyCount);
    params.reveal_claimant_names = d.revealClaimantNames;
  }
  if (dbType === 'ranked_choice' && d.category !== 'custom') {
    params.category = d.category;
  }
  if (dbType === 'ranked_choice') {
    params.winner_method = d.winnerMethod;
  }
  // Showtime: the curated showtime keys ARE the ballot options; the film name
  // is the context (→ "Showtime for {Film}" auto-title). No time-window /
  // duration / availability machinery — options arrive pre-finalized.
  if (dbType === 'showtime') {
    params.category = 'showtime';
    if (filledOptions.length > 0) {
      params.options = filledOptions;
    }
  }
  const icon = effectiveCategoryIcon(d);
  if (icon) {
    params.category_icon = icon;
  }
  // Fixed-options ranked_choice (toggle off): the typed options ARE the
  // ballot. Suggestion poll (toggle on): leave options unset so the poll
  // collects from scratch; typed options ride along as `initial_suggestions`
  // and the server submits them as the creator's own suggestion-phase vote.
  if (dbType === 'ranked_choice' && !isSuggestion && filledOptions.length > 0) {
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
  if (isSuggestion) {
    params.suggestion_deadline_minutes = prephaseMinutes != null ? Math.round(prephaseMinutes) : 120;
    if (filledOptions.length > 0) {
      params.initial_suggestions = filledOptions;
    }
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
    params.min_participants = d.minParticipants;
    params.exclusion_tolerance = d.exclusionTolerance;
    // Availability phase ON → set the prephase cutoff so the poll collects
    // availability before opening preferences. OFF → leave it unset; the
    // server reads the absent `suggestion_deadline_minutes` as "no availability
    // phase" and finalizes the candidate slots from the creator's windows at
    // create time, so the poll opens straight into the preference ballot.
    if (d.collectAvailability) {
      params.suggestion_deadline_minutes = prephaseMinutes != null ? Math.round(prephaseMinutes) : 120;
    }
  }
  return params;
}

// A draft title broken into labelled spans so the poll-search suggestions can
// annotate the parts that get prefilled (category / context / option words)
// with a coloured underline + tiny label. The connective glue ("for", commas,
// "or", "?") carries `muted` so the UI greys it out; the un-annotated yes/no
// prompt is a single plain span. `deriveDraftTitle` is literally the spans'
// text joined, so the displayed suggestion text can never drift from the
// title the poll actually lands on.
export type TitleSegmentKind = 'plain' | 'category' | 'context' | 'option';
export interface TitleSegment {
  text: string;
  kind: TitleSegmentKind;
  /** Greyed-out connective glue (commas, "or", "for", "?"). */
  muted?: boolean;
  /** Overrides the kind's default annotation label (e.g. "Yes/No"). */
  label?: string;
}

type TitleDraft = Pick<
  QuestionDraft,
  'questionType' | 'title' | 'category' | 'forField' | 'options' | 'collectSuggestions'
>;

// " for <context>" tail shared by category / option / showtime titles.
function ctxTail(forField: string): TitleSegment[] {
  const ctx = forField.trim();
  return ctx
    ? [{ text: ' for ', kind: 'plain', muted: true }, { text: ctx, kind: 'context' }]
    : [];
}

/**
 * Derive the question's auto-title as labelled segments. Mirrors
 * `generateTitle()` in page.tsx but operates on a draft (not live form
 * state) so suggestion rows + draft list rows can show the same title the
 * question would land on if submitted now.
 */
// A yes/no prompt reads as a question, so its auto-title ends with "?" like
// every other category's title — unless the user already typed terminal
// punctuation (avoids "bowling.?" / a doubled "??").
export function yesNoNeedsQuestionMark(prompt: string): boolean {
  const t = prompt.trim();
  return t.length > 0 && !/[?!.]$/.test(t);
}

// The final yes/no title text (with the trailing "?"). Apply this in EVERY
// yes/no title-generation path — `draftTitleSegments` (suggestion rows),
// `draftPollPreview` (live preview), and the submit handler's wrapper title —
// so the displayed suggestion can never drift from the title the poll lands on.
export function yesNoTitleText(prompt: string): string {
  const t = prompt.trim();
  if (!t) return `${labelForCategory('yes_no')}?`;
  return yesNoNeedsQuestionMark(t) ? `${t}?` : t;
}

export function draftTitleSegments(d: TitleDraft): TitleSegment[] {
  // yes_no: the user-typed text IS the title — annotate the whole thing with
  // the "Yes/No" category label + a trailing "?" (greyed, like the other
  // categories' auto-title "?") when one's missing.
  if (d.category === 'yes_no') {
    const label = labelForCategory('yes_no');
    const t = d.title.trim();
    if (!t) return [{ text: `${label}?`, kind: 'category', label }];
    const segs: TitleSegment[] = [{ text: t, kind: 'category', label }];
    if (yesNoNeedsQuestionMark(t)) segs.push({ text: '?', kind: 'plain', muted: true });
    return segs;
  }
  // limited_supply: the user-typed item name IS the title — annotate the whole
  // thing with the "Limited Supply" category label (no "?").
  if (d.category === 'limited_supply') {
    const label = labelForCategory('limited_supply');
    return [{ text: d.title.trim() || label, kind: 'category', label }];
  }
  // time / showtime: fixed category word + optional " for X" suffix.
  if (d.questionType === 'time' || d.category === 'time') {
    return [{ text: 'Time', kind: 'category' }, ...ctxTail(d.forField), { text: '?', kind: 'plain', muted: true }];
  }
  if (d.category === 'showtime') {
    return [{ text: 'Showtime', kind: 'category' }, ...ctxTail(d.forField), { text: '?', kind: 'plain', muted: true }];
  }

  // ranked_choice: build from options if any, else fall back to the
  // category label. Suggestion polls (collectSuggestions) are titled by
  // category regardless of typed options — those are just the creator's
  // initial suggestions, not the final ballot.
  const builtIn = getBuiltInType(d.category);
  const shorten = isLocationLikeCategory(d.category) ? shortenLocation : shortenOption;
  const filled = d.collectSuggestions ? [] : d.options.filter(o => o.trim()).map(shorten);

  if (filled.length === 0) {
    const prefix = d.category === 'location' ? 'Place'
      : builtIn?.label || (d.category && d.category !== 'custom' ? d.category : '');
    if (prefix) {
      return [{ text: prefix, kind: 'category' }, ...ctxTail(d.forField), { text: '?', kind: 'plain', muted: true }];
    }
    const trimmedFor = d.forField.trim();
    if (trimmedFor) {
      return [{ text: 'Options for ', kind: 'plain' }, { text: trimmedFor, kind: 'context' }, { text: '?', kind: 'plain', muted: true }];
    }
    return [{ text: 'Suggestions', kind: 'plain' }];
  }

  // Single option carries no trailing "?" (matches the legacy title).
  if (filled.length === 1) {
    return [{ text: filled[0], kind: 'option' }, ...ctxTail(d.forField)];
  }

  return [...orListSegments(filled), ...ctxTail(d.forField), { text: '?', kind: 'plain', muted: true }];
}

/**
 * Derive the question's auto-title from a draft snapshot. Returns text only
 * — no leading icon. Defined as the joined text of `draftTitleSegments` so
 * the annotated suggestion rows can never disagree with the real title.
 */
export function deriveDraftTitle(d: TitleDraft): string {
  return draftTitleSegments(d).map(s => s.text).join('');
}

// "Fits on one line" cap for the option or-list. Mirrors `_TITLE_CHAR_LIMIT`
// in server/algorithms/poll_title.py — keep in lockstep.
const TITLE_LIMIT = 40;

function joinWithOr(items: string[]): string {
  if (items.length === 2) return `${items[0]} or ${items[1]}?`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}?`;
}

// Build the multi-option "A, B, or C" body as segments (no trailing "?", which
// the caller appends after any context). Mirrors the old string `buildOrList`:
// include options until the rendered title would exceed TITLE_LIMIT, then
// truncate with ", or ...". Each kept option is its own `option` span so the
// UI can colour them; the commas / "or" glue is muted.
function orListSegments(items: string[]): TitleSegment[] {
  const included = [items[0]];
  for (let i = 1; i < items.length; i++) {
    const isLast = i === items.length - 1;
    const candidate = isLast
      ? joinWithOr([...included, items[i]])
      : `${[...included, items[i]].join(', ')}, or ...?`;
    if (candidate.length > TITLE_LIMIT && included.length >= 2) break;
    included.push(items[i]);
  }
  const truncated = included.length !== items.length;
  const segs: TitleSegment[] = [];
  included.forEach((it, k) => {
    if (k > 0) {
      // The final gap reads " or " for a two-item list, ", or " for three+.
      // A truncated list never ends on its last item, so every gap is a plain
      // comma and the ", or ..." tail is appended below.
      const lastGap = !truncated && k === included.length - 1;
      const sep = lastGap ? (included.length === 2 ? ' or ' : ', or ') : ', ';
      segs.push({ text: sep, kind: 'plain', muted: true });
    }
    segs.push({ text: it, kind: 'option' });
  });
  if (truncated) segs.push({ text: ', or ...', kind: 'plain', muted: true });
  return segs;
}

/**
 * Build an optimistic Poll/Question pair from the draft list at submit
 * time, before the server has responded. The group page renders this as a
 * normal collapsed poll card (fading in via `card-pending-enter`) while
 * apiCreatePoll
 * resolves in parallel. Once the real Poll arrives, GroupContent swaps the
 * placeholder fields for the real ones via POLL_HYDRATED_EVENT.
 *
 * IDs use a `pending-...` prefix so group state can identify and replace
 * them on hydration. Placeholder questions get realistic-looking defaults
 * (created_at = now, is_closed = false, empty voter_names) so the
 * collapsed-card render path doesn't crash on missing fields.
 */
export function synthesizePlaceholderPoll(
  drafts: QuestionDraft[],
  args: { wrapperTitle: string | null; responseDeadline: string | null; groupId: string | null; creatorName: string | null; details?: string | null; prephaseDeadline?: string | null; allowPlusOnes?: boolean },
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
    // Suggestion polls open with no fixed options (the typed ones become the
    // creator's initial suggestions), so the placeholder must not surface them
    // as a finalized ballot — that would morph on POLL_HYDRATED.
    const showOptions = !draftIsSuggestionMode(d) && filledOptions.length > 0;
    return {
      id: `${pollId}-q${i}`,
      title: titleForAllQuestions,
      question_type: dbType,
      options: showOptions ? filledOptions : undefined,
      created_at: now,
      updated_at: now,
      category: dbType === 'showtime' ? 'showtime' : (dbType === 'ranked_choice' && d.category !== 'custom' ? d.category : null),
      category_icon: effectiveCategoryIcon(d),
      supply_count: dbType === 'limited_supply' ? normalizeSupplyCount(d.supplyCount) : null,
      reveal_claimant_names: dbType === 'limited_supply' ? d.revealClaimantNames : null,
      winner_method: dbType === 'ranked_choice' ? d.winnerMethod : null,
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
    // Migration 105: group_id placeholders use the parent group when
    // adding a poll; new groups get null and the real group_id is
    // filled in on POLL_HYDRATED_EVENT.
    group_id: args.groupId,
    group_short_id: null,
    creator_name: args.creatorName,
    // The viewer is creating this poll, so they're the creator — show the
    // creator controls on the optimistic card immediately (the real poll
    // from POLL_HYDRATED carries the server-computed flag too).
    viewer_is_creator: true,
    response_deadline: args.responseDeadline,
    // The prephase countdown starts at creation, so reflect it on the
    // placeholder immediately rather than waiting for POLL_HYDRATED.
    prephase_deadline: args.prephaseDeadline ?? null,
    prephase_deadline_minutes: null,
    is_closed: false,
    close_reason: null,
    group_title: null,
    context: null,
    details: args.details ?? null,
    title: titleForAllQuestions,
    created_at: now,
    updated_at: now,
    allow_plus_ones: args.allowPlusOnes ?? false,
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
  if (dbType === 'limited_supply') {
    const n = normalizeSupplyCount(d.supplyCount);
    const item = d.title.trim();
    return item ? `${n} × ${item}` : `${n} spot${n === 1 ? '' : 's'}`;
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
  limited_supply: 'Limited Supply',
  custom: 'Custom',
};

export function labelForCategory(category: string): string {
  if (!category) return '';
  const key = category.trim().toLowerCase();
  if (key in _CATEGORY_LABELS) return _CATEGORY_LABELS[key];
  return category
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function _singleQuestionDefaultTitle(category: string): string {
  const key = (category || '').trim().toLowerCase();
  if (key === 'yes_no') return 'Yes/No?';
  if (key === 'time') return 'Time?';
  if (key === 'limited_supply') return 'Limited Supply';
  const label = labelForCategory(category);
  return label ? `${label}?` : 'Question?';
}

/** Pick the category string used in title generation for a draft. yes_no /
 *  time questions ignore the user's category field. */
function _draftCategory(d: QuestionDraft): string {
  const dbType = draftDbQuestionType(d);
  if (dbType === 'yes_no') return 'yes_no';
  if (dbType === 'time') return 'time';
  if (dbType === 'limited_supply') return 'limited_supply';
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
    const label = labelForCategory(cat);
    const ctx = (contexts[i] || '').trim();
    return ctx ? `${label} for ${ctx}` : label;
  });

  const accumulated: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    const candidateFull = [...accumulated, part].join(', ');
    const candidateWithEtc = isLast ? candidateFull : `${candidateFull}, etc.`;
    if (accumulated.length > 0 && candidateWithEtc.length > charLimit) {
      return `${accumulated.join(', ')}, etc.`;
    }
    accumulated.push(part);
  }
  if (accumulated.length === 0) return 'Questions';
  return accumulated.join(', ');
}

/**
 * Preview values for the in-progress "Draft Poll" card in the create-poll
 * panel. Drives a `GroupListItem` rendered in draft mode so the card
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

  // "Yes/No" is a category, not display text — drop yes_no drafts when
  // composing auto-titles. Single yes_no polls still surface the user's
  // typed prompt via the !isAutoTitle branch below; multi-question polls
  // with yes_no-among-others build the title from the other categories
  // (the yes_no's presence is conveyed by the question list itself).
  const visibleDrafts = drafts.filter(d => _draftCategory(d) !== 'yes_no');

  let title: string;
  if (drafts.length === 1 && !drafts[0].isAutoTitle && drafts[0].title.trim()) {
    // Wrapper title: when exactly 1 draft AND the user typed an explicit
    // title (yes_no with !isAutoTitle), use it — that's what the server
    // will use too. yes_no gets a trailing "?" so it reads as a question.
    title = _draftCategory(drafts[0]) === 'yes_no'
      ? yesNoTitleText(drafts[0].title)
      : drafts[0].title.trim();
  } else if (visibleDrafts.length === 0) {
    // Every draft is yes_no with no user-typed title. Fall back to the
    // poll-level context or a generic placeholder.
    title = trimmedContext || 'Question?';
  } else if (visibleDrafts.length === 1) {
    // 1-question poll (or yes_no + 1 visible): title = the question's own
    // auto-title (category + its own context, falling back to poll-level
    // context).
    const ctx = trimmedContext || visibleDrafts[0].forField.trim();
    title = ctx
      ? `${labelForCategory(_draftCategory(visibleDrafts[0]))} for ${ctx}`
      : _singleQuestionDefaultTitle(_draftCategory(visibleDrafts[0]));
  } else {
    const cats = visibleDrafts.map(d => _draftCategory(d));
    const contexts = visibleDrafts.map(d => d.forField.trim());
    const sharedFromDrafts = sharedDraftContext(visibleDrafts);
    const shared = trimmedContext || sharedFromDrafts;

    if (shared) {
      const joined = cats.map(labelForCategory).join(', ');
      const candidate = `${joined} for ${shared}`;
      title = candidate.length <= TITLE_LIMIT
        ? candidate
        : `Questions for ${shared}`;
    } else if (contexts.some(c => c !== '')) {
      title = _buildDistinctContextsTitle(cats, contexts, TITLE_LIMIT);
    } else {
      title = cats.map(labelForCategory).join(', ');
    }
  }

  // Preview line — same role as `latestQuestion.title` on a live group
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
  if (dbType === 'limited_supply') return { icon: '🎟️', label: 'Limited Supply' };
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
 * with one question. Wrapper-level fields (creator_name, response_deadline,
 * group_id, title, voting cutoff, prephase deadlines) live on the
 * poll; everything ballot-shaped stays on the question. Migration 105:
 * `group_id` directly identifies the group to add this poll to (null
 * for new groups). Wrapper-level `context` carries today's `details`
 * field; per-question `context` is unused for 1-question polls and
 * Phase 2.4 will start populating it for disambiguation. Pydantic
 * supplies defaults for omitted fields.
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
    creator_name: questionData.creator_name,
    response_deadline: questionData.response_deadline,
    prephase_deadline: questionData.suggestion_deadline,
    prephase_deadline_minutes: questionData.suggestion_deadline_minutes,
    group_id: questionData.group_id,
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
 * Returns null when ranked_choice options are valid.
 *
 * `collectSuggestions` (the "Collect Suggestions before Vote" toggle):
 *   - true (suggestion poll): any count of options is fine — 0 collects from
 *     scratch, 1+ seed the creator's initial suggestions.
 *   - false (fixed-options poll): at least two distinct options are required.
 */
export function validateRankedChoiceOptions(
  options: string[],
  category: string,
  collectSuggestions: boolean = true,
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
  const uniqueOptions = new Set(filledOptions.map(opt => opt.trim()));
  if (uniqueOptions.size !== filledOptions.length) {
    return "All question options must be unique (no duplicates).";
  }
  if (!collectSuggestions && filledOptions.length < 2) {
    return "Add at least two options, or turn on “Collect Suggestions before Vote” to ask for suggestions.";
  }
  return null;
}

/**
 * Validate a single question's own fields (NOT poll-level constraints).
 * Returns null when the draft's question is valid, else a user-facing message.
 * The single source of truth for both the modal-edit path (which validates the
 * live form via a `readCurrentDraft()` snapshot) and the ↑ send path (which
 * validates each staged draft), so the two can't drift.
 */
export function validateQuestionDraft(d: QuestionDraft): string | null {
  const dbType = draftDbQuestionType(d);
  const titleTrim = d.title.trim();
  if (dbType === 'yes_no' || dbType === 'limited_supply') {
    if (!titleTrim) {
      return dbType === 'yes_no'
        ? "Please enter a yes/no question."
        : "Please describe what's being handed out.";
    }
    if (d.title.length > 100) return "Title must be 100 characters or less.";
    if (/https?:\/\/\S+|www\.\S+/i.test(d.title)) {
      return "Links aren't allowed in the title. Use the Notes field for links.";
    }
    if (dbType === 'limited_supply' && (!Number.isFinite(d.supplyCount) || d.supplyCount < 1)) {
      return "Set at least one available spot.";
    }
    return null;
  }
  if (dbType === 'showtime') {
    if (d.options.filter((o) => o.trim() !== '').length === 0) {
      return "Pick a movie and select at least one showtime to vote on.";
    }
    return null;
  }
  if (dbType === 'ranked_choice') {
    return validateRankedChoiceOptions(d.options, d.category, d.collectSuggestions);
  }
  // time
  if (d.dayTimeWindows.length === 0) return "Please select at least one day.";
  if (d.dayTimeWindows.some((dtw) => dtw.windows.length === 0)) {
    return "Every selected day must have at least one time slot. Add time slots or remove empty days.";
  }
  if (d.durationMinEnabled && d.durationMinValue != null) {
    const minDurMinutes = Math.round(d.durationMinValue * 60);
    if (minDurMinutes > 0 && d.dayTimeWindows.some((dtw) =>
      dtw.windows.some((w) => windowDurationMinutes(w) < minDurMinutes))) {
      return `Each time window must be at least ${formatDurationLabel(minDurMinutes)} long (the minimum duration).`;
    }
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

// Map a structured AI poll suggestion (the server LLM's predicted next poll)
// into draft overrides — the SAME per-type mapping the recent-poll reuse path
// uses, so a suggestion prefills the form and auto-derives its title identically.
// Returns null when the suggestion can't form a usable draft (e.g. a yes_no /
// limited_supply with no title). Kept pure (no React) so it's unit-tested.
export function suggestionToOverrides(s: PollSuggestion): Partial<QuestionDraft> | null {
  const category = s.category;
  const context = (s.context ?? '').trim();
  if (category === 'yes_no' || category === 'limited_supply') {
    const title = (s.title ?? '').trim();
    if (!title) return null;
    return { category, title, isAutoTitle: false };
  }
  if (category === 'time') return { category: 'time', forField: context };
  const opts = (s.options ?? []).filter((o) => o && o.trim());
  if (opts.length < 2) {
    return { category, forField: context, collectSuggestions: true };
  }
  // Restore the DB ref (favicon / poster / coords) the original pick carried,
  // scoped to the options actually kept.
  const meta: OptionsMetadata = {};
  if (s.optionsMetadata) {
    for (const o of opts) {
      const m = s.optionsMetadata[o];
      if (m && typeof m === 'object') meta[o] = m as OptionsMetadata[string];
    }
  }
  const draft: Partial<QuestionDraft> = {
    category,
    options: opts,
    collectSuggestions: false,
    forField: context,
  };
  if (Object.keys(meta).length > 0) draft.optionsMetadata = meta;
  return draft;
}

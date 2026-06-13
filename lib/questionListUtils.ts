import { Question, QuestionResults } from "@/lib/types";
import { getBuiltInType } from "@/components/TypeFieldInput";

export const QUESTION_TYPE_SYMBOLS: Record<string, string> = {
  yes_no: '👍',
  ranked_choice: '🗳️',
  time: '📅',
  limited_supply: '🎟️',
  showtime: '🎬',
};

/** The symbol for a question type. It must NEVER depend on poll state
 *  (open/closed) — the glyph in front of a title is a stable identifier,
 *  not a result indicator. Question types without a dedicated symbol fall
 *  back to the ballot box. */
export function getQuestionSymbol(questionType: string): string {
  return QUESTION_TYPE_SYMBOLS[questionType] || '🗳️';
}

export function getCategoryIcon(question: Question): string {
  // A creator-chosen emoji for a custom category wins over everything.
  if (question.category_icon) return question.category_icon;
  const builtInIcon = getBuiltInCategoryIcon(question.category);
  if (builtInIcon) return builtInIcon;
  // Custom or no category — use question type symbol
  return getQuestionSymbol(question.question_type);
}

/** Returns the built-in category's emoji, or undefined for `custom` /
 *  unrecognized / missing categories. Use this when the call site WANTS
 *  to omit the icon entirely rather than fall back to a generic question-type
 *  symbol — e.g. compact result pills, where a generic symbol for custom
 *  categories felt redundant. */
export function getBuiltInCategoryIcon(category: string | null | undefined): string | undefined {
  if (!category || category === 'custom') return undefined;
  return getBuiltInType(category)?.icon;
}

/** Per-question section header used in multi-question poll cards.
 *  Mirrors the server-side auto-title ("<Label> for <Context>") so a
 *  Time question with details="Partie" reads as "Time for Partie"
 *  instead of just "Partie". The `time` special-case is load-bearing:
 *  the Time bubble stores question_type=time but leaves category=custom,
 *  so reading the category alone gives "Custom" — same convention as
 *  `_category_for_title` in `server/routers/polls.py`.
 *
 *  yes_no returns `null` rather than the "Yes/No" auto-label — that
 *  string is a category, not display text. yes_no's user-typed prompt
 *  is stored on `details` (FE forwards draft.title to the server as
 *  `context` for yes_no), and `getQuestionSectionTitle` surfaces that
 *  prompt verbatim — no "Yes/No for" prefix. */
function getQuestionLabel(question: Question): string | null {
  if (question.question_type === 'time') return 'Time';
  // showtime stores question_type=showtime but category=showtime; the film
  // name is the per-question context, so "Showtime for {Film}" reads right.
  if (question.question_type === 'showtime') return 'Showtime';
  if (question.question_type === 'yes_no') return null;
  // limited_supply: the typed title (the item) is surfaced verbatim via
  // `details`, like yes_no — no "Limited Supply for X" prefix.
  if (question.question_type === 'limited_supply') return null;
  const builtIn = getBuiltInType(question.category ?? '');
  if (builtIn) return builtIn.label;
  if (question.category && question.category !== 'custom') return question.category;
  return null;
}

/** Returns the per-question section header text, or null when there's
 *  nothing meaningful to show (the icon alone identifies the section).
 *  Callers MUST gate rendering on the result — `{title && <h2>{title}</h2>}`.
 *
 *  For yes_no this returns the user-typed prompt (stored on `details`).
 *  For non-yes_no, it composes the category label with the per-question
 *  context, matching the server's auto-title format. */
export function getQuestionSectionTitle(question: Question): string | null {
  const details = question.details?.trim();
  const label = getQuestionLabel(question);
  if (label && details) return `${label} for ${details}`;
  return label ?? details ?? null;
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// Promotes to the next larger unit only when that unit's count would be >= 2,
// avoiding "1w" / "1mo" / "1y" readings that carry less precision than the
// smaller unit (e.g. 13d stays "13d"; 14d becomes "2w"). All buckets round
// DOWN — a duration of 30 seconds reads "30s", not "1m"; a duration of 89
// minutes reads "89m", not "2h". A freshly-passed deadline shows "0s ago"
// initially, not "1m ago".
export function compactDurationSince(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(seconds / 86400);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Phase 5b: takes the wrapper's `prephase_deadline` (legacy
 *  `suggestion_deadline`) as a separate arg — it lives on the poll, not
 *  the question. The countdown starts at poll creation, so a ranked_choice
 *  question is in its suggestion phase iff the deadline is set and still in
 *  the future. */
export function isInSuggestionPhase(
  question: Question,
  suggestionDeadline?: string | null,
): boolean {
  if (question.question_type !== 'ranked_choice') return false;
  return !!suggestionDeadline && new Date(suggestionDeadline) > new Date();
}

export function isInTimeAvailabilityPhase(question: Question): boolean {
  if (question.question_type !== 'time') return false;
  return !question.options || question.options.length === 0;
}

export interface ResultBadge {
  text: string;
  emoji: string;
  color: 'green' | 'red' | 'yellow' | 'gray';
}

export const BADGE_COLORS = {
  green: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200',
  red: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200',
  gray: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
};

/** Simplified result badge — no user-specific logic, just question + results. */
export function getResultBadge(question: Question): ResultBadge {
  const results = question.results;
  if (!results) return { text: 'No results', emoji: '🔇', color: 'gray' };
  if (results.total_votes === 0) return { text: 'No voters', emoji: '🦗', color: 'gray' };

  switch (question.question_type) {
    case 'yes_no': {
      if (results.winner === 'yes') return { text: 'Yes', emoji: '👑', color: 'green' };
      if (results.winner === 'no') return { text: 'No', emoji: '👑', color: 'red' };
      if (results.winner === 'tie') return { text: 'Tie', emoji: '🤝', color: 'yellow' };
      return { text: 'No winner', emoji: '🤷', color: 'gray' };
    }
    case 'ranked_choice': {
      if (results.winner) return { text: results.winner, emoji: '👑', color: 'green' };
      return { text: 'No winner', emoji: '🤷', color: 'gray' };
    }
    default:
      return { text: 'Closed', emoji: '🔒', color: 'gray' };
  }
}

/**
 * Types whose `questions.details` holds the user-TYPED prompt / item name
 * (forwarded from the title at create time) rather than a "for X" context.
 * Single source of truth, consumed by:
 *  - draftToQuestionParams (title → API `context`) + the ?duplicate= restore
 *    in create-poll (which must NOT copy details back into the Context field
 *    for these types — the typed prompt, like the title, is retyped on a copy);
 *  - QuestionBallot, which suppresses the inner <QuestionDetails> for these
 *    types so the prompt doesn't render twice (header title + a subtitle).
 */
export function detailsIsTypedPrompt(questionType: string): boolean {
  return questionType === 'yes_no' || questionType === 'limited_supply';
}

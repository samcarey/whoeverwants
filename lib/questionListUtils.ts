import { Question, QuestionResults } from "@/lib/types";
import { getBuiltInType } from "@/components/TypeFieldInput";

export const QUESTION_TYPE_SYMBOLS: Record<string, string> = {
  yes_no: '👍',
  ranked_choice: '🗳️',
  time: '📅',
};

const CLOSED_YES_NO_SYMBOL = '🏆';

export function getQuestionSymbol(questionType: string, isClosed: boolean): string {
  if (questionType === 'yes_no' && isClosed) return CLOSED_YES_NO_SYMBOL;
  return QUESTION_TYPE_SYMBOLS[questionType] || '☰';
}

/** Phase 5b: takes `isClosed` as a separate arg since `is_closed` is a
 *  wrapper-level field. Callers source it from the parent poll. */
export function getCategoryIcon(question: Question, isClosed: boolean = false): string {
  const builtInIcon = getBuiltInCategoryIcon(question.category);
  if (builtInIcon) return builtInIcon;
  // Custom or no category — use question type symbol
  return getQuestionSymbol(question.question_type, isClosed);
}

/** Returns the built-in category's emoji, or undefined for `custom` /
 *  unrecognized / missing categories. Use this when the call site WANTS
 *  to omit the icon entirely rather than fall back to a generic question-type
 *  symbol — e.g. compact result pills, where a generic 🏆 was previously
 *  shown for custom categories and felt redundant. */
export function getBuiltInCategoryIcon(category: string | null | undefined): string | undefined {
  if (!category || category === 'custom') return undefined;
  return getBuiltInType(category)?.icon;
}

/** Per-question section header used in multi-question poll cards.
 *  Mirrors the auto-title format ("<Label> for <Context>") so a Time
 *  question with details="Partie" reads as "Time for Partie" instead of
 *  just "Partie" (which dropped the type signal entirely). Time questions
 *  always resolve to label="Time" regardless of the stored category column
 *  (the Time bubble sets question_type=time but leaves category=custom).
 *  Falls back to details / category / question_type when no label is
 *  available. */
export function getQuestionSectionTitle(question: Question): string {
  const details = question.details?.trim();
  let label: string | null = null;
  if (question.question_type === 'time') {
    label = 'Time';
  } else if (question.question_type === 'yes_no') {
    label = 'Yes/No';
  } else {
    const builtIn = getBuiltInType(question.category ?? '');
    if (builtIn) label = builtIn.label;
    else if (question.category && question.category !== 'custom') label = question.category;
  }
  if (label && details) return `${label} for ${details}`;
  if (label) return label;
  if (details) return details;
  return question.question_type.replace('_', '/');
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
// smaller unit (e.g. 13d stays "13d"; 14d becomes "2w").
export function compactDurationSince(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${Math.max(1, minutes)}m`;
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
 *  the question. Sub-question-local `suggestion_deadline_minutes` (the duration
 *  setting) still drives the "deferred timer not yet started" branch. */
export function isInSuggestionPhase(
  question: Question,
  suggestionDeadline?: string | null,
): boolean {
  if (question.question_type !== 'ranked_choice') return false;
  if (suggestionDeadline && new Date(suggestionDeadline) > new Date()) return true;
  if (!suggestionDeadline && question.suggestion_deadline_minutes) return true;
  return false;
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

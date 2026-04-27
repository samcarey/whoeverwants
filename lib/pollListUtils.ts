import { Poll, PollResults } from "@/lib/types";
import { getBuiltInType } from "@/components/TypeFieldInput";

export const POLL_TYPE_SYMBOLS: Record<string, string> = {
  yes_no: '👍',
  ranked_choice: '🗳️',
  time: '📅',
};

const CLOSED_YES_NO_SYMBOL = '🏆';

export function getPollSymbol(pollType: string, isClosed: boolean): string {
  if (pollType === 'yes_no' && isClosed) return CLOSED_YES_NO_SYMBOL;
  return POLL_TYPE_SYMBOLS[pollType] || '☰';
}

export function getCategoryIcon(poll: Poll): string {
  const category = poll.category;
  if (category && category !== 'custom') {
    const builtIn = getBuiltInType(category);
    if (builtIn?.icon) return builtIn.icon;
  }
  // Custom or no category — use poll type symbol
  return getPollSymbol(poll.poll_type, poll.is_closed ?? false);
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

export function isInSuggestionPhase(poll: Poll): boolean {
  if (poll.poll_type !== 'ranked_choice') return false;
  if (poll.suggestion_deadline && new Date(poll.suggestion_deadline) > new Date()) return true;
  if (!poll.suggestion_deadline && poll.suggestion_deadline_minutes) return true;
  return false;
}

export function isInTimeAvailabilityPhase(poll: Poll): boolean {
  if (poll.poll_type !== 'time') return false;
  return !poll.options || poll.options.length === 0;
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

/** Simplified result badge — no user-specific logic, just poll + results. */
export function getResultBadge(poll: Poll): ResultBadge {
  const results = poll.results;
  if (!results) return { text: 'No results', emoji: '🔇', color: 'gray' };
  if (results.total_votes === 0) return { text: 'No voters', emoji: '🦗', color: 'gray' };

  switch (poll.poll_type) {
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

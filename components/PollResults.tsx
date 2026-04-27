"use client";

import { useMemo } from "react";
import { PollResults, OptionsMetadata } from "@/lib/types";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import {
  formatDayLabel,
  formatStackedDayLabel,
  formatTimeSlot,
  getBubbleLabel,
  groupSlotsByDay,
  parseSlotDate,
  parseSlotStart,
} from "@/lib/timeUtils";


interface PollResultsProps {
  results: PollResults;
  isPollClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
  optionsMetadata?: OptionsMetadata | null;
  // For yes/no polls: keeps the winner card rendered in a stable DOM
  // position and hides the losing card (via grid-rows animation) when true.
  // Used by the thread view so the winner doesn't flicker across
  // expand/collapse transitions.
  hideLoser?: boolean;
  // For yes/no polls: the current viewer's choice (if voted). When defined
  // along with onVoteChange, the option cards + abstain row become
  // tappable — clicking a different option fires onVoteChange(newChoice).
  userVoteChoice?: 'yes' | 'no' | 'abstain' | null;
  onVoteChange?: (newChoice: 'yes' | 'no' | 'abstain') => void;
}

export default function PollResultsDisplay({ results, isPollClosed, userVoteData, onFollowUpClick, optionsMetadata, hideLoser, userVoteChoice, onVoteChange }: PollResultsProps) {
  if (results.poll_type === 'yes_no') {
    return <YesNoResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} hideLoser={hideLoser} userVoteChoice={userVoteChoice} onVoteChange={onVoteChange} />;
  }

  if (results.poll_type === 'ranked_choice') {
    return <CompactRankedChoiceResults results={results} isPollClosed={isPollClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} optionsMetadata={optionsMetadata} />;
  }

  if (results.poll_type === 'time') {
    return <TimeResults results={results} isPollClosed={isPollClosed} />;
  }

  return null;
}

function YesNoResults({ results, isPollClosed, userVoteData, onFollowUpClick, hideLoser = false, userVoteChoice, onVoteChange }: { results: PollResults, isPollClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void, hideLoser?: boolean, userVoteChoice?: 'yes' | 'no' | 'abstain' | null, onVoteChange?: (newChoice: 'yes' | 'no' | 'abstain') => void }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const yesPercentage = results.yes_percentage || 0;
  const noPercentage = results.no_percentage || 0;
  const winner = results.winner;
  const totalVotes = results.total_votes;

  // Prefer the explicit userVoteChoice prop (used by the thread view) over
  // the legacy userVoteData shape so callers can drive the badges + abstain
  // row without needing the full vote object.
  const voteChoice: 'yes' | 'no' | 'abstain' | null =
    userVoteChoice !== undefined
      ? userVoteChoice
      : userVoteData?.is_abstain
        ? 'abstain'
        : userVoteData?.yes_no_choice === 'yes'
          ? 'yes'
          : userVoteData?.yes_no_choice === 'no'
            ? 'no'
            : null;
  const userVotedYes = voteChoice === 'yes';
  const userVotedNo = voteChoice === 'no';
  const userAbstained = voteChoice === 'abstain';
  // Cards/abstain are tappable whenever the poll is open and a vote handler
  // was passed in — including the first-vote case (voteChoice === null).
  const canVote = !isPollClosed && !!onVoteChange;

  const yesIsWinner = winner === 'yes';
  const noIsWinner = winner === 'no';
  const isTie = winner === 'tie';

  const hasStats = totalVotes > 0;

  // Colors per side. When there are no votes yet, treat both sides as
  // neutral (nobody's winning). Winner gets a colored surface; the loser
  // stays neutral.
  const sideContainer = (side: 'yes' | 'no') => {
    const isYes = side === 'yes';
    const isWinner = hasStats && (isYes ? yesIsWinner : noIsWinner);
    if (isWinner) {
      return isYes
        ? 'bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 shadow-sm'
        : 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 shadow-sm';
    }
    if (hasStats && isTie) {
      return 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600';
    }
    return 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600';
  };
  const sidePercentClass = (side: 'yes' | 'no') => {
    const isYes = side === 'yes';
    const isWinner = hasStats && (isYes ? yesIsWinner : noIsWinner);
    if (isWinner) return isYes ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200';
    if (hasStats && isTie) return 'text-yellow-800 dark:text-yellow-200';
    return 'text-gray-700 dark:text-gray-300';
  };
  const sideLabelClass = (side: 'yes' | 'no') => {
    const isYes = side === 'yes';
    const isWinner = hasStats && (isYes ? yesIsWinner : noIsWinner);
    if (isWinner) return isYes ? 'text-green-900 dark:text-green-100 font-bold' : 'text-red-900 dark:text-red-100 font-bold';
    if (hasStats && isTie) return 'text-yellow-900 dark:text-yellow-100 font-bold';
    return 'text-gray-800 dark:text-gray-200 font-medium';
  };
  const sideCountClass = (side: 'yes' | 'no') => {
    const isYes = side === 'yes';
    const isWinner = hasStats && (isYes ? yesIsWinner : noIsWinner);
    if (isWinner) return isYes ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300';
    return 'text-gray-500 dark:text-gray-400';
  };

  // Compact (collapsed) view: a single-line winner pill + stats. Renders
  // nothing when no votes have been cast yet.
  if (hideLoser) {
    const winnerSide: 'yes' | 'no' = noIsWinner ? 'no' : 'yes';
    const winnerLabel = winnerSide === 'yes' ? 'Yes' : 'No';
    const winnerPct = winnerSide === 'yes' ? yesPercentage : noPercentage;
    const winnerCount = winnerSide === 'yes' ? yesCount : noCount;
    const winnerPillColors = yesIsWinner
      ? 'bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 text-green-900 dark:text-green-100'
      : noIsWinner
        ? 'bg-red-100 dark:bg-red-900 border-red-400 dark:border-red-600 text-red-900 dark:text-red-100'
        : 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600 text-yellow-900 dark:text-yellow-100';

    if (!hasStats) {
      return null;
    }
    return (
      <div className="flex items-center justify-end gap-[0.2rem]">
        <span className={`inline-block px-2 py-px rounded-full border text-sm font-bold ${winnerPillColors}`}>
          {winnerLabel}
        </span>
        <span className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-200">
          {winnerPct}%
        </span>
        <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
          ({winnerCount})
        </span>
      </div>
    );
  }

  const renderCard = (side: 'yes' | 'no') => {
    const isYes = side === 'yes';
    const userVoted = isYes ? userVotedYes : userVotedNo;
    const label = isYes ? 'Yes' : 'No';
    const containerClass = sideContainer(side);
    const labelClass = sideLabelClass(side);
    const interactive = canVote && !userVoted;
    const cardClasses = `relative w-24 text-center px-3 py-1.5 rounded-lg border-2 transition-all ${containerClass} ${interactive ? 'cursor-pointer hover:brightness-95 active:scale-[0.99]' : ''}`;
    // Badge hugs the outer edge of its card so it can't overlap the
    // neighboring card regardless of which side the viewer voted for.
    const badgeCornerClass = isYes ? '-top-2 -left-2' : '-top-2 -right-2';
    const cardInner = (
      <>
        {userVoted && (
          <span className={`absolute ${badgeCornerClass} w-[1.625rem] h-[1.625rem] flex items-center justify-center rounded-full bg-blue-500 text-white shadow`}>
            <svg className="w-[1.1rem] h-[1.1rem]" fill="none" stroke="currentColor" strokeWidth={4} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        <span className={`text-base ${labelClass}`}>{label}</span>
      </>
    );
    return interactive ? (
      <button type="button" onClick={() => onVoteChange!(side)} className={cardClasses}>
        {cardInner}
      </button>
    ) : (
      <div className={cardClasses}>{cardInner}</div>
    );
  };

  const abstainContent = userAbstained ? (
    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
      You abstained
    </span>
  ) : canVote ? (
    <button
      type="button"
      onClick={() => onVoteChange!('abstain')}
      className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70"
    >
      Abstain
    </button>
  ) : null;

  return (
    <div>
      {/* Cards row — items-center vertically aligns the abstain text's
          center with the cards' center. Stats render on their own row
          below so they don't skew that alignment. */}
      <div className="flex items-center justify-between gap-2">
        <div className="whitespace-nowrap ml-[1.125rem]">{abstainContent}</div>
        <div className="grid grid-cols-2 gap-x-2 items-stretch mr-3">
          {renderCard('yes')}
          {renderCard('no')}
        </div>
      </div>
      {hasStats && (
        <div className="flex justify-end mr-3 mt-0.5">
          <div className="grid grid-cols-2 gap-x-2">
            <div className="w-24 text-center tabular-nums leading-tight">
              <span className={`text-lg font-bold ${sidePercentClass('yes')}`}>{yesPercentage}%</span>
              {' '}
              <span className={`text-xs ${sideCountClass('yes')}`}>({yesCount})</span>
            </div>
            <div className="w-24 text-center tabular-nums leading-tight">
              <span className={`text-lg font-bold ${sidePercentClass('no')}`}>{noPercentage}%</span>
              {' '}
              <span className={`text-xs ${sideCountClass('no')}`}>({noCount})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimeResults({ results, isPollClosed }: { results: PollResults; isPollClosed?: boolean }) {
  const winner = results.winner;
  const options = results.options ?? [];
  const availCounts = results.availability_counts;
  const maxAvail = results.max_availability;
  const likeCounts = results.like_counts;
  const dislikeCounts = results.dislike_counts;

  // Slot keys ("YYYY-MM-DD HH:MM-HH:MM") already arrive in chronological
  // order from the backend, so no sort is needed before grouping.
  const slotsByDay = useMemo(() => groupSlotsByDay(options), [options]);

  if (!isPollClosed) {
    return (
      <div className="text-center py-3">
        <div className="text-gray-600 dark:text-gray-400 text-sm">
          Results will show when the poll closes
        </div>
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-gray-600 dark:text-gray-400">No time slots met the availability threshold.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {winner && (
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Scheduled Time</p>
          <div className="inline-flex items-center px-4 py-2 bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 rounded-xl">
            <span className="text-sm font-semibold text-green-800 dark:text-green-200">
              {formatTimeSlot(winner)}
            </span>
          </div>
          {maxAvail != null && availCounts?.[winner] != null && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              {availCounts[winner]} of {maxAvail} available
            </p>
          )}
        </div>
      )}

      {options.length > 1 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Candidate Slots ({options.length})
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" /> liked
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> disliked
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500" /> unavail.
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {slotsByDay.map(([dateStr, slots]) => {
              const { weekday, monthDay } = formatStackedDayLabel(dateStr);
              return (
                <div key={dateStr} className="flex gap-2 items-start py-3 first:pt-0 last:pb-0">
                  <div className="w-12 shrink-0 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-left leading-tight">
                    <div>{weekday}</div>
                    <div>{monthDay}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot, idx) => {
                      const label = getBubbleLabel(slot, idx > 0 ? slots[idx - 1] : null);
                      const likes = likeCounts?.[slot] ?? 0;
                      const dislikes = dislikeCounts?.[slot] ?? 0;
                      const unavailable =
                        maxAvail != null && availCounts?.[slot] != null
                          ? maxAvail - availCounts[slot]
                          : 0;
                      const isWinner = slot === winner;

                      return (
                        <div
                          key={slot}
                          title={formatTimeSlot(slot)}
                          className={[
                            "relative w-12 h-8 flex items-center justify-center rounded-full text-[0.9rem] font-medium tabular-nums leading-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300",
                            isWinner
                              ? "border-2 border-green-500 shadow-sm"
                              : "border border-gray-300 dark:border-gray-600",
                          ].join(" ")}
                        >
                          <span className="block cap-height-text">{label}</span>
                          {likes > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-white leading-none ring-1 ring-white dark:ring-gray-900">
                              {likes}
                            </span>
                          )}
                          {dislikes > 0 && (
                            <span className="absolute -top-1.5 -left-1.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none ring-1 ring-white dark:ring-gray-900">
                              {dislikes}
                            </span>
                          )}
                          {unavailable > 0 && (
                            <span className="absolute -bottom-1.5 -right-1.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white leading-none ring-1 ring-white dark:ring-gray-900">
                              {unavailable}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact single-line previews rendered in the lower-right of the thread
// card's compact header when collapsed. Empty states render below the card in
// the respondents row, so these all return null when there's no content.

// min-w-0 overrides the default `min-width: auto` on flex items so the pill
// can shrink below its content width when the thread card's footer row is
// tight, letting the internal `truncate` produce ellipsis on long winner names.
const PILL_CLASS = "inline-block min-w-0 px-2 py-px rounded-full border text-sm font-bold truncate max-w-[14rem]";
const PILL_COLORS_CLOSED = "bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 text-green-900 dark:text-green-100";
const PILL_COLORS_OPEN = "bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 text-blue-900 dark:text-blue-100";

// Short "Day 1 PM" / "Day 2:15 AM" label for the compact pill.
function formatSlotCompact(slot: string): string {
  try {
    const { h, m } = parseSlotStart(slot);
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const minSuffix = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
    return `${formatDayLabel(parseSlotDate(slot))} ${h12}${minSuffix} ${ampm}`;
  } catch {
    return slot;
  }
}

export function CompactRankedChoicePreview({
  results,
  isPollClosed,
}: {
  results: PollResults;
  isPollClosed?: boolean;
}) {
  const totalVotes = results.total_votes || 0;
  const winner = results.winner;
  if (totalVotes === 0 || !winner || winner === "tie") {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-2 min-w-0">
      <span className="text-xs shrink-0">🏆</span>
      <span
        className={`${PILL_CLASS} ${isPollClosed ? PILL_COLORS_CLOSED : PILL_COLORS_OPEN}`}
        title={winner}
      >
        {winner}
      </span>
    </div>
  );
}

export function CompactSuggestionPreview({
  results,
}: {
  results: PollResults;
}) {
  const suggestionCount = (results.suggestion_counts || []).length;
  if (suggestionCount === 0) {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={`${PILL_CLASS} ${PILL_COLORS_OPEN}`}>
        {suggestionCount} {suggestionCount === 1 ? "suggestion" : "suggestions"}
      </span>
    </div>
  );
}

export function CompactTimePreview({
  results,
  isPollClosed,
}: {
  results: PollResults;
  isPollClosed?: boolean;
}) {
  const totalVotes = results.total_votes || 0;
  const winner = results.winner;
  if (totalVotes === 0 || !winner) {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-2 min-w-0">
      <span className="text-xs shrink-0">📅</span>
      <span
        className={`${PILL_CLASS} ${isPollClosed ? PILL_COLORS_CLOSED : PILL_COLORS_OPEN}`}
        title={formatTimeSlot(winner)}
      >
        {formatSlotCompact(winner)}
      </span>
    </div>
  );
}


"use client";

import { useMemo } from "react";
import { QuestionResults, OptionsMetadata } from "@/lib/types";
import CompactRankedChoiceResults from "./CompactRankedChoiceResults";
import ShowtimeBubbles, { ShowtimeSlot } from "./ShowtimeBubbles";
import CollapsibleFadeSection from "./CollapsibleFadeSection";
import OutcomeInfoButton from "./OutcomeInfoButton";
import { outcomeExplainer } from "@/lib/outcomeExplainer";
import {
  expandHourRowsToQuarters,
  formatDayLabel,
  formatStackedDayLabel,
  formatTimeSlot,
  getBubbleLabel,
  groupSlotsByDay,
  parseSlotDate,
  parseSlotStart,
  periodColorClass,
  slotExcludedCount,
  type SlotCell,
} from "@/lib/timeUtils";


interface QuestionResultsProps {
  results: QuestionResults;
  isQuestionClosed?: boolean;
  userVoteData?: any;
  onFollowUpClick?: () => void;
  optionsMetadata?: OptionsMetadata | null;
  // For yes/no questions: keeps the winner card rendered in a stable DOM
  // position and hides the losing card (via grid-rows animation) when true.
  // Used by the group view so the winner doesn't flicker across
  // expand/collapse transitions.
  hideLoser?: boolean;
  // Group-card "result preview" mode: render the winner as bare text (no pill
  // bubble) at the inherited font size, so the group card can lay the title +
  // result out on one line (or wrapped) with a connecting arrow. Only honored
  // on the yes/no hideLoser path.
  plain?: boolean;
  // For yes/no questions: the current viewer's choice (if voted). When defined
  // along with onVoteChange, the option cards + abstain row become
  // tappable — clicking a different option fires onVoteChange(newChoice).
  userVoteChoice?: 'yes' | 'no' | 'abstain' | null;
  onVoteChange?: (newChoice: 'yes' | 'no' | 'abstain') => void;
  // True when `userVoteChoice` reflects a staged-but-not-yet-submitted tap
  // (multi-question polls batching choices through a wrapper Submit). The
  // abstain label flips to "Abstaining" so it doesn't imply a committed vote.
  isStagedChoice?: boolean;
}

export default function QuestionResultsDisplay({ results, isQuestionClosed, userVoteData, onFollowUpClick, optionsMetadata, hideLoser, plain, userVoteChoice, onVoteChange, isStagedChoice }: QuestionResultsProps) {
  if (results.question_type === 'yes_no') {
    return <YesNoResults results={results} isQuestionClosed={isQuestionClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} hideLoser={hideLoser} plain={plain} userVoteChoice={userVoteChoice} onVoteChange={onVoteChange} isStagedChoice={isStagedChoice} />;
  }

  if (results.question_type === 'ranked_choice') {
    return <CompactRankedChoiceResults results={results} isQuestionClosed={isQuestionClosed} userVoteData={userVoteData} onFollowUpClick={onFollowUpClick} optionsMetadata={optionsMetadata} />;
  }

  if (results.question_type === 'time') {
    return <TimeResults results={results} isQuestionClosed={isQuestionClosed} />;
  }

  if (results.question_type === 'showtime') {
    return <ShowtimeResults results={results} isQuestionClosed={isQuestionClosed} optionsMetadata={optionsMetadata ?? undefined} />;
  }

  // limited_supply has no QuestionResultsDisplay branch: the group card uses
  // CompactSupplyPreview (counts only) and the detail-page ballot renders the
  // roster itself (LimitedSupplyBallot), so this dispatcher is never called
  // for it.

  return null;
}

function YesNoResults({ results, isQuestionClosed, userVoteData, onFollowUpClick, hideLoser = false, plain = false, userVoteChoice, onVoteChange, isStagedChoice }: { results: QuestionResults, isQuestionClosed?: boolean, userVoteData?: any, onFollowUpClick?: () => void, hideLoser?: boolean, plain?: boolean, userVoteChoice?: 'yes' | 'no' | 'abstain' | null, onVoteChange?: (newChoice: 'yes' | 'no' | 'abstain') => void, isStagedChoice?: boolean }) {
  const yesCount = results.yes_count || 0;
  const noCount = results.no_count || 0;
  const yesPercentage = results.yes_percentage || 0;
  const noPercentage = results.no_percentage || 0;
  const winner = results.winner;
  const totalVotes = results.total_votes;

  // Prefer the explicit userVoteChoice prop (used by the group view) over
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
  // Cards/abstain are tappable whenever the question is open and a vote handler
  // was passed in — including the first-vote case (voteChoice === null).
  const canVote = !isQuestionClosed && !!onVoteChange;

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
    // Bubble-less "result preview" for the group card: winner label colored
    // (green Yes / red No / yellow tie) at the inherited font size, followed by
    // muted percentage + count.
    if (plain) {
      const winnerTextColor = yesIsWinner
        ? 'text-green-700 dark:text-green-300'
        : noIsWinner
          ? 'text-red-700 dark:text-red-300'
          : 'text-yellow-700 dark:text-yellow-300';
      return (
        <span className="font-semibold whitespace-nowrap">
          <span className={winnerTextColor}>{winnerLabel}</span>
          <span className="ml-1 text-sm font-medium tabular-nums text-gray-500 dark:text-gray-400">
            {winnerPct}% ({winnerCount})
          </span>
        </span>
      );
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
      {isStagedChoice ? 'Abstaining' : 'You abstained'}
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

  // Plain-language outcome explanation, behind a grey info (ⓘ) icon placed
  // inline right after a "Final Results" label (yes/no has no other heading) —
  // closed only.
  const explanation = isQuestionClosed ? outcomeExplainer(results) : null;

  return (
    <div>
      {explanation && (
        <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 inline-flex items-center gap-1">
          Final Results
          <OutcomeInfoButton text={explanation} align="left" />
        </p>
      )}
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

function TimeResults({ results, isQuestionClosed }: { results: QuestionResults; isQuestionClosed?: boolean }) {
  const winner = results.winner;
  const options = results.options ?? [];
  const availCounts = results.availability_counts;
  const maxAvail = results.max_availability;
  // Absolute exclusion denominator: everyone who submitted availability. Even
  // the best slot can leave some of them out. Falls back to maxAvail (relative)
  // for older results that predate the field.
  const respondents = results.availability_respondents ?? maxAvail;
  const likeCounts = results.like_counts;
  const dislikeCounts = results.dislike_counts;

  // Slot keys ("YYYY-MM-DD HH:MM-HH:MM") already arrive in chronological
  // order from the backend, so no sort is needed before grouping.
  const days = useMemo(
    () =>
      groupSlotsByDay(options).map(([dateStr, slots]) => ({
        dateStr,
        dayLabel: formatStackedDayLabel(dateStr),
        hourRows: expandHourRowsToQuarters(slots),
      })),
    [options],
  );

  if (!isQuestionClosed) {
    return null;
  }

  // No slot met the "Minimum Participants" gate → the event is off.
  if (results.time_event_cancelled) {
    return (
      <div className="text-center py-4 space-y-1">
        <p className="text-base font-semibold text-gray-800 dark:text-gray-100">No time works — the event&apos;s off</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No time had enough people available.
        </p>
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

  // Plain-language outcome explanation, behind a grey info (ⓘ) icon placed
  // inline right after the "Scheduled Time" label. The "event's off" branch
  // above returns its own self-explanatory banner, so the explainer only
  // applies to a decided winner here.
  const explanation = outcomeExplainer(results);

  return (
    <div className="space-y-4">
      {winner && (
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 inline-flex items-center gap-1">
            Scheduled Time
            {explanation && <OutcomeInfoButton text={explanation} />}
          </p>
          <div className="inline-flex items-center px-4 py-2 bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 rounded-xl">
            <span className="text-sm font-semibold text-green-800 dark:text-green-200">
              {formatTimeSlot(winner)}
            </span>
          </div>
          {respondents != null && respondents > 0 && availCounts?.[winner] != null && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              {availCounts[winner]} of {respondents} available
            </p>
          )}
        </div>
      )}

      {options.length > 1 && (
        <CollapsibleStartOptions>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {days.map(({ dateStr, dayLabel: { weekday, monthDay }, hourRows }) => {
              const renderCell = (cell: SlotCell, prevSlot: string | null) => {
                const { time } = getBubbleLabel(cell.slot, prevSlot);
                if (!cell.available) {
                  return (
                    <div
                      key={cell.slot}
                      className={`${SLOT_CELL_SIZE} text-gray-300 dark:text-gray-600 select-none`}
                      aria-hidden="true"
                    >
                      <span className="block cap-height-text">{time}</span>
                    </div>
                  );
                }
                const likes = likeCounts?.[cell.slot] ?? 0;
                const dislikes = dislikeCounts?.[cell.slot] ?? 0;
                const unavailable = slotExcludedCount(respondents, availCounts?.[cell.slot]);
                const isWinner = cell.slot === winner;
                return (
                  <div
                    key={cell.slot}
                    title={formatTimeSlot(cell.slot)}
                    className={[
                      "relative rounded-full bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300",
                      SLOT_CELL_SIZE,
                      isWinner
                        ? "border-2 border-green-500 shadow-sm"
                        : "border border-gray-300 dark:border-gray-600",
                    ].join(" ")}
                  >
                    <span className="block cap-height-text">{time}</span>
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
              };
              return (
                <div key={dateStr} className="flex gap-2 items-start py-3 first:pt-0 last:pb-0">
                  <div className="w-12 shrink-0 pt-1 text-xs font-medium text-gray-500 dark:text-gray-400 text-left leading-tight">
                    <div>{weekday}</div>
                    <div>{monthDay}</div>
                  </div>

                  <div className="flex flex-col gap-2 flex-1">
                    {hourRows.map((hourRow, rowIdx) => {
                      const firstPrev = rowIdx > 0
                        ? hourRows[rowIdx - 1][hourRows[rowIdx - 1].length - 1].slot
                        : null;
                      const rowPeriod = getBubbleLabel(hourRow[0].slot, firstPrev).period;
                      const [first, ...rest] = hourRow;
                      return (
                        <div key={first.slot} className="flex gap-2 items-start">
                          <div className={`w-7 shrink-0 h-8 flex items-center justify-end text-xs font-semibold tabular-nums ${periodColorClass(rowPeriod)}`}>
                            {rowPeriod ?? ""}
                          </div>
                          <div className="grid grid-cols-[auto_1fr] gap-2 items-start flex-1">
                            {renderCell(first, firstPrev)}
                            <div className="flex flex-wrap gap-2">
                              {rest.map((cell, i) => renderCell(cell, hourRow[i].slot))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleStartOptions>
      )}
    </div>
  );
}

const SLOT_CELL_SIZE =
  "min-w-12 h-8 px-2 flex items-center justify-center text-[0.9rem] font-mono font-medium leading-none whitespace-nowrap";

const COLLAPSED_SLOTS_HEIGHT = 80;

function CollapsibleStartOptions({ children }: { children: React.ReactNode }) {
  const header = (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Start Options
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
  );

  return (
    <CollapsibleFadeSection
      collapsedHeight={COLLAPSED_SLOTS_HEIGHT}
      fadePx={28}
      innerClassName="pt-1.5"
      header={header}
      ariaLabel="start options"
    >
      {children}
    </CollapsibleFadeSection>
  );
}

/** Full results for a showtime question (closed): the winning showtime with
 *  its rich metadata + attendance/want counts + a ticketing link, then the
 *  full showtime grid (disabled) with each option's want/can't counts. */
function ShowtimeResults({
  results,
  isQuestionClosed,
  optionsMetadata,
}: {
  results: QuestionResults;
  isQuestionClosed?: boolean;
  optionsMetadata?: OptionsMetadata;
}) {
  const options = results.options ?? [];
  const winner = results.winner;
  const attendance = results.attendance_counts ?? {};
  const likeCounts = results.like_counts ?? {};

  const slots: ShowtimeSlot[] = useMemo(
    () =>
      options.map((key) => {
        const m = (optionsMetadata?.[key] ?? {}) as Record<string, unknown>;
        const { h, m: mm } = parseSlotStart(key);
        return {
          key,
          time: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
          cinema_name: (m.cinema_name as string) ?? null,
          format: (m.format as string) ?? null,
          seats_left: typeof m.seats_left === "number" ? (m.seats_left as number) : null,
        };
      }),
    [options, optionsMetadata],
  );

  if (!isQuestionClosed || options.length === 0) return null;

  const winnerMeta = winner ? ((optionsMetadata?.[winner] ?? {}) as Record<string, unknown>) : {};
  const salesUrl = winnerMeta.sales_url as string | undefined;

  return (
    <div className="space-y-4">
      {winner && (
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1 inline-flex items-center gap-1">
            Winning Showtime
            <OutcomeInfoButton text={outcomeShowtimeExplanation(results)} align="center" />
          </p>
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {formatTimeSlot(winner)}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {[winnerMeta.cinema_name as string, winnerMeta.format as string].filter(Boolean).join(" · ")}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {attendance[winner] ?? 0} can attend · {likeCounts[winner] ?? 0} want
          </p>
          {salesUrl && (
            <a
              href={salesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 active:scale-95"
            >
              Get tickets →
            </a>
          )}
        </div>
      )}
      <ShowtimeBubbles
        mode="vote"
        slots={slots}
        likedKeys={Object.entries(likeCounts).filter(([, c]) => c > 0).map(([k]) => k)}
        dislikedKeys={[]}
        onToggle={() => {}}
        disabled
      />
    </div>
  );
}

function outcomeShowtimeExplanation(results: QuestionResults): string {
  const winner = results.winner;
  if (!winner) return "No showtime got enough support.";
  const attend = results.attendance_counts?.[winner] ?? 0;
  const want = results.like_counts?.[winner] ?? 0;
  return `This showtime wins because it has the fewest people who can't attend (${attend} can come), then the most who want it (${want} want).`;
}

// Compact single-line previews rendered in the lower-right of the group
// card's compact header when collapsed. Empty states render below the card in
// the respondents row, so these all return null when there's no content.

// min-w-0 overrides the default `min-width: auto` on flex items so the pill
// can shrink below its content width when the group card's footer row is
// tight, letting the internal `truncate` produce ellipsis on long winner names.
const PILL_CLASS = "inline-block min-w-0 px-2 py-px rounded-full border text-sm font-bold truncate max-w-[14rem]";
const PILL_COLORS_CLOSED = "bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 text-green-900 dark:text-green-100";
const PILL_COLORS_OPEN = "bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600 text-blue-900 dark:text-blue-100";

// Bubble-less "result preview" variant of the compact pills, used by the group
// card's title+result layout. No background / border / padding — just colored
// text at the inherited (title) font size. green = closed/decided, blue = open.
const PLAIN_RESULT_CLASS = "font-semibold break-words";
const PLAIN_COLOR_CLOSED = "text-green-700 dark:text-green-300";
const PLAIN_COLOR_OPEN = "text-blue-700 dark:text-blue-400";

// Short "Day 1 PM" / "Day 2:15 AM" label for the compact pill.
function formatSlotCompact(slot: string): string {
  try {
    const { h, m } = parseSlotStart(slot);
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const minSuffix = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
    return `${formatDayLabel(parseSlotDate(slot))}, ${h12}${minSuffix} ${ampm}`;
  } catch {
    return slot;
  }
}

export function CompactRankedChoicePreview({
  results,
  isQuestionClosed,
  categoryIcon,
  plain,
}: {
  results: QuestionResults;
  isQuestionClosed?: boolean;
  // When the question's category has its own emoji (restaurant, movie,
  // location, etc.), pass it here. Omit for `custom` / no-category — we
  // intentionally don't fall back to a generic trophy.
  categoryIcon?: string;
  plain?: boolean;
}) {
  const totalVotes = results.total_votes || 0;
  const winner = results.winner;
  if (totalVotes === 0 || !winner || winner === "tie") {
    return null;
  }
  if (plain) {
    return (
      <span
        className={`${PLAIN_RESULT_CLASS} ${isQuestionClosed ? PLAIN_COLOR_CLOSED : PLAIN_COLOR_OPEN}`}
        title={winner}
      >
        {winner}
      </span>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 min-w-0">
      {categoryIcon && (
        <span className="text-xs shrink-0">{categoryIcon}</span>
      )}
      <span
        className={`${PILL_CLASS} ${isQuestionClosed ? PILL_COLORS_CLOSED : PILL_COLORS_OPEN}`}
        title={winner}
      >
        {winner}
      </span>
    </div>
  );
}

export function CompactSuggestionPreview({
  results,
  plain,
}: {
  results: QuestionResults;
  plain?: boolean;
}) {
  const suggestionCount = (results.suggestion_counts || []).length;
  if (suggestionCount === 0) {
    return null;
  }
  const label = `${suggestionCount} ${suggestionCount === 1 ? "suggestion" : "suggestions"}`;
  if (plain) {
    return <span className={`${PLAIN_RESULT_CLASS} ${PLAIN_COLOR_OPEN}`}>{label}</span>;
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={`${PILL_CLASS} ${PILL_COLORS_OPEN}`}>{label}</span>
    </div>
  );
}

export function CompactTimePreview({
  results,
  isQuestionClosed,
  categoryIcon,
  plain,
}: {
  results: QuestionResults;
  isQuestionClosed?: boolean;
  categoryIcon?: string;
  plain?: boolean;
}) {
  const totalVotes = results.total_votes || 0;
  const winner = results.winner;
  // No slot met the "Minimum Participants" gate → the event is off.
  if (results.time_event_cancelled) {
    if (plain) {
      return <span className={`${PLAIN_RESULT_CLASS} ${PLAIN_COLOR_CLOSED}`}>Event&apos;s off</span>;
    }
    return (
      <div className="flex items-center justify-end gap-2 min-w-0">
        {categoryIcon && (
          <span className="text-xs shrink-0">{categoryIcon}</span>
        )}
        <span className={`${PILL_CLASS} ${PILL_COLORS_CLOSED}`}>
          Event&apos;s off
        </span>
      </div>
    );
  }
  if (totalVotes === 0 || !winner) {
    return null;
  }
  if (plain) {
    return (
      <span
        className={`${PLAIN_RESULT_CLASS} ${isQuestionClosed ? PLAIN_COLOR_CLOSED : PLAIN_COLOR_OPEN}`}
        title={formatTimeSlot(winner)}
      >
        {formatSlotCompact(winner)}
      </span>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 min-w-0">
      {categoryIcon && (
        <span className="text-xs shrink-0">{categoryIcon}</span>
      )}
      <span
        className={`${PILL_CLASS} ${isQuestionClosed ? PILL_COLORS_CLOSED : PILL_COLORS_OPEN}`}
        title={formatTimeSlot(winner)}
      >
        {formatSlotCompact(winner)}
      </span>
    </div>
  );
}

/** Compact group-card pill for a limited-supply question: "3/4 claimed" or
 *  "Full" once every slot is taken. supplyFallback is the question's
 *  supply_count, used when no results have loaded yet (so a fresh poll still
 *  shows "0/4 claimed" instead of nothing). */
export function CompactSupplyPreview({
  results,
  supplyFallback,
  isQuestionClosed,
  plain,
}: {
  results?: QuestionResults | null;
  supplyFallback?: number | null;
  isQuestionClosed?: boolean;
  plain?: boolean;
}) {
  const supply = results?.supply_count ?? supplyFallback ?? 0;
  if (!supply) return null;
  const secured = results?.secured_count ?? 0;
  const isFull = secured >= supply;
  const label = isFull ? "Full" : `${secured}/${supply} claimed`;
  if (plain) {
    return (
      <span className={`${PLAIN_RESULT_CLASS} ${isQuestionClosed || isFull ? PLAIN_COLOR_CLOSED : PLAIN_COLOR_OPEN}`}>
        {label}
      </span>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 min-w-0">
      <span className={`${PILL_CLASS} ${isQuestionClosed || isFull ? PILL_COLORS_CLOSED : PILL_COLORS_OPEN}`}>
        {label}
      </span>
    </div>
  );
}

/** Compact group-card pill for a showtime question: the winning showtime
 *  (compact time), green when closed / blue when open. Null until a winner
 *  emerges. */
export function CompactShowtimePreview({
  results,
  isQuestionClosed,
  categoryIcon,
  plain,
}: {
  results: QuestionResults;
  isQuestionClosed?: boolean;
  categoryIcon?: string;
  plain?: boolean;
}) {
  const winner = results.winner;
  if ((results.total_votes || 0) === 0 || !winner) return null;
  if (plain) {
    return (
      <span
        className={`${PLAIN_RESULT_CLASS} ${isQuestionClosed ? PLAIN_COLOR_CLOSED : PLAIN_COLOR_OPEN}`}
        title={formatTimeSlot(winner)}
      >
        {formatSlotCompact(winner)}
      </span>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2 min-w-0">
      {categoryIcon && <span className="text-xs shrink-0">{categoryIcon}</span>}
      <span
        className={`${PILL_CLASS} ${isQuestionClosed ? PILL_COLORS_CLOSED : PILL_COLORS_OPEN}`}
        title={formatTimeSlot(winner)}
      >
        {formatSlotCompact(winner)}
      </span>
    </div>
  );
}


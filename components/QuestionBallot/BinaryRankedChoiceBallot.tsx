"use client";

import OptionLabel from "@/components/OptionLabel";
import type { OptionsMetadata, QuestionResults } from "@/lib/types";

interface BinaryRankedChoiceBallotProps {
  // Display order for the two options (already shuffled client-side).
  displayOrder: string[];
  // The user's currently-staged choice. `null` = no choice yet, `'abstain'` =
  // staged abstain, otherwise the option name.
  currentChoice: string | "abstain" | null;
  // Live results for the question — used to color the winner card and show
  // first-round vote counts + percentages. May be null on first paint before
  // the fetch resolves.
  results: QuestionResults | null | undefined;
  onChoose: (option: string) => void;
  onAbstain: () => void;
  disabled?: boolean;
  optionsMetadata: OptionsMetadata | null;
}

function getFirstRoundCount(
  results: QuestionResults | null | undefined,
  option: string,
): number {
  if (!results?.ranked_choice_rounds) return 0;
  const row = results.ranked_choice_rounds.find(
    (r) => r.round_number === 1 && r.option_name === option,
  );
  return row?.vote_count ?? 0;
}

export default function BinaryRankedChoiceBallot({
  displayOrder,
  currentChoice,
  results,
  onChoose,
  onAbstain,
  disabled = false,
  optionsMetadata,
}: BinaryRankedChoiceBallotProps) {
  if (displayOrder.length !== 2) return null;

  const winnerName = results?.winner;
  const isTie = winnerName === "tie";
  const counts = displayOrder.map((opt) => getFirstRoundCount(results, opt));
  const totalFirstRound = counts[0] + counts[1];
  const hasStats = totalFirstRound > 0;
  const percentages = counts.map((c) =>
    hasStats ? Math.round((c / totalFirstRound) * 100) : 0,
  );

  const userAbstained = currentChoice === "abstain";

  // Green for winner, gray for loser — the "no" red yes/no uses doesn't fit
  // here since a losing option isn't a negation.
  const cardClass = (option: string, isUserChoice: boolean): string => {
    const base =
      "relative flex-1 min-w-0 text-center px-3 py-3 rounded-lg border-2 transition-all";
    const interactive =
      !disabled && !isUserChoice ? "cursor-pointer hover:brightness-95 active:scale-[0.99]" : "";
    let palette: string;
    if (hasStats && !isTie && winnerName === option) {
      palette =
        "bg-green-100 dark:bg-green-900 border-green-400 dark:border-green-600 shadow-sm text-green-900 dark:text-green-100";
    } else if (hasStats && isTie) {
      palette =
        "bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600 text-yellow-900 dark:text-yellow-100";
    } else {
      palette =
        "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200";
    }
    return [base, palette, interactive].filter(Boolean).join(" ");
  };

  const percentTextClass = (option: string): string => {
    if (hasStats && !isTie && winnerName === option) {
      return "text-green-800 dark:text-green-200";
    }
    if (hasStats && isTie) return "text-yellow-800 dark:text-yellow-200";
    return "text-gray-700 dark:text-gray-300";
  };

  const countTextClass = (option: string): string => {
    if (hasStats && !isTie && winnerName === option) {
      return "text-green-700 dark:text-green-300";
    }
    return "text-gray-500 dark:text-gray-400";
  };

  const renderCard = (option: string) => {
    const isUserChoice = currentChoice === option;
    // Badge hugs the outer corner so it can't overlap the neighboring card.
    const isLeft = option === displayOrder[0];
    const badgeCornerClass = isLeft ? "-top-2 -left-2" : "-top-2 -right-2";
    return (
      <button
        key={option}
        type="button"
        onClick={(e) => {
          // PlaceDetailModal triggers (e.g. tapping a restaurant link inside
          // the rich label) shouldn't double as a vote.
          if ((e.target as HTMLElement).closest?.("[data-place-name]")) return;
          if (disabled) return;
          onChoose(option);
        }}
        disabled={disabled}
        className={`${cardClass(option, isUserChoice)} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isUserChoice && (
          <span
            className={`absolute ${badgeCornerClass} w-[1.625rem] h-[1.625rem] flex items-center justify-center rounded-full bg-blue-500 text-white shadow`}
          >
            <svg
              className="w-[1.1rem] h-[1.1rem]"
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        <OptionLabel
          text={option}
          metadata={optionsMetadata?.[option]}
          layout="stacked"
        />
      </button>
    );
  };

  const abstainContent = userAbstained ? (
    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
      You abstained
    </span>
  ) : !disabled ? (
    <button
      type="button"
      onClick={onAbstain}
      className="text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70"
    >
      Abstain
    </button>
  ) : null;

  return (
    <div className={userAbstained ? "opacity-60" : undefined}>
      <div className="flex items-center gap-2">
        <div className="whitespace-nowrap shrink-0 ml-1">{abstainContent}</div>
        <div className="flex-1 flex gap-2">
          {renderCard(displayOrder[0])}
          {renderCard(displayOrder[1])}
        </div>
      </div>
      {hasStats && (
        <div className="flex items-center gap-2 mt-1">
          {/* Spacer that matches the abstain column width so the percent
              row stays aligned with the cards. */}
          <div aria-hidden className="invisible whitespace-nowrap shrink-0 ml-1 text-xs">
            Abstain
          </div>
          <div className="flex-1 flex gap-2">
            {displayOrder.map((option, i) => (
              <div
                key={option}
                className="flex-1 min-w-0 text-center tabular-nums leading-tight"
              >
                <span className={`text-lg font-bold ${percentTextClass(option)}`}>
                  {percentages[i]}%
                </span>{" "}
                <span className={`text-xs ${countTextClass(option)}`}>
                  ({counts[i]})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { QuestionResults } from "@/lib/types";
import { rankedChoiceResultGloss } from "@/lib/rankedChoiceGloss";
import { formatTimeSlot } from "@/lib/timeUtils";

export type OutcomeExplanation = {
  // 'warn' = a result worth a second look (e.g. ranked-choice eliminated a
  // broadly-acceptable option early); the info (ⓘ) affordance is tinted amber.
  // 'info' = a neutral how-it-was-decided gloss; the icon stays muted.
  tone: "info" | "warn";
  text: string;
};

/**
 * Plain-language explanation of a CLOSED poll's outcome, surfaced ONLY behind
 * an info (ⓘ) affordance on the result view — never inline, so it never
 * competes with the result chrome itself. Pure + deterministic so it can be
 * unit-tested without rendering.
 *
 * Returns null when there's nothing worth explaining (no votes, an
 * undecided/in-progress state, or a self-evident terminal banner that already
 * reads as plain language — e.g. the time "event's off" banner). The
 * ranked-choice case delegates to `rankedChoiceResultGloss`, which carries the
 * valuable "a broadly-acceptable option lost" warning (tone: 'warn'); yes/no
 * and time get their own one-liners.
 */
export function outcomeExplainer(
  results: QuestionResults,
): OutcomeExplanation | null {
  switch (results.question_type) {
    case "yes_no":
      return yesNoExplanation(results);
    case "time":
      return timeExplanation(results);
    case "ranked_choice":
      return rankedChoiceExplanation(results);
    default:
      // limited_supply is first-come / not a "why this won" decision; no gloss.
      return null;
  }
}

function yesNoExplanation(results: QuestionResults): OutcomeExplanation | null {
  const total = results.total_votes ?? 0;
  if (total === 0) return null;

  const yes = results.yes_count ?? 0;
  const no = results.no_count ?? 0;
  const abstain = results.abstain_count ?? 0;
  const abstainNote = abstain > 0 ? ` (${abstain} abstained)` : "";

  if (yes === 0 && no === 0) {
    // Votes were cast but every one was an abstain.
    return {
      tone: "info",
      text: "Everyone abstained, so nothing was decided.",
    };
  }

  if (results.winner === "tie" || yes === no) {
    return {
      tone: "info",
      text: `It's a tie — ${yes} voted Yes and ${no} voted No, so there's no decision.${abstainNote}`,
    };
  }

  const yesWon = yes > no;
  const winnerLabel = yesWon ? "Yes" : "No";
  const winnerCount = yesWon ? yes : no;
  const loserCount = yesWon ? no : yes;
  return {
    tone: "info",
    text: `${winnerLabel} won, ${winnerCount} to ${loserCount}.${abstainNote}`,
  };
}

function timeExplanation(results: QuestionResults): OutcomeExplanation | null {
  // The "event's off" banner already reads as plain language; no icon needed.
  if (results.time_event_cancelled) return null;

  const winner = results.winner;
  if (!winner) return null;

  const label = formatTimeSlot(winner);
  const maxAvail = results.max_availability;
  const avail = results.availability_counts?.[winner];
  const availClause =
    maxAvail != null && maxAvail > 0 && avail != null
      ? ` ${avail} of ${maxAvail} can make it,`
      : "";

  return {
    tone: "info",
    text: `${label} works best —${availClause} and among the available times it had the fewest people who'd rather not.`,
  };
}

function rankedChoiceExplanation(
  results: QuestionResults,
): OutcomeExplanation | null {
  const gloss = rankedChoiceResultGloss(results);
  if (gloss) return gloss;

  // `rankedChoiceResultGloss` returns null for a single-round majority (and for
  // no-winner / tie). Give the majority case its own one-liner so the info
  // affordance is consistent across decided ranked-choice outcomes.
  const winner = results.winner;
  if (!winner || winner === "tie") return null;
  return {
    tone: "info",
    text: `“${winner}” won with a majority of first-choice votes.`,
  };
}

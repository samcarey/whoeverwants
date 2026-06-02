import { QuestionResults } from "@/lib/types";
import { rankedChoiceResultGloss } from "@/lib/rankedChoiceGloss";
import { formatTimeSlot } from "@/lib/timeUtils";

/**
 * Plain-language explanation of a CLOSED poll's outcome, surfaced ONLY behind
 * a (grey) info (ⓘ) affordance on the result view — never inline, so it never
 * competes with the result chrome itself. Pure + deterministic so it can be
 * unit-tested without rendering.
 *
 * Returns null when there's nothing worth explaining (no votes, an
 * undecided/in-progress state, or a self-evident terminal banner that already
 * reads as plain language — e.g. the time "event's off" banner). The
 * ranked-choice case delegates to `rankedChoiceResultGloss`, which carries the
 * valuable "a broadly-acceptable option lost" gloss; yes/no and time get their
 * own one-liners.
 */
export function outcomeExplainer(results: QuestionResults): string | null {
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

function yesNoExplanation(results: QuestionResults): string | null {
  const total = results.total_votes ?? 0;
  if (total === 0) return null;

  const yes = results.yes_count ?? 0;
  const no = results.no_count ?? 0;
  const abstain = results.abstain_count ?? 0;
  const abstainNote = abstain > 0 ? ` (${abstain} abstained)` : "";

  if (yes === 0 && no === 0) {
    // Votes were cast but every one was an abstain.
    return "Everyone abstained, so nothing was decided.";
  }

  if (results.winner === "tie" || yes === no) {
    return `It's a tie — ${yes} voted Yes and ${no} voted No, so there's no decision.${abstainNote}`;
  }

  const yesWon = yes > no;
  const winnerLabel = yesWon ? "Yes" : "No";
  const winnerCount = yesWon ? yes : no;
  const loserCount = yesWon ? no : yes;
  return `${winnerLabel} won, ${winnerCount} to ${loserCount}.${abstainNote}`;
}

function timeExplanation(results: QuestionResults): string | null {
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

  return `${label} works best —${availClause} and among the available times it had the fewest people who'd rather not.`;
}

function rankedChoiceExplanation(results: QuestionResults): string | null {
  const gloss = rankedChoiceResultGloss(results);
  if (gloss) return gloss.text;

  // `rankedChoiceResultGloss` returns null for a single-round majority (and for
  // no-winner / tie). Give the majority case its own one-liner so the info
  // affordance is consistent across decided ranked-choice outcomes.
  const winner = results.winner;
  if (!winner || winner === "tie") return null;
  return `“${winner}” won with a majority of first-choice votes.`;
}

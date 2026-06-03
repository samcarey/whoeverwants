import { QuestionResults } from "@/lib/types";

export type RankedChoiceGloss = {
  // 'warn' = the headline-worthy "the broadly-acceptable option lost" case;
  // rendered with attention-drawing amber chrome. 'info' = a neutral
  // how-it-was-decided explanation for an otherwise-unremarkable multi-round
  // result; rendered subtly.
  tone: "info" | "warn";
  text: string;
};

/**
 * Plain-language one-line explanation of a ranked-choice (IRV) outcome.
 *
 * The valuable case: instant-runoff eliminates the option with the FEWEST
 * first-choice votes each round, so a broadly-liked compromise (everyone's
 * #2, few #1s) can be knocked out early while a polarizing plurality wins.
 * Non-experts read the bare winner as "the group's choice" and don't realize
 * a more widely-acceptable option lost. We detect that by comparing full
 * Borda scores (rewarding breadth of support across ballots) against the
 * winner's: an eliminated option with a strictly higher Borda score was
 * ranked on more/higher ballots overall yet removed for lacking first-choice
 * picks. When found, say so. Otherwise, for a multi-round result, give a
 * neutral gloss of how IRV reached the winner. Returns null when there's
 * nothing worth explaining (no winner, a tie, or a single-round majority).
 *
 * Pure + deterministic so it can be unit-tested without rendering.
 */
export function rankedChoiceResultGloss(
  results: QuestionResults,
): RankedChoiceGloss | null {
  const winner = results.winner;

  // Consensus mode: the headline IS the broadest-acceptance option, so the
  // "a compromise lost" warning never applies. Explain the method instead, and
  // note the favorite when it differs so the result is fully legible.
  if (results.winner_method === "consensus") {
    if (!winner || winner === "tie") return null;
    const favorite = results.ranked_choice_winner;
    const favoriteNote =
      favorite && favorite !== winner
        ? ` (“${favorite}” had the most first-choice picks, but “${winner}” was the option more people were okay with.)`
        : "";
    return {
      tone: "info",
      text: `This poll was set to pick the option with the broadest acceptance: “${winner}” was ranked highest across the most ballots.${favoriteNote}`,
    };
  }

  const rounds = results.ranked_choice_rounds;
  if (!winner || winner === "tie" || !rounds || rounds.length === 0) {
    return null;
  }

  const totalRounds = rounds.reduce((m, r) => Math.max(m, r.round_number), 0);
  const eliminated = new Set(
    rounds.filter((r) => r.is_eliminated).map((r) => r.option_name),
  );

  const borda = results.borda_scores;
  if (borda && winner in borda) {
    const winnerBorda = borda[winner];
    // The strongest "compromise that lost": the eliminated option ranked on
    // the most ballots overall (highest Borda) that still beat the winner's
    // breadth. Strictly-greater so an equal-breadth option doesn't trigger it.
    let compromise: string | null = null;
    let compromiseBorda = winnerBorda;
    for (const name of eliminated) {
      const score = borda[name];
      if (score !== undefined && score > compromiseBorda) {
        compromise = name;
        compromiseBorda = score;
      }
    }
    if (compromise) {
      return {
        tone: "warn",
        text: `Heads up: “${compromise}” was ranked on more ballots than “${winner}”, but had fewer first-choice picks — so ranked-choice voting eliminated it early. The winner reflects the strongest first choices, not the broadest acceptance.`,
      };
    }
  }

  if (totalRounds >= 2) {
    return {
      tone: "info",
      text: `“${winner}” won after ${totalRounds} rounds of instant-runoff voting: each round the option with the fewest first-choice votes is dropped and those ballots move to their next choice.`,
    };
  }

  // Single-round majority — the result speaks for itself.
  return null;
}

import { describe, it, expect } from "vitest";
import { outcomeExplainer } from "@/lib/outcomeExplainer";
import type { QuestionResults, RankedChoiceRound } from "@/lib/types";

function results(partial: Partial<QuestionResults>): QuestionResults {
  return {
    question_id: "q",
    title: "t",
    question_type: "yes_no",
    created_at: "",
    total_votes: 0,
    ...partial,
  };
}

function round(
  roundNumber: number,
  optionName: string,
  eliminated: boolean,
): RankedChoiceRound {
  return {
    id: `${roundNumber}-${optionName}`,
    question_id: "q",
    round_number: roundNumber,
    option_name: optionName,
    vote_count: 0,
    is_eliminated: eliminated,
    created_at: "",
  };
}

describe("outcomeExplainer — yes/no", () => {
  it("explains a clear win with counts", () => {
    const e = outcomeExplainer(
      results({ question_type: "yes_no", total_votes: 6, yes_count: 4, no_count: 2, winner: "yes" }),
    );
    expect(e).toEqual({ tone: "info", text: "Yes won, 4 to 2." });
  });

  it("orders the winning side first when No wins", () => {
    const e = outcomeExplainer(
      results({ question_type: "yes_no", total_votes: 5, yes_count: 1, no_count: 4, winner: "no" }),
    );
    expect(e?.text).toBe("No won, 4 to 1.");
  });

  it("appends an abstain note", () => {
    const e = outcomeExplainer(
      results({ question_type: "yes_no", total_votes: 7, yes_count: 4, no_count: 2, abstain_count: 1, winner: "yes" }),
    );
    expect(e?.text).toBe("Yes won, 4 to 2. (1 abstained)");
  });

  it("explains a tie", () => {
    const e = outcomeExplainer(
      results({ question_type: "yes_no", total_votes: 6, yes_count: 3, no_count: 3, winner: "tie" }),
    );
    expect(e?.tone).toBe("info");
    expect(e?.text).toContain("tie");
  });

  it("explains all-abstain", () => {
    const e = outcomeExplainer(
      results({ question_type: "yes_no", total_votes: 3, yes_count: 0, no_count: 0, abstain_count: 3 }),
    );
    expect(e?.text).toContain("abstained");
  });

  it("returns null with no votes", () => {
    expect(outcomeExplainer(results({ question_type: "yes_no", total_votes: 0 }))).toBeNull();
  });
});

describe("outcomeExplainer — time", () => {
  const slot = "2026-04-28 19:00-20:00";

  it("explains the winning slot with availability", () => {
    const e = outcomeExplainer(
      results({
        question_type: "time",
        winner: slot,
        max_availability: 6,
        availability_counts: { [slot]: 5 },
      }),
    );
    expect(e?.tone).toBe("info");
    expect(e?.text).toContain("5 of 6 can make it");
    expect(e?.text).toContain("fewest people who'd rather not");
  });

  it("omits the availability clause when counts are missing", () => {
    const e = outcomeExplainer(results({ question_type: "time", winner: slot }));
    expect(e?.text).not.toContain("can make it");
  });

  it("returns null when the event was cancelled (banner is self-explanatory)", () => {
    expect(
      outcomeExplainer(results({ question_type: "time", time_event_cancelled: true })),
    ).toBeNull();
  });

  it("returns null with no winner", () => {
    expect(outcomeExplainer(results({ question_type: "time" }))).toBeNull();
  });
});

describe("outcomeExplainer — ranked choice", () => {
  it("delegates the broadly-acceptable-lost warning (tone: warn)", () => {
    const e = outcomeExplainer(
      results({
        question_type: "ranked_choice",
        winner: "Pizza",
        borda_scores: { Pizza: 5, Sushi: 9 },
        ranked_choice_rounds: [
          round(1, "Pizza", false),
          round(1, "Sushi", true),
          round(2, "Pizza", false),
        ],
      }),
    );
    expect(e?.tone).toBe("warn");
    expect(e?.text).toContain("Sushi");
  });

  it("gives a majority one-liner for a single-round winner", () => {
    const e = outcomeExplainer(
      results({
        question_type: "ranked_choice",
        winner: "Tacos",
        ranked_choice_rounds: [round(1, "Tacos", false)],
      }),
    );
    expect(e?.tone).toBe("info");
    expect(e?.text).toContain("Tacos");
    expect(e?.text).toContain("majority");
  });

  it("returns null with no winner", () => {
    expect(outcomeExplainer(results({ question_type: "ranked_choice" }))).toBeNull();
  });
});

describe("outcomeExplainer — other types", () => {
  it("returns null for limited_supply", () => {
    expect(
      outcomeExplainer(results({ question_type: "limited_supply", total_votes: 3, winner: "x" })),
    ).toBeNull();
  });
});

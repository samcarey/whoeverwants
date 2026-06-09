import { describe, it, expect } from "vitest";
import { planPollSuggestions, primarySuggestion } from "@/lib/pollSuggestions";

// The on-device embedding classifier (lib/aiCategoryClassify) feeds an `aiCategory`
// hint into the planner. Contract (augment, never block): a confident hint ADDS a
// category row nearest the bar (just above the primary), but NEVER changes the
// nearest-bar default, NEVER duplicates a keyword-matched category, and is a total
// no-op when absent. These are pure (no model) — the embedder's QUALITY is graded
// in prototypes/poll-classify; this pins the MERGE behavior.

const NOW = new Date(2026, 5, 8);
const kindOf = (text: string, ai?: { category: string; score: number } | null) => {
  const p = primarySuggestion(text, { now: NOW, aiCategory: ai });
  return p ? (p.kind === "category" ? `category:${p.category}` : p.kind) : "none";
};
const catRows = (text: string, ai?: { category: string; score: number } | null) =>
  planPollSuggestions(text, { now: NOW, aiCategory: ai })
    .filter((r) => r.kind === "category")
    .map((r) => r.category);

describe("pollSuggestions aiCategory merge", () => {
  it("is a no-op when absent — plan is byte-identical with null vs omitted", () => {
    for (const t of ["frag night", "pizza or tacos", "should we get a dog", "movie night", "feed me"]) {
      const base = planPollSuggestions(t, { now: NOW });
      const withNull = planPollSuggestions(t, { now: NOW, aiCategory: null });
      expect(withNull).toEqual(base);
    }
  });

  it("ADDS the hinted category when the keyword matcher missed it (slang)", () => {
    // "frag night" has no keyword → heuristic primary is custom, no category rows.
    expect(catRows("frag night")).toEqual([]);
    const rows = planPollSuggestions("frag night", { now: NOW, aiCategory: { category: "video_game", score: 0.7 } });
    expect(rows.filter((r) => r.kind === "category").map((r) => r.category)).toEqual(["video_game"]);
  });

  it("never overrides the nearest-bar default (primary unchanged)", () => {
    // custom default stays custom; the hint only adds a row above it.
    expect(kindOf("frag night")).toBe("custom");
    expect(kindOf("frag night", { category: "video_game", score: 0.7 })).toBe("custom");
    // structure-dominated defaults are untouched too.
    expect(kindOf("pizza or tacos", { category: "restaurant", score: 0.7 })).toBe("options");
    expect(kindOf("should we get a dog", { category: "restaurant", score: 0.7 })).toBe("yes_no");
  });

  it("places the added category nearest the bar (last non-primary row)", () => {
    const rows = planPollSuggestions("frag night", { now: NOW, aiCategory: { category: "video_game", score: 0.7 } });
    const primaryIdx = rows.findIndex((r) => r.primary);
    expect(primaryIdx).toBe(rows.length - 1); // primary is always last
    expect(rows[primaryIdx - 1]).toMatchObject({ kind: "category", category: "video_game", primary: false });
  });

  it("does not duplicate a category the keyword matcher already surfaced", () => {
    // keyword already makes video_game the primary; the hint must not add a dup.
    expect(kindOf("what game should we play")).toBe("category:video_game");
    const rows = catRows("what game should we play", { category: "video_game", score: 0.9 });
    expect(rows.filter((c) => c === "video_game")).toHaveLength(1);
  });

  it("ignores an unknown/non-searchable category value", () => {
    const base = planPollSuggestions("frag night", { now: NOW });
    const bogus = planPollSuggestions("frag night", { now: NOW, aiCategory: { category: "yes_no", score: 0.9 } });
    expect(bogus).toEqual(base); // yes_no isn't a searchable category → not added
  });
});

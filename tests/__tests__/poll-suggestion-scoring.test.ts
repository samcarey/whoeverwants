import { describe, it, expect } from "vitest";
import { planPollSuggestions, primarySuggestion } from "@/lib/pollSuggestions";
import { STOP_WORDS, CATEGORY_DEFS } from "@/lib/categoryMatch";
import {
  POLL_SUGGESTION_CORPUS,
  scoreTopChoice,
  scoreRecall,
  type Prediction,
} from "../fixtures/poll-suggestion-corpus";

// CI gate for the new-poll search box's suggestion quality. The labeled corpus
// + scorers live in tests/fixtures/poll-suggestion-corpus.ts — the SAME reusable
// substrate a future AI classifier is benchmarked against (see
// docs/poll-textbox-followups.md, TODO 2). This file just wires the heuristic
// planner into those scorers and pins thresholds + canonical cases.
//
// Before the matcher/ordering rework these were ~18% default / ~42% recall (the
// generic "Context" row won almost everything and natural sentences surfaced no
// category). Current: ~95–100% / ~98–100%. The thresholds sit under the current
// numbers but far above the old behavior, catching a regression without being
// brittle to keyword tuning.

const NOW = new Date(2026, 5, 8); // fixed anchor → deterministic temporal parsing
const plannerPrimary = (text: string): Prediction | null => primarySuggestion(text, { now: NOW });
const plannerList = (text: string): Prediction[] => planPollSuggestions(text, { now: NOW });

describe("poll search box — suggestion quality on natural input", () => {
  it("defaults the nearest-bar row to the intended interpretation (≥85%)", () => {
    const { rate, misses } = scoreTopChoice(plannerPrimary);
    // Surfaces offenders in the failure message if the gate trips.
    expect({ rate: +rate.toFixed(3), misses }).toMatchObject({});
    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it("includes the intended interpretation somewhere in the list (≥93%)", () => {
    const { rate, misses } = scoreRecall(plannerList);
    expect({ rate: +rate.toFixed(3), misses }).toMatchObject({});
    expect(rate).toBeGreaterThanOrEqual(0.93);
  });

  it("the corpus is non-trivial (guards against an empty/half-loaded dataset)", () => {
    expect(POLL_SUGGESTION_CORPUS.length).toBeGreaterThanOrEqual(60);
  });
});

describe("poll search box — canonical cases (lock in the headline wins)", () => {
  const primaryKindOf = (text: string) => {
    const p = primarySuggestion(text, { now: NOW });
    return p ? (p.kind === "category" ? `category:${p.category}` : p.kind) : "none";
  };
  it("natural sentences default to their category, not a generic poll", () => {
    expect(primaryKindOf("movie night")).toBe("category:movie");
    expect(primaryKindOf("what game should we play")).toBe("category:video_game");
    expect(primaryKindOf("where should we eat")).toBe("category:restaurant");
    expect(primaryKindOf("when should we meet")).toBe("category:time");
  });
  it("explicit lists default to Options; question stems default to Yes/No", () => {
    expect(primaryKindOf("pizza or tacos")).toBe("options");
    expect(primaryKindOf("should we get a dog")).toBe("yes_no");
  });
  it("a matched-category list also surfaces its sibling (Movie ↔ Showtime)", () => {
    const rows = planPollSuggestions("movie night", { now: NOW });
    const cats = rows.filter((r) => r.kind === "category").map((r) => r.category);
    expect(cats).toContain("movie");
    expect(cats).toContain("showtime");
  });
});

describe("category matcher invariants", () => {
  it("no stop word is also a category trigger (or it could never match)", () => {
    const triggers = new Set<string>();
    for (const d of CATEGORY_DEFS) {
      d.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).forEach((w) => triggers.add(w));
      d.keywords.forEach((k) => triggers.add(k));
    }
    const overlap = [...STOP_WORDS].filter((w) => triggers.has(w));
    expect(overlap).toEqual([]);
  });
});

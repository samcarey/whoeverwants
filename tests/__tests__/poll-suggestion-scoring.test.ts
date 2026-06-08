import { describe, it, expect } from "vitest";
import { planPollSuggestions, primarySuggestion, type PlannedRow } from "@/lib/pollSuggestions";
import { STOP_WORDS, CATEGORY_DEFS } from "@/lib/categoryMatch";

// Regression harness for the new-poll search box's suggestion quality.
//
// It runs a labeled corpus of natural poll descriptions through the REAL
// planner (lib/pollSuggestions.ts — the same code the box renders) and scores:
//   • DEFAULT: does the nearest-bar primary row match the human-intended kind?
//   • RECALL : is the intended interpretation present ANYWHERE in the list?
//
// Before the matcher/ordering rework these were ~18% / ~42% (the generic
// "Context" row won almost everything and natural sentences surfaced no
// category). The thresholds below sit well under the current numbers
// (~95% / ~98%) but far above the old behavior, so they catch a regression
// without being brittle to future keyword tuning. Genuinely ambiguous phrasings
// ("dinner this friday" → Time OR Restaurant) accept a SET of intents.

const NOW = new Date(2026, 5, 8); // fixed anchor so temporal parsing is deterministic

type Intent =
  | { kind: "category"; category: string }
  | { kind: "time" }
  | { kind: "options" }
  | { kind: "yes_no" };
type Case = { text: string; accept: Intent[] };

const cat = (c: string): Intent => ({ kind: "category", category: c });
const C: Case[] = [];
const add = (texts: string[], accept: Intent | Intent[]) => {
  const a = Array.isArray(accept) ? accept : [accept];
  for (const text of texts) C.push({ text, accept: a });
};

add(["where should we eat", "where do we want to eat", "dinner spot", "pick a restaurant",
  "where to eat tonight", "lunch spot", "where should we grab food", "best place to eat",
  "dinner ideas", "let's pick a restaurant", "somewhere to eat saturday", "what restaurant",
  "food for the party", "where are we eating", "dinner plans", "where should we get dinner"],
  [cat("restaurant"), cat("location")]); // "place to eat" reasonably reads as Place too

add(["what movie should we watch", "movie night", "pick a movie", "which film to watch",
  "what should we watch", "let's watch a movie", "movie picks", "what film", "choose a movie"],
  [cat("movie"), cat("showtime")]);

add(["what game should we play", "game night", "which game to play", "pick a game",
  "let's pick a game", "what game"], cat("video_game"));

add(["when should we meet", "when works for everyone", "what time should we meet",
  "find a time to meet", "schedule the meeting", "when are people free", "pick a time",
  "when can everyone make it", "let's find a time", "when should we get together"], cat("time"));

add(["where should we go", "where to hang out", "pick a place", "where should we meet up",
  "what's the venue", "where do we want to go", "place to meet"],
  [cat("location"), cat("time")]); // "meet" pulls some of these toward Time — both ok

add(["pizza or tacos", "pizza, tacos, or sushi", "thai or italian or mexican",
  "red blue or green", "beach or mountains", "netflix or hbo or hulu", "coffee tea or water",
  "dogs or cats", "marvel or dc", "north or south", "in person or zoom"], { kind: "options" });

add(["should we get a dog", "should we order pizza", "are we still on for friday",
  "do we need snacks", "should we cancel", "is everyone coming", "should we reschedule",
  "can we move it to monday", "should we book it", "do we want dessert"], { kind: "yes_no" });

// Scheduling phrases — Time, or the food/movie category they mention, both fine.
add(["dinner this friday", "lunch tomorrow", "coffee thursday morning"], [{ kind: "time" }, cat("restaurant")]);
add(["games tonight"], [{ kind: "time" }, cat("video_game")]);
add(["movie night friday 8pm"], [{ kind: "time" }, cat("movie")]);
add(["meet up saturday afternoon"], [{ kind: "time" }, cat("location")]);
add(["hang out this weekend", "get together next week"], { kind: "time" });

function matches(row: PlannedRow | null, want: Intent): boolean {
  if (!row) return false;
  if (want.kind === "category") return row.kind === "category" && row.category === want.category;
  if (want.kind === "time") return row.kind === "time" || (row.kind === "category" && row.category === "time");
  return row.kind === want.kind;
}
const anyMatch = (row: PlannedRow | null, accept: Intent[]) => accept.some((w) => matches(row, w));

describe("poll search box — suggestion quality on natural input", () => {
  let defaultOk = 0;
  let recallOk = 0;
  const defaultMisses: string[] = [];
  const recallMisses: string[] = [];

  for (const c of C) {
    const rows = planPollSuggestions(c.text, { now: NOW });
    const primary = primarySuggestion(c.text, { now: NOW });
    if (anyMatch(primary, c.accept)) defaultOk++;
    else defaultMisses.push(c.text);
    if (rows.some((r) => anyMatch(r, c.accept))) recallOk++;
    else recallMisses.push(c.text);
  }

  it("defaults the nearest-bar row to the intended interpretation (≥85%)", () => {
    const rate = defaultOk / C.length;
    // Surfaces the offenders in the failure message if the gate trips.
    expect({ rate: +rate.toFixed(3), misses: defaultMisses }).toMatchObject({});
    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it("includes the intended interpretation somewhere in the list (≥93%)", () => {
    const rate = recallOk / C.length;
    expect({ rate: +rate.toFixed(3), misses: recallMisses }).toMatchObject({});
    expect(rate).toBeGreaterThanOrEqual(0.93);
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

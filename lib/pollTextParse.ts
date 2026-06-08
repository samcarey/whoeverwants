// Shared natural-language → poll-shape parser.
//
// SINGLE SOURCE OF TRUTH for turning a free-text / spoken phrase into the right
// poll to create. Two surfaces consume the SAME logic so they behave
// identically with zero network round-trip:
//   1. The in-app search box (`app/create-poll/page.tsx`) — instant client-side
//      suggestions. It builds a richer candidate LIST on top of these
//      primitives; `parseForContext` / `parseOptionsFromText` are shared verbatim.
//   2. Siri / App Intents (`ios/App/App/AppDelegate.swift: PollTextParser`) — a
//      faithful Swift port of `decidePoll`, so a spoken "quick poll" produces the
//      same poll shape the box's top suggestion would, computed locally on-device
//      (no network parse round-trip).
//
// ALIGNMENT CONTRACT. `decidePoll` is pinned by
// `tests/__tests__/poll-text-parse.test.ts` against the shared fixture
// `tests/fixtures/poll-parse-cases.json`. The Swift port mirrors this file
// rule-for-rule and is validated against the SAME fixture (see the
// `PollTextParser` comment in AppDelegate.swift). When you change ANY rule here
// — the "for" split, the option delimiters, the yes/no stems, or the category
// triggers — update the fixture AND the Swift port in the same change. The JS
// test is the CI-enforced half of the contract.

export type ParsedPollKind = "options" | "category" | "yes_no";

export interface ParsedPoll {
  kind: ParsedPollKind;
  /** The trimmed phrase. Used as the yes/no title + the deep-link `title=`. */
  prompt: string;
  /** The "for X" tail (empty string when none). Question-level `context`. */
  context: string;
  /** kind === "options": the ≥2 parsed ballot options. */
  options?: string[];
  /** kind === "category": the matched built-in category value. */
  category?: string;
}

// Split the typed/spoken text on a standalone "for": everything after the first
// " for " is the poll's context (prefilled into `forField`), everything before
// is the subject used for the category filter / options / custom name. "for"
// only counts as a whole word, so "comfortable" / "fortnite" don't trip it.
export function parseForContext(raw: string): { subject: string; context: string } {
  const m = raw.match(/\bfor\b/i);
  if (!m || m.index === undefined) return { subject: raw.trim(), context: "" };
  return {
    subject: raw.slice(0, m.index).trim(),
    context: raw.slice(m.index + m[0].length).trim(),
  };
}

// Parse free text into poll options by splitting on commas and the word "or"
// (so "pizza, tacos or sushi" → ["pizza", "tacos", "sushi"]). The oxford
// "a, b, or c" form is handled by collapsing " or " to a comma first. Trims,
// drops blanks, de-dupes case-insensitively (keeping the first spelling).
// Callers gate on length >= 2.
export function parseOptionsFromText(text: string): string[] {
  const parts = text
    .replace(/\s+or\s+/gi, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// First words that unambiguously start a yes/no question. Checked against the
// FIRST word of the raw phrase, BEFORE category detection, so "should we meet
// for lunch" stays a yes/no instead of tripping the time-category "meet"
// trigger.
const YESNO_STEMS = new Set<string>([
  "should",
  "shall",
  "can",
  "could",
  "will",
  "would",
  "is",
  "are",
  "am",
  "was",
  "were",
  "do",
  "does",
  "did",
  "has",
  "have",
  "had",
  "may",
  "might",
  "must",
]);

// Built-in categories a spoken phrase can imply, with the exact subject words
// that trigger each. ORDER IS PRECEDENCE — the first category with a matching
// subject word wins, so "where should we eat" → restaurant ("eat" beats the
// location "where"). Matching is exact whole-word membership (incl. common
// plurals) to avoid the false positives a substring match would create.
const CATEGORY_TRIGGERS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["restaurant", new Set(["eat", "eats", "food", "restaurant", "restaurants", "dine", "takeout"])],
  ["movie", new Set(["movie", "movies", "film", "films", "watch"])],
  ["video_game", new Set(["game", "games", "videogame"])],
  ["time", new Set(["when", "time", "schedule", "meet"])],
  ["location", new Set(["where", "place", "places", "spot", "venue", "location"])],
  ["showtime", new Set(["showtime", "showtimes"])],
];

// The built-in category implied by a subject, or null when none. Mirrors the
// search box's category token-matching, narrowed to a high-precision trigger
// set so voice phrasing maps cleanly.
export function detectCategory(subject: string): string | null {
  const words = subject.toLowerCase().split(/[\s,]+/).filter(Boolean);
  for (const [category, triggers] of CATEGORY_TRIGGERS) {
    if (words.some((w) => triggers.has(w))) return category;
  }
  return null;
}

// Decide the SINGLE best poll to create from a phrase. Precedence:
//   1. ≥2 comma/"or" options  → an options (fixed-options ranked_choice) poll.
//   2. leading yes/no stem     → a yes/no poll (the whole phrase is the prompt).
//   3. a category trigger word → that built-in category (filled in via the form).
//   4. otherwise               → a yes/no poll.
// Note (1) outranks (2): "should we get sushi or pizza" is more useful as a
// pick-one than a yes/no. The in-app box surfaces all of these as a candidate
// list; Siri creates this single top pick.
export function decidePoll(raw: string): ParsedPoll {
  const prompt = raw.trim();
  const { subject, context } = parseForContext(prompt);

  const options = parseOptionsFromText(subject);
  if (options.length >= 2) {
    return { kind: "options", prompt, context, options };
  }

  const firstWord = prompt.toLowerCase().split(/[\s,]+/).filter(Boolean)[0] ?? "";
  if (YESNO_STEMS.has(firstWord)) {
    return { kind: "yes_no", prompt, context };
  }

  const category = detectCategory(subject);
  if (category) {
    return { kind: "category", prompt, context, category };
  }

  return { kind: "yes_no", prompt, context };
}

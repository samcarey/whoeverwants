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

import type { DayTimeWindow } from "./types";

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

// ── Temporal parsing (search-box only) ──────────────────────────────────────
//
// Detect natural-language dates ("this Friday", "tonight", "tomorrow") and
// colloquial time-of-day bands ("dinner", "evening", "7-9pm") in a phrase and
// turn them into concrete DayTimeWindow[] used to PREFILL the time-question
// window field.
//
// IMPORTANT — this NEVER decides the poll's category and NEVER edits the text.
// The category stays keyword-driven (see `decidePoll` / `detectCategory`); the
// typed phrase flows through to the title verbatim ("Time for dinner this
// Friday"). The search box surfaces an ADDITIVE "Time" suggestion row whenever
// this returns a non-empty result — the parsed range is only ever a
// pre-narrowed starting point the user still confirms in the form.
//
// NOT part of the Swift `decidePoll` alignment contract — `parseTemporal` is
// web-search-box-only for now (the Siri deep link can't carry windows yet, so
// the Swift port doesn't mirror this). If Siri gains window prefill later,
// port these tables + rules and add fixture cases.
//
// Pure + side-effect-free + deterministic given `today` (no Date.now() inside),
// so it's unit-testable and SSR-safe. Any internal failure degrades to [].

interface ParsedWindow { min: string; max: string; }

// Colloquial time-of-day bands. ORDER MATTERS — multi-word phrases first so
// "late night" doesn't first match "night". Whole-word anchored. The window is
// a pre-narrowed *suggestion*, not a claim about when the event happens.
//
// The 4th element is `isMeal`: a meal NOUN ("dinner", "lunch") is usually the
// poll's SUBJECT, so `stripTemporal` keeps it in the title/context even though
// it still contributes a window. Pure time-of-day words ("evening", "tonight")
// are stripped out to the inline parsed-range annotation.
const BAND_LEXICON: ReadonlyArray<readonly [RegExp, string, string, boolean]> = [
  // Multi-word / qualified phrases FIRST so they win over their single-word
  // constituents (the band loop blanks matched spans as it goes). Plural forms
  // (`s?`) so combos like "nights this weekend" / "evenings next week" match.
  [/\blate nights?\b/i, "21:00", "23:30", false],
  [/\bhappy hour\b/i, "16:00", "18:00", false],
  [/\ball weekend\b/i, "09:00", "21:00", false],
  [/\bbusiness hours\b/i, "09:00", "17:00", false],
  [/\bafter work\b/i, "17:00", "21:00", false],
  [/\bafter school\b/i, "15:00", "18:00", false],
  [/\bafter dinner\b/i, "20:00", "22:00", false],
  [/\bafter lunch\b/i, "13:00", "15:00", false],
  [/\bweeknights?\b/i, "17:00", "21:00", false],
  [/\bfirst thing\b/i, "06:00", "09:00", false],
  [/\bearly mornings?\b/i, "06:00", "09:00", false],
  [/\bmid-?mornings?\b/i, "10:00", "11:30", false],
  [/\blate mornings?\b/i, "10:00", "12:00", false],
  [/\bearly afternoons?\b/i, "12:00", "14:00", false],
  [/\bmid-?afternoons?\b/i, "14:00", "16:00", false],
  [/\blate afternoons?\b/i, "15:00", "18:00", false],
  [/\bearly evenings?\b/i, "17:00", "19:00", false],
  [/\b(?:any\s?time|whenever)\b/i, "09:00", "21:00", false],
  [/\ball day\b/i, "09:00", "21:00", false],
  // Meal nouns (isMeal = true → kept as the subject by stripTemporal).
  [/\bbreakfast\b/i, "07:00", "09:00", true],
  [/\bbrunch\b/i, "10:00", "13:00", true],
  [/\b(?:lunch|lunchtime)\b/i, "11:30", "13:30", true],
  [/\b(?:dinner|dinnertime|supper)\b/i, "18:00", "20:00", true],
  // Single time-of-day words last (plural forms for "mornings this week" etc.).
  [/\bmornings?\b/i, "08:00", "12:00", false],
  [/\bafternoons?\b/i, "12:00", "17:00", false],
  [/\b(?:evenings?|eve)\b/i, "17:00", "21:00", false],
  [/\b(?:tonight|nighttime|nights?)\b/i, "18:00", "23:00", false],
];

// Bare day with no band word → a narrow evening suggestion (the most common
// "let's get together" slot), still obviously refinable. Tunable.
const DEFAULT_SUGGESTED_BAND: ParsedWindow = { min: "17:00", max: "21:00" };

// A single clock point ("at 7pm") → a window of this span starting there.
const DEFAULT_POINT_SPAN_MIN = 120;
const DAY_START_MIN = 8 * 60; // 08:00, lower bound for "before <time>"
const DAY_END_MIN = 23 * 60 + 30; // 23:30 — clamp every window within the day (no cross-midnight v1)
const DAY_CAP = 14; // never explode into more than two weeks of dates

const WEEKDAYS: ReadonlyMap<string, number> = new Map([
  ["sunday", 0], ["sun", 0],
  ["monday", 1], ["mon", 1],
  ["tuesday", 2], ["tue", 2], ["tues", 2],
  ["wednesday", 3], ["wed", 3], ["weds", 3],
  ["thursday", 4], ["thu", 4], ["thur", 4], ["thurs", 4],
  ["friday", 5], ["fri", 5],
  ["saturday", 6], ["sat", 6],
]);

function isoFromBase(base: Date, addDays: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Soonest date >= today matching weekday `wd`; `next` adds a week (so "next
// Friday" said on Wednesday is the FOLLOWING week's Friday).
function weekdayDate(base: Date, wd: number, next: boolean): string {
  let delta = (wd - base.getDay() + 7) % 7; // 0..6, today when it matches
  if (next) delta += 7;
  return isoFromBase(base, delta);
}

function pad(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Resolve a clock token to minutes-from-midnight. AM/PM: explicit wins; else a
// 24h hour (>12) stays as-is; else the bare-hour rule — 1–7 → PM, 8–11 → AM,
// 12 → noon. Returns null on an impossible hour.
function clockToMinutes(hour: number, minute: number, ap: string | null): number | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  let h = hour;
  if (ap === "am") h = hour === 12 ? 0 : hour;
  else if (ap === "pm") h = hour === 12 ? 12 : hour + 12;
  else if (hour <= 12) {
    if (hour === 12) h = 12; // noon
    else if (hour >= 1 && hour <= 7) h = hour + 12; // 1–7 → afternoon/evening
    else h = hour; // 8–11 → morning
  }
  if (h > 23) return null;
  return h * 60 + minute;
}

function clamp(min: number, max: number): ParsedWindow | null {
  const lo = Math.max(0, min);
  const hi = Math.min(DAY_END_MIN, max);
  if (lo >= hi) return null;
  return { min: pad(lo), max: pad(hi) };
}

// Pull explicit clock windows out of the raw text: ranges ("7-9pm",
// "between 6 and 8"), open-ended ("after 6pm", "before noon"), and single
// points ("at 7"). Bare numbers with no marker are ignored so an option like
// "7" can't be misread as a time.
function parseClockWindows(raw: string): ParsedWindow[] {
  const out: ParsedWindow[] = [];
  const T = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?";

  // Range: "7-9pm", "7 to 9", "between 6 and 8".
  const rangeRe = new RegExp(`(?:between\\s+)?${T}\\s*(?:-|–|—|to|until|till|and)\\s*${T}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(raw)) !== null) {
    let ap1 = m[3]?.toLowerCase() ?? null;
    let ap2 = m[6]?.toLowerCase() ?? null;
    // "7-9pm": the trailing meridiem applies to both ends; and vice-versa.
    if (!ap1 && ap2) ap1 = ap2;
    if (!ap2 && ap1) ap2 = ap1;
    // Neither end marked. A morning→afternoon span ("9-5", "10-2", "11-3":
    // first hour 8–12 AND descending to an afternoon hour 1–7) is the workday
    // pattern → AM then PM. Otherwise infer ONE shared meridiem from the first
    // hour (1–7 → PM, 8–11 → AM, 12 → noon) and apply to both ends.
    if (!ap1 && !ap2) {
      const h1 = parseInt(m[1], 10);
      const h2 = parseInt(m[4], 10);
      if (h1 >= 8 && h1 <= 12 && h2 >= 1 && h2 <= 7 && h1 > h2) {
        ap1 = h1 === 12 ? "pm" : "am";
        ap2 = "pm";
      } else {
        const shared = h1 >= 1 && h1 <= 7 ? "pm" : h1 === 12 ? "pm" : "am";
        ap1 = shared;
        ap2 = shared;
      }
    }
    const a = clockToMinutes(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, ap1);
    const b = clockToMinutes(parseInt(m[4], 10), m[5] ? parseInt(m[5], 10) : 0, ap2);
    if (a !== null && b !== null) {
      const w = clamp(Math.min(a, b), Math.max(a, b));
      if (w) out.push(w);
    }
  }

  // "after 6pm" → [T, end-of-day]; "before noon" → [day-start, T].
  const afterRe = new RegExp(`\\bafter\\s+${T}`, "gi");
  while ((m = afterRe.exec(raw)) !== null) {
    const t = clockToMinutes(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3]?.toLowerCase() ?? null);
    if (t !== null) { const w = clamp(t, DAY_END_MIN); if (w) out.push(w); }
  }
  if (/\bbefore\s+noon\b/i.test(raw)) { const w = clamp(DAY_START_MIN, 12 * 60); if (w) out.push(w); }
  const beforeRe = new RegExp(`\\bbefore\\s+${T}`, "gi");
  while ((m = beforeRe.exec(raw)) !== null) {
    const t = clockToMinutes(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3]?.toLowerCase() ?? null);
    if (t !== null) { const w = clamp(DAY_START_MIN, t); if (w) out.push(w); }
  }

  // Single point: "at 7", "by 6pm", "around 8", "@ 7:30". Skips ranges (those
  // are caught above and would double-count) by requiring a leading marker.
  const pointRe = new RegExp(`(?:\\bat|\\bby|\\baround|@)\\s*${T}`, "gi");
  while ((m = pointRe.exec(raw)) !== null) {
    const t = clockToMinutes(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, m[3]?.toLowerCase() ?? null);
    if (t !== null) { const w = clamp(t, t + DEFAULT_POINT_SPAN_MIN); if (w) out.push(w); }
  }

  // Fuzzy point: "7ish", "7-ish" → a point at that hour (bare-hour rule).
  const ishRe = /\b(\d{1,2})\s*-?\s*ish\b/gi;
  while ((m = ishRe.exec(raw)) !== null) {
    const t = clockToMinutes(parseInt(m[1], 10), 0, null);
    if (t !== null) { const w = clamp(t, t + DEFAULT_POINT_SPAN_MIN); if (w) out.push(w); }
  }

  // Word anchors: "noon" → midday window (unless it's a "before/after noon"
  // open range, handled above/below); "midnight" → late.
  if (/\bnoon\b/i.test(raw) && !/\b(?:before|after)\s+noon\b/i.test(raw)) {
    const w = clamp(12 * 60, 12 * 60 + DEFAULT_POINT_SPAN_MIN); if (w) out.push(w);
  }
  if (/\bafter\s+noon\b/i.test(raw)) { const w = clamp(12 * 60, DAY_END_MIN); if (w) out.push(w); }
  if (/\bmidnight\b/i.test(raw)) { const w = clamp(DAY_END_MIN - DEFAULT_POINT_SPAN_MIN, DAY_END_MIN); if (w) out.push(w); }

  return out;
}

// Resolve the set of dates ("D") implied by the phrase, as ISO strings.
function parseDays(raw: string, base: Date): Set<string> {
  const days = new Set<string>();
  const lower = ` ${raw.toLowerCase()} `;
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);

  // Phrase-level markers (order: more-specific first).
  if (/\bday after tomorrow\b/.test(lower)) days.add(isoFromBase(base, 2));
  if (/\b(?:tomorrow|tmrw|tmw|tmro)\b/.test(lower)) days.add(isoFromBase(base, 1));
  if (/\b(?:today|tonight)\b/.test(lower)) days.add(isoFromBase(base, 0));
  // "this morning/afternoon/evening/night" → today.
  if (/\bthis\s+(?:morning|afternoon|evening|night|eve)\b/.test(lower)) days.add(isoFromBase(base, 0));
  // "tomorrow morning/night/..." already added tomorrow above (band handled in T).

  // Weekend (incl. "all weekend" — the all-day band rides separately).
  if (/\bnext\s+weekend\b/.test(lower)) {
    days.add(weekdayDate(base, 6, true));
    days.add(weekdayDate(base, 0, true));
  } else if (/\b(?:this\s+|all\s+)?weekend\b/.test(lower)) {
    days.add(weekdayDate(base, 6, false));
    days.add(weekdayDate(base, 0, false));
  }

  const daysToSunday = (7 - base.getDay()) % 7; // 0 when today is Sunday
  const at = (off: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + off);

  // Specific sub-week phrases — handled directly (and they SUPPRESS the broad
  // week scope below, since "early next week" etc. contain "week").
  let subWeekHandled = false;
  if (/\bmidweek\b/.test(lower)) days.add(weekdayDate(base, 3, false)); // Wed (independent of week scope)
  if (/\bearly\s+next\s+week\b/.test(lower)) { days.add(weekdayDate(base, 1, true)); days.add(weekdayDate(base, 2, true)); subWeekHandled = true; }
  if (/\blate\s+next\s+week\b/.test(lower)) { days.add(weekdayDate(base, 4, true)); days.add(weekdayDate(base, 5, true)); subWeekHandled = true; }
  if (/\b(?:start|beginning)\s+of\s+(?:the\s+|this\s+)?week\b/.test(lower)) { days.add(weekdayDate(base, 1, false)); days.add(weekdayDate(base, 2, false)); subWeekHandled = true; }
  if (/\b(?:end\s+of\s+(?:the\s+|this\s+)?week|eow)\b/.test(lower)) { days.add(weekdayDate(base, 4, false)); days.add(weekdayDate(base, 5, false)); subWeekHandled = true; }

  // Broad scope range [start, end] in day-offsets for week / month, or null.
  // "this month"/"next month" are only ever expanded via a weekday filter
  // (a bare month would explode to ~30 days); a bare week DOES expand.
  let scope: [number, number] | null = null;
  let scopeIsWeek = false;
  if (!subWeekHandled) {
    if (/\bnext\s+week\b/.test(lower)) { scope = [daysToSunday + 1, daysToSunday + 7]; scopeIsWeek = true; }
    else if (/\b(?:this\s+)?week\b/.test(lower)) { scope = [0, daysToSunday]; scopeIsWeek = true; }
    else if (/\bnext\s+month\b/.test(lower)) {
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const firstNext = daysInMonth - base.getDate() + 1;
      const daysInNext = new Date(base.getFullYear(), base.getMonth() + 2, 0).getDate();
      scope = [firstNext, firstNext + daysInNext - 1];
    } else if (/\b(?:this\s+)?month\b/.test(lower)) {
      const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      scope = [0, daysInMonth - base.getDate()];
    }
  }

  // "in N days/weeks", "N days/weeks from now", vague counts.
  let m = /\bin\s+(\d{1,2})\s+days?\b/.exec(lower);
  if (m) days.add(isoFromBase(base, parseInt(m[1], 10)));
  m = /\b(\d{1,2})\s+days?\s+from\s+now\b/.exec(lower);
  if (m) days.add(isoFromBase(base, parseInt(m[1], 10)));
  m = /\bin\s+(\d{1,2})\s+weeks?\b/.exec(lower);
  if (m) days.add(isoFromBase(base, 7 * parseInt(m[1], 10)));
  m = /\b(\d{1,2})\s+weeks?\s+from\s+now\b/.exec(lower);
  if (m) days.add(isoFromBase(base, 7 * parseInt(m[1], 10)));
  if (/\b(?:in\s+)?(?:a\s+)?couple\s+(?:of\s+)?days?\b/.test(lower)) days.add(isoFromBase(base, 2));
  if (/\b(?:in\s+)?(?:a\s+)?few\s+days?\b/.test(lower)) days.add(isoFromBase(base, 3));

  // Weekday matches (singular or plural), honoring "this"/"next". A plural
  // ("thursdays") or a "weekday(s)"/"weeknight(s)" word means "every matching
  // day" rather than a single occurrence.
  const filterSet = new Set<number>();
  const singles: Array<{ wd: number; next: boolean }> = [];
  let plural = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let wd = WEEKDAYS.get(t);
    let isPlural = false;
    if (wd === undefined && t.endsWith("s")) {
      const s = WEEKDAYS.get(t.slice(0, -1));
      if (s !== undefined) { wd = s; isPlural = true; }
    }
    if (wd === undefined) continue;
    filterSet.add(wd);
    if (isPlural) plural = true;
    else singles.push({ wd, next: tokens[i - 1] === "next" });
  }
  if (/\bweekdays?\b/.test(lower)) { [1, 2, 3, 4, 5].forEach((d) => filterSet.add(d)); plural = true; }
  if (/\bweeknights?\b/.test(lower)) { [1, 2, 3, 4].forEach((d) => filterSet.add(d)); plural = true; }

  if (scope && filterSet.size) {
    // Combo: "thursdays this month", "weeknights next week" → matching weekdays
    // within the scope.
    for (let off = scope[0]; off <= scope[1]; off++) {
      if (filterSet.has(at(off).getDay())) days.add(isoFromBase(base, off));
    }
  } else if (scope && scopeIsWeek) {
    // Bare week → every day of the week.
    for (let off = scope[0]; off <= scope[1]; off++) days.add(isoFromBase(base, off));
  } else if (filterSet.size) {
    // No scope. Singular weekday → next occurrence (honoring this/next); a
    // plural / "weekday(s)" / "weeknight(s)" → every match in the next 2 weeks.
    for (const { wd, next } of singles) days.add(weekdayDate(base, wd, next));
    if (plural) {
      for (let off = 0; off < 14; off++) {
        if (filterSet.has(at(off).getDay())) days.add(isoFromBase(base, off));
      }
    }
  }

  return days;
}

/**
 * Parse natural-language temporal hints into prefill windows for a time poll.
 * Returns [] when nothing temporal is detected (a lone band word like "dinner"
 * with no day or clock does NOT trigger — there must be a day marker OR an
 * explicit clock). Deterministic given `today`.
 */
export function parseTemporal(raw: string, today: Date = new Date()): DayTimeWindow[] {
  try {
    if (!raw || !raw.trim()) return [];
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const days = parseDays(raw, base);
    const clockWindows = parseClockWindows(raw);

    // Bands present in the text (T from the lexicon). Matched spans are blanked
    // out as we go so a multi-word phrase ("late night") suppresses its
    // single-word constituent ("night") — the lexicon is ordered multi-word
    // first, so the broad single-word entries see the blanked text last.
    const bandKeys = new Set<string>();
    const bands: ParsedWindow[] = [];
    let scratch = raw;
    for (const [re, min, max] of BAND_LEXICON) {
      if (re.test(scratch)) {
        const k = `${min}-${max}`;
        if (!bandKeys.has(k)) { bandKeys.add(k); bands.push({ min, max }); }
        scratch = scratch.replace(new RegExp(re.source, "gi"), " ");
      }
    }

    // Gate: need a concrete day OR an explicit clock. A lone band word
    // ("dinner", "morning") with neither is too weak to imply scheduling.
    if (days.size === 0 && clockWindows.length === 0) return [];

    // Build T (windows): explicit clocks + lexicon bands, de-duped.
    const winKeys = new Set<string>();
    let windows: ParsedWindow[] = [];
    for (const w of [...clockWindows, ...bands]) {
      const k = `${w.min}-${w.max}`;
      if (!winKeys.has(k)) { winKeys.add(k); windows.push(w); }
    }
    // No band/clock but a day was named → a narrow evening suggestion.
    if (windows.length === 0) windows = [{ ...DEFAULT_SUGGESTED_BAND }];

    // Build D (dates): default to today when only a clock/band was given.
    const dayList = (days.size ? [...days] : [isoFromBase(base, 0)])
      .sort()
      .slice(0, DAY_CAP);

    // Cartesian D × T, sorted, with a final validity backstop.
    return dayList.map((day) => ({
      day,
      windows: windows
        .map((w) => clamp(toMin(w.min), toMin(w.max)))
        .filter((w): w is ParsedWindow => w !== null)
        .sort((a, b) => a.min.localeCompare(b.min)),
    })).filter((d) => d.windows.length > 0);
  } catch {
    return [];
  }
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

// One regex matching every temporal phrase `parseTemporal` recognises, EXCEPT
// meal nouns (kept as the subject). Built once from the same WEEKDAYS keys +
// BAND_LEXICON sources so it can't drift from the parser. Used by
// `stripTemporal` to lift the day/time text out of the title/context — it's
// shown instead as the inline parsed-range annotation in the suggestion row.
const STRIP_RE: RegExp = (() => {
  const HHMM = "\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?";
  // Weekday alternation allows a trailing plural "s" ("thursdays").
  const WD = `(?:${[...WEEKDAYS.keys()].sort((a, b) => b.length - a.length).join("|")})s?`;
  const nonMealBands = BAND_LEXICON.filter(([, , , meal]) => !meal).map(([re]) => re.source);
  const parts = [
    // Day phrases (longest / multi-word first).
    "\\bday after tomorrow\\b",
    "\\b(?:early|late)\\s+next\\s+week\\b",
    "\\b(?:start|beginning)\\s+of\\s+(?:the\\s+|this\\s+)?week\\b",
    "\\bend\\s+of\\s+(?:the\\s+|this\\s+)?week\\b",
    "\\beow\\b",
    "\\bmidweek\\b",
    "\\b(?:this|next|all)\\s+weekend\\b",
    "\\bweekend\\b",
    "\\b(?:this|next)\\s+week\\b",
    "\\bweek\\b",
    "\\b(?:this|next)\\s+month\\b",
    "\\bmonth\\b",
    "\\bweekdays?\\b",
    `\\b(?:this|next|on)\\s+${WD}\\b`,
    `\\b${WD}\\b`,
    "\\b(?:today|tonight|tomorrow|tmrw|tmw|tmro)\\b",
    "\\bthis\\s+(?:morning|afternoon|evening|night|eve)\\b",
    "\\bin\\s+\\d{1,2}\\s+days?\\b",
    "\\b\\d{1,2}\\s+days?\\s+from\\s+now\\b",
    "\\bin\\s+\\d{1,2}\\s+weeks?\\b",
    "\\b\\d{1,2}\\s+weeks?\\s+from\\s+now\\b",
    "\\b(?:in\\s+)?(?:a\\s+)?couple\\s+(?:of\\s+)?days?\\b",
    "\\b(?:in\\s+)?(?:a\\s+)?few\\s+days?\\b",
    // Time-of-day bands (non-meal only) + noon/midnight/midday.
    ...nonMealBands,
    "\\b(?:noon|midnight|midday|mid-?day)\\b",
    // Clock phrases.
    "\\bbefore\\s+noon\\b",
    "\\bafter\\s+noon\\b",
    `(?:between\\s+)?${HHMM}\\s*(?:-|–|—|to|until|till|and)\\s*${HHMM}`,
    `\\b(?:after|before|at|by|around)\\s+${HHMM}`,
    `@\\s*${HHMM}`,
    `\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b`,
    "\\b\\d{1,2}\\s*-?\\s*ish\\b",
  ];
  return new RegExp(parts.join("|"), "gi");
})();

/**
 * Remove the day/time-of-day text that `parseTemporal` consumed from a subject
 * or context string, leaving the meaningful remainder (meal nouns are kept).
 * e.g. "dinner this friday" → "dinner", "games tonight" → "games". The lifted
 * range is surfaced separately as the suggestion row's parsed-range annotation.
 * Pure + `today`-independent.
 */
export function stripTemporal(text: string): string {
  if (!text) return "";
  return text
    .replace(STRIP_RE, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    // Tidy connectives left dangling where a phrase was removed.
    .replace(/^(?:or|and|,|on|at|by|around|between|from|in|the|this|next)\s+/i, "")
    .replace(/\s+(?:or|and|,|on|at|by|around|between|from|in|the|this|next)$/i, "")
    .trim();
}

// Canonical built-in-category matcher — the SINGLE SOURCE OF TRUTH for "which
// built-in poll category does this free-text subject imply?", shared by:
//   1. lib/pollTextParse.ts: detectCategory / decidePoll (and the Siri Swift
//      port that mirrors them).
//   2. lib/pollSuggestions.ts: the new-poll search box's ranked category rows.
//   3. components/TypeFieldInput.tsx: categoryMatchesQuery / categoryLabelMatchesQuery
//      (delegate here, kept for the dropdown + category-search.test.ts).
//
// Pure + React-free + SSR-safe so the pure parser and tests can import it.
//
// WHY this exists: the box previously required EVERY typed token to prefix-match
// a category word, so any natural sentence ("movie night", "where should we
// eat") matched NO category and fell through to a generic poll. This matcher
// uses the decidePoll philosophy instead — drop generic stop words, then match
// if ANY remaining token hits a category trigger — and RANKS the hits so the
// strongest is the default. Precedence (CATEGORY_ORDER) breaks score ties.
//
// FOLLOW-UPS (docs/poll-textbox-followups.md): (1) mirror this matcher into the
// Siri Swift parser (AppDelegate.swift: PollTextParser) for JS<->Swift parity;
// (2) augment the heuristic with a small on-device / Mac-mini AI classifier,
// benchmarked with the reusable corpus in tests/fixtures/poll-suggestion-corpus.ts.

export type CategoryDef = {
  value: string;
  /** Label words (weighted higher than alias keywords when scoring). */
  label: string;
  /** Trigger words a typed subject can imply this category by. */
  keywords: readonly string[];
};

// ORDER IS PRECEDENCE — the first category wins a score tie. Tuned so "eat"
// (restaurant) beats "where" (location) on "where should we eat", matching the
// poll-parse fixture. Only the six SEARCHABLE categories live here; yes_no and
// limited_supply are never keyword-matched (they're dedicated rows whose title
// is the whole typed text).
export const CATEGORY_DEFS: readonly CategoryDef[] = [
  { value: "restaurant", label: "Restaurant", keywords: ["eat", "eats", "dinner", "lunch", "food", "dining", "dine", "brunch", "breakfast", "supper", "cuisine", "meal", "takeout", "coffee", "drinks", "cafe", "bite"] },
  { value: "movie", label: "Movie", keywords: ["film", "films", "cinema", "watch", "flick", "flicks", "screening", "showtime"] },
  { value: "video_game", label: "Video Game", keywords: ["game", "games", "gaming", "videogame", "play", "console", "esports"] },
  { value: "time", label: "Time", keywords: ["when", "schedule", "date", "day", "availability", "available", "calendar", "meeting", "meet", "free"] },
  { value: "location", label: "Place", keywords: ["where", "spot", "spots", "venue", "destination", "address", "bar", "park", "trip", "location", "places"] },
  { value: "showtime", label: "Showtime", keywords: ["movie", "film", "cinema", "theater", "theatre", "showtimes", "screening", "tickets", "showings"] },
];

const DEF_BY_VALUE = new Map(CATEGORY_DEFS.map((d) => [d.value, d]));
export const CATEGORY_ORDER: readonly string[] = CATEGORY_DEFS.map((d) => d.value);

// Generic filler words removed before matching. MUST NOT contain any category
// trigger word (a test asserts the disjointness), or that word could never
// surface its category. Question words that ARE triggers ("where", "when") are
// deliberately absent.
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "should", "shall", "would", "could", "can", "will", "do", "does", "did",
  "is", "are", "am", "was", "were", "be", "been", "being", "have", "has", "had",
  "the", "a", "an", "of", "to", "we", "i", "you", "he", "she", "they", "it",
  "us", "our", "your", "my", "me", "this", "that", "these", "those",
  "what", "whats", "which", "who", "whose", "how",
  "lets", "let", "get", "got", "want", "wanna", "gonna", "going", "go",
  "pick", "choose", "choosing", "need", "please", "maybe", "some", "any",
  "every", "all", "on", "at", "in", "with", "and", "or", "for", "from",
  "next", "best", "favorite", "favourite", "vote", "poll", "decide", "decision",
  "grab", "hang", "out", "up", "still", "ok", "okay", "about", "around",
  "idea", "ideas", "plan", "plans", "option", "options", "vs", "versus",
  "make", "find", "doing", "having", "everyone", "people",
]);

/** Split a subject into lowercase alphanumeric tokens, dropping stop words and
 *  sub-2-char fragments. Apostrophes/punctuation split (so "what's" → "what"). */
export function tokenizeSubject(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

// Light singularization (trailing "s" on words longer than 3) so "movies"
// matches "movie" and "games" matches "game" without a stemmer dependency.
function singular(w: string): string {
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}

// A token matches a trigger when either is a (singularized) prefix of the
// other — covers partial typing ("vid"→"video") and plurals ("games"→"game").
function tokenHits(token: string, trigger: string): boolean {
  const t = singular(token);
  const k = singular(trigger);
  return t === k || k.startsWith(t) || t.startsWith(k);
}

// Label words per category, split once at module load (these run per keystroke
// in the search box, so the split must not repeat per call).
const LABEL_WORDS = new Map(
  CATEGORY_DEFS.map((d) => [d.value, d.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)] as const),
);

// Score a category in ONE pass over the tokens, returning both the full score
// (label hits weigh 2, alias-keyword hits 1) and the label-only score (used to
// rank exact-label hits ahead of alias-only). Each token counts at most once.
function scoreBoth(value: string, tokens: readonly string[]): { score: number; labelScore: number } {
  const def = DEF_BY_VALUE.get(value);
  if (!def || !tokens.length) return { score: 0, labelScore: 0 };
  const labelWords = LABEL_WORDS.get(value)!;
  let score = 0;
  let labelScore = 0;
  for (const tok of tokens) {
    if (labelWords.some((w) => tokenHits(tok, w))) {
      score += 2;
      labelScore += 2;
    } else if (def.keywords.some((k) => tokenHits(tok, k))) {
      score += 1;
    }
  }
  return { score, labelScore };
}

/** Match score for a category against pre-tokenized subject words. Label hits
 *  weigh 2, alias-keyword hits 1; 0 means no match. */
export function scoreCategory(value: string, tokens: readonly string[]): number {
  return scoreBoth(value, tokens).score;
}

/** Score against a category's LABEL words only (ignoring alias keywords). Used
 *  to rank exact-label hits ahead of alias-only hits. */
export function scoreCategoryLabel(value: string, tokens: readonly string[]): number {
  return scoreBoth(value, tokens).labelScore;
}

export interface RankedCategory { value: string; score: number; }

/** Every category the subject matches, strongest first. Sort key:
 *  score desc → label-hit desc (exact label beats alias) → CATEGORY_ORDER
 *  (precedence) → optional caller recency order. Deterministic. */
export function rankCategories(subject: string, recencyOrder: readonly string[] = []): RankedCategory[] {
  const tokens = tokenizeSubject(subject);
  if (!tokens.length) return [];
  const recIndex = (v: string) => {
    const i = recencyOrder.indexOf(v);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return CATEGORY_DEFS
    .map((d) => ({ value: d.value, ...scoreBoth(d.value, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.labelScore - a.labelScore ||
      CATEGORY_ORDER.indexOf(a.value) - CATEGORY_ORDER.indexOf(b.value) ||
      recIndex(a.value) - recIndex(b.value),
    )
    .map(({ value, score }) => ({ value, score }));
}

/** The single best built-in category implied by a subject, or null. Mirrors the
 *  old detectCategory contract; now the top of the shared ranking. */
export function topCategory(subject: string): string | null {
  return rankCategories(subject)[0]?.value ?? null;
}

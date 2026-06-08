// REUSABLE BENCHMARK for "free text → poll shape" classification.
//
// This is the versioned, labeled evaluation dataset + scorers for the new-poll
// search box's intent detection. It is deliberately decoupled from any specific
// classifier so the SAME corpus + metrics measure:
//   • the current deterministic heuristic (lib/pollSuggestions.ts planner), and
//   • any FUTURE AI classifier — an on-device embedding ranker, a small Mac-mini
//     model, a prompt variant — so AI work is graded against the heuristic
//     baseline on identical data (see docs/poll-textbox-followups.md, TODO 2).
//
// Consumed by tests/__tests__/poll-suggestion-scoring.test.ts (the CI gate).
//
// HOW TO BENCHMARK A CLASSIFIER (heuristic or AI):
//   const predict = (text) => myClassifier(text);   // → Prediction | null
//   const { rate, misses } = scoreTopChoice(predict); // default-correctness
//   // For a system that returns a LIST (recall): scoreRecall(predictList)
//   // For latency: wrap `predict` with timing and report p50/p95 separately —
//   // the corpus gives QUALITY; latency is measured by the caller.
//
// HOW TO GROW IT: append cases (slang, typos, compound, multilingual long-tail).
// Keep `accept` a SET when a phrasing is genuinely either-or ("dinner this
// friday" → Time OR Restaurant). New buckets sharpen the AI eval without
// changing the scorers. A Python/Mac eval can snapshot this to JSON if needed.

/** A human-intended interpretation. `accept` is a SET — any one matching is a
 *  hit — so genuinely-ambiguous phrasings don't unfairly penalize a classifier. */
export type Intent =
  | { kind: "category"; category: string }
  | { kind: "time" }
  | { kind: "options" }
  | { kind: "yes_no" };

export interface LabeledCase {
  text: string;
  accept: Intent[];
  /** Optional bucket tag for slicing the report (e.g. "slang", "typo"). */
  bucket?: string;
}

/** Classifier-agnostic prediction: only the kind (+ category for category kind)
 *  is graded, so a PlannedRow, a decidePoll result, or an AI's JSON all fit. */
export interface Prediction {
  kind: string;
  category?: string | null;
}

const cat = (c: string): Intent => ({ kind: "category", category: c });

// ── Corpus ──────────────────────────────────────────────────────────────────
const CORPUS: LabeledCase[] = [];
const add = (texts: string[], accept: Intent | Intent[], bucket?: string) => {
  const a = Array.isArray(accept) ? accept : [accept];
  for (const text of texts) CORPUS.push({ text, accept: a, bucket });
};

add(["where should we eat", "where do we want to eat", "dinner spot", "pick a restaurant",
  "where to eat tonight", "lunch spot", "where should we grab food", "best place to eat",
  "dinner ideas", "let's pick a restaurant", "somewhere to eat saturday", "what restaurant",
  "food for the party", "where are we eating", "dinner plans", "where should we get dinner"],
  [cat("restaurant"), cat("location")], "restaurant");

add(["what movie should we watch", "movie night", "pick a movie", "which film to watch",
  "what should we watch", "let's watch a movie", "movie picks", "what film", "choose a movie"],
  [cat("movie"), cat("showtime")], "movie");

add(["what game should we play", "game night", "which game to play", "pick a game",
  "let's pick a game", "what game"], cat("video_game"), "video_game");

add(["when should we meet", "when works for everyone", "what time should we meet",
  "find a time to meet", "schedule the meeting", "when are people free", "pick a time",
  "when can everyone make it", "let's find a time", "when should we get together"],
  cat("time"), "time");

add(["where should we go", "where to hang out", "pick a place", "where should we meet up",
  "what's the venue", "where do we want to go", "place to meet"],
  [cat("location"), cat("time")], "location");

add(["pizza or tacos", "pizza, tacos, or sushi", "thai or italian or mexican",
  "red blue or green", "beach or mountains", "netflix or hbo or hulu", "coffee tea or water",
  "dogs or cats", "marvel or dc", "north or south", "in person or zoom"],
  { kind: "options" }, "options");

add(["should we get a dog", "should we order pizza", "are we still on for friday",
  "do we need snacks", "should we cancel", "is everyone coming", "should we reschedule",
  "can we move it to monday", "should we book it", "do we want dessert"],
  { kind: "yes_no" }, "yes_no");

// Scheduling phrases — Time, or the food/movie category they mention, both fine.
add(["dinner this friday", "lunch tomorrow", "coffee thursday morning"], [{ kind: "time" }, cat("restaurant")], "temporal");
add(["games tonight"], [{ kind: "time" }, cat("video_game")], "temporal");
add(["movie night friday 8pm"], [{ kind: "time" }, cat("movie")], "temporal");
add(["meet up saturday afternoon"], [{ kind: "time" }, cat("location")], "temporal");
add(["hang out this weekend", "get together next week"], { kind: "time" }, "temporal");

export const POLL_SUGGESTION_CORPUS: readonly LabeledCase[] = CORPUS;

// ── Long-tail corpus ─────────────────────────────────────────────────────────
// Deliberately HARD phrasings that expose the keyword heuristic's ceiling:
// slang/novel words it has no trigger for, typos that corrupt the trigger word
// itself, compound multi-intent input, and non-English. Kept SEPARATE from the
// CI-gated core (the heuristic is EXPECTED to do poorly here) so this set can be
// the proving ground for an AI classifier without breaking the core CI gate.
// `accept` stays a SET where intent is genuinely either-or. See
// docs/poll-textbox-followups.md (TODO 2) + prototypes/poll-classify/.
const LONGTAIL: LabeledCase[] = [];
const addLong = (texts: string[], accept: Intent | Intent[], bucket: string) => {
  const a = Array.isArray(accept) ? accept : [accept];
  for (const text of texts) LONGTAIL.push({ text, accept: a, bucket });
};

// slang / novel vocabulary the keyword set lacks (a couple of controls the
// heuristic already handles — "drinks"/"movie" — guard against AI regressions).
addLong(["feed me", "i'm starving", "let's grub", "grub time", "what're we munching on",
  "hungry, ideas?", "chow down where", "somewhere to nosh"], cat("restaurant"), "slang");
addLong(["happy hour spot", "where we drinking"], [cat("restaurant"), cat("location")], "slang");
addLong(["frag night", "let's frag", "controller time", "respawn night", "co-op session"],
  cat("video_game"), "slang");
addLong(["let's get drinks", "movie marathon"], [cat("restaurant"), cat("movie")], "slang"); // controls

// typos that corrupt the TRIGGER word itself (typos on non-trigger words don't
// challenge the heuristic). A few controls keep a surviving keyword.
addLong(["moive night", "moive marathon", "pic a flim", "whihc moive"], cat("movie"), "typo");
addLong(["restaraunt ideas", "diner tonight", "whats for dinr", "wheres good to eet"],
  cat("restaurant"), "typo");
addLong(["vidoe gaem night", "wat gaem to paly"], cat("video_game"), "typo");
addLong(["schedual a meetnig", "whenn are we free"], cat("time"), "typo");
addLong(["lunhc spot"], [cat("restaurant"), cat("location")], "typo");
addLong(["resturant for dinner", "moveis to watch"], // controls (surviving keyword)
  [cat("restaurant"), cat("movie")], "typo");

// compound / multi-intent — the structural detectors (options, yes/no, temporal)
// usually dominate, so accept the union; this measures that the AI category swap
// doesn't BREAK structure-dominated input.
addLong(["dinner friday or saturday with the team"], [{ kind: "time" }, cat("restaurant"), { kind: "options" }], "compound");
addLong(["movie or game night this weekend"], [{ kind: "time" }, { kind: "options" }, cat("movie"), cat("video_game")], "compound");
addLong(["pizza or sushi for lunch tomorrow"], [{ kind: "options" }, { kind: "time" }, cat("restaurant")], "compound");
addLong(["thai or italian friday"], [{ kind: "options" }, cat("restaurant"), { kind: "time" }], "compound");
addLong(["game or movie tonight"], [{ kind: "options" }, { kind: "time" }, cat("video_game"), cat("movie")], "compound");
addLong(["brunch sunday or monday"], [{ kind: "time" }, { kind: "options" }, cat("restaurant")], "compound");
addLong(["where and when should we meet"], [{ kind: "time" }, cat("location")], "compound");
addLong(["what time and where for drinks"], [{ kind: "time" }, cat("restaurant"), cat("location")], "compound");
addLong(["should we do dinner or a movie"], [{ kind: "yes_no" }, { kind: "options" }, cat("restaurant"), cat("movie")], "compound");
addLong(["lunch spot near the office for the team"], [cat("restaurant"), cat("location")], "compound");

// multilingual — English keyword set + an English-only embedder BOTH fail here;
// this bucket exists to show that a MULTILINGUAL embedder is required to lift it.
addLong(["dónde comemos", "dónde cenamos", "wo essen wir", "où manger ce soir", "dove mangiamo"], cat("restaurant"), "multilingual");
addLong(["qué película vemos", "quel film regarder", "welcher film", "che film guardiamo"], cat("movie"), "multilingual");
addLong(["cuándo nos reunimos", "quand se voit-on", "wann treffen wir uns"], cat("time"), "multilingual");
addLong(["qué juego jugamos"], cat("video_game"), "multilingual");

export const POLL_SUGGESTION_LONGTAIL: readonly LabeledCase[] = LONGTAIL;
/** Core + long-tail, the full proving ground for an AI classifier eval. */
export const POLL_SUGGESTION_CORPUS_FULL: readonly LabeledCase[] = [...CORPUS, ...LONGTAIL];

// ── Matchers ──────────────────────────────────────────────────────────────────
/** Does a prediction satisfy one intent? "time" is satisfied by either a
 *  `time` kind or a `category:time`, since the box surfaces both shapes. */
export function intentMatches(pred: Prediction | null, intent: Intent): boolean {
  if (!pred) return false;
  if (intent.kind === "category") return pred.kind === "category" && pred.category === intent.category;
  if (intent.kind === "time") return pred.kind === "time" || (pred.kind === "category" && pred.category === "time");
  return pred.kind === intent.kind; // options | yes_no
}
export const anyIntentMatch = (pred: Prediction | null, accept: readonly Intent[]) =>
  accept.some((w) => intentMatches(pred, w));

// ── Scorers ─────────────────────────────────────────────────────────────────
export interface ScoreResult {
  rate: number; // fraction in [0,1]
  correct: number;
  total: number;
  misses: string[];
  /** Per-bucket rate, for sliced reports. */
  byBucket: Record<string, { correct: number; total: number }>;
}

function tally(
  corpus: readonly LabeledCase[],
  hit: (c: LabeledCase) => boolean,
): ScoreResult {
  let correct = 0;
  const misses: string[] = [];
  const byBucket: Record<string, { correct: number; total: number }> = {};
  for (const c of corpus) {
    const b = c.bucket ?? "_";
    byBucket[b] ??= { correct: 0, total: 0 };
    byBucket[b].total++;
    if (hit(c)) {
      correct++;
      byBucket[b].correct++;
    } else misses.push(c.text);
  }
  return { rate: corpus.length ? correct / corpus.length : 1, correct, total: corpus.length, misses, byBucket };
}

/** DEFAULT-correctness: the classifier's single best guess matches intent. Use
 *  for an AI classifier OR the heuristic's primary (nearest-bar) suggestion. */
export function scoreTopChoice(
  predict: (text: string) => Prediction | null,
  corpus: readonly LabeledCase[] = POLL_SUGGESTION_CORPUS,
): ScoreResult {
  return tally(corpus, (c) => anyIntentMatch(predict(c.text), c.accept));
}

/** RECALL: the intended interpretation appears anywhere in a returned list. Use
 *  for a list-producing system (the suggestion planner). */
export function scoreRecall(
  predictList: (text: string) => Prediction[],
  corpus: readonly LabeledCase[] = POLL_SUGGESTION_CORPUS,
): ScoreResult {
  return tally(corpus, (c) => predictList(c.text).some((p) => anyIntentMatch(p, c.accept)));
}

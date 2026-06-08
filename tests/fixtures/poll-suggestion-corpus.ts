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

// Prototype phrases + model config for the on-device embedding CATEGORY ranker
// (lib/aiCategoryClassify.ts). The ranker classifies a typed subject by MEANING
// — cosine-ranking it against a handful of prototype phrases per category — so
// slang / novel phrasings / typos surface a built-in category even when the
// keyword matcher (lib/categoryMatch.ts) has no trigger word for them.
//
// It AUGMENTS, never replaces: the deterministic planner stays the instant
// default; a confident embedding only ADDS a category suggestion row.
//
// Extend the ranker by adding PROTOTYPE PHRASES here — never by editing keyword
// lists. Prototypes are English; an English embedder (bge-small) is used, so the
// multilingual long tail is out of scope for this first rollout (see
// prototypes/poll-classify/README.md for the model comparison + benchmark).

/** HuggingFace model id (transformers.js / ONNX). bge-small-en-v1.5 was the best
 *  English option in the benchmark: +7.6 pts default / +15.9 pts recall on the
 *  grown corpus, ~30 MB int8, ~2 ms/query on a server CPU (more on real phones,
 *  still far under the debounce budget). */
export const AI_CATEGORY_MODEL_ID = "Xenova/bge-small-en-v1.5";

/** int8 quantization — the variant benchmarked. */
export const AI_CATEGORY_DTYPE = "q8" as const;

/** Cosine gate: a category is only suggested when its best prototype match is at
 *  least this similar. Tuned conservatively for bge-small (cosines run high);
 *  re-sweep with prototypes/poll-classify/bench.mts if the model changes. Because
 *  a suggested row never overrides the heuristic default, a missed/extra row is
 *  low-cost — this errs toward suppressing noise on clearly non-category input. */
export const AI_CATEGORY_MIN_SCORE = 0.45;

/** A handful of natural prototype phrases per built-in searchable category. Kept
 *  aligned with prototypes/poll-classify/categoryEmbed.mts (the eval harness). */
export const CATEGORY_PROTOTYPES: Record<string, string[]> = {
  restaurant: [
    "where should we eat",
    "pick a restaurant for dinner",
    "what's a good place to eat",
    "let's grab some food",
    "where can we get lunch",
    "i'm hungry, let's find food",
    "a spot for drinks and a bite",
  ],
  movie: [
    "what movie should we watch",
    "pick a film for movie night",
    "which film should we see",
    "let's watch a movie together",
    "choose a movie to watch",
  ],
  video_game: [
    "what game should we play",
    "pick a video game for game night",
    "which game should we play",
    "let's play some games",
    "a co-op gaming session",
  ],
  time: [
    "when should we meet",
    "find a time that works for everyone",
    "what day are people free",
    "schedule a meeting time",
    "pick a date and time to get together",
  ],
  location: [
    "where should we go",
    "pick a place to hang out",
    "what is the venue",
    "where should we meet up",
    "a spot to get together",
  ],
  showtime: [
    "what movie showtime should we see",
    "which cinema screening to attend",
    "buy tickets for a film showing",
    "what time is the movie playing",
  ],
};

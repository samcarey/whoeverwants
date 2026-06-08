# Poll search-box — follow-up TODOs

Context: the new-poll search box's category matching + suggestion ordering were
reworked (branch `claude/poll-textbox-ux-review-64wfgf`). The decision layer is
now three pure modules:

- `lib/categoryMatch.ts` — canonical ranked, any-token, stop-word-filtered
  category matcher (the single source of truth for category trigger words).
- `lib/pollTextParse.ts` — `parseForContext` / `parseOptionsFromText` /
  `decidePoll` / `detectCategory` (delegates to `categoryMatch`) + temporal
  parsing. Shared with the Siri Swift port via the fixture
  `tests/fixtures/poll-parse-cases.json`.
- `lib/pollSuggestions.ts` — the box's suggestion **planner** (which rows, in
  what order). The box (`app/create-poll/page.tsx`) and the scoring harness
  (`tests/__tests__/poll-suggestion-scoring.test.ts`) both consume it.

Box default-correctness on natural phrasings went 18% → ~95%, recall 42% → ~98%.

---

## TODO 1 — Mirror the unified matcher into the Siri Swift parser (parity)

**Status:** open. Web ✅ shipped; Swift ⏳ still on the OLD narrow trigger set.

**What's diverged.** `detectCategory` / `decidePoll` (JS) now delegate to
`lib/categoryMatch.ts` (rich keyword set, any-token, stop-word-filtered,
ranked). The Siri/App-Intents Swift port — `PollTextParser` in
`ios/App/App/AppDelegate.swift` (~the `CATEGORY_TRIGGERS` / `detectCategory` /
`decide` block) — still uses the original *narrow, whole-word* trigger set. So
the two parsers now classify natural sentences differently:

| Input | JS `decidePoll` (now) | Swift `PollTextParser` (now) |
|---|---|---|
| `movie night` | category:movie | category:movie ✅ (lucky — "movie" is in the old set) |
| `dinner tonight` | category:restaurant | **yes_no** ❌ (old set has no "dinner") |
| `where to eat` | category:restaurant | category:restaurant ✅ ("eat") |
| `pick a game` | category:video_game | category:video_game ✅ |
| `what's for dinner` | yes_no | yes_no ✅ |

The shared fixture (`poll-parse-cases.json`) is still **green on both sides** —
the rework was designed to keep every existing fixture case unchanged — so CI
isn't red and Siri still works; it's just less rich than the web until ported.

**What to port** (faithful Swift mirror of `lib/categoryMatch.ts`):
1. `CATEGORY_DEFS` — the six searchable categories + their label/keywords, in
   precedence order (restaurant, movie, video_game, time, location, showtime).
2. `STOP_WORDS` — the generic-filler set (assert it stays disjoint from every
   trigger word, same invariant the JS test pins).
3. `tokenizeSubject` (lowercase, split on non-alphanumeric, drop stop words +
   sub-2-char), `singular` (strip trailing "s" when len > 3), `tokenHits`
   (prefix-match in either direction after singularizing).
4. `scoreCategory` (label hit = 2, alias-keyword hit = 1, sum over tokens) →
   `rankCategories` (sort score desc → label-score desc → precedence) →
   `topCategory`. `detectCategory` = `topCategory`.
5. `decidePoll` precedence is UNCHANGED (options ≥2 → yes/no stem → category →
   yes/no) — only the category lookup underneath it changes.

**Then extend the alignment contract.** Once Swift mirrors, ADD the
natural-sentence wins to `poll-parse-cases.json` (e.g. `dinner tonight` →
restaurant, `movie night` → movie, `pick a game` → video_game) so the JS test
*and* the Swift unit test both pin the unified behavior and can't silently drift
again. Don't add these BEFORE Swift mirrors — the fixture is the shared contract;
a case JS passes but Swift fails breaks the manual-mirror discipline.

**NOT in scope for Siri parity:** `parseTemporal` / `stripTemporal` and the
whole `lib/pollSuggestions.ts` planner are **web-search-box only** (the Siri
deep link can't carry day/time windows or a ranked suggestion list yet). Only
the `decidePoll` decision (kind + category + options + context) is mirrored.

**Verification.** Can't compile iOS in the sandbox — needs a real iOS build.
Add a Swift `XCTest` that reads the SAME `poll-parse-cases.json` and asserts
`PollTextParser.decide`, then verify on a TestFlight build (the device-verify
pattern in CLAUDE.md). The JS half (`poll-text-parse.test.ts`) is the
CI-enforced anchor.

---

## TODO 2 — Replace/augment the heuristic with a small AI model

**Status:** open, exploratory. The keyword matcher is a big step up but is still
a hand-curated heuristic, so it has a structural ceiling:

- **Synonyms / novel phrasings** it has no word for: "where should we grub",
  "feed me", "let's get plastered" (→ restaurant/bar), "frag night" (→ game).
- **Idioms** the rules mishandle: `what's for dinner` splits on "for" → a
  custom poll named "what's"; `place to eat` ranks Place over Restaurant
  because "place" is literally the Place label.
- **Compound / ambiguous intent**: "dinner friday or saturday with the team" is
  simultaneously time + options + restaurant + a context ("with the team").
- **Typos / multilingual**: "moive night", "dónde comemos".

An embedding/LLM classifier maps free text → poll shape by *meaning*, lifting
long-tail recall well past what adding more keywords can.

### Hard constraints (non-negotiable UX)

1. **AI augments, never blocks.** The deterministic planner stays the *instant*
   default (per-keystroke, offline, zero-cost). The AI result arrives async and
   only *re-ranks / adds* a suggestion. The box must stay instant and work with
   no network / model down.
2. **Cheap + low-latency.** The box reacts per-keystroke; an AI pass must be
   debounced (~250–350 ms after typing pauses), cached by query string, and
   cancellable.
3. **Privacy.** Prefer on-device. A self-hosted Mac-mini model is acceptable
   (no third party); a paid cloud LLM per keystroke is not.

### Hosting reality (be honest about it)

- **Production API = the DigitalOcean droplet (1 GB RAM).** It **cannot** host
  even a tiny LLM. So for *production*, the viable path is **on-device**.
- **Mac mini (M4, 32 GB, Colima VM)** already hosts dev servers + `cmd-api` and
  has a precedent for small self-hosted services (favicon cache, showtimes
  adapter). It's the right place to **prototype + evaluate** a model, and could
  serve **dev/canary** classification — but don't design prod around it unless
  prod hosting changes.

### Design options (sweet spot first)

**A. Embedding-similarity category ranker (recommended first step).**
Precompute embeddings for a handful of *prototype phrases* per category
("where to eat", "pick a restaurant", "dinner spot", … for restaurant). At
query time, embed the typed subject and cosine-rank categories. Tiny, fast
(~10–40 ms), deterministic, and extended by adding prototypes (not keywords).
- **On-device iOS:** `NLEmbedding` (Apple's built-in sentence embeddings) —
  free, offline, no model to ship. Also usable from the Siri App-Intent process.
- **On-device web:** `transformers.js` running a small int8 embedder
  (e.g. `all-MiniLM-L6-v2`, ~20 MB) via WASM/WebGPU, lazy-loaded with the
  create-poll chunk so it doesn't bloat the initial bundle.
- **Mac mini (dev/canary):** a `/api/poll-classify` FastAPI endpoint wrapping
  `bge-small` / `all-MiniLM` (sentence-transformers). The per-branch dev FE
  already proxies `/api/*` to the in-container API.

**B. Small instruction-tuned LLM for the hard cases.** A sub-2B quantized model
(Qwen2.5-0.5B/1.5B, Llama-3.2-1B, Phi-3-mini) with **grammar/JSON-constrained
output** returning `{kind, category, options[], context, temporal}` in one shot
— handles compound/ambiguous input the embedder can't. Heavier (~100–300 ms),
so fire it on a longer pause or on submit, NOT per keystroke.
- **On-device iOS 18+:** Apple Foundation Models (on-device Apple Intelligence)
  via the system LLM APIs, where available; else Core ML with a distilled
  classifier.
- **Mac mini:** llama.cpp / Ollama behind the same `/api/poll-classify`
  endpoint; free, self-hosted, fine for dev/canary + eval.

### Architecture sketch

```
type typed → planner() → instant suggestions (default, offline)        [unchanged]
            └─ debounce 300ms ─→ classify(text) ─→ {kind,category,...,confidence}
                                   (NLEmbedding on-device / Mac /api/poll-classify)
                                 └─ if confidence high → promote/add a row,
                                    re-rank above the heuristic primary;
                                    else leave the heuristic result as-is.
```

Keep `lib/pollSuggestions.ts` as the merge point: the planner returns the
deterministic rows; an optional `aiHint?: {kind, category, score}` re-orders the
primary. Cache `classify()` by normalized query; cancel in-flight on new input;
hard-timeout (~400 ms) → fall back to heuristic.

### Evaluation substrate (already built — reuse it for prompt/model dev)

The test suite from the rework is a **reusable, classifier-agnostic benchmark**,
intentionally decoupled so an AI variant is graded against the heuristic on the
SAME data:

- **`tests/fixtures/poll-suggestion-corpus.ts`** — the versioned labeled dataset
  (`POLL_SUGGESTION_CORPUS`, ~77 cases with bucket tags) + the scorers
  (`scoreTopChoice` for single-best/default-correctness, `scoreRecall` for
  list/recall) + the matcher (`intentMatches`, ambiguity-tolerant via an
  `accept` SET per case). `Prediction = {kind, category?}` is classifier-agnostic
  so a PlannedRow, a `decidePoll` result, OR an AI's JSON all plug in.
- **`tests/__tests__/poll-suggestion-scoring.test.ts`** — the CI gate; just wires
  the heuristic planner into those scorers + pins canonical cases.

**Benchmark an AI classifier (or a prompt variant) like this:**

```ts
import { scoreTopChoice, scoreRecall } from "tests/fixtures/poll-suggestion-corpus";
const predict = (text) => myClassifier(text);          // → {kind, category?} | null
const ai   = scoreTopChoice(predict);                  // default-correctness + per-bucket
const base = scoreTopChoice(plannerPrimary);           // heuristic baseline, same corpus
// ship only if  ai.rate > base.rate  AND latency budget met
```

Workflow for AI/prompt development:
1. **Quality** comes from the corpus + scorers (default-correct, recall,
   `byBucket` slices to see WHERE a model wins/loses — slang vs idiom vs compound).
2. **Latency** is measured by the caller (wrap `predict` with timing → p50/p95);
   the corpus deliberately doesn't bake in timing.
3. **Grow the corpus** with long-tail buckets (slang, typos, compound,
   multilingual) — this is exactly what exposes the heuristic's ceiling and gives
   prompt iteration signal. Keep `accept` a SET for genuine ambiguity.
4. **Gate** any AI path on (a) measurable recall/default lift over the heuristic
   AND (b) a latency budget, so a slower-but-not-better model can't ship.
5. For a **Python / Mac-mini** eval (e.g. sentence-transformers, llama.cpp),
   snapshot the corpus to JSON and re-implement the tiny scorer there, OR call a
   Node harness — the corpus is the contract either way.

### Suggested first move

Prototype **Option A on-device** (`NLEmbedding` on iOS, `transformers.js` on
web) behind a flag, A/B it against the heuristic with the scoring harness on a
fresh long-tail corpus, and measure recall lift + latency before committing to
anything heavier. The Mac-mini endpoint is the fastest way to iterate on
prototypes/prompts; on-device is the prod-viable end state.

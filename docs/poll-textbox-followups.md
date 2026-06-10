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

## TODO 2 — Augment the heuristic with a small AI model — SHIPPED (web, on-device)

**Status:** the embedding category ranker shipped and is live on all tiers incl.
prod. Canonical writeup is in CLAUDE.md (search "Embedding category ranker").
Summary: `lib/aiCategoryClassify.ts` embeds the typed subject (transformers.js
`Xenova/bge-small-en-v1.5`, q8, lazy-loaded from a CDN ESM URL — not bundled)
and cosine-ranks it against `lib/categoryPrototypes.ts`; a confident hint feeds
`planPollSuggestions(..., { aiHint })` and only ADDS a row, never overrides the
heuristic default. Fail-safe (no model / no network / SSR → planner no-op).
Benchmarked at +7.6% default-correctness / +15.9% recall over the heuristic on
the long-tail corpus.

**Still open (out of scope of the shipped work):**
- Multilingual — bge is English-only; a multilingual model (e.g.
  `paraphrase-multilingual-MiniLM-L12`) would lift the multilingual bucket but
  isn't wired up.
- The **iOS / Siri** side has no AI classifier (it uses only the keyword
  matcher) — and that matcher itself still needs the TODO 1 Swift port first.

**Reusable eval substrate (kept):** `tests/fixtures/poll-suggestion-corpus.ts`
(labeled dataset + classifier-agnostic scorers `scoreTopChoice` / `scoreRecall`,
`Prediction = {kind, category?}`) and `prototypes/poll-classify/bench.mts` (the
IRV-vs-model bench that imports the real planner as baseline). Use these to
re-tune `AI_CATEGORY_MIN_SCORE` or compare a different model; grow the corpus
(esp. the non-CI `POLL_SUGGESTION_LONGTAIL` slang/typo/compound/multilingual
buckets) to expose where a candidate wins/loses.

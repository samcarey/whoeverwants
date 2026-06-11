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

**Status:** Swift port ✅ LANDED (the matcher); fixture extended ✅; **Swift
parity test ✅ LANDED in CI** (June 2026 — as a swiftc fixture harness, not an
XCTest target; see below); on-device verification ⏳ still owed (needs a
TestFlight build — can't compile iOS in the sandbox).

**Parity test (shipped).** `PollTextParser` was extracted from
`AppDelegate.swift` into its own `ios/App/App/PollTextParser.swift` (pure
Foundation — keep it free of UIKit/Capacitor imports) so
`scripts/ios/test-parser.sh` can `swiftc`-compile it for the macOS host
together with the harness `scripts/ios/parser-harness/main.swift`, which reads
the SAME `tests/fixtures/poll-parse-cases.json` the JS test asserts and checks
`PollTextParser.decide` case-by-case (kind / options / category / context —
identical assertion semantics to `poll-text-parse.test.ts`). The
`ios-build.yml` workflow runs it on the Mac runner before archiving, so a
drifting Swift port now FAILS the iOS build instead of silently shipping. This
supersedes the original "Swift XCTest target" idea — an XCTest target would
need pbxproj surgery for a whole native test target plus a simulator to run
in CI; the standalone-compile harness gets the same fixture-pinned guarantee
with none of that.

**What shipped.** `PollTextParser` in `ios/App/App/AppDelegate.swift` is now a
faithful Swift mirror of `lib/categoryMatch.ts` — the OLD narrow whole-word
`categoryTriggers` set was replaced by:
- `categoryDefs` — the six searchable categories + label/keywords, in precedence
  order (restaurant, movie, video_game, time, location, showtime).
- `stopWords` — the generic-filler set (disjoint from every trigger word; the JS
  test `category-search.test.ts` / `poll-text-parse.test.ts` pin the invariant
  on the JS side).
- `tokenizeSubject` (lowercase, split on non-`a-z0-9`, drop stop words +
  sub-2-char), `singular` (strip trailing "s" when len > 3), `tokenHits`
  (singularized prefix-match either direction).
- `scoreBoth` (label hit = 2, alias-keyword hit = 1) feeding the ranked
  `detectCategory` (= `topCategory`): sort score desc → label-score desc →
  precedence (the `categoryDefs` order). The web-only recency tie-break is NOT
  mirrored (Siri has no recency signal).
- `decide` precedence is UNCHANGED (options ≥2 → yes/no stem → category →
  yes/no) — only the category lookup underneath it changed.

So the two parsers now classify natural sentences the same way (previously
`dinner tonight` → yes_no on Swift, restaurant on JS, etc.).

**Fixture extended.** Four natural-sentence wins were added to
`poll-parse-cases.json` now that both sides agree: `dinner tonight` →
restaurant, `movie night` → movie, `pick a game` → video_game, `where to eat` →
restaurant. The JS test (`poll-text-parse.test.ts`, 30 cases) is green.

**NOT in scope for Siri parity:** `parseTemporal` / `stripTemporal` and the
whole `lib/pollSuggestions.ts` planner are **web-search-box only** (the Siri
deep link can't carry day/time windows or a ranked suggestion list yet). Only
the `decide` decision (kind + category + options + context) is mirrored.

**Remaining.** Only (b): verify the spoken/Spotlight path on a TestFlight
build (the device-verify pattern in CLAUDE.md) — owner/device action. Both
halves of the fixture are now CI-enforced: JS via `poll-text-parse.test.ts`
(Node CI), Swift via `scripts/ios/test-parser.sh` (Mac runner, every iOS
build).

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

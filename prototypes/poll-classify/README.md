# poll-classify — embedding category ranker (Option A prototype)

Exploratory prototype for **TODO 2** in `docs/poll-textbox-followups.md`: augment the
new-poll search box's hand-curated keyword category matcher (`lib/categoryMatch.ts`)
with an **embedding-similarity ranker** that classifies the typed subject by *meaning*,
so slang / novel phrasings / typos / other languages map to a category even when no
keyword matches.

This is a **prototype + benchmark only** — nothing here is wired into the box
(per the task: report lift + latency *before* wiring). The deterministic planner
stays the instant default; the embedder is the "augment, never block" category step.

## What it is

- **`categoryEmbed.mts`** — the ranker. A handful of **prototype phrases per category**
  (extended by adding phrases, never by editing keyword lists), embedded once and
  disk-cached; at query time the typed subject is embedded and categories are
  cosine-ranked (`max` over each category's prototypes). Runtime: `transformers.js`
  (WASM) — the prod-viable on-device-web path. The same prototype set works on iOS
  `NLEmbedding` and a Mac-mini `/api/poll-classify`.
- **`bench.mts`** — the A/B harness. **Imports the real heuristic** so the baseline
  is literally `lib/pollSuggestions` (it asserts a keyword-only reproduction matches
  the real planner on all 132 cases → zero port divergence). The ONLY thing the AI
  variant changes is the category step; every structural detector (≥2 options,
  yes/no stem, temporal) stays the heuristic — a clean isolation of "augment, never
  block". Grades three strategies on `POLL_SUGGESTION_CORPUS_FULL`:
  - `baseline`  — `rankCategories` (keyword), the shipped heuristic
  - `embed@T`   — embedding cosine rank, gated at threshold `T`
  - `hybrid@T`  — keyword if it fires, else embedding ≥ `T` (fill the long tail)
- **`snapshot-corpus.mts`** — dumps the corpus to `corpus.json` for a Python/Mac eval.
- **`results.md`** — captured output for the three models below.

## Corpus growth (the proving ground)

`tests/fixtures/poll-suggestion-corpus.ts` gained a separate, **non-CI-gated**
`POLL_SUGGESTION_LONGTAIL` (+`POLL_SUGGESTION_CORPUS_FULL`) export of 55 deliberately
hard cases across four buckets — kept separate so the heuristic's expected failures
there don't break the core CI gate:

| bucket | n | what it stresses |
|---|---|---|
| `slang` | 17 | novel vocab the keyword set lacks ("feed me", "frag night", "grub time") |
| `typo` | 15 | typos that corrupt the **trigger word itself** ("moive night", "restaraunt") |
| `compound` | 10 | multi-intent ("dinner friday or saturday with the team") |
| `multilingual` | 13 | es/fr/de/it ("dónde comemos", "quel film", "wann treffen wir uns") |

`accept` stays a SET where intent is genuinely either-or, so ambiguous phrasings
aren't unfairly penalized.

## Results

Run: `node_modules/.bin/tsx bench.mts [modelId] [max|mean]`. Overall = default-correctness
(`scoreTopChoice`) on all 132 cases; per-bucket cells show the four long-tail buckets.

| strategy / model | overall | slang | typo | compound | multilingual | query p50 / p95 |
|---|---|---|---|---|---|---|
| **baseline (keyword)** | **75.8%** | 29% | 33% | 100% | 23% | — |
| all-MiniLM-L6-v2 · embed@0.3 | 82.6% (**+6.8**) | 59% | 53% | 100% | 23% | 2 / 3 ms |
| all-MiniLM-L6-v2 · hybrid@0.3 | 81.1% (+5.3) | 59% | 53% | 100% | 23% | 2 / 3 ms |
| bge-small-en-v1.5 · embed@0.3 | 83.3% (**+7.6**) | 59% | 53% | 100% | 38% | 3 / 4 ms |
| paraphrase-multilingual-MiniLM-L12 · embed@0.3 | **87.1% (+11.4)** | 59% | 40% | 100% | **92%** | 2 / 4 ms |

(Prototype embedding is a one-off ~50–85 ms, cached to disk. Model cold-load ~0.9 s.)

**Recall** (`scoreRecall` — intended interpretation appears *anywhere* in the list;
AI-augmented = planner rows **plus** the embed top-2 categories ≥T, so it can only go up):

| list / model | recall (full 132) | lift |
|---|---|---|
| baseline (planner rows) | 76.5% | — |
| + embed all-MiniLM-L6-v2 | 86.4% | +9.8 |
| + embed bge-small-en-v1.5 | 92.4% | +15.9 |
| + embed paraphrase-multilingual-MiniLM-L12 | **93.2%** | **+16.7** |

### Findings

1. **The embedder delivers a real, isolated lift on the long tail.** Every model
   roughly **doubles slang (29%→59%)** and **lifts typos (33%→53%)** — exactly the
   ceiling the keyword matcher can't cross by adding more keywords. Core buckets
   (restaurant/movie/game/time/location/options/yes_no) stay at 100% under both —
   no regressions.
2. **Compound is structure-dominated → embedding correctly doesn't change it
   (100%→100%).** The ≥2-options / yes-no-stem / temporal detectors already pick the
   dominant intent; the category swap only re-ranks the category branch. This
   validates the "augment, never block" isolation — the AI never overrides structure.
3. **Multilingual needs a multilingual embedder.** English MiniLM/bge can't bridge
   languages (23% / 38%); `paraphrase-multilingual-MiniLM-L12-v2` takes it to **92%**
   for the same ~2–4 ms. This is the biggest single swing and makes the multilingual
   model the overall winner (+11.4 pts), at a small typo cost (40% vs bge's 53%).
4. **Latency is a non-issue.** p50 ≈ 2 ms, p95 ≈ 4 ms per query embed — two orders of
   magnitude under the 250–350 ms debounce budget the box would use. The cost is
   model **load** (~0.9 s, one-off) and the ~23–120 MB model download, both
   amortizable (lazy-load with the create-poll chunk).
5. **`embed-only` ≈ `hybrid`, both win.** Pure-embed edges hybrid here because the
   structural precedence already protects yes_no/options/custom, so over-triggering
   the category branch is cheap. For prod I'd still prefer **hybrid** (keyword's
   precision when it fires, embedder fills the gap) for determinism on the cases the
   heuristic already nails.

### Recommendation (before any wiring)

- **Ship-readiness:** the lift is real (+5 to +11 pts) and cheap (≤4 ms/query), so the
  approach clears the doc's gate (measurable lift + latency budget). But the headline
  win (multilingual) rides on shipping a ~120 MB multilingual model to the browser —
  weigh that bundle cost against the multilingual share of real traffic.
- **Prod path = on-device** (the 1 GB droplet can't host a model): `transformers.js`
  with a lazy-loaded int8 embedder on web, `NLEmbedding` on iOS (also reusable from
  the Siri App-Intent process). The Mac-mini `/api/poll-classify` endpoint is the
  fast iteration / dev-canary host, not prod.
- **Lowest-risk first integration is the LIST (recall), not the default.** Adding an
  embed-suggested category *row* (the +9.8 to +16.7 pt recall win) never overrides the
  heuristic's nearest-bar default — it just gives the user one more correct row to tap,
  so a wrong/over-eager embedding can't make the box worse. Promoting the embed category
  to the *primary* (the default-correctness win) is the higher-reward, higher-risk step
  to gate behind a confidence margin once the list-level version is proven.
- **Merge point** stays `lib/pollSuggestions.ts`: planner returns deterministic rows;
  an async, debounced, query-cached `classify()` supplies an `aiHint` that re-ranks
  **only** the category primary (hybrid gate), with a hard timeout → heuristic
  fallback. Exactly the `decide(raw, catRanker, gate)` shape `bench.mts` exercises.
- **Tune before shipping:** sweep `T` per model on a larger corpus (the sweep here
  tops at the small grown set), grow the long-tail buckets further (the corpus +
  scorers are the contract), and A/B `max` vs `mean` aggregation.

## Run it

```bash
cd prototypes/poll-classify
npm install                       # tsx + @huggingface/transformers (already done in dev)
node_modules/.bin/tsx bench.mts                                            # all-MiniLM-L6-v2
node_modules/.bin/tsx bench.mts Xenova/bge-small-en-v1.5
node_modules/.bin/tsx bench.mts Xenova/paraphrase-multilingual-MiniLM-L12-v2
node_modules/.bin/tsx snapshot-corpus.mts                                  # → corpus.json
```

First run downloads the model (cached under `node_modules/.cache`); prototype vectors
cache under `.embed-cache/`. `node_modules/`, `.embed-cache/`, `corpus.json` are gitignored.

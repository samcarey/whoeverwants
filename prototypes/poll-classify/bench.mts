// A/B benchmark: keyword heuristic (baseline) vs embedding category ranker.
//
// Design — the only thing that differs between baseline and AI variant is the
// CATEGORY step. Every structural detector (≥2 options, yes/no stem, temporal)
// is the REAL heuristic from lib/, imported here, so this is a clean isolation
// of "augment, never block": the embedder only changes which category (if any)
// becomes the primary; structure still wins.
//
// Strategies graded on the SAME corpus (tests/fixtures/poll-suggestion-corpus.ts):
//   • baseline  — rankCategories (keyword) ............... the shipped heuristic
//   • embed@T   — embedding cosine rank, gated at threshold T
//   • hybrid@T  — keyword if it fires, else embedding ≥ T (fill the long tail)
//
// Run: prototypes/poll-classify/node_modules/.bin/tsx bench.mts [modelId]
//
// Reports default-correctness (scoreTopChoice) overall + per bucket, validates
// the harness reproduces the real planner, and reports query-embed p50/p95.

import {
  parseForContext,
  parseOptionsFromText,
  parseTemporal,
  startsWithYesNoStem,
} from "../../lib/pollTextParse.ts";
import { rankCategories } from "../../lib/categoryMatch.ts";
import { primarySuggestion, planPollSuggestions } from "../../lib/pollSuggestions.ts";
import {
  POLL_SUGGESTION_CORPUS_FULL,
  scoreTopChoice,
  scoreRecall,
  type Prediction,
} from "../../tests/fixtures/poll-suggestion-corpus.ts";
import { buildEmbedRanker, type RankedCategory } from "./categoryEmbed.mts";

const NOW = new Date(2026, 5, 8); // matches the CI test's anchor
const CORPUS = POLL_SUGGESTION_CORPUS_FULL;

// ── Shared precedence harness (mirrors lib/pollSuggestions primary logic) ─────
type CatRanker = (subject: string) => RankedCategory[];
type CatGate = (top: RankedCategory) => boolean;

function decide(raw: string, rankCats: CatRanker, gate: CatGate): Prediction {
  const { subject } = parseForContext(raw);
  if (parseOptionsFromText(subject).length >= 2) return { kind: "options" };
  if (startsWithYesNoStem(raw)) return { kind: "yes_no" };
  const top = rankCats(subject)[0];
  if (top && gate(top)) return { kind: "category", category: top.value };
  if (parseTemporal(raw, NOW).length > 0) return { kind: "time" };
  return { kind: "custom" };
}

// keyword ranker → only score>0 entries (so top exists iff a keyword matched)
const kwRank: CatRanker = (s) => rankCategories(s);
const alwaysGate: CatGate = () => true;

// ── Validate the harness reproduces the REAL planner (zero port divergence) ───
const normKind = (p: { kind: string; category?: string | null }) =>
  p.kind === "category" ? `category:${p.category}` : p.kind;

function validateHarness(): void {
  let mismatches = 0;
  for (const c of CORPUS) {
    const mine = decide(c.text, kwRank, alwaysGate);
    const real = primarySuggestion(c.text, { now: NOW })!;
    if (normKind(mine) !== normKind(real)) {
      mismatches++;
      if (mismatches <= 8) console.log(`  ✗ harness≠planner "${c.text}": ${normKind(mine)} vs ${normKind(real)}`);
    }
  }
  console.log(mismatches === 0
    ? `✓ keyword harness reproduces the real planner on all ${CORPUS.length} cases`
    : `⚠ ${mismatches} harness/planner mismatches (baseline numbers below use the harness)`);
}

// ── Reporting helpers ─────────────────────────────────────────────────────────
const BUCKETS = ["restaurant", "movie", "video_game", "time", "location", "options", "yes_no",
  "temporal", "slang", "typo", "compound", "multilingual"];

function report(label: string, predict: (t: string) => Prediction | null): Record<string, { c: number; t: number }> {
  const r = scoreTopChoice(predict, CORPUS);
  const cells = BUCKETS.map((b) => {
    const x = r.byBucket[b];
    return x ? `${b}:${x.correct}/${x.total}` : `${b}:-`;
  });
  console.log(`${label.padEnd(12)} overall ${(r.rate * 100).toFixed(1)}%  (${r.correct}/${r.total})`);
  console.log(`             ${cells.join("  ")}`);
  return r.byBucket;
}

const pct = (b: Record<string, { correct: number; total: number }>, bucket: string) => {
  const x = b[bucket];
  return x ? (x.correct / x.total) * 100 : NaN;
};

// ── Main ──────────────────────────────────────────────────────────────────────
const modelId = process.argv[2] ?? "Xenova/all-MiniLM-L6-v2";
const agg = (process.argv[3] as "max" | "mean") ?? "max";
const queryPrefix = process.argv[4] ?? "";

console.log(`\n=== Poll-classify embedding bench ===`);
console.log(`model=${modelId} agg=${agg} prefix=${JSON.stringify(queryPrefix)} corpus=${CORPUS.length}\n`);
validateHarness();

const ranker = await buildEmbedRanker({ modelId, agg, queryPrefix });
console.log(`prototypes embedded (one-off): ${ranker.protoBuildMs} ms\n`);

// Embed every corpus subject once; collect query-embed latencies.
const subjectOf = (raw: string) => parseForContext(raw).subject;
const latencies: number[] = [];
for (const c of CORPUS) {
  const { ms } = await ranker.embedTimed(subjectOf(c.text));
  latencies.push(ms);
}
latencies.sort((a, b) => a - b);
const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
const mean = latencies.reduce((s, x) => s + x, 0) / latencies.length;

// Strategies.
const embedPredict = (T: number) => (raw: string): Prediction =>
  decide(raw, (s) => ranker.rank(s), (top) => top.score >= T);
const hybridPredict = (T: number) => (raw: string): Prediction =>
  decide(raw, (s) => {
    const kw = rankCategories(s);
    return kw.length ? kw : ranker.rank(s);
  }, (top) => {
    // keyword tops carry an integer score (≥1); embed tops carry a cosine (<1).
    return top.score >= 1 || top.score >= T;
  });

console.log("── default-correctness (scoreTopChoice) ─────────────────────────────");
const base = report("baseline", (t) => decide(t, kwRank, alwaysGate));

// Threshold sweep for the pure-embed and hybrid variants.
const THRESHOLDS = agg === "mean" ? [0.18, 0.22, 0.26, 0.30, 0.34, 0.38] : [0.30, 0.34, 0.38, 0.42, 0.46, 0.50];
console.log("\n  embed-only (gated at T):");
let bestEmbed = { T: 0, rate: -1, byBucket: {} as Record<string, { correct: number; total: number }> };
for (const T of THRESHOLDS) {
  const bb = report(`  embed@${T}`, embedPredict(T));
  const overall = Object.values(bb).reduce((a, x) => ({ c: a.c + x.correct, t: a.t + x.total }), { c: 0, t: 0 });
  const rate = overall.c / overall.t;
  if (rate > bestEmbed.rate) bestEmbed = { T, rate, byBucket: bb };
}
console.log("\n  hybrid (keyword first, embed fills the gap):");
let bestHybrid = { T: 0, rate: -1, byBucket: {} as Record<string, { correct: number; total: number }> };
for (const T of THRESHOLDS) {
  const bb = report(` hybrid@${T}`, hybridPredict(T));
  const overall = Object.values(bb).reduce((a, x) => ({ c: a.c + x.correct, t: a.t + x.total }), { c: 0, t: 0 });
  const rate = overall.c / overall.t;
  if (rate > bestHybrid.rate) bestHybrid = { T, rate, byBucket: bb };
}

// ── Recall (intended interpretation appears anywhere in the returned list) ────
// Baseline list = the real planner's rows. AI-augmented = that list PLUS the
// embed top-2 categories (≥T) — the embedder only ADDS rows, never removes, so
// recall can only go up (the "augment, never block" guarantee at the list level).
console.log("\n── recall (scoreRecall) ─────────────────────────────────────────────");
const baseList = (raw: string): Prediction[] => planPollSuggestions(raw, { now: NOW });
const Trec = bestHybrid.T || THRESHOLDS[0];
const augList = (raw: string): Prediction[] => {
  const rows = baseList(raw);
  const subj = subjectOf(raw);
  const extra = ranker.rank(subj).filter((c) => c.score >= Trec).slice(0, 2)
    .map((c): Prediction => ({ kind: "category", category: c.value }));
  return [...rows, ...extra];
};
const recBase = scoreRecall(baseList, CORPUS);
const recAug = scoreRecall(augList, CORPUS);
console.log(`baseline list .......... ${(recBase.rate * 100).toFixed(1)}%  (${recBase.correct}/${recBase.total})`);
console.log(`+embed top-2 (≥${Trec}) ... ${(recAug.rate * 100).toFixed(1)}%  (${recAug.correct}/${recAug.total})  (${recAug.rate >= recBase.rate ? "+" : ""}${((recAug.rate - recBase.rate) * 100).toFixed(1)} pts)`);

// ── Summary ───────────────────────────────────────────────────────────────────
const baseRate = scoreTopChoice((t) => decide(t, kwRank, alwaysGate), CORPUS).rate;
console.log("\n── SUMMARY ──────────────────────────────────────────────────────────");
console.log(`model: ${modelId} (agg=${agg}${queryPrefix ? `, prefix=${JSON.stringify(queryPrefix)}` : ""})`);
console.log(`overall default-correctness:`);
console.log(`  baseline (keyword) ......... ${(baseRate * 100).toFixed(1)}%`);
console.log(`  best embed-only  @T=${bestEmbed.T} ... ${(bestEmbed.rate * 100).toFixed(1)}%  (${bestEmbed.rate >= baseRate ? "+" : ""}${((bestEmbed.rate - baseRate) * 100).toFixed(1)} pts)`);
console.log(`  best hybrid      @T=${bestHybrid.T} ... ${(bestHybrid.rate * 100).toFixed(1)}%  (${bestHybrid.rate >= baseRate ? "+" : ""}${((bestHybrid.rate - baseRate) * 100).toFixed(1)} pts)`);
console.log(`per-bucket lift (hybrid@${bestHybrid.T} vs baseline):`);
for (const b of ["slang", "typo", "compound", "multilingual"]) {
  const lo = pct(base, b), hi = pct(bestHybrid.byBucket, b);
  if (!Number.isNaN(lo)) console.log(`  ${b.padEnd(13)} ${lo.toFixed(0)}% → ${hi.toFixed(0)}%`);
}
console.log(`query-embed latency: p50=${p(0.5)}ms  p95=${p(0.95)}ms  mean=${mean.toFixed(1)}ms  (n=${latencies.length})`);
console.log(`prototype build (one-off, cached): ${ranker.protoBuildMs}ms`);

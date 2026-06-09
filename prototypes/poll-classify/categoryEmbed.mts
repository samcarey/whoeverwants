// Option-A prototype: embedding-similarity CATEGORY ranker.
//
// Precompute embeddings for a handful of PROTOTYPE PHRASES per category, then at
// query time embed the typed subject and cosine-rank categories by best match.
// This is the "augment, never block" category step — a drop-in alternative to
// lib/categoryMatch.ts: rankCategories that classifies by MEANING (so slang /
// novel phrasings / typos / other languages map to a category even with no
// keyword), while every structural detector (options, yes/no, temporal) stays
// the deterministic heuristic. See docs/poll-textbox-followups.md (TODO 2).
//
// Runtime: transformers.js (WASM) — the prod-viable on-device web path. The same
// prototype set works on iOS NLEmbedding and a Mac-mini /api/poll-classify.

import { pipeline } from "@huggingface/transformers";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, ".embed-cache");

// A handful of prototype phrases per category, spanning natural phrasings. The
// ranker is extended by ADDING prototypes here — never by editing keyword lists.
// Prototypes are ENGLISH; a multilingual embedder maps other languages onto them.
export const PROTOTYPES: Record<string, string[]> = {
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

export interface RankedCategory {
  value: string;
  score: number;
}

export interface EmbedRanker {
  /** Cosine-rank categories for a subject, strongest first (every category gets
   *  a score; threshold/gate at the call site). */
  rank(subject: string): RankedCategory[];
  /** Embed one query, returning the unit vector + elapsed ms (for latency). */
  embedTimed(text: string): Promise<{ vec: number[]; ms: number }>;
  modelId: string;
  /** ms it took to embed every prototype at build time (one-off cost). */
  protoBuildMs: number;
}

const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function cacheKey(modelId: string, phrases: string[]): string {
  const h = createHash("sha1").update(modelId + "\n" + phrases.join("\n")).digest("hex").slice(0, 16);
  return join(CACHE_DIR, `${modelId.replace(/[^a-z0-9]+/gi, "_")}-${h}.json`);
}

/**
 * Build the embedding ranker. Loads the model once, embeds (and disk-caches) the
 * prototype phrases, and returns a synchronous `rank()` over precomputed vectors
 * plus an async `embedTimed()` for query latency measurement.
 *
 * `agg` controls how a category's prototype similarities collapse to one score:
 *   "max"  — best-matching prototype wins (good for diverse phrasings)
 *   "mean" — average match (smoother, less spiky)
 */
export async function buildEmbedRanker(opts: {
  modelId?: string;
  dtype?: "fp32" | "q8";
  agg?: "max" | "mean";
  queryPrefix?: string; // e.g. bge models want "query: "
} = {}): Promise<EmbedRanker> {
  const modelId = opts.modelId ?? "Xenova/all-MiniLM-L6-v2";
  const agg = opts.agg ?? "max";
  const prefix = opts.queryPrefix ?? "";
  const extractor = await pipeline("feature-extraction", modelId, { dtype: opts.dtype ?? "q8" });

  const embed = async (texts: string[]): Promise<number[][]> => {
    const out = await extractor(texts.map((t) => prefix + t), { pooling: "mean", normalize: true });
    return out.tolist() as number[][];
  };

  // Embed prototypes (cached on disk so reruns are instant).
  const flat: string[] = [];
  const owner: string[] = [];
  for (const [value, phrases] of Object.entries(PROTOTYPES)) {
    for (const p of phrases) {
      flat.push(p);
      owner.push(value);
    }
  }
  const ck = cacheKey(modelId + "|" + agg, flat);
  let protoVecs: number[][];
  let protoBuildMs = 0;
  if (existsSync(ck)) {
    protoVecs = JSON.parse(readFileSync(ck, "utf8"));
  } else {
    const t0 = Date.now();
    protoVecs = await embed(flat);
    protoBuildMs = Date.now() - t0;
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(ck, JSON.stringify(protoVecs));
  }

  const byCat: Record<string, number[][]> = {};
  owner.forEach((v, i) => (byCat[v] ??= []).push(protoVecs[i]));

  const scoreFor = (qv: number[], value: string): number => {
    const vs = byCat[value];
    if (agg === "mean") return vs.reduce((s, pv) => s + dot(qv, pv), 0) / vs.length;
    let best = -Infinity;
    for (const pv of vs) best = Math.max(best, dot(qv, pv));
    return best;
  };

  // Synchronous rank requires a query vector; we expose embedTimed for the async
  // embed and keep a tiny LRU of recent query vectors so rank() can be sync in a
  // batch loop (the bench embeds first, then ranks).
  const qcache = new Map<string, number[]>();
  const rank = (subject: string): RankedCategory[] => {
    const qv = qcache.get(subject);
    if (!qv) throw new Error(`rank() called before embedding "${subject}" — call embedTimed first`);
    return Object.keys(PROTOTYPES)
      .map((value) => ({ value, score: scoreFor(qv, value) }))
      .sort((a, b) => b.score - a.score);
  };

  const embedTimed = async (text: string) => {
    const t0 = Date.now();
    const [v] = await embed([text]);
    const ms = Date.now() - t0;
    qcache.set(text, v);
    return { vec: v, ms };
  };

  return { rank, embedTimed, modelId, protoBuildMs };
}

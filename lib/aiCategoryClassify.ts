// On-device embedding CATEGORY classifier — the "augment, never block" layer over
// the deterministic keyword matcher (lib/categoryMatch.ts). Embeds the typed
// subject and cosine-ranks it against prototype phrases (lib/categoryPrototypes.ts)
// to surface a built-in category by MEANING when no keyword matched (slang, typos,
// novel phrasings). A confident result only ADDS a suggestion row in the box — it
// never overrides the heuristic's default. See prototypes/poll-classify/README.md
// for the model comparison + benchmark, and docs/poll-textbox-followups.md (TODO 2).
//
// RUNTIME: transformers.js is loaded LAZILY from a CDN ESM URL (no npm dependency,
// no bundler config — the import is left as a native runtime import). Inference
// runs locally on-device (WASM/CPU in the browser); only the library + model
// BYTES are fetched (and then Cache-API-cached). The typed text never leaves the
// device. The 30 MB model downloads in the background on first use; until it's
// ready, classify() returns null and the box shows the heuristic only.
//
// FAIL-SAFE: every failure path (SSR, disabled host, network/model error, timeout,
// still-loading) returns null → the planner merge is a no-op → the box behaves
// exactly as it does today. Nothing here can break the box.

import {
  AI_CATEGORY_MODEL_ID,
  AI_CATEGORY_DTYPE,
  AI_CATEGORY_MIN_SCORE,
  CATEGORY_PROTOTYPES,
} from "./categoryPrototypes";

// Pinned to the version benchmarked in prototypes/poll-classify (4.2.0). jsdelivr
// serves the bundled ESM; the magic comments keep webpack AND turbopack from
// trying to resolve/bundle it (it has Node-only deps that would choke the client
// build) — it stays a native runtime import.
const TRANSFORMERS_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm";

// Import the library at runtime from the CDN. The arg is a VARIABLE (not a string
// literal) so TS doesn't error on the unresolvable URL module; the magic comments
// tell webpack AND turbopack to skip it so it stays a native runtime import (its
// Node-only deps would otherwise break the client build). Returned as `unknown`
// and narrowed by the caller's cast.
function importTransformers(): Promise<unknown> {
  const url = TRANSFORMERS_CDN_URL;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

// classify() AWAITS the model load (the box consumes it fully async — debounced +
// latest-wins — so this never blocks the UI). The timeout only guards a dead/very
// slow network; the ~30 MB load is a few seconds on first use, then cached. A
// not-ready return is NOT cached, so the single per-query call still resolves once
// the (warm-started) model finishes loading, as long as the query hasn't changed.
const MODEL_LOAD_TIMEOUT_MS = 60_000;
const INFER_TIMEOUT_MS = 1200; // safety cap on a single query embed (warm inference is ~tens of ms)
const QUERY_CACHE_MAX = 200;

export interface AiCategory {
  category: string;
  score: number;
}

/**
 * Rollout gate. Enabled only in the browser AND only on dev / canary hosts for
 * now — prod (whoeverwants.com) stays off until real on-device latency + the
 * 30 MB first-load cost are validated on canary. Flip the prod host in here to
 * enable it everywhere (it's already fail-safe).
 */
export function isAiCategoryClassifyEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".dev.whoeverwants.com") ||
    h === "latest.whoeverwants.com"
  );
}

// ── Lazy model + prototype embeddings ─────────────────────────────────────────
type Extractor = (texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
interface Ready {
  extractor: Extractor;
  /** category value → its prototype unit vectors */
  protoByCat: Record<string, number[][]>;
}

let readyPromise: Promise<Ready> | null = null;

async function loadEverything(): Promise<Ready> {
  const mod = await importTransformers();
  const { pipeline, env } = mod as {
    pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Extractor>;
    env: { allowLocalModels?: boolean; allowRemoteModels?: boolean; backends?: { onnx?: { wasm?: { numThreads?: number } } } };
  };
  // No local model files ship with the app; fetch from the Hub (Cache-API-cached).
  if (env) {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    // Single-threaded WASM avoids the SharedArrayBuffer / cross-origin-isolation
    // requirement that iOS WebViews usually can't satisfy. Costs a little latency.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
  }
  const extractor = await pipeline("feature-extraction", AI_CATEGORY_MODEL_ID, { dtype: AI_CATEGORY_DTYPE });

  // Embed the prototype phrases once (unit vectors, mean-pooled), keyed by category.
  const flat: string[] = [];
  const owner: string[] = [];
  for (const [cat, phrases] of Object.entries(CATEGORY_PROTOTYPES)) {
    for (const p of phrases) {
      flat.push(p);
      owner.push(cat);
    }
  }
  const out = await extractor(flat, { pooling: "mean", normalize: true });
  const vecs = out.tolist();
  const protoByCat: Record<string, number[][]> = {};
  owner.forEach((cat, i) => (protoByCat[cat] ??= []).push(vecs[i]));
  return { extractor, protoByCat };
}

function ensureReady(): Promise<Ready> {
  return (readyPromise ??= loadEverything().catch((e) => {
    // Reset so a later attempt can retry (e.g. transient network), but don't throw
    // out of the singleton — callers race against it and treat reject as "no AI".
    readyPromise = null;
    throw e;
  }));
}

/** Kick off the (one-off, ~30 MB) model load in the background. Call when the box
 *  gains focus so the model is likely ready by the time the user pauses typing. */
export function warmAiCategoryClassifier(): void {
  if (!isAiCategoryClassifyEnabled()) return;
  void ensureReady().catch(() => {});
}

// ── Query classification ──────────────────────────────────────────────────────
const dot = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const queryCache = new Map<string, AiCategory | null>();
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Classify a typed subject to a built-in category by embedding similarity, or
 * null. Returns null fast (no block) while the model is still loading, and on any
 * failure. Results are cached by normalized query. The score is the best cosine
 * to any of the category's prototypes; only ≥ AI_CATEGORY_MIN_SCORE is returned.
 */
export async function classifyCategory(subject: string): Promise<AiCategory | null> {
  if (!isAiCategoryClassifyEnabled()) return null;
  const key = norm(subject);
  if (!key) return null;
  if (queryCache.has(key)) return queryCache.get(key)!;

  // Await the model load (non-blocking for the box — see MODEL_LOAD_TIMEOUT_MS).
  // The not-ready/timeout path returns null WITHOUT caching, so a later call can
  // still succeed once the model is up.
  const ready = await withTimeout(ensureReady(), MODEL_LOAD_TIMEOUT_MS);
  if (!ready) return null;

  const embedded = await withTimeout(
    ready.extractor([key], { pooling: "mean", normalize: true }).then((o) => o.tolist()[0]),
    INFER_TIMEOUT_MS,
  );
  if (!embedded) return null;

  let best: AiCategory | null = null;
  for (const [cat, protos] of Object.entries(ready.protoByCat)) {
    let s = -Infinity;
    for (const pv of protos) s = Math.max(s, dot(embedded, pv));
    if (!best || s > best.score) best = { category: cat, score: s };
  }
  const result = best && best.score >= AI_CATEGORY_MIN_SCORE ? best : null;

  if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value!);
  queryCache.set(key, result);
  return result;
}

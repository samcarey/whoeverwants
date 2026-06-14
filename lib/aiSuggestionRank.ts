// Real-time fine-tuning of the AI poll-suggestion list against the typed query,
// using the SAME on-device embedding model as lib/aiCategoryClassify. As the user
// types in the new-poll box, the cached structured suggestions (predicted next
// polls from the server LLM) are re-ranked + filtered by cosine similarity to
// what they're typing — so a relevant prediction floats up and an irrelevant one
// drops out, without another server round-trip.
//
// FAIL-SAFE: every path returns null on failure (SSR, disabled host, model not
// loaded, error) → the box falls back to server order + token filtering. Nothing
// here can break the box.

import { cosine, embedTexts, isAiCategoryClassifyEnabled } from "./aiCategoryClassify";

// Candidate (suggestion title) embeddings are cached by text so re-ranking on
// each keystroke only re-embeds the (changing) query, not the stable candidates.
const candidateCache = new Map<string, number[]>();
const CANDIDATE_CACHE_MAX = 300;

/**
 * Cosine similarity of `query` to each candidate in `texts`, aligned to `texts`,
 * or null on any failure / when the model isn't available. Embeds the query plus
 * any not-yet-cached candidates in ONE batch.
 */
export async function scoreSuggestions(
  query: string,
  texts: string[],
): Promise<number[] | null> {
  if (!isAiCategoryClassifyEnabled() || !query.trim() || texts.length === 0) return null;

  const need = texts.filter((t) => t && !candidateCache.has(t));
  const batch = [query, ...need];
  const vecs = await embedTexts(batch);
  if (!vecs || vecs.length !== batch.length) return null;

  const queryVec = vecs[0];
  need.forEach((t, i) => {
    if (candidateCache.size >= CANDIDATE_CACHE_MAX) {
      const oldest = candidateCache.keys().next().value;
      if (oldest !== undefined) candidateCache.delete(oldest);
    }
    candidateCache.set(t, vecs[i + 1]);
  });

  return texts.map((t) => {
    const cv = candidateCache.get(t);
    return cv ? cosine(queryVec, cv) : 0;
  });
}

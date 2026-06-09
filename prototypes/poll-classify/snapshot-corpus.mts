// Snapshot the labeled corpus (core + long-tail) to JSON so a Python / Mac-mini
// eval (sentence-transformers, llama.cpp) can grade against the SAME data without
// the TS toolchain. The TS fixture stays the source of truth; this is a mirror.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  POLL_SUGGESTION_CORPUS,
  POLL_SUGGESTION_LONGTAIL,
  POLL_SUGGESTION_CORPUS_FULL,
} from "../../tests/fixtures/poll-suggestion-corpus.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = {
  generatedFrom: "tests/fixtures/poll-suggestion-corpus.ts",
  counts: {
    core: POLL_SUGGESTION_CORPUS.length,
    longtail: POLL_SUGGESTION_LONGTAIL.length,
    full: POLL_SUGGESTION_CORPUS_FULL.length,
  },
  cases: POLL_SUGGESTION_CORPUS_FULL,
};
const path = join(HERE, "corpus.json");
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`wrote ${path}: core=${out.counts.core} longtail=${out.counts.longtail} full=${out.counts.full}`);

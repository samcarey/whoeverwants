/**
 * Server-side helper for resolving the backend API base URL from a Next.js
 * server component (e.g. inside `generateMetadata`).
 *
 * Mirrors `getApiRewriteDestination()` in `next.config.ts`:
 *   - Production / Vercel + `main`/`master` → `https://api.whoeverwants.com`
 *   - Production / Vercel + feature branch  → `https://<slug>.api.whoeverwants.com`
 *   - Local / dev server                    → `$PYTHON_API_URL` or `http://localhost:8000`
 *
 * Server components can't go through the Next.js `/api/*` rewrites — those
 * are configured for the client-side runtime — so we always need the
 * absolute backend origin.
 */

import { branchToSlug } from "./slug";

export function getServerApiBaseUrl(): string {
  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    if (branch && branch !== "main" && branch !== "master") {
      return `https://${branchToSlug(branch)}.api.whoeverwants.com`;
    }
    return "https://api.whoeverwants.com";
  }
  return process.env.PYTHON_API_URL || "http://localhost:8000";
}

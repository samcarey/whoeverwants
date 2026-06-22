import type { NextConfig } from "next";
import { branchToSlug } from "./lib/slug";

// Default backend API origin (production / branch previews). Latest-tier
// routing is layered on top via host-conditional rewrites — see
// `latestRewriteRules` below.
function getApiRewriteDestination(): string {
  const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    if (branch && branch !== 'main' && branch !== 'master') {
      return `https://${branchToSlug(branch)}.api.whoeverwants.com`;
    }
    return 'https://api.whoeverwants.com';
  }
  return process.env.PYTHON_API_URL || 'http://localhost:8000';
}

// The "latest" tier (pre-prod canary) lives at latest.whoeverwants.com and is
// fronted by the latest droplet's API at api.latest.whoeverwants.com. Both
// hostnames serve from the same Vercel deployment artifact; the upstream API
// is selected at request time via the `host` header.
const LATEST_HOST = 'latest.whoeverwants.com';
const LATEST_API_DEST = 'https://api.latest.whoeverwants.com';

// Emit the full set of /api/* rewrite rules pointed at `dest`. When `host` is
// passed, the rules only match requests with that Host header (Next.js host
// rewrites are evaluated at request time on Vercel).
function apiRewriteRules(dest: string, host?: string) {
  const has = host ? [{ type: 'host' as const, value: host }] : undefined;
  const paths: Array<[string, string]> = [
    ['/api/questions', '/api/questions'],
    ['/api/questions/', '/api/questions'],
    ['/api/questions/:path*', '/api/questions/:path*'],
    ['/api/polls', '/api/polls'],
    ['/api/polls/', '/api/polls'],
    ['/api/polls/:path*', '/api/polls/:path*'],
    ['/api/groups', '/api/groups'],
    ['/api/groups/', '/api/groups'],
    ['/api/groups/:path*', '/api/groups/:path*'],
    ['/api/users', '/api/users'],
    ['/api/users/', '/api/users'],
    ['/api/users/:path*', '/api/users/:path*'],
    ['/api/notifications', '/api/notifications'],
    ['/api/notifications/', '/api/notifications'],
    ['/api/notifications/:path*', '/api/notifications/:path*'],
    ['/api/auth', '/api/auth'],
    ['/api/auth/', '/api/auth'],
    ['/api/auth/:path*', '/api/auth/:path*'],
    ['/api/search/:path*', '/api/search/:path*'],
    ['/api/showtimes', '/api/showtimes'],
    ['/api/showtimes/', '/api/showtimes'],
    ['/api/showtimes/:path*', '/api/showtimes/:path*'],
    ['/api/client-logs', '/api/client-logs'],
    ['/api/client-logs/', '/api/client-logs'],
  ];
  return paths.map(([source, destPath]) => ({
    source,
    destination: `${dest}${destPath}`,
    ...(has ? { has } : {}),
  }));
}

const nextConfig: NextConfig = {
  trailingSlash: true,
  // Move the Next.js dev indicator (the "N" build-status logo) to the
  // top-left corner.
  // Dev-only — has no effect in the Vercel production build.
  devIndicators: {
    position: "top-left",
  },
  // Prevent trailingSlash from issuing 308 redirects on API routes.
  // Rewrites handle the proxy; the redirect breaks POST request bodies.
  skipTrailingSlashRedirect: true,
  images: {
    unoptimized: true,
  },

  // Allow dev server HMR WebSocket connections from proxy domains
  allowedDevOrigins: ['*.dev.whoeverwants.com'],

  // Expose Vercel's git info to the client for preview API URL derivation and commit info.
  // Vercel sets VERCEL_GIT_COMMIT_* (no NEXT_PUBLIC_ prefix); dev servers set the prefixed versions directly.
  env: {
    NEXT_PUBLIC_VERCEL_GIT_BRANCH: process.env.VERCEL_GIT_COMMIT_REF || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || '',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || '',
  },

};

if (process.env.NEXT_OUTPUT === 'standalone') {
  // Docker production build: standalone output for minimal image size
  nextConfig.output = 'standalone';
} else {
  const apiDest = getApiRewriteDestination();

  // Proxy /api/* to the backend API (same-origin for Safari ITP compatibility).
  // Latest-host rules first so they win over the default rules (Next.js
  // evaluates rewrites top-to-bottom). API rewrites live in `beforeFiles` so
  // they take priority over the trailingSlash redirect (which otherwise 308s
  // API POST requests and drops the body).
  nextConfig.rewrites = async () => ({
    beforeFiles: [
      // latest.whoeverwants.com → api.latest.whoeverwants.com
      ...apiRewriteRules(LATEST_API_DEST, LATEST_HOST),
      // Default (whoeverwants.com + branch previews) → existing logic
      ...apiRewriteRules(apiDest),
    ],
    afterFiles: [],
    fallback: [],
  });

  // Headers for tunnel compatibility and environment-specific caching
  // (not supported with static export)
  nextConfig.headers = async () => {
    const isDev = process.env.NODE_ENV === 'development';
    const pageCache = isDev
      ? 'no-cache, no-store, must-revalidate, max-age=0'
      : 'public, max-age=3600, stale-while-revalidate=3600';
    const staticCache = isDev
      ? 'no-cache, no-store, must-revalidate, max-age=0'
      : 'public, max-age=31536000, immutable';

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Forwarded-Proto', value: 'https' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      // Page cache scoped to exclude /api/* and /_next/static/* — those
      // have their own rules below or pass the upstream Cache-Control
      // through (API). /api/* intentionally has NO rule: the upstream
      // FastAPI sets `immutable` on image bytes endpoints, and every
      // other API endpoint is identity-dependent (filtered by
      // X-Browser-Id) or mutation-sensitive — caching by URL alone
      // surfaced as "iOS user creates poll → group page shows empty"
      // because the WKWebView cache pinned the pre-poll `[]` response.
      // Don't reintroduce a blanket `/api/*` Cache-Control without
      // `Vary: X-Browser-Id`, and even then per-browser cache partitions
      // explode to one entry per visitor with no real reuse.
      {
        source: '/((?!api/|_next/static/).*)',
        headers: [{ key: 'Cache-Control', value: pageCache }],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: staticCache },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  };
}

export default nextConfig;

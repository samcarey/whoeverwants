import type { NextConfig } from "next";

// Derive a preview API slug from a git branch name.
// e.g., "claude/fix-voting-bug-abc123" -> "fix-voting-bug-abc123"
function branchToSlug(branch: string): string {
  let slug = branch.replace(/^claude\//, '').toLowerCase();
  slug = slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug.slice(0, 50);
}

// Determine the backend API origin for rewrites.
// - Standalone (Docker dev servers): no rewrites needed
// - Vercel production: proxy to api.whoeverwants.com (avoids cross-origin Safari ITP warnings)
// - Vercel preview: proxy to <slug>.api.whoeverwants.com
// - Local dev: proxy to localhost:8000
function getApiRewriteDestination(): string {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    if (branch && branch !== 'main' && branch !== 'master') {
      return `https://${branchToSlug(branch)}.api.whoeverwants.com`;
    }
    return 'https://api.whoeverwants.com';
  }
  return process.env.PYTHON_API_URL || 'http://localhost:8000';
}

const nextConfig: NextConfig = {
  trailingSlash: true,
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

  // Proxy /api/polls requests to the backend API.
  // In dev: proxies to localhost:8000.
  // On Vercel: proxies to api.whoeverwants.com, making API calls same-origin
  // and avoiding Safari's Advanced Tracking and Fingerprinting Protection warnings.
  nextConfig.rewrites = async () => ({
    beforeFiles: [
      // API rewrites must be in beforeFiles so they take priority over
      // the trailingSlash redirect (which otherwise 308s API POST requests)
      {
        source: '/api/polls',
        destination: `${apiDest}/api/polls`,
      },
      {
        source: '/api/polls/',
        destination: `${apiDest}/api/polls`,
      },
      {
        source: '/api/polls/:path*',
        destination: `${apiDest}/api/polls/:path*`,
      },
    ],
    afterFiles: [],
    fallback: [],
  });

  // Headers for tunnel compatibility and environment-specific caching
  // (not supported with static export)
  nextConfig.headers = async () => {
    const isDev = process.env.NODE_ENV === 'development';

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Forwarded-Proto',
            value: 'https'
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*'
          },
          // Cache control for pages
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-cache, no-store, must-revalidate, max-age=0'
              : 'public, max-age=3600, stale-while-revalidate=3600'
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-cache, no-store, must-revalidate, max-age=0'
              : 'public, max-age=31536000, immutable',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*'
          },
        ],
      },
      // API routes caching
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-cache, no-store, must-revalidate, max-age=0'
              : 'public, max-age=3600, stale-while-revalidate=3600'
          },
        ],
      },
    ];
  };
}

export default nextConfig;

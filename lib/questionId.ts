/**
 * Question identifier helpers.
 *
 * Question IDs appear in two formats in this app:
 *  - UUIDs (e.g. "ce359851-3281-485b-8696-9ed7ccc1ccbe") — the database primary key
 *  - Short IDs (e.g. "2m") — a short base62 handle, used in share URLs
 *
 * Route params and cache lookups accept either, so we need a quick check to
 * decide which API to hit.
 */

/** Heuristic: true if `id` looks like a UUID rather than a short base62 ID.
 *  UUIDs are 36 chars with hyphens; short IDs are short and hyphen-free. */
export function isUuidLike(id: string): boolean {
  return id.length > 10 && id.includes('-');
}

/** Normalize a URL pathname: strip a trailing slash, but keep root `/` as `/`.
 *  Used for comparing pathnames coming from different sources — the app has
 *  `trailingSlash: true`, so `/g/abc` can render at `/g/abc/`. */
export function normalizePath(path: string): string {
  return path.replace(/\/$/, '') || '/';
}

/** If `pathname` is a group page (`/g/<id>` with optional trailing slash),
 *  return the group route ID (root poll's short_id or UUID). Otherwise null. */
export function extractGroupRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/g\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/** True when `pathname` is the top-level group view: the empty placeholder
 *  (`/g` or `/g/`) or a specific group (`/g/<id>`). False for sub-routes like
 *  `/g/<id>/info`. Template uses this to decide which pages get the
 *  group-like layout + new group button. */
export function isGroupRootView(pathname: string): boolean {
  return /^\/g(\/[^/]+)?\/?$/.test(pathname);
}

/** True when `pathname` is a poll detail view: `/g/<groupId>/p/<pollId>`. */
export function isPollDetailView(pathname: string): boolean {
  return /^\/g\/[^/]+\/p\/[^/]+\/?$/.test(pathname);
}

/** True when `url` is exactly `prefix` or starts a complete path segment
 *  / query under it — i.e. `prefix`, `prefix/...`, or `prefix?...`.
 *  Distinguishes from a bare `startsWith(prefix)` which false-positives
 *  on sibling routes that share a string prefix (`/g/~abc` vs `/g/~abcdef`,
 *  or `/g/<id>/info` vs `/g/<id>/info-stats`). */
export function isPathPrefix(url: string, prefix: string): boolean {
  return (
    url === prefix ||
    url.startsWith(`${prefix}/`) ||
    url.startsWith(`${prefix}?`)
  );
}

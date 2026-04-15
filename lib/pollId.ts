/**
 * Poll identifier helpers.
 *
 * Poll IDs appear in two formats in this app:
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
 *  `trailingSlash: true`, so `/thread/abc` can render at `/thread/abc/`. */
export function normalizePath(path: string): string {
  return path.replace(/\/$/, '') || '/';
}

/** If `pathname` is a poll page (`/p/<id>` with optional trailing slash),
 *  return the poll route ID (short_id or UUID). Otherwise null. */
export function extractPollRouteId(pathname: string): string | null {
  const match = pathname.match(/^\/p\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

"use client";

/**
 * Module-level scroll position memory for in-app back navigation.
 *
 * Saved on forward navigation (e.g. tap a group on home, tap a poll card
 * on a group page); read on remount of the destination page so the user
 * lands exactly where they were. Restoration runs synchronously in
 * `useLayoutEffect` before paint, so no scrolling motion is visible
 * after the back gesture completes.
 *
 * Persistence: module scope — survives client-side navigations but
 * resets on hard reload. Entries are overwritten on every save and never
 * expire; the map is bounded by O(distinct keys visited) which stays
 * small for typical sessions.
 *
 * Use `HOME_SCROLL_KEY` for the home page and `groupScrollKey(routeId)`
 * for group pages — those are the two surfaces that participate today.
 */

const positions = new Map<string, number>();

export function rememberScroll(key: string, y: number): void {
  positions.set(key, y);
}

/** Snapshot `window.scrollY` to `key`. SSR-safe no-op. Use at every
 *  nav-away point — keeps callsites a single line and ensures the
 *  typeof-window guard isn't forgotten. */
export function rememberCurrentScroll(key: string): void {
  if (typeof window === "undefined") return;
  rememberScroll(key, window.scrollY);
}

export function getRememberedScroll(key: string): number | undefined {
  return positions.get(key);
}

/** Drop every saved group-page scroll position. Called when the home page
 *  mounts so that returning to home resets all group pages to their default
 *  (bottom) scroll position on re-entry, rather than restoring wherever the
 *  user last left each one. Home and poll-detail keys are untouched. */
export function clearGroupScroll(): void {
  for (const key of positions.keys()) {
    if (key.startsWith(GROUP_SCROLL_PREFIX)) positions.delete(key);
  }
}

export const HOME_SCROLL_KEY = "home";

const GROUP_SCROLL_PREFIX = "group:";

export function groupScrollKey(groupRouteId: string): string {
  return `${GROUP_SCROLL_PREFIX}${groupRouteId}`;
}

export function pollScrollKey(pollShortId: string): string {
  return `poll:${pollShortId}`;
}

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

export const HOME_SCROLL_KEY = "home";

export function groupScrollKey(groupRouteId: string): string {
  return `group:${groupRouteId}`;
}

export function pollScrollKey(pollShortId: string): string {
  return `poll:${pollShortId}`;
}

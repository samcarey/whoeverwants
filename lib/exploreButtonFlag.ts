"use client";

/**
 * "Explore Button" experimental flag.
 *
 * Surfaced as a toggle in the Experimental tab of the build-info modal
 * (long-press the home title). When ON it appends a persistent `?explore=1`
 * URL parameter that is re-applied on every navigation (the param is the
 * source of truth for whether the upper-right Explore globe renders). When
 * OFF the param is stripped everywhere and the globe is hidden.
 *
 * The intent is stored in localStorage so it survives reloads and so the URL
 * param can be re-appended after a route change strips it; the param presence
 * is what the template reads to decide visibility.
 */

export const EXPLORE_PARAM = "explore";
const STORAGE_KEY = "whoeverwants_explore_button";

/** Fired whenever the stored intent OR the URL param presence changes, so the
 *  modal toggle and the template's globe-visibility both stay in sync. */
export const EXPLORE_BUTTON_CHANGED_EVENT = "explore-button-changed";

/** The user's stored intent (drives URL-param re-appending across navigation). */
export function isExploreButtonEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

/** Whether the current URL carries the explore param — the visibility source. */
export function exploreParamPresent(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has(EXPLORE_PARAM);
}

/** Persist the intent, sync the URL param, and notify listeners. */
export function setExploreButtonEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) localStorage.setItem(STORAGE_KEY, "1");
  else localStorage.removeItem(STORAGE_KEY);
  syncExploreParam();
}

/**
 * Make the URL's explore param match the stored intent. Called on every
 * navigation (route changes strip the param) and after the toggle flips.
 * Uses `history.replaceState` — the path is unchanged, so this only updates
 * the displayed query string and never feeds Next.js router state.
 */
export function syncExploreParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const enabled = isExploreButtonEnabled();
  const present = url.searchParams.has(EXPLORE_PARAM);
  if (enabled === present) return; // already in sync — no replaceState churn
  if (enabled) url.searchParams.set(EXPLORE_PARAM, "1");
  else url.searchParams.delete(EXPLORE_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(new Event(EXPLORE_BUTTON_CHANGED_EVENT));
}

"use client";

/**
 * "Groups Button" experimental flag — the legacy /groups list's entry point.
 *
 * The upper-right home button now opens /contacts; the old group-list page
 * is reachable only through this toggle in the Experimental tab of the
 * build-info modal (long-press the home title). Mirrors exploreButtonFlag
 * exactly: localStorage stores the intent, a persistent `?groups=1` URL
 * param (re-applied on every navigation) is what the template reads for
 * visibility.
 */

const GROUPS_PARAM = "groups";
const STORAGE_KEY = "whoeverwants_groups_button";

export const GROUPS_BUTTON_CHANGED_EVENT = "groups-button-changed";

export function isGroupsButtonEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function groupsParamPresent(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has(GROUPS_PARAM);
}

export function setGroupsButtonEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) localStorage.setItem(STORAGE_KEY, "1");
  else localStorage.removeItem(STORAGE_KEY);
  syncGroupsParam();
}

export function syncGroupsParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const enabled = isGroupsButtonEnabled();
  const present = url.searchParams.has(GROUPS_PARAM);
  if (enabled === present) return;
  if (enabled) url.searchParams.set(GROUPS_PARAM, "1");
  else url.searchParams.delete(GROUPS_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(new Event(GROUPS_BUTTON_CHANGED_EVENT));
}

"use client";

/**
 * Module-level memory for the active follow/ignore tab (To Do · New · Old)
 * on each group page.
 *
 * The group page's `selectedTab` is component-local state, so it resets to
 * the default (To Do when any, else New) every time `GroupContent` remounts
 * — which happens on every poll-detail round-trip (tap a card → back). This
 * map persists the user's tap across that navigation, keyed by the group's
 * route id, and is cleared when the home page mounts so returning to the
 * main list resets every group to its default tab on re-entry.
 *
 * Same lifecycle + persistence model as `lib/scrollMemory.ts`: module scope
 * survives client-side navigations, resets on hard reload, never expires.
 */

import type { PollTab } from "@/lib/followState";

const tabs = new Map<string, PollTab>();

export function rememberGroupTab(groupRouteId: string, tab: PollTab): void {
  tabs.set(groupRouteId, tab);
}

export function getRememberedGroupTab(groupRouteId: string): PollTab | undefined {
  return tabs.get(groupRouteId);
}

/** Drop every saved group tab. Called when the home page mounts so returning
 *  to home resets all group pages to their default tab on re-entry. */
export function clearGroupTabs(): void {
  tabs.clear();
}

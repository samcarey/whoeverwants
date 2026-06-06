"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny module-level store recording the route id of the most recently
 * LOADED-WITH-ACCESS group. Drives whether the floating create-poll search
 * bar is shown on a `/g/<id>` page: the bar must NOT appear on the "Private
 * Group / you don't have access" wall (a non-member must not be invited to
 * create a poll in a group they can't see).
 *
 * Default = nothing granted, so a `/g/<id>` page hides the bar UNTIL the
 * group page confirms access by calling `setGroupAccessGranted(routeId)`.
 * That means:
 *   - member group → granted → bar shows.
 *   - no-access wall / loading → never granted → bar hidden.
 *   - navigating granted-group A → wall-group B → the stored id is still A,
 *     so /g/B doesn't match → hidden (no stale bar, no flash).
 *
 * Mirrors the `useIsSlideOverlayGroupActive` / `useHomeBackdropActive`
 * module-store pattern. There is deliberately NO cleanup on unmount: the
 * slide-overlay handoff briefly double-mounts GroupContent for the same
 * group, and an unmount reset would clobber the still-active instance's
 * grant (same foot-gun as the `data-group-id` "no removeAttribute" rule).
 * Staleness is handled by the route-id match instead.
 */
let grantedRouteId: string | null = null;
const listeners = new Set<() => void>();

export function setGroupAccessGranted(routeId: string): void {
  if (grantedRouteId === routeId) return;
  grantedRouteId = routeId;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** True iff the granted group matches `routeId` (the `/g/<routeId>` path id).
 *  Returns false for null / mismatched ids, so the bar stays hidden on the
 *  no-access wall + during the brief load before access is confirmed. */
export function useGroupAccessGranted(routeId: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => routeId != null && grantedRouteId === routeId,
    () => false,
  );
}

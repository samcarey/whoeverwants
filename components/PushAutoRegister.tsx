"use client";

import { useEffect } from "react";

import { bootstrapCapacitorPushSubscription, refreshAppBadge } from "@/lib/pushNotifications";
import { BADGE_SETTINGS_CHANGED_EVENT } from "@/lib/badgeSettings";
import { SESSION_CHANGED_EVENT } from "@/lib/session";
import { installSwMessageBridge } from "@/lib/swMessages";

/**
 * Bootstraps push notifications on Capacitor iOS:
 *
 *   * If iOS permission is already 'granted', silently registers the
 *     device's APNS token with the server (keeps the subscription row
 *     alive across dev-DB resets, app reinstalls, and token rotation).
 *
 *   * If iOS permission has never been decided ('prompt'), triggers the
 *     system dialog ONCE per install (guarded by a localStorage flag so
 *     a dismissed prompt doesn't re-fire on every launch). This matches
 *     the iOS messaging-app convention of "ask at launch, deliver by
 *     default" and saves users from having to discover the per-group
 *     toggle to enable push.
 *
 *   * On 'denied' / 'prompt-with-rationale' / 'na': no-op.
 *
 * Inert on web / PWA — the helper short-circuits there.
 *
 * Mounted from `app/layout.tsx` (not template) so the effect runs once
 * per page load and survives client-side navigation.
 */
export function PushAutoRegister() {
  useEffect(() => {
    // Re-dispatch service worker postMessages as window CustomEvents so
    // JoinRequestsSection / GroupNotFound can refresh on push arrival
    // without each component duplicating the navigator.serviceWorker
    // listener boilerplate. Idempotent — safe to call on every mount.
    installSwMessageBridge();
    void bootstrapCapacitorPushSubscription();
    // Recompute the true app-icon badge whenever the app is opened or
    // refocused, or when the badge model / sign-in state changes — so the
    // badge reflects the user's unread/to-do choice and self-corrects after
    // they act on another device. Works on web / PWA (Badging API) AND native
    // iOS (AppBadgePlugin) — the latter is what clears a stale icon badge for a
    // signed-out / no-group user whose true count is 0.
    const resync = () => void refreshAppBadge();
    resync();
    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", resync);
    window.addEventListener(BADGE_SETTINGS_CHANGED_EVENT, resync);
    window.addEventListener(SESSION_CHANGED_EVENT, resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", resync);
      window.removeEventListener(BADGE_SETTINGS_CHANGED_EVENT, resync);
      window.removeEventListener(SESSION_CHANGED_EVENT, resync);
    };
  }, []);
  return null;
}

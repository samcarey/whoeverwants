"use client";

import { useEffect } from "react";

import { bootstrapCapacitorPushSubscription, clearAppBadge } from "@/lib/pushNotifications";

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
    void bootstrapCapacitorPushSubscription();
    // Clear the app-icon badge whenever the app is opened or refocused — the
    // user has now seen whatever a close / phase-transition push was flagging.
    clearAppBadge();
    const onVisible = () => {
      if (document.visibilityState === "visible") clearAppBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", clearAppBadge);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", clearAppBadge);
    };
  }, []);
  return null;
}

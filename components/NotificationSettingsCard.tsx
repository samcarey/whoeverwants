/**
 * Notification settings card. Rendered on the group info page below the
 * members roster. One toggle ("Activity") governs every per-group push:
 * new polls, a poll closing, and a poll's suggestion/availability phase
 * ending (voting opening). They share the single `notify_new_poll` pref
 * column server-side — the column name is historical; the toggle covers all
 * three events.
 *
 * Capability gating: the toggle greys out + sits unchecked when the
 * runtime can't receive push notifications (e.g. iOS Safari without
 * PWA install, browsers without `PushManager`, or users who explicitly
 * denied the permission prompt). On supported platforms the toggle's
 * state is sourced from the server (`GET /api/notifications/groups/{id}`).
 * Default behavior server-side is ON for every group the browser is a
 * member of, so a fresh row from the API reads `notify_new_poll: true`
 * regardless of whether a pref row has been written yet.
 *
 * Flipping the toggle on triggers `ensurePushSubscription()` which
 * (a) prompts for permission if needed, (b) registers the push-only
 * service worker at scope `/push/`, (c) calls `pushManager.subscribe`,
 * and (d) POSTs the resulting endpoint + keys to the server. If the
 * user denies permission, we stay off and surface the denial state.
 *
 * Native-iOS fast path: when `iosPermission === "granted"` (typically
 * from the launch-time `bootstrapCapacitorPushSubscription`), we skip
 * the await on `ensurePushSubscription()` and fire it as a background
 * refresh. The APNS `registration` event can take seconds to arrive (or
 * stall up to the 15s timeout), and awaiting it left the switch in a
 * `saving=true` disabled state long enough that users navigated away
 * before the pref save fired — making the toggle look stuck and the
 * setting silently revert. Trust the bootstrap and proceed straight to
 * the per-group pref save.
 */

"use client";

import { useEffect, useState } from "react";

import {
  apiGetGroupNotificationPref,
  apiSetGroupNotificationPref,
  getCachedGroupNotificationPref,
} from "@/lib/api/notifications";
import {
  detectPushCapability,
  ensurePushSubscription,
  getCapacitorPushPermission,
  type CapacitorPushPermission,
  type PushCapability,
} from "@/lib/pushNotifications";
import SliderSwitch from "@/components/SliderSwitch";
import { haptic } from "@/lib/haptics";

interface Props {
  groupRouteId: string;
  className?: string;
}

export default function NotificationSettingsCard({ groupRouteId, className = "mt-6" }: Props) {
  const [capability, setCapability] = useState<PushCapability | null>(null);
  const [iosPermission, setIosPermission] =
    useState<CapacitorPushPermission | null>(null);
  // Seed from the last-resolved pref so the toggle renders at its final
  // position on the FIRST commit (no OFF→ON slide during the transition into
  // /info). Null on a cold cache (first-ever visit); the effect below
  // refetches + corrects on every mount regardless.
  const [enabled, setEnabled] = useState<boolean | null>(() =>
    typeof window === "undefined" ? null : getCachedGroupNotificationPref(groupRouteId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capability detection runs client-side only (touches navigator/
  // window). Initial render uses `null` to avoid hydration mismatch
  // between server and client; the effect fires post-mount.
  useEffect(() => {
    setCapability(detectPushCapability());
  }, []);

  // Probe iOS permission so the toggle's checked display can reflect
  // whether pushes will actually deliver (on iOS the OS-level
  // permission must be granted AND the APNS token registered, neither
  // of which is captured by the server pref alone). Returns 'na' on
  // web/PWA.
  useEffect(() => {
    let cancelled = false;
    void getCapacitorPushPermission().then((value) => {
      if (!cancelled) setIosPermission(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGetGroupNotificationPref(groupRouteId)
      .then((pref) => {
        if (!cancelled) setEnabled(pref.notify_new_poll);
      })
      .catch(() => {
        if (!cancelled) setEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupRouteId]);

  const platformBlocked = capability !== null && !capability.anySupported;
  const webPermissionBlocked = capability?.permissionDenied === true;
  const iosPermissionDenied = iosPermission === "denied";
  const iosPermissionGranted = iosPermission === "granted";
  const permissionBlocked = webPermissionBlocked || iosPermissionDenied;
  // Wait for the iOS probe before letting taps fire — otherwise we'd
  // render a stale "ON" between mount and probe resolving.
  const iosProbePending =
    capability?.capacitorNative === true && iosPermission === null;
  const disabled =
    capability === null ||
    platformBlocked ||
    permissionBlocked ||
    iosProbePending ||
    enabled === null ||
    saving;

  // On iOS, default-ON server pref doesn't deliver unless the OS
  // permission is also granted — force-display OFF in that case rather
  // than misrepresenting the delivery state.
  const iosBlocksDisplay =
    capability?.capacitorNative === true && !iosPermissionGranted;
  const checked =
    !!enabled && !platformBlocked && !permissionBlocked && !iosBlocksDisplay;

  const onToggle = async (next: boolean) => {
    if (disabled) return;
    haptic.medium();
    setError(null);
    setSaving(true);
    // Optimistic flip so the switch tracks the user's intent while the
    // permission prompt and subscription dance happen.
    setEnabled(next);
    try {
      if (next) {
        const alreadyGrantedNative =
          capability?.capacitorNative === true && iosPermissionGranted;
        if (alreadyGrantedNative) {
          // Native-iOS fast path — see file header.
          void ensurePushSubscription().catch(() => {});
        } else {
          const endpoint = await ensurePushSubscription();
          if (capability?.capacitorNative) {
            setIosPermission(endpoint === null ? "denied" : "granted");
          }
          if (endpoint === null) {
            setEnabled(false);
            setCapability(detectPushCapability());
            return;
          }
        }
      }
      await apiSetGroupNotificationPref(groupRouteId, next);
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : "Failed to update notifications");
    } finally {
      setSaving(false);
    }
  };

  const helpText = (() => {
    if (capability === null) return null;
    if (!capability.anySupported) {
      return "Notifications are not supported on this platform.";
    }
    if (capability.permissionDenied) {
      return "Notifications are blocked in your browser settings.";
    }
    if (iosPermissionDenied) {
      return "Notifications are blocked. Enable them in iOS Settings → WhoeverWants → Notifications.";
    }
    if (capability.capacitorNative && !iosPermissionGranted && !iosProbePending) {
      return "Tap to allow push notifications on this device.";
    }
    return null;
  })();

  return (
    <section className={className}>
      <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        Notifications
      </h2>
      <div className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          <div
            className={`flex items-center justify-between gap-3 h-12 ${
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
            onClick={() => { if (!disabled) onToggle(!checked); }}
          >
            <span
              className={`text-base font-normal ${
                disabled ? "text-gray-400 dark:text-gray-500" : ""
              }`}
            >
              Activity
            </span>
            <SliderSwitch
              checked={checked}
              onChange={onToggle}
              disabled={disabled}
              aria-label="Notify me about activity in this group: new polls, a poll closing, or voting opening"
            />
          </div>
        </div>
      </div>
      {(helpText || error) && (
        <p
          className={`px-1 mt-2 text-xs ${
            error
              ? "text-red-600 dark:text-red-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {error ?? helpText}
        </p>
      )}
    </section>
  );
}

/**
 * Notification settings card. Rendered on the group info page below the
 * members roster. Today it holds one toggle ("New Poll"); future
 * notification kinds (votes, suggestions cutoff, etc.) plug into the
 * same divide-y card.
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
 */

"use client";

import { useEffect, useState } from "react";

import {
  apiGetGroupNotificationPref,
  apiSetGroupNotificationPref,
} from "@/lib/api/notifications";
import {
  detectPushCapability,
  ensurePushSubscription,
  getCapacitorPushPermission,
  type CapacitorPushPermission,
  type PushCapability,
} from "@/lib/pushNotifications";
import SliderSwitch from "@/components/SliderSwitch";

interface Props {
  groupRouteId: string;
}

export default function NotificationSettingsCard({ groupRouteId }: Props) {
  const [capability, setCapability] = useState<PushCapability | null>(null);
  const [iosPermission, setIosPermission] =
    useState<CapacitorPushPermission | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
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
    setError(null);
    setSaving(true);
    // Optimistic flip so the switch tracks the user's intent while the
    // permission prompt and subscription dance happen.
    setEnabled(next);
    try {
      if (next) {
        const endpoint = await ensurePushSubscription();
        if (capability?.capacitorNative) {
          // ensurePushSubscription returns the endpoint on grant, null
          // on the iOS permission dialog being declined. Either way the
          // iOS permission state is now definitively decided — skip the
          // IPC re-probe and reflect it directly.
          setIosPermission(endpoint === null ? "denied" : "granted");
        }
        if (endpoint === null) {
          setEnabled(false);
          setCapability(detectPushCapability());
          return;
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
      return "Notifications are not supported on this device.";
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
    <section className="mt-6">
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
              New Poll
            </span>
            <SliderSwitch
              checked={checked}
              onChange={onToggle}
              disabled={disabled}
              aria-label="Notify me when someone creates a new poll in this group"
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

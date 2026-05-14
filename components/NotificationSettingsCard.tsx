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
  type PushCapability,
} from "@/lib/pushNotifications";

interface Props {
  groupRouteId: string;
}

export default function NotificationSettingsCard({ groupRouteId }: Props) {
  const [capability, setCapability] = useState<PushCapability | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capability detection runs client-side only (touches navigator/
  // window). Initial render uses `null` to avoid hydration mismatch
  // between server and client; the effect fires post-mount.
  useEffect(() => {
    setCapability(detectPushCapability());
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

  // Three reasons the toggle can be disabled (in priority order):
  //   1. Platform doesn't support any transport (greyed, off).
  //   2. Platform supports push but user has explicitly denied perm.
  //   3. Save is in flight.
  const platformBlocked = capability !== null && !capability.anySupported;
  const permissionBlocked = capability?.permissionDenied === true;
  const disabled =
    capability === null ||
    platformBlocked ||
    permissionBlocked ||
    enabled === null ||
    saving;

  // Forced-off display state: even if the server has notify_new_poll=true
  // saved for this browser, the local UI shows "off" when the platform
  // can't actually deliver. We don't overwrite the server pref in that
  // case — the user might be opening from a different device with a
  // working transport.
  const checked = !!enabled && !platformBlocked && !permissionBlocked;

  const onToggle = async (next: boolean) => {
    if (disabled) return;
    setError(null);
    setSaving(true);
    // Optimistic flip so the checkbox tracks the user's intent while the
    // permission prompt and subscription dance happen.
    setEnabled(next);
    try {
      if (next) {
        const endpoint = await ensurePushSubscription();
        if (endpoint === null) {
          // Permission denied — reset to off, refresh capability so
          // the UI flips into the "blocked" state.
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
    return null;
  })();

  return (
    <section className="mt-6">
      <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        Notifications
      </h2>
      <div className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          <label
            className={`flex items-center justify-between gap-3 h-12 ${
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <span
              className={`text-base font-normal ${
                disabled ? "text-gray-400 dark:text-gray-500" : ""
              }`}
            >
              New Poll
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onToggle(e.target.checked)}
              disabled={disabled}
              aria-label="Notify me when someone creates a new poll in this group"
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            />
          </label>
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

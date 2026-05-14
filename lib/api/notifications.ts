/**
 * API helpers for push notifications: server-side config (VAPID key +
 * APNS support flag), web-push subscription register/unregister, APNS
 * device-token register/unregister, and per-group preference get/set.
 *
 * These are thin fetch wrappers — the actual subscription dance
 * (permission prompt, Service Worker registration, PushManager.subscribe,
 * Capacitor PushNotifications.register) lives in `lib/pushNotifications.ts`.
 */

import { notificationsFetch, groupFetch } from "./_internal";

export interface NotificationConfig {
  vapid_public_key: string;
  apns_supported: boolean;
}

export interface PushSubscriptionPayload {
  kind: "web_push" | "apns";
  endpoint: string;
  keys?: { p256dh: string; auth: string };
  bundle_id?: string;
  user_agent?: string;
}

export interface GroupNotificationPreference {
  notify_new_poll: boolean;
}

export async function apiGetNotificationConfig(): Promise<NotificationConfig> {
  return notificationsFetch<NotificationConfig>("/config");
}

export async function apiRegisterPushSubscription(
  payload: PushSubscriptionPayload,
): Promise<{ id: string; kind: string; endpoint: string }> {
  return notificationsFetch("/subscriptions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function apiUnregisterPushSubscription(endpoint: string): Promise<void> {
  await notificationsFetch("/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

export async function apiGetGroupNotificationPref(
  routeId: string,
): Promise<GroupNotificationPreference> {
  return notificationsFetch<GroupNotificationPreference>(
    `/groups/${encodeURIComponent(routeId)}`,
  );
}

export async function apiSetGroupNotificationPref(
  routeId: string,
  notify_new_poll: boolean,
): Promise<GroupNotificationPreference> {
  return notificationsFetch<GroupNotificationPreference>(
    `/groups/${encodeURIComponent(routeId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ notify_new_poll }),
    },
  );
}

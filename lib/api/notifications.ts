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

/** The app-icon badge count for the calling browser under `settings`. The
 *  client passes its EFFECTIVE settings (account-synced when signed in, else
 *  localStorage) so anonymous users get the right count too. Used by the
 *  on-focus client-side badge resync. */
export async function apiGetBadgeCount(settings: {
  todoMode: boolean;
  onVotingOpen: boolean;
  onResults: boolean;
}): Promise<number> {
  const qs = new URLSearchParams({
    todo_mode: String(settings.todoMode),
    on_voting_open: String(settings.onVotingOpen),
    on_results: String(settings.onResults),
  });
  const res = await notificationsFetch<{ count: number }>(`/badge?${qs.toString()}`);
  return res?.count ?? 0;
}

// Last-resolved per-group `notify_new_poll` pref, so NotificationSettingsCard
// can seed its toggle SYNCHRONOUSLY on its FIRST commit instead of flashing
// OFF and then sliding ON once the async GET resolves (visible during the
// slide-overlay transition into /info). Bounded LRU like `groupRosterCache`;
// no TTL — the card always refetches on mount and corrects any staleness, the
// seed just prevents the initial-load animation. `getCachedGroupNotificationPref`
// returns null on a cold cache (first-ever visit), where a one-time animation
// is unavoidable.
const PREF_CACHE_MAX = 50;
const groupNotificationPrefCache = new Map<string, boolean>();
function cacheGroupNotificationPref(routeId: string, value: boolean): void {
  groupNotificationPrefCache.delete(routeId); // re-insert at the end (most-recent)
  groupNotificationPrefCache.set(routeId, value);
  if (groupNotificationPrefCache.size > PREF_CACHE_MAX) {
    const oldest = groupNotificationPrefCache.keys().next().value;
    if (oldest !== undefined) groupNotificationPrefCache.delete(oldest);
  }
}
export function getCachedGroupNotificationPref(routeId: string): boolean | null {
  return groupNotificationPrefCache.get(routeId) ?? null;
}

export async function apiGetGroupNotificationPref(
  routeId: string,
): Promise<GroupNotificationPreference> {
  const pref = await notificationsFetch<GroupNotificationPreference>(
    `/groups/${encodeURIComponent(routeId)}`,
  );
  cacheGroupNotificationPref(routeId, pref.notify_new_poll);
  return pref;
}

export async function apiSetGroupNotificationPref(
  routeId: string,
  notify_new_poll: boolean,
): Promise<GroupNotificationPreference> {
  const pref = await notificationsFetch<GroupNotificationPreference>(
    `/groups/${encodeURIComponent(routeId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ notify_new_poll }),
    },
  );
  cacheGroupNotificationPref(routeId, pref.notify_new_poll);
  return pref;
}

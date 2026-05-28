/**
 * Push-notification → window-event bridge.
 *
 * Two transports feed the same pair of window CustomEvents so listeners
 * can subscribe via one `window.addEventListener` pattern regardless of
 * platform:
 *
 *   * **Web / PWA** — `public/sw-push.js` postMessages every open client
 *     on `push` (push arrived) and `notificationclick` (user tapped).
 *     We re-dispatch those messages via `navigator.serviceWorker`.
 *
 *   * **Capacitor native iOS** — the WebView doesn't run our service
 *     worker; pushes route through APNS. The `@capacitor/push-notifications`
 *     plugin fires `pushNotificationReceived` (when a push arrives while
 *     the app is foregrounded) and `pushNotificationActionPerformed`
 *     (when the user taps a banner). We listen for those and dispatch
 *     the SAME window events with a normalized detail shape.
 *
 * The APNS payload puts `url` + `group_id` at the top level (see
 * `services/push.py: _send_apns`); web push puts them inside `data`.
 * Both arrive at the bridge as the same `SwPushReceivedDetail`.
 *
 * Used by:
 *   * `JoinRequestsSection` — refetches the pending list when a
 *     `join-request-*` push lands for its group (handles "creator is
 *     already on /info when a request comes in") OR when the user
 *     taps a notification whose URL equals the current page (so
 *     `client.navigate()` is a no-op and React never remounts the
 *     section).
 *   * `GroupLoadState.GroupNotFound` — reloads the page when a
 *     `member-added-*` push lands for the route id the user is sitting
 *     on (handles "requester is waiting on the GroupNotFound screen
 *     after submitting their request").
 *
 * Bridge installation is idempotent via a module-level flag — repeated
 * `installSwMessageBridge()` calls are no-ops.
 */

import { Capacitor } from "@capacitor/core";

export const SW_PUSH_RECEIVED_EVENT = 'sw:push-received';
export const SW_NOTIFICATION_CLICK_EVENT = 'sw:notification-click';

export interface SwPushReceivedDetail {
  /** Destination URL the notification would navigate to on tap (path
   *  form, e.g. `/g/<short>/info`). Echoes the server payload's `url`. */
  url: string;
  /** Group's `route_for_url` (short_id || uuid), or null when the push
   *  isn't group-scoped. */
  group_id: string | null;
  /** Notification tag (deduplication key), e.g. `join-request-<uuid>`
   *  or `member-added-<group_uuid>`. Listeners discriminate on the
   *  prefix. */
  tag: string | null;
}

export type SwNotificationClickDetail = SwPushReceivedDetail;

let installed = false;

function dispatch(
  eventName: typeof SW_PUSH_RECEIVED_EVENT | typeof SW_NOTIFICATION_CLICK_EVENT,
  detail: SwPushReceivedDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<SwPushReceivedDetail>(eventName, { detail }),
  );
}

function normalizeDetail(data: unknown): SwPushReceivedDetail | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { url?: unknown; group_id?: unknown; tag?: unknown };
  const url = typeof d.url === 'string' ? d.url : null;
  const groupId = typeof d.group_id === 'string' ? d.group_id : null;
  const tag = typeof d.tag === 'string' ? d.tag : null;
  // Demand at least one matchable field so a malformed payload doesn't
  // trigger a refresh / reload on listeners.
  if (!url && !groupId && !tag) return null;
  return { url: url ?? '/', group_id: groupId, tag };
}

function installServiceWorkerBridge(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string } | null | undefined;
    if (!data || typeof data !== 'object') return;
    const detail = normalizeDetail(data);
    if (!detail) return;
    if (data.type === 'whoeverwants-push-received') {
      dispatch(SW_PUSH_RECEIVED_EVENT, detail);
    } else if (data.type === 'whoeverwants-notification-click') {
      dispatch(SW_NOTIFICATION_CLICK_EVENT, detail);
    }
  });
}

async function installCapacitorBridge(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  // Dynamic-import the plugin so web bundles don't pay for it (matches the
  // existing pattern in `lib/pushNotifications.ts`).
  const mod = await import('@capacitor/push-notifications').catch(() => null);
  if (!mod || !mod.PushNotifications) return;
  const PushNotifications = mod.PushNotifications;
  // pushNotificationReceived: app is foregrounded and a push arrives. The
  // notification's `data` field carries our server payload (url, group_id,
  // tag) — same shape as the web push event after `_send_apns` flattens it
  // alongside `aps`. Mirror the web `push-received` event.
  PushNotifications.addListener(
    'pushNotificationReceived',
    (notification: { data?: Record<string, unknown> }) => {
      const detail = normalizeDetail(notification.data ?? null);
      if (!detail) return;
      dispatch(SW_PUSH_RECEIVED_EVENT, detail);
    },
  ).catch(() => {
    // Listener registration failures are non-fatal; the web SW path
    // covers the cross-platform case for any PWA install of the same
    // user account.
  });
  // pushNotificationActionPerformed: the user tapped a banner. The native
  // OS handles the foreground/navigation; we just need to wake any
  // already-mounted React listener for the page they land on.
  PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action: { notification?: { data?: Record<string, unknown> } }) => {
      const detail = normalizeDetail(action.notification?.data ?? null);
      if (!detail) return;
      dispatch(SW_NOTIFICATION_CLICK_EVENT, detail);
    },
  ).catch(() => {});
}

export function installSwMessageBridge(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;
  installServiceWorkerBridge();
  void installCapacitorBridge();
}

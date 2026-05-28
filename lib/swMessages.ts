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
  /** Group's `route_for_url` (short_id when available, else the UUID).
   *  Useful for FE listeners whose viewer is on the canonical URL form. */
  group_id: string | null;
  /** Canonical group UUID. Rides alongside `group_id` so listeners
   *  whose viewer routeId is the UUID form (legacy share, direct hit)
   *  can match against this field — `group_id` would be the short_id
   *  and miss in that case. */
  group_uuid: string | null;
  /** Notification tag (deduplication key), e.g. `join-request-<uuid>`
   *  or `member-added-<group_uuid>`. Listeners discriminate on the
   *  prefix. */
  tag: string | null;
}

export type SwNotificationClickDetail = SwPushReceivedDetail;

// Independent per-transport flags so a synchronous failure in one
// installer doesn't latch the other off forever. Both are module-scope
// (page-lifetime) — see PushAutoRegister for the install site.
let swInstalled = false;
let capacitorInstalled = false;

function normalizeDetail(data: unknown): SwPushReceivedDetail | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    url?: unknown;
    group_id?: unknown;
    group_uuid?: unknown;
    tag?: unknown;
  };
  const url = typeof d.url === 'string' ? d.url : null;
  const groupId = typeof d.group_id === 'string' ? d.group_id : null;
  const groupUuid = typeof d.group_uuid === 'string' ? d.group_uuid : null;
  const tag = typeof d.tag === 'string' ? d.tag : null;
  // Demand at least one matchable field so a malformed payload doesn't
  // trigger a refresh / reload on listeners.
  if (!url && !groupId && !groupUuid && !tag) return null;
  return { url: url ?? '/', group_id: groupId, group_uuid: groupUuid, tag };
}

function installServiceWorkerBridge(): void {
  if (swInstalled) return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string } | null | undefined;
    if (!data || typeof data !== 'object') return;
    const detail = normalizeDetail(data);
    if (!detail) return;
    if (data.type === 'whoeverwants-push-received') {
      window.dispatchEvent(
        new CustomEvent<SwPushReceivedDetail>(SW_PUSH_RECEIVED_EVENT, { detail }),
      );
    } else if (data.type === 'whoeverwants-notification-click') {
      window.dispatchEvent(
        new CustomEvent<SwPushReceivedDetail>(SW_NOTIFICATION_CLICK_EVENT, { detail }),
      );
    }
  });
  swInstalled = true;
}

async function installCapacitorBridge(): Promise<void> {
  if (capacitorInstalled) return;
  if (!Capacitor.isNativePlatform()) return;
  // Dynamic-import the plugin so web bundles don't pay for it (matches the
  // existing pattern in `lib/pushNotifications.ts`).
  const mod = await import('@capacitor/push-notifications').catch(() => null);
  if (!mod || !mod.PushNotifications) return;
  const PushNotifications = mod.PushNotifications;
  // pushNotificationReceived: app is foregrounded and a push arrives. The
  // notification's `data` field carries our server payload — same shape as
  // the web push event after `_send_apns` flattens url/group_id/group_uuid/tag
  // alongside `aps`. Mirror the web `push-received` event.
  PushNotifications.addListener(
    'pushNotificationReceived',
    (notification: { data?: Record<string, unknown> }) => {
      const detail = normalizeDetail(notification.data ?? null);
      if (!detail) return;
      window.dispatchEvent(
        new CustomEvent<SwPushReceivedDetail>(SW_PUSH_RECEIVED_EVENT, { detail }),
      );
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
      window.dispatchEvent(
        new CustomEvent<SwPushReceivedDetail>(SW_NOTIFICATION_CLICK_EVENT, { detail }),
      );
    },
  ).catch(() => {});
  capacitorInstalled = true;
}

export function installSwMessageBridge(): void {
  if (typeof window === 'undefined') return;
  // Each transport guards its own re-install so a failure in one doesn't
  // permanently latch the other off — and a future retry (HMR / mount
  // race) can fall through to the path that hasn't taken yet.
  installServiceWorkerBridge();
  void installCapacitorBridge();
}

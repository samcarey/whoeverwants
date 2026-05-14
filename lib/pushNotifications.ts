/**
 * Push notification subscription management.
 *
 * Two transports are handled here behind one shared API:
 *
 *   * Web Push (browser + PWA + iOS PWA 16.4+) — register `/sw-push.js`
 *     at scope `/push/`, prompt for permission, call
 *     `PushManager.subscribe({applicationServerKey})` with the server's
 *     VAPID public key, and POST the resulting endpoint + keys to
 *     `POST /api/notifications/subscriptions`.
 *
 *   * Capacitor APNS (native iOS) — the Capacitor shell exposes
 *     `@capacitor/push-notifications`; we register a one-shot listener
 *     for the `registration` event, then call `PushNotifications.register()`
 *     which prompts iOS for permission and yields an APNS device token.
 *     The token is POSTed to the same endpoint with kind='apns' and
 *     the iOS bundle id.
 *
 * The push-only service worker is registered at scope `/push/` so it
 * doesn't conflict with the existing caching SWs (`sw.js`/`sw-mobile.js`)
 * at the root scope. Importantly this works on dev servers too, where
 * the root-scope SWs are intentionally unregistered (to avoid stale-
 * cache headaches during rebuilds).
 */

import { Capacitor } from "@capacitor/core";

import {
  apiGetNotificationConfig,
  apiRegisterPushSubscription,
  apiUnregisterPushSubscription,
  type NotificationConfig,
} from "@/lib/api/notifications";

/** Available transports on the current platform/runtime. */
export interface PushCapability {
  /** Whether the user's environment can receive push notifications via
   *  Web Push (Service Worker + PushManager + Notification). */
  webPushSupported: boolean;
  /** Whether the runtime is the Capacitor iOS shell — meaning the FE
   *  will route through the native @capacitor/push-notifications plugin
   *  (APNS) instead of Web Push (which WKWebView blocks). */
  capacitorNative: boolean;
  /** Aggregate: at least one transport is workable. */
  anySupported: boolean;
  /** When false + anySupported is true, the platform supports push but
   *  the user has explicitly denied permission. The UI should show this
   *  distinctly from "platform not supported". */
  permissionDenied: boolean;
}

/** Detect whether the current runtime can receive push notifications.
 *  Runs synchronously, no async calls — safe to call from a useEffect's
 *  initializer or a render path. */
export function detectPushCapability(): PushCapability {
  if (typeof window === "undefined") {
    return {
      webPushSupported: false,
      capacitorNative: false,
      anySupported: false,
      permissionDenied: false,
    };
  }
  const capacitorNative = Capacitor.isNativePlatform();
  const webPushSupported =
    !capacitorNative &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  // The native Capacitor shell always supports push (via the plugin —
  // gated on APNS being server-configured, which we don't know yet here).
  const anySupported = webPushSupported || capacitorNative;
  const permissionDenied =
    webPushSupported &&
    typeof Notification !== "undefined" &&
    Notification.permission === "denied";
  return {
    webPushSupported,
    capacitorNative,
    anySupported,
    permissionDenied,
  };
}

/** Convert a URL-safe base64 string (the VAPID public key from the API)
 *  to a Uint8Array, which is what `applicationServerKey` expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const PUSH_SW_URL = "/sw-push.js";
const PUSH_SW_SCOPE = "/push/";

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

async function getOrRegisterPushSW(): Promise<ServiceWorkerRegistration> {
  if (!registrationPromise) {
    registrationPromise = (async () => {
      // Reuse an existing registration at the push scope, otherwise
      // register fresh. Race-safe because pushManager.subscribe later
      // is itself idempotent (returns the existing subscription when
      // applicationServerKey matches).
      const existing = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
      if (existing) return existing;
      return navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
    })();
    registrationPromise.catch(() => {
      // Reset so a subsequent attempt can retry cleanly.
      registrationPromise = null;
    });
  }
  return registrationPromise;
}

let cachedConfig: NotificationConfig | null = null;

async function getConfig(): Promise<NotificationConfig> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await apiGetNotificationConfig();
  return cachedConfig;
}

/** Subscribe the current browser/device to push if not already, and
 *  POST the subscription to the server. Idempotent: calling twice with
 *  the same browser returns the same endpoint, and the server's
 *  ON CONFLICT keeps a single row.
 *
 *  Returns the endpoint that was registered (or `null` if the user
 *  denied permission). Throws on any other failure (network, SW
 *  registration, etc.) so callers can surface a clear error. */
export async function ensurePushSubscription(): Promise<string | null> {
  const cap = detectPushCapability();
  if (cap.capacitorNative) {
    return ensureCapacitorPushSubscription();
  }
  if (!cap.webPushSupported) {
    throw new Error("Push notifications are not supported on this platform");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    // The browser denied (or the user chose Block). Don't throw — the
    // toggle stays off and the UI shows the denied state.
    return null;
  }

  const config = await getConfig();
  const registration = await getOrRegisterPushSW();
  const appServerKey = urlBase64ToUint8Array(config.vapid_public_key);

  // PushManager.subscribe is idempotent IF the existing subscription's
  // applicationServerKey matches. If the VAPID key changed (e.g. dev
  // DB nuke), getSubscription() returns the stale one — unsubscribe
  // before re-subscribing in that case.
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const existingKey = subscription.options.applicationServerKey;
    const matches =
      existingKey instanceof ArrayBuffer &&
      arrayBuffersEqual(existingKey, appServerKey.buffer);
    if (!matches) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned an incomplete push subscription");
  }

  await apiRegisterPushSubscription({
    kind: "web_push",
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    user_agent: navigator.userAgent,
  });

  return json.endpoint;
}

function arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  return true;
}

/** Native iOS push registration via @capacitor/push-notifications.
 *  Lazily imported so the plugin isn't pulled into the web bundle. */
async function ensureCapacitorPushSubscription(): Promise<string | null> {
  // Dynamic import so the plugin's runtime cost only lands on the
  // Capacitor native bundle. Web bundles include the chunk but never
  // execute it (capacitorNative is false on web).
  const mod = await import("@capacitor/push-notifications").catch(() => null);
  if (!mod || !mod.PushNotifications) {
    throw new Error("Native push plugin is not installed");
  }
  const PushNotifications = mod.PushNotifications;

  let perms = await PushNotifications.checkPermissions();
  if (perms.receive === "prompt" || perms.receive === "prompt-with-rationale") {
    perms = await PushNotifications.requestPermissions();
  }
  if (perms.receive !== "granted") {
    return null;
  }

  // Race the registration event against a 15s timeout. The plugin emits
  // either `registration` (success, .value = token) or `registrationError`.
  const token = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for APNS registration"));
    }, 15000);
    PushNotifications.addListener(
      "registration",
      (registration: { value: string }) => {
        clearTimeout(timeout);
        resolve(registration.value);
      },
    );
    PushNotifications.addListener(
      "registrationError",
      (error: { error: string }) => {
        clearTimeout(timeout);
        reject(new Error(error.error || "APNS registration failed"));
      },
    );
    PushNotifications.register().catch((err: unknown) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Read the bundle id from Capacitor's app info when possible (so
  // dev vs prod builds register against the right APNS topic).
  let bundleId: string | undefined;
  try {
    const appMod = await import("@capacitor/app").catch(() => null);
    if (appMod && appMod.App) {
      const info = await appMod.App.getInfo();
      bundleId = info.id;
    }
  } catch {
    // ignore — bundle_id is optional on the server side
  }

  await apiRegisterPushSubscription({
    kind: "apns",
    endpoint: token,
    bundle_id: bundleId,
    user_agent: navigator.userAgent,
  });

  return token;
}

/** Tear down the current browser's push subscription on this device.
 *  Called when the user toggles every group off OR when they want to
 *  fully revoke. The current per-group toggle UX doesn't fire this
 *  (the row is enough to suppress fan-out for a single group), but the
 *  helper is here for completeness. */
export async function tearDownPushSubscription(): Promise<void> {
  const cap = detectPushCapability();
  if (cap.capacitorNative) {
    // No real "unregister" on iOS — the device token stays valid until
    // the app is uninstalled. We can drop our server-side row though.
    return;
  }
  if (!cap.webPushSupported) return;
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    /* ignore */
  }
  await apiUnregisterPushSubscription(endpoint).catch(() => {});
}

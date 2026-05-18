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

/** iOS notification permission state, mirroring
 *  `@capacitor/push-notifications`'s `PermissionState` plus `'na'` for
 *  the non-Capacitor case. Read via `getCapacitorPushPermission()`. */
export type CapacitorPushPermission =
  | "granted"
  | "prompt"
  | "prompt-with-rationale"
  | "denied"
  | "na";

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
      arrayBuffersEqual(existingKey, appServerKey.buffer as ArrayBuffer);
    if (!matches) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: lib.dom typing for applicationServerKey is BufferSource,
      // but Uint8Array<ArrayBufferLike> doesn't satisfy that union under
      // recent TS. Runtime accepts the Uint8Array exactly.
      applicationServerKey: appServerKey as unknown as BufferSource,
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

/** In-flight dedupe for `ensureCapacitorPushSubscription`. Bootstrap fires
 *  on every layout mount and the per-group toggle fires on tap; without
 *  coalescing they install duplicate APNS listeners, call register()
 *  twice, and POST the same token to the server twice on every overlap. */
let capacitorRegistrationPromise: Promise<string | null> | null = null;

/** Native iOS push registration via @capacitor/push-notifications.
 *  Lazily imported so the plugin isn't pulled into the web bundle. */
async function ensureCapacitorPushSubscription(): Promise<string | null> {
  if (capacitorRegistrationPromise) return capacitorRegistrationPromise;
  capacitorRegistrationPromise = (async () => {
    try {
      return await runCapacitorPushRegistration();
    } finally {
      capacitorRegistrationPromise = null;
    }
  })();
  return capacitorRegistrationPromise;
}

async function runCapacitorPushRegistration(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    console.warn(
      "[push-bootstrap] skipped: Capacitor.isNativePlatform()=false (not running inside the iOS shell)",
    );
    return null;
  }
  // Dynamic import so the plugin's runtime cost only lands on the
  // Capacitor native bundle. Web bundles include the chunk but never
  // execute it (capacitorNative is false on web).
  const mod = await import("@capacitor/push-notifications").catch((err) => {
    console.warn("[push-bootstrap] dynamic import of @capacitor/push-notifications failed", err);
    return null;
  });
  if (!mod || !mod.PushNotifications) {
    throw new Error("Native push plugin is not installed");
  }
  const PushNotifications = mod.PushNotifications;

  let perms = await PushNotifications.checkPermissions();
  if (perms.receive === "prompt" || perms.receive === "prompt-with-rationale") {
    perms = await PushNotifications.requestPermissions();
  }
  if (perms.receive !== "granted") {
    console.warn(
      `[push-bootstrap] permission not granted after requestPermissions: ${perms.receive}`,
    );
    return null;
  }

  // Race the registration event against a 15s timeout. The plugin emits
  // either `registration` (success, .value = token) or `registrationError`.
  // Each `addListener` returns a handle we MUST `.remove()` after the
  // promise settles — otherwise repeated calls (per-launch + per-toggle)
  // pile up listeners that all fire on every subsequent register().
  // Install listeners FIRST (awaiting their handles), THEN trigger
  // register() so the registration event can't fire before the handles
  // are assigned for cleanup.
  type ListenerHandle = { remove: () => Promise<void> };
  let resolveToken: (token: string) => void;
  let rejectToken: (err: Error) => void;
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  const timeout = setTimeout(() => {
    rejectToken(new Error("Timed out waiting for APNS registration"));
  }, 15000);
  let regHandle: ListenerHandle | undefined;
  let errHandle: ListenerHandle | undefined;
  try {
    regHandle = (await PushNotifications.addListener(
      "registration",
      (registration: { value: string }) => {
        clearTimeout(timeout);
        resolveToken(registration.value);
      },
    )) as ListenerHandle;
    errHandle = (await PushNotifications.addListener(
      "registrationError",
      (error: { error: string }) => {
        clearTimeout(timeout);
        rejectToken(new Error(error.error || "APNS registration failed"));
      },
    )) as ListenerHandle;
    PushNotifications.register().catch((err: unknown) => {
      clearTimeout(timeout);
      rejectToken(err instanceof Error ? err : new Error(String(err)));
    });
    const token = await tokenPromise;

    // Read the bundle id from Capacitor's app info when possible (so
    // prod vs `latest` builds register against the right APNS topic).
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

    try {
      await apiRegisterPushSubscription({
        kind: "apns",
        endpoint: token,
        bundle_id: bundleId,
        user_agent: navigator.userAgent,
      });
    } catch (err) {
      console.warn("[push-bootstrap] POST /api/notifications/subscriptions failed", err);
      throw err;
    }

    console.warn(
      `[push-bootstrap] APNS registration succeeded (bundle=${bundleId ?? "?"}, token=${token.slice(0, 8)}…)`,
    );
    return token;
  } finally {
    clearTimeout(timeout);
    await Promise.allSettled([
      regHandle?.remove(),
      errHandle?.remove(),
    ]);
  }
}

/** Probe the Capacitor iOS push permission state without prompting.
 *  Returns 'na' on web / non-native runtimes. The toggle UI calls this
 *  to gate its displayed `checked` state, since on iOS the server-side
 *  default-ON pref can't deliver unless the OS has granted permission
 *  AND the device's APNS token is registered with the server. */
export async function getCapacitorPushPermission(): Promise<CapacitorPushPermission> {
  if (!Capacitor.isNativePlatform()) return "na";
  const mod = await import("@capacitor/push-notifications").catch(() => null);
  if (!mod || !mod.PushNotifications) return "na";
  try {
    const result = await mod.PushNotifications.checkPermissions();
    return result.receive as CapacitorPushPermission;
  } catch {
    return "na";
  }
}

/** Register the device's APNS token with the server, prompting for
 *  permission at app launch if it has never been decided. No-op on
 *  web / PWA. Behavior by current permission state:
 *
 *    'granted'              → silently re-register (idempotent server upsert).
 *                             Keeps the subscription row alive across
 *                             dev-DB resets and APNS token rotation.
 *    'prompt' /             → fall through to `register()`, which iOS
 *    'prompt-with-rationale'  itself rate-limits — the system dialog only
 *                             shows once per install; subsequent calls
 *                             return the cached state. We previously
 *                             gated re-attempts behind a localStorage
 *                             flag, but that left users stranded with no
 *                             subscription when iOS happened to leave
 *                             the state at 'prompt' (e.g. dismissed
 *                             dialog). Letting iOS arbitrate is safer.
 *    'denied' / 'na'        → no-op.
 *
 *  Errors are caught + logged at warn level (forwarded to the canary
 *  log buffer for diagnostics) so this background path stops silently
 *  swallowing failures: the previous bare `catch {}` was hiding the
 *  reason 0/15 group members ever registered. */
export async function bootstrapCapacitorPushSubscription(): Promise<void> {
  let permission: CapacitorPushPermission;
  try {
    permission = await getCapacitorPushPermission();
  } catch (err) {
    console.warn("[push-bootstrap] failed to read permission state", err);
    return;
  }
  if (permission === "na" || permission === "denied") return;
  try {
    const endpoint = await ensureCapacitorPushSubscription();
    if (endpoint === null) {
      console.warn(
        "[push-bootstrap] registration returned null (permission denied or not granted)",
      );
    }
  } catch (err) {
    console.warn("[push-bootstrap] ensureCapacitorPushSubscription threw", err);
  }
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

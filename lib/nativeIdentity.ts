/**
 * Phase 2 of docs/siri-integration-plan.md — native identity bridge (JS half).
 *
 * The WebView keeps the user's identity in localStorage:
 *   - session bearer token  (`lib/session.ts`, key `session_token`)
 *   - browser id            (`lib/browserIdentity.ts`, key `browser_id`)
 *   - display name          (`lib/userProfile.ts`, key `whoeverwants_user_name`)
 * Native Swift can't see any of it. This module mirrors the current triple into
 * the iOS Keychain (via the `NativeIdentity` Capacitor plugin in
 * `ios/App/App/AppDelegate.swift`) so native code — and the future in-process
 * headless-creation App Intent (Phase 3) — can make API calls *as the user*.
 *
 * INERT on web / PWA: every path short-circuits on `!Capacitor.isNativePlatform()`,
 * so there's no native plugin call (and no behavior change) outside the iOS shell.
 *
 * Wiring: instead of sprinkling `setIdentity` calls through `saveSession` /
 * `clearSession` / `persistSignIn` (which would need a lazy-require to dodge the
 * `session.ts ↔ nativeIdentity.ts` import cycle), we subscribe ONCE to
 * `SESSION_CHANGED_EVENT` — which `saveSession`, `clearSession`, and
 * `updateCachedSessionUser` all already dispatch — plus a foreground resync.
 * That single subscription catches every sign-in / sign-out / account-name
 * refresh and reads the live values at event time, with no cycle and no
 * per-callsite plumbing. (A local-only name edit or a first browser-id
 * establishment that doesn't dispatch SESSION_CHANGED is picked up by the
 * focus / visibilitychange resync.)
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { getSessionToken, SESSION_CHANGED_EVENT } from "@/lib/session";
import { getBrowserId } from "@/lib/browserIdentity";
import { getUserName } from "@/lib/userProfile";

interface NativeIdentityPlugin {
  /** Upserts each non-null value; a null / "" value DELETES that key. Pass the
   *  full current triple every call so sign-out (null token + null name, kept
   *  browser id) is expressible in one call. */
  setIdentity(options: {
    token: string | null;
    browserId: string | null;
    name: string | null;
  }): Promise<void>;
  getIdentity(): Promise<{ token?: string; browserId?: string; name?: string }>;
}

let plugin: NativeIdentityPlugin | null = null;
function getPlugin(): NativeIdentityPlugin {
  if (!plugin) plugin = registerPlugin<NativeIdentityPlugin>("NativeIdentity");
  return plugin;
}

// The last triple actually written to the Keychain, serialized. The foreground
// resync fires on BOTH `focus` and `visibilitychange` (often back-to-back on
// iOS) and the identity rarely changes, so without this guard every foreground
// would do 2 × 3 redundant Keychain writes. Skipping unchanged syncs makes the
// duplicate event harmless. Left unset on a failed write so the next call retries.
let lastSynced: string | null = null;

/**
 * Push the current token / browser id / display name into the Keychain.
 * No-op on web / PWA, and a no-op when the triple is unchanged since the last
 * successful write. Best-effort — a failed bridge call leaves localStorage as
 * the source of truth for the WebView; only native consumers degrade.
 */
export async function syncNativeIdentity(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  const payload = {
    token: getSessionToken(),
    browserId: getBrowserId(),
    name: getUserName()?.trim() || null,
  };
  const key = JSON.stringify(payload);
  if (key === lastSynced) return;
  try {
    await getPlugin().setIdentity(payload);
    lastSynced = key;
  } catch {
    // best-effort — leave lastSynced unset so the next call retries.
  }
}

let installed = false;
/**
 * Subscribe to identity changes and keep the Keychain in sync for the app's
 * lifetime. Idempotent (a module-level flag guards re-install across HMR /
 * StrictMode double-mounts, matching `installSwMessageBridge`); no uninstall —
 * mounted once at the layout level. No-op on web / PWA.
 */
export function installNativeIdentitySync(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!Capacitor.isNativePlatform()) return;
  installed = true;
  const sync = () => void syncNativeIdentity();
  sync(); // initial — covers "already signed in at launch" / a token that
  // predates this build shipping the bridge.
  window.addEventListener(SESSION_CHANGED_EVENT, sync);
  // Foreground resync catches a browser id established after mount and any
  // local-only name edit that doesn't route through SESSION_CHANGED.
  window.addEventListener("focus", sync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync();
  });
}

/** Reset module state for tests (the install flag + the value-change guard). */
export function _resetNativeIdentityForTests(): void {
  installed = false;
  lastSynced = null;
}

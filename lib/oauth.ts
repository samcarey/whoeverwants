/**
 * Phase C: OAuth helpers for Apple + Google Sign In.
 *
 * Two surfaces:
 *   1. Web / PWA — both providers load their browser SDKs lazily and
 *      hand us back an ID token from the popup-style flow.
 *   2. Capacitor iOS — Apple AND Google both use the
 *      `@capgo/capacitor-social-login` plugin (Apple drives the system
 *      sign-in sheet via ASAuthorizationController; Google opens the
 *      installed Google app or a SFSafariViewController fallback). The
 *      Google web SDK (`accounts.google.com/gsi/client`) is explicitly
 *      blocked in iOS WebViews — embedded user-agent detection returns
 *      403 `disallowed_useragent` mid-flow — so the native plugin is
 *      the only viable iOS path.
 *
 * Whichever surface produces the token, it's POSTed to the same
 * `/api/auth/oauth/{provider}` endpoint and verified against the
 * provider's JWKS server-side (see `server/services/oauth.py`). Audience
 * notes:
 *   - Apple: server's `APPLE_OAUTH_AUDIENCES` must include the web
 *     Service ID AND each iOS bundle id (com.whoeverwants.app +
 *     com.whoeverwants.app.latest).
 *   - Google: server's `GOOGLE_OAUTH_CLIENT_IDS` must include the web
 *     client ID AND each per-bundle iOS client ID. iOS client IDs are
 *     bound to a specific bundle id at Google Cloud Console create time,
 *     so prod + canary need separate iOS clients (see
 *     `GOOGLE_IOS_CLIENT_IDS` below).
 *
 * Apple Developer prereqs (per bundle id, one-time):
 *   - Enable "Sign In with Apple" capability on the bundle's identifier
 *     in Apple Developer portal → Identifiers → <bundle> → Capabilities.
 *     The entitlement (`com.apple.developer.applesignin`) in
 *     `App.entitlements` compiles without it, but iOS silently rejects
 *     the authorize call.
 *
 * Plugin choice: `@capgo/capacitor-social-login` was picked over the
 * better-known `@capacitor-community/apple-sign-in` because the latter
 * peg-pins `capacitor-swift-pm` to v7.x while `@capacitor/push-notifications@8`
 * pins it to v8.x — SPM rejects the dependency graph at archive time
 * with a "could not resolve" error. capgo is the only mainstream plugin
 * with a Capacitor-8-compatible release (8.x).
 */

import { Capacitor } from "@capacitor/core";

const GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";
const APPLE_JS_SRC =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";
const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_OAUTH_SERVICE_ID || "";

// Per-bundle iOS Google client IDs. Bound to a specific iOS bundle id at
// Google Cloud Console create time — the audience claim Google's JWKS
// verifier sees in the id_token is the iOS client ID (NOT the web one),
// so the server's GOOGLE_OAUTH_CLIENT_IDS allowlist must include all
// three (web + both iOS). Public values (also baked into the iOS binary's
// Info.plist as a CFBundleURLTypes scheme via ios-build.yml); committing
// them in source is fine.
const GOOGLE_IOS_CLIENT_IDS: Record<string, string> = {
  "com.whoeverwants.app":
    "641867957358-r25ftjoihrcam51ca3ilhnl08pl3vhur.apps.googleusercontent.com",
  "com.whoeverwants.app.latest":
    "641867957358-hqpgqhfi9j7hbjpnr7cmkq3c6nfdteph.apps.googleusercontent.com",
};
const GOOGLE_IOS_CLIENT_ID_DEFAULT = GOOGLE_IOS_CLIENT_IDS["com.whoeverwants.app"];

// Module-level in-flight script loader promises so concurrent opens of
// the sign-in modal (e.g. StrictMode double-mount in dev) don't fetch
// the script twice. Lifetime is the page lifetime — the SDK is global.
let googleScriptPromise: Promise<void> | null = null;
let appleScriptPromise: Promise<void> | null = null;

function loadScript(src: string, existingPromise: Promise<void> | null): Promise<void> {
  if (existingPromise) return existingPromise;
  return new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Document is not available"));
      return;
    }
    // The provider's SDK may already be on the page (e.g. from a
    // previous mount). Reuse it.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error(`Failed to load ${src}`)),
          { once: true }
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${src}`)),
      { once: true }
    );
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------------------
// Capability flags (read by the SignInModal to decide which buttons to show)
// ---------------------------------------------------------------------------

/** True when running inside the Capacitor native iOS WebView (NOT in
 *  Safari or PWA standalone mode). Exported so callers can fork between
 *  the web flow and the native plugin flow without re-implementing the
 *  Capacitor probe. SSR-safe — short-circuits to false when window is
 *  unavailable. */
export function isNativeIOS(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Whether Google Sign In is wired up for the current surface.
 *  Native iOS routes through the @capgo/capacitor-social-login plugin
 *  with a per-bundle iOS client ID (see GOOGLE_IOS_CLIENT_IDS); we trust
 *  the build pipeline configured the right one (mirrors Apple's "return
 *  true on native" pattern). Web/PWA require the web client id env var.
 *  Independent of the server-side `providers` endpoint — both must agree
 *  before the button is functional. */
export function googleConfigured(): boolean {
  if (isNativeIOS()) return true;
  return !!GOOGLE_CLIENT_ID;
}

/** Whether Apple Sign In is wired up for the current surface.
 *  Native iOS routes through the @capacitor-community plugin and
 *  needs no env var (the bundle id from `App.getInfo()` is the
 *  client id). Web/PWA needs the Service ID env var. */
export function appleConfigured(): boolean {
  if (isNativeIOS()) return true;
  return !!APPLE_CLIENT_ID;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

type GoogleCredentialResponse = { credential: string };

interface GoogleAccountsIdentity {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  prompt(callback?: (notification: { isNotDisplayed?: () => boolean; isSkippedMoment?: () => boolean }) => void): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      width?: number;
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      shape?: "rectangular" | "pill" | "circle" | "square";
      logo_alignment?: "left" | "center";
    }
  ): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsIdentity;
      };
    };
    AppleID?: {
      auth: {
        init(config: {
          clientId: string;
          scope: string;
          redirectURI: string;
          state?: string;
          usePopup?: boolean;
        }): void;
        signIn(): Promise<{
          authorization: { id_token: string; code: string; state?: string };
          user?: { name?: { firstName?: string; lastName?: string }; email?: string };
        }>;
      };
    };
  }
}

async function ensureGoogleSdk(): Promise<GoogleAccountsIdentity> {
  if (isNativeIOS()) {
    // Hard guard: Google's web SDK 403s with `disallowed_useragent` in
    // WebViews. The native path is `googleNativeSignIn()`; callers must
    // branch before reaching this helper.
    throw new Error(
      "Google web SDK is unavailable in iOS WebView; use googleSignIn() instead."
    );
  }
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google sign-in isn't configured on this client.");
  }
  googleScriptPromise = loadScript(GOOGLE_GSI_SRC, googleScriptPromise);
  await googleScriptPromise;
  if (!window.google?.accounts?.id) {
    throw new Error("Google sign-in failed to initialize.");
  }
  return window.google.accounts.id;
}

// `sdk.initialize` overwrites Google's singleton callback every call,
// so re-initializing per modal-open swaps the credential delivery to
// the new Promise's resolver. Mirror Apple's one-shot init by routing
// every callback through a mutable resolver that's reassigned before
// each renderButton, with init itself called exactly once per page.
let googleInitialized = false;
let googleResolveRef: ((token: string) => void) | null = null;
let googleRejectRef: ((err: Error) => void) | null = null;

/** Render the Google "Sign in with Google" button into a container.
 *
 *  The button itself is rendered by Google's SDK — required by their
 *  branding guidelines for the official credential flow. We can't
 *  substitute our own button without falling back to One Tap (which
 *  is unreliable across browsers). Caller supplies the host element;
 *  we initialize the SDK with our client_id and a callback that
 *  resolves a Promise with the credential id_token.
 *
 *  Returns a Promise<string> that resolves with the id_token, or
 *  rejects if the SDK fails to load. The Promise stays pending until
 *  the user actually completes the flow (or never resolves if they
 *  close the popup — caller times out or unmounts).
 */
export async function renderGoogleButton(
  container: HTMLElement,
  theme: "light" | "dark"
): Promise<string> {
  const sdk = await ensureGoogleSdk();
  // Reject any previous still-pending promise so the new caller's
  // resolver is the only one Google's callback delivers to.
  googleRejectRef?.(new Error("Sign-in superseded"));
  return new Promise<string>((resolve, reject) => {
    googleResolveRef = resolve;
    googleRejectRef = reject;
    try {
      if (!googleInitialized) {
        sdk.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: "popup",
          cancel_on_tap_outside: true,
          callback: (response) => {
            const r = googleResolveRef;
            const rej = googleRejectRef;
            googleResolveRef = null;
            googleRejectRef = null;
            if (response?.credential) {
              r?.(response.credential);
            } else {
              rej?.(new Error("Google didn't return a credential."));
            }
          },
        });
        googleInitialized = true;
      }
      sdk.renderButton(container, {
        type: "standard",
        theme: theme === "dark" ? "filled_black" : "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
      });
    } catch (err) {
      googleResolveRef = null;
      googleRejectRef = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ---------------------------------------------------------------------------
// Apple — web
// ---------------------------------------------------------------------------

async function ensureAppleSdk() {
  if (!APPLE_CLIENT_ID) {
    throw new Error("Apple sign-in isn't configured on this client.");
  }
  appleScriptPromise = loadScript(APPLE_JS_SRC, appleScriptPromise);
  await appleScriptPromise;
  if (!window.AppleID?.auth) {
    throw new Error("Apple sign-in failed to initialize.");
  }
  return window.AppleID.auth;
}

let appleInitialized = false;

async function appleWebSignIn(): Promise<string> {
  const sdk = await ensureAppleSdk();
  if (!appleInitialized) {
    sdk.init({
      clientId: APPLE_CLIENT_ID,
      scope: "email",
      // Apple requires the redirect URI to be HTTPS — the popup flow
      // doesn't actually navigate the user there, but the SDK still
      // validates the value.
      redirectURI:
        process.env.NEXT_PUBLIC_APPLE_OAUTH_REDIRECT_URI ||
        (typeof window !== "undefined" ? window.location.origin : ""),
      usePopup: true,
    });
    appleInitialized = true;
  }
  const result = await sdk.signIn();
  const token = result?.authorization?.id_token;
  if (!token) {
    throw new Error("Apple didn't return an ID token.");
  }
  return token;
}

// ---------------------------------------------------------------------------
// Apple — Capacitor native
// ---------------------------------------------------------------------------
//
// Uses `@capgo/capacitor-social-login` which wraps `ASAuthorizationController`
// on iOS and returns the identityToken JWT. Same token shape as the web flow
// — POSTed to `/api/auth/oauth/apple` and verified by the server's JWKS
// pipeline. The audience claim differs:
//   - Web flow: aud = Service ID (e.g. com.whoeverwants.signin).
//   - Native iOS: aud = bundle id (com.whoeverwants.app or .latest).
// `APPLE_OAUTH_AUDIENCES` on the API server must include all three.

// One-shot init: SocialLogin.initialize() can be called repeatedly but
// pays a noticeable round-trip on first call. Memoize the promise so
// concurrent modal opens share it, mirroring the script-loader pattern
// for the web SDKs above.
let appleNativeInitPromise: Promise<void> | null = null;

async function ensureAppleNativeInit(): Promise<void> {
  if (appleNativeInitPromise) return appleNativeInitPromise;
  appleNativeInitPromise = (async () => {
    const mod = await import("@capgo/capacitor-social-login").catch(() => null);
    if (!mod) {
      appleNativeInitPromise = null;
      throw new Error("Apple sign-in plugin failed to load.");
    }
    const { SocialLogin } = mod;
    // The bundle id IS the Apple-issued audience for native flows. Read
    // it at runtime from @capacitor/app so the prod + canary builds
    // (com.whoeverwants.app vs .latest) each send their own value.
    const appMod = await import("@capacitor/app").catch(() => null);
    let clientId = "com.whoeverwants.app";
    if (appMod) {
      try {
        const info = await appMod.App.getInfo();
        if (info?.id) clientId = info.id;
      } catch {
        // Fall back to the prod bundle id; the server's audience list
        // includes both bundles so a missed lookup still verifies.
      }
    }
    await SocialLogin.initialize({
      apple: {
        clientId,
        // The @capgo/capacitor-social-login plugin GETs AND POSTs this URL
        // during initialize() + login() and rejects the whole flow with
        // "Invalid response code: NNN" when it returns non-2xx. The plugin
        // docs claim this field is unused on native iOS, but empirically
        // it is used. The URL must:
        //   1. Live under a Return URL registered on the Apple Service ID
        //      (com.whoeverwants.signin → Configure → Return URLs). Both
        //      `https://whoeverwants.com` and `https://latest.whoeverwants.com`
        //      are registered, so any path under either is fine.
        //   2. Accept both GET AND POST and return 2xx. The bare origin
        //      `/` returns 200 on GET but 405 on POST (Vercel's static page
        //      handler doesn't accept POST). So we need a dedicated route.
        // `/auth/apple/callback` is the Next.js route handler in
        // `app/auth/apple/callback/route.ts` — accepts both methods,
        // returns `{status: "ok"}`. The actual id_token verification
        // happens on `/api/auth/oauth/apple` after the plugin hands the
        // token to our JS, not here.
        redirectUrl:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/apple/callback`
            : "https://whoeverwants.com/auth/apple/callback",
      },
    });
  })().catch((err) => {
    appleNativeInitPromise = null;
    throw err;
  });
  return appleNativeInitPromise;
}

async function appleNativeSignIn(): Promise<string> {
  await ensureAppleNativeInit();
  const mod = await import("@capgo/capacitor-social-login");
  const { SocialLogin } = mod;
  try {
    const res = await SocialLogin.login({
      provider: "apple",
      options: { scopes: ["email"] },
    });
    // capgo plugin returns { provider: 'apple', result: { idToken, ... } }.
    // Older shapes also surfaced the token at `result.profile.token.id_token`
    // — fall through both forms defensively so a minor plugin bump doesn't
    // strand us on a wrong field name.
    // Cast through `unknown` — the plugin's typed `AppleProviderResponse`
    // doesn't have a string index signature, and the defensive fall-
    // through below reads fields that aren't on the typed shape (older
    // plugin versions surfaced the token under `profile.token.id_token`).
    const result = (res as unknown as { result?: Record<string, unknown> })
      ?.result;
    const idToken =
      (result?.idToken as string | undefined) ??
      (
        (result?.profile as { token?: { id_token?: string } } | undefined)
          ?.token?.id_token
      );
    if (!idToken) {
      throw new Error("Apple didn't return an identity token.");
    }
    return idToken;
  } catch (err) {
    // Plugin surfaces user-cancel as a thrown error with various
    // shapes. Re-throw as a recognizable Error so the modal can
    // detect cancel vs failure consistently.
    if (err instanceof Error) throw err;
    throw new Error(typeof err === "string" ? err : "Apple sign-in failed.");
  }
}

/** Trigger Apple's sign-in flow. Native plugin on Capacitor iOS, the
 *  Apple JS SDK popup on web/PWA. Returns the id_token (identityToken
 *  on native) on success, rejects on cancel or any other failure. */
export async function appleSignIn(): Promise<string> {
  if (isNativeIOS()) {
    return appleNativeSignIn();
  }
  return appleWebSignIn();
}

// ---------------------------------------------------------------------------
// Google — Capacitor native
// ---------------------------------------------------------------------------
//
// Uses `@capgo/capacitor-social-login` (same plugin that drives Apple
// native) which on iOS opens the installed Google app or a
// SFSafariViewController fallback. Returns an id_token whose `aud` is
// the per-bundle iOS client ID; POSTed to `/api/auth/oauth/google` and
// verified by the same JWKS pipeline as the web flow.
//
// `SocialLogin.initialize` is provider-scoped — calling it with `{google:
// ...}` configures Google without touching the Apple slot set up by
// `ensureAppleNativeInit`. Keep the two inits separate so each can fail
// + retry independently. Memoize the promise so concurrent modal opens
// share one round-trip, matching the Apple pattern.

let googleNativeInitPromise: Promise<void> | null = null;

async function ensureGoogleNativeInit(): Promise<void> {
  if (googleNativeInitPromise) return googleNativeInitPromise;
  googleNativeInitPromise = (async () => {
    const mod = await import("@capgo/capacitor-social-login").catch(() => null);
    if (!mod) {
      googleNativeInitPromise = null;
      throw new Error("Google sign-in plugin failed to load.");
    }
    const { SocialLogin } = mod;
    // Resolve the bundle id at runtime to pick the right iOS client ID
    // (prod vs canary). Missing lookup falls back to the prod client —
    // the server's audience allowlist includes both bundles' iOS clients
    // so a wrong-bundle token would still verify; but the OS-level URL
    // scheme handshake won't, so this fallback only saves us from a hard
    // failure if App.getInfo() somehow misfires.
    const appMod = await import("@capacitor/app").catch(() => null);
    let iOSClientId = GOOGLE_IOS_CLIENT_ID_DEFAULT;
    if (appMod) {
      try {
        const info = await appMod.App.getInfo();
        const lookup = info?.id ? GOOGLE_IOS_CLIENT_IDS[info.id] : undefined;
        if (lookup) iOSClientId = lookup;
      } catch {
        // Fall back to the prod client id below.
      }
    }
    await SocialLogin.initialize({
      google: {
        iOSClientId,
        mode: "online",
      },
    });
  })().catch((err) => {
    googleNativeInitPromise = null;
    throw err;
  });
  return googleNativeInitPromise;
}

async function googleNativeSignIn(): Promise<string> {
  await ensureGoogleNativeInit();
  const mod = await import("@capgo/capacitor-social-login");
  const { SocialLogin } = mod;
  try {
    const res = await SocialLogin.login({
      provider: "google",
      options: { scopes: ["email", "profile"] },
    });
    // Cast through `unknown` for the same reason as the Apple flow — the
    // plugin's typed response shape doesn't accommodate the defensive
    // fall-through paths some plugin versions surface.
    const result = (res as unknown as { result?: Record<string, unknown> })
      ?.result;
    const idToken =
      (result?.idToken as string | undefined) ??
      (
        (result?.profile as { token?: { id_token?: string } } | undefined)
          ?.token?.id_token
      );
    if (!idToken) {
      throw new Error("Google didn't return an identity token.");
    }
    return idToken;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(typeof err === "string" ? err : "Google sign-in failed.");
  }
}

/** Trigger Google's native sign-in flow on Capacitor iOS.
 *
 *  The web/PWA path is `renderGoogleButton` (Google's branding rules
 *  require their SDK-rendered button); the native path uses the capgo
 *  plugin and a custom button. Callers must check `isNativeIOS()` before
 *  picking which path to call — this helper throws on non-native to
 *  surface that misuse loudly. */
export async function googleSignIn(): Promise<string> {
  if (!isNativeIOS()) {
    throw new Error(
      "googleSignIn() is the native-iOS path; web should call renderGoogleButton."
    );
  }
  return googleNativeSignIn();
}

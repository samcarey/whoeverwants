/**
 * Phase C: web OAuth helpers for Apple + Google Sign In.
 *
 * Both providers ship browser SDKs that we lazy-load only when the
 * sign-in modal opens — avoids paying the script-fetch cost on every
 * page load. The flow on each side:
 *   - User taps the provider's button in the modal.
 *   - We load the provider's SDK script (idempotent — only fetches once
 *     per page load).
 *   - We trigger the provider's sign-in UI (popup or One Tap-style
 *     overlay).
 *   - The user grants consent; the provider hands us back an ID token.
 *   - We POST the ID token to our server's verify endpoint (in
 *     `lib/api/auth.ts`); the server validates the signature + claims
 *     against the provider's JWKS and issues a session.
 *
 * Native Capacitor flows are intentionally out of scope for this phase
 * — the iOS bundle hides the buttons via the `isNativePlatform` short-
 * circuit and a follow-up PR will add `@capacitor-community/apple-sign-in`
 * + `@codetrix-studio/capacitor-google-auth` for the native experience.
 */

import { Capacitor } from "@capacitor/core";

const GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";
const APPLE_JS_SRC =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || "";
const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_OAUTH_SERVICE_ID || "";

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

/** Whether Google Sign In is wired up on this client bundle. Independent
 *  of the server-side `providers` endpoint — both must agree before the
 *  button is functional. */
export function googleConfigured(): boolean {
  return !!GOOGLE_CLIENT_ID;
}

/** Same shape as `googleConfigured()` for Apple. */
export function appleConfigured(): boolean {
  return !!APPLE_CLIENT_ID;
}

/** Hide every OAuth button when running inside the Capacitor iOS
 *  WebView — the native bundle will get plugin-driven flows in a follow-
 *  up phase, and the web SDKs don't render correctly inside WKWebView
 *  anyway (Google explicitly blocks `accounts.google.com/gsi` in
 *  embedded WebViews per their disallowed-user-agents policy). */
export function isWebOAuthAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return false;
  } catch {
    // Capacitor isn't available — that's the browser/PWA case, which
    // is exactly when web OAuth IS available.
  }
  return true;
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
  if (!googleConfigured()) {
    throw new Error("Google sign-in isn't configured on this client.");
  }
  googleScriptPromise = loadScript(GOOGLE_GSI_SRC, googleScriptPromise);
  await googleScriptPromise;
  if (!window.google?.accounts?.id) {
    throw new Error("Google sign-in failed to initialize.");
  }
  return window.google.accounts.id;
}

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
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    try {
      sdk.initialize({
        client_id: GOOGLE_CLIENT_ID,
        ux_mode: "popup",
        cancel_on_tap_outside: true,
        callback: (response) => {
          if (settled) return;
          settled = true;
          if (response?.credential) {
            resolve(response.credential);
          } else {
            reject(new Error("Google didn't return a credential."));
          }
        },
      });
      sdk.renderButton(container, {
        type: "standard",
        theme: theme === "dark" ? "filled_black" : "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        // width: 280, // intentionally omitted; lets the button stretch.
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------

async function ensureAppleSdk() {
  if (!appleConfigured()) {
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

/** Trigger Apple's popup-based sign-in flow. Returns the id_token on
 *  success, rejects on cancel or any other failure.
 *
 *  Apple requires:
 *    - A Service ID (clientId here) registered in the Apple Developer
 *      portal.
 *    - The current origin's domain registered as a "Domain" on the
 *      Service ID.
 *    - A "Return URL" (redirectURI) also registered on the Service ID.
 *      For `usePopup: true` the user is sent to this URL inside a popup
 *      that posts the result back via postMessage — the URL just needs
 *      to be reachable; we use the current origin's root.
 *
 *  `scope: 'email'` is the minimum we need to merge accounts on shared
 *  email; `name` would also be sent but we don't surface display names
 *  yet (Phase I).
 */
export async function appleSignIn(): Promise<string> {
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

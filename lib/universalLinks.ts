/**
 * iOS Universal Links — convert an incoming `appUrlOpen` event from the
 * native shell into a Next.js client-side navigation.
 *
 * When iOS resolves a `https://whoeverwants.com/...` URL into our app
 * (because the AASA file at /.well-known/apple-app-site-association
 * claims the path), the Capacitor runtime fires
 * `App.addListener('appUrlOpen', ...)` with the full https URL. We strip
 * the origin and `router.push` the path + query so the destination
 * renders without a hard reload.
 */

import { Capacitor } from "@capacitor/core";

// Hosts whose paths we're willing to navigate the WebView to. iOS only
// hands us URLs matching the `applinks:` entitlements, but we re-validate
// here so a hostile payload can't sneak through if entitlements ever
// widen.
const KNOWN_HOSTS = new Set<string>([
  "whoeverwants.com",
  "latest.whoeverwants.com",
]);

interface UrlOpenEvent {
  url?: string;
}

interface AppPlugin {
  addListener: (
    event: "appUrlOpen",
    handler: (event: UrlOpenEvent) => void,
  ) => Promise<{ remove: () => Promise<void> | void }>;
}

let installed = false;

/** Extract the path+search portion of an https URL targeting one of our
 *  known hosts. Returns null for cross-origin URLs or malformed inputs so
 *  the caller doesn't accidentally navigate the WebView to a hostile
 *  site received through the universal-link channel. */
export function pathFromUniversalLinkUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!KNOWN_HOSTS.has(parsed.hostname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
}

/** Install the listener once per page. Pass a navigate function — usually
 *  `router.push` from `next/navigation`'s `useRouter`. Synchronously
 *  short-circuits on browsers / PWA so the `@capacitor/app` chunk only
 *  loads on the native shell. */
export async function installUniversalLinksHandler(
  navigate: (path: string) => void,
): Promise<(() => void) | null> {
  if (typeof window === "undefined") return null;
  if (!Capacitor.isNativePlatform()) return null;
  if (installed) return null;
  // Claim the slot BEFORE awaiting `@capacitor/app`, otherwise a
  // concurrent mount (StrictMode dev double-invoke) could pass the guard
  // and register a second listener.
  installed = true;

  const appModule = await import("@capacitor/app").catch(() => null);
  const App = (appModule as unknown as { App?: AppPlugin } | null)?.App;
  if (!App) {
    installed = false;
    return null;
  }

  const handle = await App.addListener("appUrlOpen", (event) => {
    const path = pathFromUniversalLinkUrl(event?.url);
    if (path) navigate(path);
  });

  return () => {
    try {
      void handle.remove();
    } catch {
      // Listener already torn down or plugin gone; safe to ignore.
    }
    installed = false;
  };
}

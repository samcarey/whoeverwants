/**
 * iOS Universal Links — convert an incoming `appUrlOpen` event from the
 * native shell into a Next.js client-side navigation.
 *
 * When iOS resolves a `https://whoeverwants.com/...` URL into our app
 * (because the AASA file at /.well-known/apple-app-site-association
 * claims the path), the Capacitor runtime fires `App.addListener('appUrlOpen', ...)`
 * with the full https URL. We strip the origin and `router.push` the path
 * + query so the destination renders without a hard reload.
 *
 * The listener is primarily for cold-launching the app: tapping a link
 * from iMessage / Mail / Notes wakes the app and routes straight to the
 * target. When the WebView is already foregrounded on whoeverwants.com,
 * iOS lets the WebView handle the navigation natively and `appUrlOpen`
 * may not fire — that's fine, both paths land on the same Next.js route.
 *
 * Non-Capacitor platforms (regular browser + PWA) short-circuit before
 * touching the dynamic import, so this file is safe to include in the
 * regular bundle.
 */

const HANDLED_FLAG = "__universalLinksHandlerInstalled" as const;
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
  ) => Promise<{ remove: () => Promise<void> } | { remove: () => void }>;
}

declare global {
  interface Window {
    [HANDLED_FLAG]?: boolean;
  }
}

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
 *  `router.push` from `next/navigation`'s `useRouter`. The router instance
 *  changes across renders, so `navigate` is captured via a closure inside
 *  the component's effect (see `<UniversalLinksHandler>`). */
export async function installUniversalLinksHandler(
  navigate: (path: string) => void,
): Promise<(() => void) | null> {
  if (typeof window === "undefined") return null;
  if (window[HANDLED_FLAG]) return null;

  const capModule = await import("@capacitor/core").catch(() => null);
  if (!capModule?.Capacitor?.isNativePlatform?.()) return null;

  const appModule = await import("@capacitor/app").catch(() => null);
  const App = (appModule as unknown as { App?: AppPlugin } | null)?.App;
  if (!App) return null;

  window[HANDLED_FLAG] = true;
  const handle = await App.addListener("appUrlOpen", (event) => {
    const path = pathFromUniversalLinkUrl(event?.url);
    if (path) navigate(path);
  });

  return () => {
    try {
      void Promise.resolve(handle.remove());
    } catch {
      // Listener already torn down or plugin gone; safe to ignore.
    }
    window[HANDLED_FLAG] = false;
  };
}

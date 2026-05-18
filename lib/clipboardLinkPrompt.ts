/**
 * iOS clipboard link prompt — when the Capacitor shell becomes active
 * (cold launch or foreground-from-background) and the system clipboard
 * holds a URL targeting one of our known hosts (whoeverwants.com /
 * latest.whoeverwants.com), surface a confirmation modal that lets the
 * user navigate to that path inside the app.
 *
 * Inert on non-native platforms (web / PWA). On iOS this WILL trigger
 * the system "X pasted from Y" banner / permission prompt every time we
 * read — that's iOS 14+ behavior we can't suppress. We minimise reads by
 * (a) running only on app-active transitions (not every render) and
 * (b) tracking dismissed URLs in a module-level Set so resuming the app
 * with the same clipboard contents doesn't re-prompt our own modal.
 */

import { Capacitor } from "@capacitor/core";
import { pathFromUniversalLinkUrl } from "@/lib/universalLinks";

interface ClipboardReadResult {
  value?: string;
  type?: string;
}

interface ClipboardPlugin {
  read: () => Promise<ClipboardReadResult>;
}

interface AppStateChangeEvent {
  isActive?: boolean;
}

interface AppPlugin {
  addListener: (
    event: "appStateChange",
    handler: (event: AppStateChangeEvent) => void,
  ) => Promise<{ remove: () => Promise<void> | void }>;
}

let installed = false;
// URLs the user has already responded to (open or dismiss) in this
// session. Persists for the lifetime of this JS module — i.e. across
// foreground/background cycles but cleared on a full WebView reload
// (cold launch, swipe-up-to-kill). Cold launch SHOULD re-prompt because
// the user may have copied the URL specifically to use it now.
const respondedUrls = new Set<string>();

export type ClipboardPromptHandler = (path: string, originalUrl: string) => void;

/** Normalise a path for "is the user already here?" comparison.
 *  Strips a trailing slash so `/g/abc/` and `/g/abc` are equivalent. */
function normalisePath(p: string): string {
  if (!p) return "/";
  return p.replace(/\/+$/, "") || "/";
}

/** Mark a URL as "the user has been prompted about this one" so a
 *  subsequent app-foreground with the same clipboard contents doesn't
 *  re-show the modal. Call from BOTH the confirm and the cancel paths. */
export function markClipboardUrlResponded(rawUrl: string): void {
  respondedUrls.add(rawUrl);
}

/** Install the clipboard-link prompt listener. Runs an immediate
 *  cold-launch check then re-checks on every app-active transition.
 *  Returns a cleanup function (or null if the platform isn't native). */
export async function installClipboardLinkPrompt(
  onLinkFound: ClipboardPromptHandler,
): Promise<(() => void) | null> {
  if (typeof window === "undefined") return null;
  if (!Capacitor.isNativePlatform()) return null;
  if (installed) return null;
  // Claim the slot BEFORE awaiting plugin imports so concurrent mounts
  // (StrictMode dev double-invoke) can't both pass the guard.
  installed = true;

  const [appModule, clipboardModule] = await Promise.all([
    import("@capacitor/app").catch(() => null),
    import("@capacitor/clipboard").catch(() => null),
  ]);
  const App = (appModule as unknown as { App?: AppPlugin } | null)?.App;
  const Clipboard = (clipboardModule as unknown as { Clipboard?: ClipboardPlugin } | null)?.Clipboard;
  if (!App || !Clipboard) {
    installed = false;
    return null;
  }

  const checkClipboard = async () => {
    let result: ClipboardReadResult;
    try {
      result = await Clipboard.read();
    } catch {
      // Empty clipboard, non-text payload, or denied paste permission.
      // All silent — there's no useful UX in surfacing a "clipboard read
      // failed" toast every time someone opens the app.
      return;
    }
    const raw = result?.value;
    if (!raw || typeof raw !== "string") return;
    if (respondedUrls.has(raw)) return;
    const path = pathFromUniversalLinkUrl(raw);
    if (!path) return;
    // Skip if the user is already on this path — opening the same URL
    // they're looking at would be confusing.
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (normalisePath(currentPath) === normalisePath(path)) {
      respondedUrls.add(raw);
      return;
    }
    onLinkFound(path, raw);
  };

  // Cold launch: appStateChange doesn't fire on the initial active
  // state, so do an immediate one-shot check.
  void checkClipboard();

  const handle = await App.addListener("appStateChange", (event) => {
    if (event?.isActive) void checkClipboard();
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

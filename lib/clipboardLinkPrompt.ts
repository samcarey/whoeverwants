import { Capacitor } from "@capacitor/core";
import { pathFromUniversalLinkUrl } from "@/lib/universalLinks";
import { normalizePath } from "@/lib/questionId";

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
let checking = false;

// Bounded so a long-running PWA / WebView can't accumulate forever. Set
// preserves insertion order, so the oldest entry is `values().next()`.
const MAX_RESPONDED = 50;
const respondedUrls = new Set<string>();

function markResponded(raw: string): void {
  if (respondedUrls.has(raw)) return;
  if (respondedUrls.size >= MAX_RESPONDED) {
    const oldest = respondedUrls.values().next().value;
    if (oldest !== undefined) respondedUrls.delete(oldest);
  }
  respondedUrls.add(raw);
}

export function markClipboardUrlResponded(rawUrl: string): void {
  markResponded(rawUrl);
}

export type ClipboardPromptHandler = (path: string, originalUrl: string) => void;

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
    // Rapid foreground/background cycles can dispatch overlapping checks
    // — coalesce so we only fire one iOS paste banner + one modal.
    if (checking) return;
    checking = true;
    try {
      let result: ClipboardReadResult;
      try {
        result = await Clipboard.read();
      } catch {
        // Empty / denied / non-text — silent.
        return;
      }
      const raw = result?.value;
      if (!raw || typeof raw !== "string") return;
      if (respondedUrls.has(raw)) return;
      const path = pathFromUniversalLinkUrl(raw);
      if (!path) return;
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (normalizePath(currentPath) === normalizePath(path)) {
        markResponded(raw);
        return;
      }
      // Mark BEFORE firing the callback so any check racing the modal
      // mount can't fire onLinkFound a second time for the same URL.
      markResponded(raw);
      onLinkFound(path, raw);
    } finally {
      checking = false;
    }
  };

  // Cold launch: appStateChange doesn't fire on the initial active state,
  // so do an immediate one-shot check.
  void checkClipboard();

  const handle = await App.addListener("appStateChange", (event) => {
    if (event?.isActive) void checkClipboard();
  });

  return () => {
    try {
      void handle.remove();
    } catch {
      // Plugin already torn down; safe to ignore.
    }
    installed = false;
  };
}

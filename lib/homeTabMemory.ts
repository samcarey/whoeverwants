// Memory for the home page's active tab (Groups · Playlist), persisted to
// localStorage so the choice survives hard reloads as well as back-nav
// remounts. A module-level cache avoids re-reading localStorage on every
// call (same pattern as lib/session's cachedToken).
//
// Hydration note: the home page must NOT seed its tab state from this
// module during the initial hydration render (the server HTML is rendered
// with DEFAULT_HOME_TAB) — it gates the eager read on isAppHydrated() and
// falls back to a mount-effect read for the hard-reload case.

export type HomeTab = "playlist" | "groups";

export const DEFAULT_HOME_TAB: HomeTab = "groups";

const STORAGE_KEY = "whoeverwants_home_tab";

export const HOME_TABS: { value: HomeTab; label: string }[] = [
  { value: "groups", label: "Groups" },
  { value: "playlist", label: "Playlist" },
];

// Fired on every rememberHomeTab so layout-level chrome that depends on the
// active tab (the floating "+ Group" / "+ Slot" FAB in CreateGroupButtonHost)
// can react without a home-page remount.
export const HOME_TAB_CHANGED_EVENT = "homeTabChanged";

// Shared class builders so the real home page and HomeBackdropHost's
// decorative mirror can't drift (the mirror must be pixel-identical or the
// swipe-back handoff shows a visible swap).
//
// Row: left-justified + horizontally scrollable (more tabs may come);
// `.scrollbar-hide` is the app/globals.css utility.
export const HOME_TAB_ROW_CLASS =
  "flex gap-2 px-2 pt-1 pb-1 overflow-x-auto scrollbar-hide";

export function homeTabPillClass(selected: boolean): string {
  return `shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
    selected
      ? "bg-blue-500 border-blue-500 text-white"
      : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
  }`;
}

let current: HomeTab | null = null;

export function getHomeTab(): HomeTab {
  if (current !== null) return current;
  if (typeof window === "undefined") return DEFAULT_HOME_TAB;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    current = stored === "playlist" || stored === "groups" ? stored : DEFAULT_HOME_TAB;
  } catch {
    current = DEFAULT_HOME_TAB;
  }
  return current;
}

export function rememberHomeTab(tab: HomeTab): void {
  current = tab;
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HOME_TAB_CHANGED_EVENT));
  }
}

// Module-level memory for the home page's active tab (Playlist · Groups).
// Mirrors lib/groupTabMemory.ts: the home page remounts on every back-nav
// from a group, so component state alone would snap the tab back to the
// default each time. A module variable survives client-side navigation and
// resets to the default on a hard reload.

export type HomeTab = "playlist" | "groups";

const DEFAULT_HOME_TAB: HomeTab = "groups";

export const HOME_TABS: { value: HomeTab; label: string }[] = [
  { value: "groups", label: "Groups" },
  { value: "playlist", label: "Playlist" },
];

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
      ? "bg-blue-600 border-blue-600 text-white"
      : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
  }`;
}

let current: HomeTab = DEFAULT_HOME_TAB;

export function getHomeTab(): HomeTab {
  return current;
}

export function rememberHomeTab(tab: HomeTab): void {
  current = tab;
}

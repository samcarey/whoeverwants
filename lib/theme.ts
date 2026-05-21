export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "whoeverwants_theme";

export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export function saveTheme(theme: ThemePreference) {
  if (typeof window === "undefined") return;
  if (theme === "system") {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, theme);
  }
  applyTheme(theme);
}

export function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

/** Resolve the user's currently-active theme to a concrete light/dark
 *  value, accounting for explicit override (`data-theme` set by the
 *  pre-hydration script in app/layout.tsx) and system preference
 *  fallback. Used by themed third-party widgets (e.g. Google's Sign-In
 *  button) that need an actual light/dark — not the user's stored
 *  preference of "system". SSR-safe (returns "light" with no DOM). */
export function resolveActiveTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return "dark";
  if (explicit === "light") return "light";
  return typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * App-icon badge model preferences. See CLAUDE.md 'App-Icon Badge Model'.
 *
 * Three switches, account-synced when signed in (authoritative on
 * `SessionUser`), localStorage-only when anonymous. `getEffectiveBadgeSettings`
 * is the single resolver every surface reads — Settings UI, the client-side
 * badge resync, and any future consumer. `saveBadgeSettings` writes locally AND
 * (when signed in) pushes to the account, then fires a change event so the
 * badge resync re-runs.
 */

import { getCachedSessionUser, getSessionToken } from "@/lib/session";

export interface BadgeSettings {
  /** OFF (default) = unread model; ON = to-do model. */
  todoMode: boolean;
  /** Unread-only: a prephase→voting transition re-lights the poll. */
  onVotingOpen: boolean;
  /** Unread-only: a poll closing re-lights the poll. */
  onResults: boolean;
}

export const DEFAULT_BADGE_SETTINGS: BadgeSettings = {
  todoMode: false,
  onVotingOpen: true,
  onResults: true,
};

const KEY = "whoeverwants_badge_settings";

/** Fired after `saveBadgeSettings` so the app-icon badge resync re-runs. */
export const BADGE_SETTINGS_CHANGED_EVENT = "badge-settings:changed";

function readLocal(): BadgeSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p === "object") {
      return {
        todoMode: !!p.todoMode,
        onVotingOpen: p.onVotingOpen !== false,
        onResults: p.onResults !== false,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function writeLocal(s: BadgeSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota / privacy mode — accept the in-account value
  }
}

/**
 * The settings to act on right now. Account values win when signed in (they're
 * synced and authoritative); otherwise the localStorage copy; otherwise the
 * sensible defaults (unread, both re-lights on).
 */
export function getEffectiveBadgeSettings(): BadgeSettings {
  const user = getCachedSessionUser();
  if (user && getSessionToken()) {
    return {
      todoMode: user.badge_todo_mode ?? DEFAULT_BADGE_SETTINGS.todoMode,
      onVotingOpen: user.badge_on_voting_open ?? DEFAULT_BADGE_SETTINGS.onVotingOpen,
      onResults: user.badge_on_results ?? DEFAULT_BADGE_SETTINGS.onResults,
    };
  }
  return readLocal() ?? DEFAULT_BADGE_SETTINGS;
}

/**
 * Persist a settings change. Always writes the localStorage mirror; when signed
 * in, also pushes to the account (best-effort, lazily imported to dodge the
 * api/auth → session import cycle). Fires BADGE_SETTINGS_CHANGED_EVENT.
 */
export function saveBadgeSettings(s: BadgeSettings): void {
  writeLocal(s);
  if (getSessionToken()) {
    void import("@/lib/api/auth")
      .then((m) => m.apiUpdateBadgeSettings(s))
      .catch(() => {
        // best-effort; localStorage mirror is the fallback for this session
      });
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(BADGE_SETTINGS_CHANGED_EVENT));
    } catch {
      // ignore (test env / old browsers)
    }
  }
}

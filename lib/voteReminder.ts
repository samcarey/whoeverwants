/**
 * Per-user "remind me to vote" preference. Recipient-side, account-synced when
 * signed in (authoritative on `SessionUser.vote_reminder`), localStorage-only
 * when anonymous — mirroring the badge-settings pattern in `lib/badgeSettings.ts`.
 *
 * The value is one of `VOTE_REMINDER_OPTIONS` (keep in lockstep with
 * `server/services/validation.py: VOTE_REMINDER_OPTIONS`). The server's cron
 * tick reads the account value to decide when, before a poll's deadline, to
 * send a one-shot "you haven't voted yet" push — so an anonymous user's local
 * value shapes only the Settings UI, not server pushes (which use the column
 * default until they sign in).
 */

import { getCachedSessionUser, getSessionToken } from "@/lib/session";

export type VoteReminder =
  | "off"
  | "0.5x"
  | "0.2x"
  | "0.1x"
  | "1h"
  | "3h"
  | "1d";

export const VOTE_REMINDER_OPTIONS: ReadonlyArray<{
  value: VoteReminder;
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "0.5x", label: "When half the time is left" },
  { value: "0.2x", label: "When 20% of the time is left" },
  { value: "0.1x", label: "When 10% of the time is left" },
  { value: "1h", label: "1 hour before closing" },
  { value: "3h", label: "3 hours before closing" },
  { value: "1d", label: "1 day before closing" },
];

export const DEFAULT_VOTE_REMINDER: VoteReminder = "0.2x";

const KEY = "whoeverwants_vote_reminder";

/** Fired after `saveVoteReminder` so any listening surface can re-read. */
export const VOTE_REMINDER_CHANGED_EVENT = "vote-reminder:changed";

const VALID = new Set<string>(VOTE_REMINDER_OPTIONS.map((o) => o.value));

function coerce(value: string | null | undefined): VoteReminder | null {
  return value && VALID.has(value) ? (value as VoteReminder) : null;
}

function readLocal(): VoteReminder | null {
  if (typeof window === "undefined") return null;
  try {
    return coerce(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function writeLocal(v: VoteReminder): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // quota / privacy mode — accept the in-account value
  }
}

/**
 * The preference to act on right now. Account value wins when signed in (synced
 * + authoritative); otherwise the localStorage copy; otherwise the default.
 */
export function getEffectiveVoteReminder(): VoteReminder {
  const user = getCachedSessionUser();
  if (user && getSessionToken()) {
    return coerce(user.vote_reminder) ?? DEFAULT_VOTE_REMINDER;
  }
  return readLocal() ?? DEFAULT_VOTE_REMINDER;
}

/**
 * Persist a preference change. Always writes the localStorage mirror; when
 * signed in, also pushes to the account (best-effort, lazily imported to dodge
 * the api/auth → session import cycle). Fires VOTE_REMINDER_CHANGED_EVENT.
 */
export function saveVoteReminder(v: VoteReminder): void {
  writeLocal(v);
  if (getSessionToken()) {
    void import("@/lib/api/auth")
      .then((m) => m.apiUpdateVoteReminder(v))
      .catch(() => {
        // best-effort; localStorage mirror is the fallback for this session
      });
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(VOTE_REMINDER_CHANGED_EVENT));
    } catch {
      // ignore (test env / old browsers)
    }
  }
}

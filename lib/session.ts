/**
 * Phase A: client-side session token storage + cached user profile.
 *
 * Mirrors `lib/browserIdentity.ts`'s lazy-load pattern: cached in memory
 * after first storage read; module-level memo so 50+ components calling
 * `getSessionToken()` per render don't each touch localStorage.
 *
 * Storage backend: localStorage today. iOS Capacitor's WKWebView
 * localStorage persists across app updates (and survives until the user
 * explicitly clears app data), which is the right durability for a
 * session token. A future upgrade to `@capacitor/preferences` (Keychain
 * on iOS) would survive even data clears; deferred until Phase I.
 *
 * Token contents are opaque to the FE — the server stores only the
 * sha256 hash. The raw token here is treated as a bearer credential and
 * sent via `Authorization: Bearer <token>` on every API call (added in
 * `lib/api/_internal.ts`).
 */

import { clearStoredUserData } from '@/lib/userProfile';

const TOKEN_KEY = 'session_token';
const PROFILE_KEY = 'session_user';

// Listener channel for sign-in / sign-out events. Components that
// surface signed-in state (settings page header, future "you're now
// linked to N polls" banner, etc.) subscribe to refresh without
// requiring a prop drill.
export const SESSION_CHANGED_EVENT = 'session:changed';

export interface SessionUser {
  user_id: string;
  email: string | null;
  providers: string[];
  created_at: string; // ISO-8601
  // Account-tied display name (null when unset). On sign-in this overwrites
  // the local `whoeverwants_user_name`; changing the local name while signed
  // in pushes it back to the account. Optional so pre-this-feature cached
  // profiles (no `name`) deserialize cleanly until the next /me refresh.
  name?: string | null;
  // Account-synced app-icon badge preferences (migration 121). Optional so
  // pre-feature cached profiles deserialize; defaults applied by
  // `lib/badgeSettings.ts` when absent. See CLAUDE.md 'App-Icon Badge Model'.
  badge_todo_mode?: boolean;
  badge_on_voting_open?: boolean;
  badge_on_results?: boolean;
  // Migration 123: drives the home-page "add a recovery method" banner. True
  // = the user dismissed the nudge. Optional so pre-feature cached profiles
  // deserialize (treated as not-dismissed until the next /me refresh).
  recovery_reminder_dismissed?: boolean;
}

let cachedToken: string | null | undefined; // undefined = not yet read
let cachedProfile: SessionUser | null | undefined;

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    return v && v.length >= 16 ? v : null;
  } catch {
    return null;
  }
}

function readProfile(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.user_id === 'string') {
      return parsed as SessionUser;
    }
    return null;
  } catch {
    return null;
  }
}

function writeToken(value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // Quota / privacy mode — accept the in-memory value and move on.
  }
}

function writeProfile(value: SessionUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function dispatchChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT));
  } catch {
    // ignore (test env / old browsers)
  }
}

/** Current session bearer token, or null if signed out / not yet signed in. */
export function getSessionToken(): string | null {
  if (cachedToken === undefined) cachedToken = readToken();
  return cachedToken;
}

/** Cached user profile from the last sign-in, or null. Refreshed on
 *  every successful sign-in / explicit refetch. */
export function getCachedSessionUser(): SessionUser | null {
  if (cachedProfile === undefined) cachedProfile = readProfile();
  return cachedProfile;
}

/** Persist the result of a successful sign-in. Dispatches
 *  SESSION_CHANGED_EVENT so listeners can refresh. */
function invalidateAccessibleCacheLazy(): void {
  // Lazy require to dodge any circular-import edge case at module
  // initialization time. `clearSession`/`saveSession` are called from
  // many surfaces; this keeps the import graph honest.
  if (typeof window === 'undefined') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { invalidateAccessibleQuestions } = require('@/lib/questionCache');
    invalidateAccessibleQuestions?.();
  } catch {
    // Cache module not loaded yet (SSR, test harness). Safe to skip:
    // there's nothing to invalidate.
  }
}

function clearCachedProfileLazy(): void {
  // The profile photo is account data (keyed by user_id, migration 124).
  // On sign-out the cached avatar must vanish immediately — drop the
  // localStorage profile cache + fire its change event so every avatar
  // surface falls back to initials without a navigation. Lazy require to
  // avoid the session ↔ api/users ↔ _internal ↔ session import cycle at
  // module-init time.
  if (typeof window === 'undefined') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearCachedMyUserProfile } = require('@/lib/api/users');
    clearCachedMyUserProfile?.();
  } catch {
    // Module not loaded yet (SSR, test harness) — nothing cached to clear.
  }
}

export function saveSession(token: string, user: SessionUser): void {
  cachedToken = token;
  cachedProfile = user;
  writeToken(token);
  writeProfile(user);
  // Membership-driven visibility changes on sign-in: the existing
  // anonymous-state polls cache no longer reflects what the server
  // would return for a signed-in caller. Drop it so the next
  // `getMyGroups()` refetches.
  invalidateAccessibleCacheLazy();
  dispatchChange();
}

/** Clear local session state. Server-side revocation is the caller's
 *  job (POST /api/auth/sign-out).
 *
 *  Also invalidates the accessible-polls cache. Otherwise the signed-
 *  in groups would remain in the in-memory cache and — because
 *  `[].every(...) === true` makes an empty `accessibleQuestionIds`
 *  list satisfy the cache freshness check — the anonymous post-sign-
 *  out path would happily serve them for up to the 60s TTL, leaking
 *  signed-in-fetched group data to the anonymous session.
 *
 *  When a session actually existed (`wasSignedIn`), also wipes the
 *  locally-stored personal user data (display name, reference
 *  location, min-responses default) so signing out leaves a clean
 *  slate. Gated on `wasSignedIn` so an anonymous user — whose
 *  `apiGetMe()` 401 also routes here — keeps the name/location they
 *  set without ever signing in. The clear runs BEFORE `dispatchChange`
 *  so SESSION_CHANGED listeners (e.g. the settings name field) read the
 *  already-emptied values. */
export function clearSession(): void {
  const wasSignedIn = !!cachedToken || !!cachedProfile;
  cachedToken = null;
  cachedProfile = null;
  writeToken(null);
  writeProfile(null);
  invalidateAccessibleCacheLazy();
  if (wasSignedIn) {
    clearStoredUserData();
    clearCachedProfileLazy();
    dispatchChange();
  }
}

/** Update the cached profile without rotating the token (used after
 *  `/api/auth/me` refetch). */
export function updateCachedSessionUser(user: SessionUser | null): void {
  cachedProfile = user;
  writeProfile(user);
  dispatchChange();
}

/** Reset for tests. */
export function _resetSessionForTests(): void {
  cachedToken = undefined;
  cachedProfile = undefined;
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PROFILE_KEY);
    } catch {}
  }
}

/**
 * API helpers for the Phase A+B auth surface.
 *
 * Magic-link request, magic-link verify, get-me, sign-out. The verify
 * helper writes the session into `lib/session.ts` so subsequent fetches
 * pick up the bearer token automatically; the sign-out helper clears
 * both server-side (DELETE the session row) and client-side
 * (`clearSession`). Caller can pessimistically call `clearSession`
 * after the response too — `clearSession` is idempotent.
 */

import { authFetch, ApiError } from "./_internal";
import {
  clearSession,
  getCachedSessionUser,
  getSessionToken,
  saveSession,
  updateCachedSessionUser,
  type SessionUser,
} from "@/lib/session";
import { getUserName, saveUserNameLocalOnly } from "@/lib/userProfile";
import { isValidUserName } from "@/lib/nameValidation";
import { apiGetMyUserProfile, cacheMyUserProfile } from "@/lib/api/users";

export interface MagicLinkRequestResponse {
  accepted: boolean;
  email_configured: boolean;
}

export interface SessionResponse {
  session_token: string;
  expires_at: string;
  user: SessionUser;
}

export interface AuthProvidersResponse {
  email: boolean;
  google: boolean;
  apple: boolean;
  passkey: boolean;
}

// Phase D — Passkey / WebAuthn

/** A passkey credential, as surfaced by `GET /passkeys`. */
export interface PasskeySummary {
  credential_id: string;
  name: string | null;
  aaguid: string | null;
  transports: string | null;
  created_at: string;
  last_used_at: string;
}

export interface PasskeyListResponse {
  passkeys: PasskeySummary[];
}

export interface PasskeyRegistrationResult {
  credential_id: string;
  aaguid: string | null;
  transports: string | null;
  /**
   * Set when the registration was anonymous (passkey-as-account-creation
   * flow). The FE persists this session so subsequent fetches are
   * authenticated. For "Add a passkey" from Settings (signed in
   * already), session is null.
   */
  session: SessionResponse | null;
}

/**
 * Persist a freshly-issued session and reconcile the display name with the
 * account. Every sign-in path (magic link, OAuth, passkey auth, anonymous
 * passkey registration) funnels through here so the name-tie rule lives in
 * one place:
 *   - account has a name  → it's authoritative: mirror it down to local
 *     storage (overwriting whatever was there) BEFORE saving the session, so
 *     SESSION_CHANGED listeners read the updated local name.
 *   - account has no name → seed it from this browser's local name (if any)
 *     so the user's existing name follows them to other devices.
 */
function persistSignIn(token: string, user: SessionUser): void {
  const accountName = user.name?.trim() || null;
  if (accountName) {
    if ((getUserName()?.trim() || null) !== accountName) {
      saveUserNameLocalOnly(accountName);
    }
    saveSession(token, user);
    refreshProfilePhotoForSession();
    return;
  }
  saveSession(token, user);
  refreshProfilePhotoForSession();
  const localName = getUserName()?.trim() || null;
  if (localName && isValidUserName(localName)) {
    void pushLocalNameToAccount(localName);
  }
}

/** The profile photo is account data (migration 124). On sign-in, pull
 *  the account's photo into the local cache so it shows everywhere
 *  (including a freshly-signed-in device that never visited Settings).
 *  Best-effort + fire-and-forget — a network blip just leaves the avatar
 *  on initials until the next /me/profile read. `saveSession` already
 *  dispatched SESSION_CHANGED; cacheMyUserProfile fires its own
 *  USER_PROFILE_CHANGED_EVENT so avatars refresh when the bytes land. */
function refreshProfilePhotoForSession(): void {
  void apiGetMyUserProfile()
    .then(cacheMyUserProfile)
    .catch(() => {
      // ignore — initials fallback until a later refresh.
    });
}

/**
 * Set or clear the signed-in user's account display name. Returns the
 * updated profile and refreshes the cached session user. Caller-facing so
 * the settings page (or any future name surface) can await it directly.
 */
export async function apiUpdateMyName(
  name: string | null,
): Promise<SessionUser> {
  const user = await authFetch<SessionUser>("/me/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  updateCachedSessionUser(user);
  return user;
}

/**
 * Mirror a locally-saved name up to the signed-in account. No-op when signed
 * out or when the account already reflects this value (so the common
 * "save the same name again" path costs nothing). Best-effort — a network
 * failure leaves local storage as the source of truth for this session.
 *
 * Called from `saveUserName` (lib/userProfile.ts) so every name change in the
 * app — voting forms, the name-required modal, settings — propagates without
 * each callsite knowing about accounts.
 */
export async function pushLocalNameToAccount(name: string): Promise<void> {
  if (!getSessionToken()) return;
  const trimmed = name.trim();
  const cachedName = getCachedSessionUser()?.name ?? null;
  if ((cachedName ?? "") === trimmed) return;
  try {
    await apiUpdateMyName(trimmed.length ? trimmed : null);
  } catch {
    // best-effort
  }
}

/**
 * Set the signed-in user's account-synced app-icon badge preferences. Returns
 * the updated profile and refreshes the cached session user so every surface
 * (and the client-side badge resync) reflects the change immediately. Signed-in
 * only — anonymous callers persist locally via `lib/badgeSettings.ts`.
 */
export async function apiUpdateBadgeSettings(settings: {
  todoMode: boolean;
  onVotingOpen: boolean;
  onResults: boolean;
}): Promise<SessionUser> {
  const user = await authFetch<SessionUser>("/me/badge-settings", {
    method: "POST",
    body: JSON.stringify({
      badge_todo_mode: settings.todoMode,
      badge_on_voting_open: settings.onVotingOpen,
      badge_on_results: settings.onResults,
    }),
  });
  updateCachedSessionUser(user);
  return user;
}

/**
 * Set the signed-in user's account-synced "remind me to vote" preference.
 * Returns the updated profile and refreshes the cached session user so every
 * surface reflects the change immediately. Signed-in only — anonymous callers
 * persist locally via `lib/voteReminder.ts`.
 */
export async function apiUpdateVoteReminder(
  voteReminder: string,
): Promise<SessionUser> {
  const user = await authFetch<SessionUser>("/me/vote-reminder", {
    method: "POST",
    body: JSON.stringify({ vote_reminder: voteReminder }),
  });
  updateCachedSessionUser(user);
  return user;
}

/**
 * Create a recovery-less account from just a name (the "provide a name to
 * continue" path of the gating modal), or set the name on the existing
 * account when already signed in. Persists the issued session so subsequent
 * fetches are authenticated — the caller is signed in on return.
 */
export async function apiCreateNameAccount(
  name: string,
): Promise<SessionResponse> {
  const res = await authFetch<SessionResponse>("/account/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  persistSignIn(res.session_token, res.user);
  return res;
}

/**
 * Set the signed-in user's "stop reminding me to add a recovery method" flag
 * (drives the home-page recovery banner's "don't remind me again" toggle).
 * Refreshes the cached session user so the banner hides immediately. Signed-in
 * only.
 */
export async function apiSetRecoveryReminderDismissed(
  dismissed: boolean,
): Promise<SessionUser> {
  const user = await authFetch<SessionUser>("/me/recovery-reminder", {
    method: "POST",
    body: JSON.stringify({ dismissed }),
  });
  updateCachedSessionUser(user);
  return user;
}

// Dev-only instant sign-in links (demo helper). See the matching section
// in server/routers/auth.py. The mint endpoint (POST /api/auth/dev/instant-link)
// is called via curl when assembling a demo — there's no in-app caller, so no
// FE client for it. The adopt helper below IS used by the `/auth/instant`
// landing page.

/** DEV-ONLY: adopt the session token carried in an instant-sign-in URL.
 *  Links THIS browser to the account server-side (so its pre-seeded
 *  groups become visible) and persists the session locally. 503 / 400 on
 *  prod / invalid token. */
export async function apiAdoptInstantSession(
  token: string,
): Promise<SessionUser> {
  const user = await authFetch<SessionUser>("/instant/adopt", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  persistSignIn(token, user);
  return user;
}

export async function apiRequestMagicLink(
  email: string,
): Promise<MagicLinkRequestResponse> {
  return authFetch<MagicLinkRequestResponse>("/magic-link/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function apiVerifyMagicLink(token: string): Promise<SessionResponse> {
  const res = await authFetch<SessionResponse>("/magic-link/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  persistSignIn(res.session_token, res.user);
  return res;
}

/** Resolve the current session to a user. Returns null when the FE
 *  isn't signed in OR the server says the session is no longer valid.
 *  Updates the cached profile on success. */
export async function apiGetMe(): Promise<SessionUser | null> {
  try {
    const user = await authFetch<SessionUser>("/me");
    updateCachedSessionUser(user);
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // A 401 with a token attached = the server revoked the session;
      // clear local state (fetchWithBase already did when the token was
      // attached, but clearSession is idempotent + keeps the cache in
      // sync). With NO token, the 401 just means "you're anonymous" —
      // there's nothing to clear, and calling clearSession() would fire
      // its invalidateAccessibleQuestions() side effect, wiping the home
      // groups cache. That made groups vanish (then re-fetch) after a
      // visit to ANY page that calls apiGetMe (e.g. /settings) — surfaced
      // by the settings→home swipe-back, where the backdrop + the real
      // route both read the now-empty cache.
      if (getSessionToken()) clearSession();
      return null;
    }
    throw err;
  }
}

/** Revoke the current session both server-side and client-side. The
 *  server-side request is best-effort — even if it fails (network
 *  down), local state is cleared so the user is signed out locally. */
export async function apiSignOut(): Promise<void> {
  try {
    await authFetch<void>("/sign-out", { method: "POST" });
  } catch {
    // ignore — local clear is what makes "signed out" true for the FE.
  }
  clearSession();
}

// Phase I: account management — recovery email + delete account.

export interface RecoveryEmailRequestResponse {
  accepted: boolean;
  email_configured: boolean;
}

/** Phase I: send a "confirm your recovery email" link to `email`,
 *  tagged with the current (signed-in) user. The server gates on the
 *  account not already having an email identity. Throws `ApiError` on
 *  401 (not signed in) / 400 (invalid email OR account already has an
 *  email). */
export async function apiRequestRecoveryEmail(
  email: string,
): Promise<RecoveryEmailRequestResponse> {
  return authFetch<RecoveryEmailRequestResponse>("/recovery-email/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Phase I: confirm a recovery-email link, binding the email to the
 *  current account. Returns the refreshed profile (now including the
 *  'email' provider) and updates the cached session user so every
 *  surface reflects the new identity. No new session is issued.
 *
 *  Throws `ApiError`: 401 (not signed in), 403 (link belongs to a
 *  different account), 409 (email already used by another account),
 *  400 (invalid / expired link). The verify page maps these to copy. */
export async function apiVerifyRecoveryEmail(
  token: string,
): Promise<SessionUser> {
  const user = await authFetch<SessionUser>("/recovery-email/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  updateCachedSessionUser(user);
  return user;
}

/** Phase I: permanently delete the signed-in account. The server
 *  cascades through every users(id) FK; this browser reverts to
 *  anonymous (keeping its group memberships + poll creator secrets).
 *  Clears local session state on success. */
export async function apiDeleteAccount(): Promise<void> {
  await authFetch<void>("/me", { method: "DELETE" });
  clearSession();
}

/** Synchronous read of the currently-cached signed-in user. Use
 *  `apiGetMe()` to refresh from the server. */
export function getCurrentUser(): SessionUser | null {
  return getCachedSessionUser();
}

// Phase C: Apple + Google OAuth sign-in

export type OAuthProvider = "google" | "apple";

/** Verify an OAuth ID token (Google or Apple) against the server.
 *  On success, the server resolves the user via the (provider, sub)
 *  lookup or merges by verified email, issues a session, and we
 *  persist it locally so `fetchWithBase` attaches the bearer token to
 *  subsequent requests. */
export async function apiSignInWithOAuth(
  provider: OAuthProvider,
  idToken: string,
  opts?: { merge?: boolean },
): Promise<SessionResponse> {
  const res = await authFetch<SessionResponse>(`/oauth/${provider}`, {
    method: "POST",
    body: JSON.stringify({ id_token: idToken, merge: opts?.merge ?? false }),
  });
  persistSignIn(res.session_token, res.user);
  return res;
}

// Module-memoized providers lookup: the server's response is driven by
// env vars and is stable for the page lifetime, so one fetch per page
// load is enough. Concurrent callers share the in-flight promise.
let providersPromise: Promise<AuthProvidersResponse> | null = null;

/** Capability discovery — which sign-in methods this API tier has
 *  configured. Used by the SignInModal to hide OAuth buttons when the
 *  server isn't wired up to verify them. Independent of client-side
 *  configuration (NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID etc.); both must
 *  be true for the button to function end-to-end. */
export async function apiGetAuthProviders(): Promise<AuthProvidersResponse> {
  if (!providersPromise) {
    providersPromise = authFetch<AuthProvidersResponse>("/providers").catch((err) => {
      // Drop the cached failure so the next call can retry.
      providersPromise = null;
      throw err;
    });
  }
  return providersPromise;
}

// Phase D — Passkey ceremonies + management.
//
// The shape passed to / from these helpers mirrors WebAuthn's wire
// format almost exactly. `lib/passkeys.ts` wraps the browser API and
// converts between WebAuthn's binary-as-ArrayBuffer model and the
// base64url-encoded JSON that crosses the wire.

/** Step 1 of registration: ask the server for a fresh challenge +
 *  options dict suitable for `navigator.credentials.create()`. */
export async function apiPasskeyRegistrationOptions(): Promise<unknown> {
  return authFetch<unknown>("/passkey/registration/options", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Step 2 of registration: post the attestation back for verification.
 *  Returns the saved credential's id + metadata so the FE can update
 *  its local passkey list without a follow-up GET. When the server
 *  also issues a session (anonymous registration path), that session
 *  is persisted locally so subsequent fetches attach the bearer token
 *  — the caller doesn't have to do anything special for the new
 *  account creation flow vs the add-to-existing-account flow. */
export async function apiPasskeyRegistrationVerify(
  credential: unknown,
  name: string | null,
): Promise<PasskeyRegistrationResult> {
  const res = await authFetch<PasskeyRegistrationResult>(
    "/passkey/registration/verify",
    {
      method: "POST",
      body: JSON.stringify({ credential, name }),
    },
  );
  if (res.session) {
    persistSignIn(res.session.session_token, res.session.user);
  }
  return res;
}

/** Step 1 of authentication: ask the server for a fresh challenge +
 *  options dict suitable for `navigator.credentials.get()`. */
export async function apiPasskeyAuthenticationOptions(): Promise<unknown> {
  return authFetch<unknown>("/passkey/authentication/options", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Step 2 of authentication: post the assertion back. On success the
 *  server issues a session and we persist it locally so subsequent
 *  fetches attach the bearer token. */
export async function apiPasskeyAuthenticationVerify(
  credential: unknown,
  opts?: { merge?: boolean },
): Promise<SessionResponse> {
  const res = await authFetch<SessionResponse>("/passkey/authentication/verify", {
    method: "POST",
    body: JSON.stringify({ credential, merge: opts?.merge ?? false }),
  });
  persistSignIn(res.session_token, res.user);
  return res;
}

/** List the signed-in user's registered passkeys. */
export async function apiListPasskeys(): Promise<PasskeyListResponse> {
  return authFetch<PasskeyListResponse>("/passkeys");
}

/** Drop a passkey by credential_id. Idempotent from the caller's POV
 *  even though the server 404s on unknown id — the FE just removes the
 *  row from its local list either way. */
export async function apiDeletePasskey(credentialId: string): Promise<void> {
  await authFetch<void>(`/passkeys/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
  });
}

/** Rename a passkey. Empty string clears the name (defaults back to the
 *  generic "Passkey" label). */
export async function apiRenamePasskey(
  credentialId: string,
  name: string,
): Promise<{ credential_id: string; name: string | null }> {
  return authFetch<{ credential_id: string; name: string | null }>(
    `/passkeys/${encodeURIComponent(credentialId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name }),
    },
  );
}

/** Phase G: invite redemption.
 *
 *  Lives on /auth (not /groups) because the URL the joiner clicked
 *  carries only a raw token — no route_id. The redeem endpoint
 *  resolves the group from the token's stored group_id and writes a
 *  `group_members` row for the requester's earliest-linked browser.
 *
 *  Throws `ApiError` on 401 (anonymous) and 404 (invalid / expired /
 *  revoked / fully-used). The caller is responsible for surfacing
 *  status-specific messages to the user (the FE's invite page does).
 *
 *  `already_member: true` is NOT an error — it means the user was
 *  already a member (possibly approved via Phase F earlier), and
 *  use_count was NOT bumped. The FE can still redirect into the
 *  group but skip any "welcome!" toast. */
export interface InviteRedeemResult {
  group_id: string;
  group_short_id: string | null;
  target_poll_id: string | null;
  target_poll_short_id: string | null;
  already_member: boolean;
}

export async function apiRedeemInvite(
  token: string,
): Promise<InviteRedeemResult> {
  return authFetch<InviteRedeemResult>(
    `/invites/${encodeURIComponent(token)}/redeem`,
    { method: "POST" },
  );
}

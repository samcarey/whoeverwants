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
  saveSession,
  updateCachedSessionUser,
  type SessionUser,
} from "@/lib/session";

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
  saveSession(res.session_token, res.user);
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
      // fetchWithBase already called clearSession when a bearer token
      // was attached; this branch covers the no-token case AND keeps
      // the local cache in sync.
      clearSession();
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
): Promise<SessionResponse> {
  const res = await authFetch<SessionResponse>(`/oauth/${provider}`, {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
  saveSession(res.session_token, res.user);
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
    saveSession(res.session.session_token, res.session.user);
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
): Promise<SessionResponse> {
  const res = await authFetch<SessionResponse>("/passkey/authentication/verify", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  saveSession(res.session_token, res.user);
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

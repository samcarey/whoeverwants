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

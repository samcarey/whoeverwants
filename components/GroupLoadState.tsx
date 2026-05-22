"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ApiError,
  apiCreateGroupJoinRequest,
} from "@/lib/api";
import SignInModal from "@/components/SignInModal";
import { haptic } from "@/lib/haptics";
import {
  getCachedSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/session";

export function GroupLoading({ label = "Loading group..." }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <svg className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <p className="text-gray-600 dark:text-gray-400">{label}</p>
      </div>
    </div>
  );
}

/**
 * Phase F: when `routeId` is provided AND the viewer is signed in,
 * surface a "Request to join" affordance below the standard "Go Home"
 * fallback. The button POSTs to `/api/groups/<routeId>/join-requests`
 * — which works regardless of whether this is a private-group 404
 * (the actual case it's meant to handle) or just a wrong URL (it'll
 * 404 too, surfaced as a clean error message).
 *
 * Why on the 404 page and not on a private group's hidden landing
 * page: per Phase E, /by-route-id 404s strangers on private groups
 * with no leak of title/avatar. So the 404 page IS the only surface a
 * signed-in non-member ever reaches when given a private group's URL.
 * We don't try to look up the group here — that would be the leak.
 *
 * UX states:
 *   * Anonymous viewer → only the "Go Home" button (signing in alone
 *     isn't a meaningful CTA — they need a private group URL first).
 *   * Signed-in viewer → "Request to join" button below "Go Home".
 *     Tap → POST → on success show "Request sent. The group's creator
 *     will be notified."; on 404 show "Group not found."; on 401
 *     (token expired mid-tap) show a re-sign-in nudge.
 */
export function GroupNotFound({ routeId }: { routeId?: string } = {}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "sent"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [signInOpen, setSignInOpen] = useState(false);

  // Same session-tracking pattern as GroupPrivacySection — seed from
  // the localStorage cache then subscribe to live changes so the
  // "Request to join" button surfaces the moment the user signs in
  // via the modal below.
  useEffect(() => {
    setSession(getCachedSessionUser());
    const update = () => setSession(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);

  const requestAccess = () => {
    if (!routeId || submitting) return;
    haptic.medium();
    setSubmitting(true);
    setStatus({ kind: "idle" });
    apiCreateGroupJoinRequest(routeId, null)
      .then((result) => {
        if (result.status === "already_member") {
          setStatus({
            kind: "sent",
            message: "You're already in this group. Go home to find it.",
          });
        } else if (result.status === "already_pending") {
          setStatus({
            kind: "sent",
            message: "You've already requested access. The creator will see it.",
          });
        } else {
          setStatus({
            kind: "sent",
            message: "Request sent. The group's creator will be notified.",
          });
        }
      })
      .catch((e) => {
        const msg =
          e instanceof ApiError && e.status === 404
            ? "Group not found. Check the link."
            : e instanceof ApiError && e.status === 401
            ? "Session expired. Sign in again."
            : e instanceof ApiError
            ? e.message
            : "Could not send request";
        setStatus({ kind: "error", message: msg });
      })
      .finally(() => setSubmitting(false));
  };

  // The "Request to join" CTA only renders when we have a routeId to
  // request against AND the viewer is signed in. Anonymous viewers
  // get a quieter "Sign in to request access" nudge that opens the
  // SignInModal — once they sign in, the SESSION_CHANGED_EVENT fires
  // and this component re-renders with the actual Request button.
  const canRequest = !!routeId && !!session;
  const showSignInNudge = !!routeId && !session;
  const requestSent = status.kind === "sent";

  return (
    <>
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Group Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            This group may not exist or you don&apos;t have access.
          </p>
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Go Home
          </button>
          {canRequest && !requestSent && (
            <div className="mt-4">
              <button
                type="button"
                onClick={requestAccess}
                disabled={submitting}
                className="inline-flex items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Request to join"}
              </button>
            </div>
          )}
          {showSignInNudge && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="text-blue-600 dark:text-blue-400 hover:underline active:opacity-70"
              >
                Sign in
              </button>
              {" to request access."}
            </p>
          )}
          {status.kind === "sent" && (
            <p
              className="mt-4 text-sm text-green-700 dark:text-green-400"
              role="status"
            >
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p
              className="mt-4 text-sm text-red-600 dark:text-red-400"
              role="status"
            >
              {status.message}
            </p>
          )}
        </div>
      </div>
      <SignInModal isOpen={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ApiError,
  apiCreateGroupJoinRequest,
  apiGetGroupPreview,
} from "@/lib/api";
import SignInModal from "@/components/SignInModal";
import { haptic } from "@/lib/haptics";
import { isPathPrefix } from "@/lib/questionId";
import {
  getCachedSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/session";
import {
  SW_NOTIFICATION_CLICK_EVENT,
  SW_PUSH_RECEIVED_EVENT,
  type SwPushReceivedDetail,
} from "@/lib/swMessages";

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
 *
 * To avoid pretending the group "may not exist" when it actually does,
 * we probe the public `/preview` endpoint (same one Open Graph
 * crawlers hit on URL share — no new info disclosed). If preview
 * returns 200 the group exists; we swap to the "Private Group" copy.
 * Preview 404 keeps the ambiguous original copy ("may not exist or
 * you don't have access") since the group really might be missing.
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
  // null = not yet known (probe in flight or no routeId); true = preview
  // returned 200 so the group exists (private + no access); false =
  // preview 404'd, group truly may not exist.
  const [groupExists, setGroupExists] = useState<boolean | null>(null);

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

  // Probe /preview to find out whether the group exists. Cancelled on
  // unmount so a late response can't setState on a dead component.
  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    apiGetGroupPreview(routeId).then((preview) => {
      if (cancelled) return;
      setGroupExists(preview !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  // Auto-reload when the creator approves the requester's join request:
  // the server fires a `member-added-<group_uuid>` push (whose
  // `group_id` payload field carries this group's route_for_url, i.e.
  // its short_id or uuid — the same string we receive as `routeId`).
  // A full reload is the simplest path back into the group since
  // `useGroup` in the parent route fetches via its own cache that
  // would need separate invalidation. This handles both the
  // "notification arrived in the background while sitting here" path
  // (push-received event) and the "tap the notification" path
  // (notification-click event).
  useEffect(() => {
    if (!routeId) return;
    // `routeId` is whatever's in the URL — could be the canonical
    // groups.short_id OR a legacy UUID form. Push payload's `group_id`
    // is route_for_url (short_id when present) and `group_uuid` is the
    // canonical UUID; match against either so the UUID-form viewer
    // isn't silently dropped. `isPathPrefix` keeps the URL match from
    // false-positive on a sibling routeId like `~abcdef` when listening
    // for `~abc`.
    const groupRootPath = `/g/${routeId}`;
    const onSwEvent = (event: Event) => {
      const detail = (event as CustomEvent<SwPushReceivedDetail>).detail;
      if (!detail) return;
      const tagMatch =
        !!detail.tag &&
        detail.tag.startsWith("member-added-") &&
        (detail.group_id === routeId || detail.group_uuid === routeId);
      const urlMatch =
        typeof detail.url === "string" &&
        isPathPrefix(detail.url, groupRootPath);
      if (!tagMatch && !urlMatch) return;
      window.location.reload();
    };
    window.addEventListener(SW_PUSH_RECEIVED_EVENT, onSwEvent);
    window.addEventListener(SW_NOTIFICATION_CLICK_EVENT, onSwEvent);
    return () => {
      window.removeEventListener(SW_PUSH_RECEIVED_EVENT, onSwEvent);
      window.removeEventListener(SW_NOTIFICATION_CLICK_EVENT, onSwEvent);
    };
  }, [routeId]);

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
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {groupExists ? "Private Group" : "Group Not Found"}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {groupExists
              ? "Request access to view this group."
              : "This group may not exist or you don’t have access."}
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

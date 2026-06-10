/**
 * Phase F (group join requests) — creator-side pending list on /info.
 *
 * Renders the group's pending join requests with Approve / Deny
 * buttons per row. Only mounted when the caller is the group's
 * recorded `creator_user_id` (the parent /info page gates this via
 * the same session + creator_user_id check as
 * `GroupPrivacySection`'s toggle).
 *
 * Empty pending list → renders nothing at all (no chrome, no "no
 * pending requests" placeholder). The section's whole purpose is to
 * surface actionable items; rendering an empty card every time the
 * creator opens /info would be visual noise.
 *
 * Action flow:
 *   1. Tap Approve / Deny → optimistic remove from the local list +
 *      haptic feedback.
 *   2. Fire `apiDecideGroupJoinRequest`.
 *   3. On success, leave the row removed. On failure, restore + show
 *      a transient error message above the section.
 *
 * Requester identity display (avatar + stacked text):
 *   - Profile photo when uploaded, else a name-initials disc
 *     (`InitialBubble`).
 *   - Name (account display_name) as the primary label; falls back to
 *     email, then "Passkey user" (Phase D no-email accounts).
 *   - Email as a secondary line under the name (when both exist).
 *   - "Requested <relative time>" so the creator sees how long it's
 *     been waiting.
 *   - Message (if any) renders below in lighter text.
 */

"use client";

import { useEffect, useState } from "react";

import {
  ApiError,
  apiDecideGroupJoinRequest,
  apiListGroupJoinRequests,
} from "@/lib/api";
import type { GroupJoinRequest } from "@/lib/api";
import { buildUserImageUrl } from "@/lib/api";
import InitialBubble from "@/components/InitialBubble";
import { haptic } from "@/lib/haptics";
import { isPathPrefix } from "@/lib/questionId";
import { relativeTime } from "@/lib/questionListUtils";
import {
  SW_NOTIFICATION_CLICK_EVENT,
  SW_PUSH_RECEIVED_EVENT,
  type SwPushReceivedDetail,
} from "@/lib/swMessages";

interface Props {
  groupId: string;
  /** When true, the section refetches its list. Driver: parent calls
   *  this after the SignInModal flips from signed-out to signed-in.
   *  Falsy → don't fetch; the section renders nothing. */
  enabled: boolean;
  className?: string;
  /** Fired after a request is successfully approved/denied so the parent can
   *  refresh dependent UI (e.g. the member roster grows on approve). */
  onDecided?: (action: "approve" | "deny") => void;
}

export default function JoinRequestsSection({
  groupId,
  enabled,
  className = "mt-6",
  onDecided,
}: Props) {
  const [requests, setRequests] = useState<GroupJoinRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track per-request "deciding" state so a slow network doesn't let
  // the user double-tap and fire two decide POSTs.
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
  // Bump to force the fetch effect to re-run. Driven by service-worker
  // push/notification-click events for this group (see effect below).
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setRequests(null);
      return;
    }
    let cancelled = false;
    // Only show the loading spinner on the initial fetch; SW-triggered
    // refetches (refreshKey > 0) update in-place so an already-mounted
    // section doesn't flicker to blank when a push arrives.
    if (refreshKey === 0) setLoading(true);
    setError(null);
    apiListGroupJoinRequests(groupId)
      .then((data) => {
        if (cancelled) return;
        setRequests(data);
      })
      .catch((e) => {
        if (cancelled) return;
        // 403 / 404 here just means the caller isn't the creator or
        // the route is unresolvable — both fall through to "render
        // nothing", which the empty-list branch already handles. Log
        // anything else as an explicit error.
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          setRequests([]);
          return;
        }
        setError(
          e instanceof ApiError ? e.message : "Failed to load join requests",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, enabled, refreshKey]);

  // Auto-refresh when a join-request push arrives for THIS group, or
  // when the creator taps a notification whose URL targets this /info
  // page (in which case `client.navigate` was a no-op and React never
  // remounted). Both signals route through the same refetch.
  //
  // The `groupId` prop is whatever the URL contains — could be the
  // canonical groups.short_id OR the legacy UUID form. The push payload
  // always uses route_for_url (short_id when present) for `group_id`
  // AND the canonical UUID in `group_uuid`, so we match against either
  // — otherwise a creator on the UUID-form URL would never auto-refresh.
  useEffect(() => {
    if (!enabled) return;
    const groupInfoPath = `/g/${groupId}/info`;
    const shouldRefresh = (detail: SwPushReceivedDetail): boolean => {
      const tagMatch =
        !!detail.tag &&
        detail.tag.startsWith("join-request-") &&
        (detail.group_id === groupId || detail.group_uuid === groupId);
      const urlMatch =
        typeof detail.url === "string" &&
        isPathPrefix(detail.url, groupInfoPath);
      return tagMatch || urlMatch;
    };
    const onSwEvent = (event: Event) => {
      const detail = (event as CustomEvent<SwPushReceivedDetail>).detail;
      if (!detail) return;
      if (!shouldRefresh(detail)) return;
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener(SW_PUSH_RECEIVED_EVENT, onSwEvent);
    window.addEventListener(SW_NOTIFICATION_CLICK_EVENT, onSwEvent);
    return () => {
      window.removeEventListener(SW_PUSH_RECEIVED_EVENT, onSwEvent);
      window.removeEventListener(SW_NOTIFICATION_CLICK_EVENT, onSwEvent);
    };
  }, [groupId, enabled]);

  const decide = (request: GroupJoinRequest, action: "approve" | "deny") => {
    if (decidingIds.has(request.id)) return;
    haptic.medium();
    setDecidingIds((prev) => {
      const next = new Set(prev);
      next.add(request.id);
      return next;
    });
    setError(null);
    // Optimistically drop the row — the decided-on row will be gone
    // from the server's pending list on next reload anyway.
    setRequests((prev) =>
      prev ? prev.filter((r) => r.id !== request.id) : prev,
    );
    apiDecideGroupJoinRequest(groupId, request.id, action)
      .then(() => {
        // Let the parent refresh dependent UI — an approve adds the
        // requester to the group, so the member roster should grow.
        onDecided?.(action);
      })
      .catch((e) => {
        // Roll the row back so the creator can retry.
        setRequests((prev) => (prev ? [request, ...prev] : prev));
        setError(
          e instanceof ApiError ? e.message : "Failed to decide request",
        );
      })
      .finally(() => {
        setDecidingIds((prev) => {
          const next = new Set(prev);
          next.delete(request.id);
          return next;
        });
      });
  };

  // Render nothing during initial load (no need to show a spinner for a
  // section that's blank when empty), when not enabled, or when there
  // are no pending requests. The only visible states are "has
  // requests" and "had a load error".
  if (!enabled || loading || !requests) return null;
  if (requests.length === 0 && !error) return null;

  return (
    <section className={className}>
      <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        Pending requests
      </h2>
      {error && (
        <p
          className="px-1 mb-2 text-xs text-red-600 dark:text-red-400"
          role="status"
        >
          {error}
        </p>
      )}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {requests.map((r) => {
            const deciding = decidingIds.has(r.id);
            const displayName = r.requester_name?.trim() || null;
            // Primary label is the requester's name; fall back to their
            // email, then the passkey-only placeholder.
            const identity =
              displayName ?? r.requester_email ?? "Passkey user";
            // Secondary line: show the email under the name (only when we
            // actually have a name above it, so it isn't duplicated).
            const subLabel = displayName ? r.requester_email : null;
            const imageUrl = buildUserImageUrl(
              r.requester_user_id,
              r.requester_image_updated_at,
            );
            return (
              <li key={r.id} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <InitialBubble
                    name={displayName ?? r.requester_email ?? null}
                    imageUrl={imageUrl}
                    sizeClassName="w-9 h-9 shrink-0"
                    textSizeClassName="text-sm"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-gray-900 dark:text-white break-words">
                      {identity}
                    </span>
                    {subLabel && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 break-words">
                        {subLabel}
                      </span>
                    )}
                    <span className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      Requested {relativeTime(r.requested_at)}
                    </span>
                    {r.message && (
                      <span className="mt-1 text-sm text-gray-600 dark:text-gray-400 break-words whitespace-pre-wrap">
                        {r.message}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decide(r, "approve")}
                    disabled={deciding}
                    className="flex-1 h-10 rounded-full bg-green-600 hover:bg-green-700 active:scale-95 text-white text-sm font-medium disabled:opacity-50 transition-transform"
                    aria-label={`Approve request from ${identity}`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(r, "deny")}
                    disabled={deciding}
                    className="flex-1 h-10 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 text-gray-800 dark:text-gray-200 text-sm font-medium disabled:opacity-50 transition-transform"
                    aria-label={`Deny request from ${identity}`}
                  >
                    Deny
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

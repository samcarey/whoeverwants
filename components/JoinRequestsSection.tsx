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
 * Requester identity display:
 *   - Email when available (most users — magic-link sign-in always
 *     records one, OAuth merges via verified email).
 *   - "Passkey user" fallback for Phase D no-email accounts.
 *   - Message (if any) renders below the identity line in lighter
 *     text. Long messages truncate to 3 lines with an expandable
 *     "more" link (deferred — for v1, line-clamp-3 is enough).
 */

"use client";

import { useEffect, useState } from "react";

import {
  ApiError,
  apiDecideGroupJoinRequest,
  apiListGroupJoinRequests,
} from "@/lib/api";
import type { GroupJoinRequest } from "@/lib/api";
import { haptic } from "@/lib/haptics";

interface Props {
  groupId: string;
  /** When true, the section refetches its list. Driver: parent calls
   *  this after the SignInModal flips from signed-out to signed-in.
   *  Falsy → don't fetch; the section renders nothing. */
  enabled: boolean;
  className?: string;
}

export default function JoinRequestsSection({
  groupId,
  enabled,
  className = "mt-6",
}: Props) {
  const [requests, setRequests] = useState<GroupJoinRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track per-request "deciding" state so a slow network doesn't let
  // the user double-tap and fire two decide POSTs.
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      setRequests(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
            const identity = r.requester_email ?? "Passkey user";
            return (
              <li key={r.id} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-gray-900 dark:text-white break-words">
                    {identity}
                  </span>
                  {r.message && (
                    <span className="mt-0.5 text-sm text-gray-600 dark:text-gray-400 break-words whitespace-pre-wrap">
                      {r.message}
                    </span>
                  )}
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

/**
 * Phase G (group invite links) — creator-side invite management
 * section on /info.
 *
 * Two UI surfaces:
 *   1. List of active invites with per-row Copy + Revoke buttons.
 *      "Active" = not revoked, not expired, has remaining uses. The
 *      server filters this set; the FE just renders.
 *   2. "Create new invite link" button. v1 mints a multi-use,
 *      unlimited, no-expiry invite with no target poll — the simplest
 *      shape. Future iterations can layer a modal for mode / expiry /
 *      target controls without changing the API contract.
 *
 * Only mounted when the viewer is the recorded creator (the parent
 * /info page gates this via the same session + creator_user_id check
 * as `GroupPrivacySection`'s toggle + `JoinRequestsSection`).
 *
 * Token + URL display:
 *   - The list endpoint NEVER returns raw tokens — they're one-shot
 *     at create time. So an invite row from list mode shows
 *     "Active link" + use_count + Revoke; no Copy button (we don't
 *     have the URL to copy).
 *   - The newly-minted invite from `apiCreateGroupInvite` DOES carry
 *     `url` + `token`. We prepend it to the list and surface a Copy
 *     button for THAT row only. After page refresh / unmount, the
 *     URL is lost (matches the security model — server didn't keep
 *     it either).
 *
 * Empty active list (and no freshly-minted row) → just shows the
 * "Create new invite link" button; no "no invites yet" placeholder.
 */

"use client";

import { useEffect, useState } from "react";

import {
  ApiError,
  apiCreateGroupInvite,
  apiListGroupInvites,
  apiRevokeGroupInvite,
} from "@/lib/api";
import type { GroupInvite } from "@/lib/api";
import { haptic } from "@/lib/haptics";

interface Props {
  groupId: string;
  /** When false, the section renders nothing (used to gate on the
   *  creator check at the parent level). */
  enabled: boolean;
  className?: string;
}

export default function InviteLinksSection({
  groupId,
  enabled,
  className = "mt-6",
}: Props) {
  // `invites` is the server's view (no tokens). `freshUrls` is a
  // per-id Map of "this invite was minted in THIS browser session, so
  // we still have its raw URL". The merger below the JSX overlays
  // them so freshly-minted rows show a Copy button while
  // previously-existing rows don't.
  const [invites, setInvites] = useState<GroupInvite[] | null>(null);
  const [freshUrls, setFreshUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setInvites(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiListGroupInvites(groupId)
      .then((data) => {
        if (cancelled) return;
        setInvites(data);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          setInvites([]);
          return;
        }
        setError(
          e instanceof ApiError ? e.message : "Failed to load invites",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, enabled]);

  const createInvite = () => {
    if (creating) return;
    haptic.medium();
    setCreating(true);
    setError(null);
    // v1 defaults: multi-use, unlimited, no expiry, no target poll.
    // The modal-driven configuration UI is a follow-up.
    apiCreateGroupInvite(groupId, { mode: "multi" })
      .then((invite) => {
        setInvites((prev) => (prev ? [invite, ...prev] : [invite]));
        if (invite.url) {
          setFreshUrls((prev) => ({ ...prev, [invite.id]: invite.url! }));
        }
      })
      .catch((e) => {
        setError(
          e instanceof ApiError ? e.message : "Failed to create invite",
        );
      })
      .finally(() => setCreating(false));
  };

  const revokeInvite = (invite: GroupInvite) => {
    if (revokingIds.has(invite.id)) return;
    haptic.medium();
    setRevokingIds((prev) => {
      const next = new Set(prev);
      next.add(invite.id);
      return next;
    });
    setError(null);
    // Optimistically drop the row.
    setInvites((prev) =>
      prev ? prev.filter((i) => i.id !== invite.id) : prev,
    );
    setFreshUrls((prev) => {
      if (!(invite.id in prev)) return prev;
      const next = { ...prev };
      delete next[invite.id];
      return next;
    });
    apiRevokeGroupInvite(groupId, invite.id)
      .catch((e) => {
        setInvites((prev) => (prev ? [invite, ...prev] : prev));
        setError(
          e instanceof ApiError ? e.message : "Failed to revoke invite",
        );
      })
      .finally(() => {
        setRevokingIds((prev) => {
          const next = new Set(prev);
          next.delete(invite.id);
          return next;
        });
      });
  };

  const copyUrl = async (invite: GroupInvite, url: string) => {
    haptic.light();
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      // Clear the "Copied!" indicator after a short delay so the
      // user can tell repeated taps registered.
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === invite.id ? null : prev));
      }, 1800);
    } catch {
      // Last-resort fallback if Clipboard API is unavailable
      // (older WebViews, permissions blocked, etc.).
      window.prompt("Copy this URL:", url);
    }
  };

  if (!enabled || loading) return null;

  // Always render the create button when the section is enabled —
  // empty list is the common starting state.
  const list = invites ?? [];

  return (
    <section className={className}>
      <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        Invite links
      </h2>
      {error && (
        <p
          className="px-1 mb-2 text-xs text-red-600 dark:text-red-400"
          role="status"
        >
          {error}
        </p>
      )}
      {list.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden mb-3">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {list.map((invite) => {
              const url = freshUrls[invite.id];
              const revoking = revokingIds.has(invite.id);
              const usageLabel =
                invite.max_uses != null
                  ? `${invite.use_count}/${invite.max_uses} used`
                  : `${invite.use_count} used`;
              const modeLabel =
                invite.mode === "single" ? "Single use" : "Multi-use";
              return (
                <li key={invite.id} className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-gray-900 dark:text-white">
                      {modeLabel} · {usageLabel}
                    </span>
                    {url && (
                      <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-all">
                        {url}
                      </span>
                    )}
                    {!url && (
                      <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        Link only shown when first created.
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {url && (
                      <button
                        type="button"
                        onClick={() => copyUrl(invite, url)}
                        className="flex-1 h-10 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-medium transition-transform"
                        aria-label="Copy invite link"
                      >
                        {copiedId === invite.id ? "Copied!" : "Copy link"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => revokeInvite(invite)}
                      disabled={revoking}
                      className="flex-1 h-10 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 active:scale-95 text-gray-800 dark:text-gray-200 text-sm font-medium disabled:opacity-50 transition-transform"
                      aria-label="Revoke invite"
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={createInvite}
        disabled={creating}
        className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-medium rounded-full disabled:opacity-50 transition-transform"
      >
        {creating ? "Creating…" : "Create invite link"}
      </button>
    </section>
  );
}

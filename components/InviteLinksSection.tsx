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
 *   - A newly-minted invite (via `startInviteCreation`) DOES carry
 *     `url` + `token`. We prepend it to the list and surface a Copy
 *     button for THAT row only. After page refresh / unmount, the
 *     URL is lost (matches the security model — server didn't keep
 *     it either).
 *   - Every create AUTO-COPIES the fresh URL to the clipboard and
 *     flashes "Copied!" on the row — whether minted in place (the +
 *     button) or stashed by the group page's "Create Invite Link"
 *     CTA before sliding here (see lib/inviteCreation.ts).
 *
 * Empty active list (and no freshly-minted row) → just shows the
 * "Create new invite link" button; no "no invites yet" placeholder.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  apiListGroupInvites,
  apiRevokeGroupInvite,
} from "@/lib/api";
import type { GroupInvite } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import {
  peekInviteCreation,
  startInviteCreation,
} from "@/lib/inviteCreation";
import { compactDurationSince } from "@/lib/questionListUtils";

interface Props {
  groupId: string;
  /** When false, the section renders nothing (used to gate on the
   *  creator check at the parent level). */
  enabled: boolean;
  className?: string;
}

// The `&& e.message` guard matters: over HTTP/2 `res.statusText` is "",
// so an ApiError from a body-less error response can carry an empty
// message — which would render as a blank (invisible) error line.
const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof ApiError && e.message ? e.message : fallback;

// "Copied!" flash durations. Manual taps keep the snappy flash; auto-copies
// (every invite create auto-copies its URL) hold longer so the state is
// still visible after the page transition that often precedes it.
const MANUAL_COPY_FLASH_MS = 1800;
const AUTO_COPY_FLASH_MS = 4000;
// A stashed creation older than this (a late /info revisit within the
// stash TTL) keeps its Copy button but doesn't re-flash "Copied!" or
// re-surface a stale mint error.
const STASH_RECENCY_MS = 8000;

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

  // Set the "Copied!" indicator on a row, clearing after `ms` so the user
  // can tell repeated copies registered. useCallback([]) so the list-load
  // effect (which adopts a stashed creation) can reference it without a dep.
  const flashCopied = useCallback((inviteId: string, ms: number) => {
    setCopiedId(inviteId);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === inviteId ? null : prev));
    }, ms);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setInvites(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // The group page's "Create Invite Link" CTA mints the invite (and starts
    // the in-gesture clipboard write) BEFORE sliding here; adopt the stashed
    // creation so this view shows the fresh row with its Copy button +
    // "Copied!" state. Non-consuming peek — the slide-overlay handoff mounts
    // this section twice (overlay + real route) and both must agree.
    const pending = peekInviteCreation(groupId);
    const pendingIsRecent =
      pending !== null && Date.now() - pending.startedAt < STASH_RECENCY_MS;
    Promise.all([
      apiListGroupInvites(groupId),
      pending ? pending.invitePromise.catch(() => null) : Promise.resolve(null),
    ])
      .then(([data, minted]) => {
        if (cancelled) return;
        // The list GET can race the mint's commit — merge the minted invite
        // in when the server's list doesn't carry it yet.
        const merged =
          minted && !data.some((i) => i.id === minted.id)
            ? [minted, ...data]
            : data;
        setInvites(merged);
        if (minted?.url) {
          const url = minted.url;
          setFreshUrls((prev) => ({ ...prev, [minted.id]: url }));
        }
        if (pending && pendingIsRecent) {
          if (!minted) {
            setError("Failed to create invite");
          } else {
            pending.copiedPromise.then((ok) => {
              if (!cancelled && ok) flashCopied(minted.id, AUTO_COPY_FLASH_MS);
            });
          }
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          setInvites([]);
          return;
        }
        setError(errorMessage(e, "Failed to load invites"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, enabled, flashCopied]);

  const createInvite = () => {
    if (creating) return;
    haptic.medium();
    setCreating(true);
    setError(null);
    // v1 defaults: multi-use, unlimited, no expiry, no target poll.
    // The modal-driven configuration UI is a follow-up. The URL auto-copy
    // starts inside this tap's user-activation window (iOS requires the
    // clipboard write to be registered in-gesture — see copyTextFromPromise).
    const pending = startInviteCreation(groupId);
    pending.invitePromise
      .then((invite) => {
        setInvites((prev) => (prev ? [invite, ...prev] : [invite]));
        if (invite.url) {
          setFreshUrls((prev) => ({ ...prev, [invite.id]: invite.url! }));
        }
        pending.copiedPromise.then((ok) => {
          if (ok) flashCopied(invite.id, AUTO_COPY_FLASH_MS);
        });
      })
      .catch((e) => {
        setError(errorMessage(e, "Failed to create invite"));
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
      .catch(async (e) => {
        // 404 = the invite is already revoked/gone server-side. The goal
        // state is reached — keep the row removed, no error.
        if (e instanceof ApiError && e.status === 404) return;
        // Other failures are ambiguous: a network-level drop (deploy
        // window, lost connection, CORS-blocked 5xx) can occur AFTER the
        // server applied the revoke. Don't blindly resurrect the row —
        // re-sync from the server, which is the source of truth.
        const message = errorMessage(e, "Failed to revoke invite");
        try {
          const data = await apiListGroupInvites(groupId);
          setInvites(data);
          // Only surface the error if the invite genuinely survived.
          if (data.some((i) => i.id === invite.id)) setError(message);
        } catch {
          // Server unreachable — restore the row locally and report.
          setInvites((prev) => (prev ? [invite, ...prev] : prev));
          setError(message);
        }
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
      flashCopied(invite.id, MANUAL_COPY_FLASH_MS);
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
      <div className="px-1 mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
          Invite links
        </h2>
        <button
          type="button"
          onClick={createInvite}
          disabled={creating}
          aria-label="Create invite link"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white disabled:opacity-50 transition-transform"
        >
          {creating ? (
            <span className="text-xs">…</span>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          )}
        </button>
      </div>
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
              const age = invite.created_at
                ? compactDurationSince(invite.created_at)
                : null;
              return (
                <li key={invite.id} className="px-4 py-2.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">
                    {modeLabel} · {usageLabel}
                    {age && (
                      <span className="text-gray-400 dark:text-gray-500"> · {age}</span>
                    )}
                  </span>
                  {url && (
                    <button
                      type="button"
                      onClick={() => copyUrl(invite, url)}
                      className="shrink-0 px-3 h-8 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-medium transition-transform"
                      aria-label="Copy invite link"
                    >
                      {copiedId === invite.id ? "Copied!" : "Copy"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => revokeInvite(invite)}
                    disabled={revoking}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-600 dark:hover:text-red-400 active:scale-95 disabled:opacity-50 transition"
                    aria-label="Revoke invite"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

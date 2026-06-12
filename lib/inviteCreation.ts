/**
 * Invite-link creation with in-gesture auto-copy.
 *
 * Every "create invite link" affordance auto-copies the freshly-minted URL
 * to the clipboard and surfaces a "Copied!" state. The clipboard mechanics
 * live in `lib/clipboard.ts: copyTextFromPromise` (the write must be
 * registered synchronously inside the tap for iOS Safari's user-activation
 * rules; see that helper's doc).
 *
 * `startInviteCreation` bundles the mint + copy so both callers share one
 * implementation:
 *   - InviteLinksSection's "+" button (mint in place on /info).
 *   - The group page's "Create Invite Link" solo-group CTA, which mints
 *     in the tap, STASHES the in-flight creation, and slides to /info —
 *     where InviteLinksSection adopts the stash and renders the fresh row
 *     in its "Copied!" state. The stash peek is non-consuming because the
 *     slide-overlay handoff mounts /info twice (overlay + real route) and
 *     both instances must render the same fresh invite.
 */

import { apiCreateGroupInvite } from "@/lib/api";
import type { GroupInvite } from "@/lib/api";
import { copyTextFromPromise } from "@/lib/clipboard";

export interface PendingInviteCreation {
  invitePromise: Promise<GroupInvite>;
  /** Resolves true when the invite URL landed on the clipboard; false on
   *  any failure (mint rejected, clipboard unavailable/denied). Never
   *  rejects. */
  copiedPromise: Promise<boolean>;
  startedAt: number;
}

/** Mint a multi-use invite for the group and auto-copy its URL. Call from
 *  inside the user's tap so the clipboard write is activation-covered. */
export function startInviteCreation(groupId: string): PendingInviteCreation {
  const invitePromise = apiCreateGroupInvite(groupId, { mode: "multi" });
  // Leak guard: consumers attach their own handlers (possibly a tick later
  // via the stash); this no-op branch keeps a mint failure from surfacing
  // as an unhandled rejection in the meantime.
  invitePromise.catch(() => {});
  const copiedPromise = copyTextFromPromise(
    invitePromise.then((invite) => {
      if (!invite.url) throw new Error("invite carried no url");
      return invite.url;
    }),
  );
  return { invitePromise, copiedPromise, startedAt: Date.now() };
}

// --- Cross-page stash (group-page CTA → /info handoff) ---

// Sized to survive the slide + the real route's mount/list-load (even on a
// slow dev-server route compile), and nothing more: a later /info visit
// treats the invite like any other existing one (no URL, no Copy button),
// matching the "raw URL is shown once at create time" security model.
const STASH_TTL_MS = 8_000;
const stash = new Map<string, PendingInviteCreation>();

export function stashInviteCreation(
  groupId: string,
  pending: PendingInviteCreation,
): void {
  stash.set(groupId, pending);
  // Hard eviction (identity-guarded so a re-stash isn't clobbered): a tap
  // that never reaches /info would otherwise retain the resolved invite —
  // including its raw URL — for the page lifetime.
  window.setTimeout(() => {
    if (stash.get(groupId) === pending) stash.delete(groupId);
  }, STASH_TTL_MS);
}

/** Non-consuming peek — see the module comment for why (double-mount). */
export function peekInviteCreation(
  groupId: string,
): PendingInviteCreation | null {
  const pending = stash.get(groupId);
  if (!pending) return null;
  if (Date.now() - pending.startedAt > STASH_TTL_MS) {
    stash.delete(groupId);
    return null;
  }
  return pending;
}

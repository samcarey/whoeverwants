/**
 * Invite-link creation with in-gesture auto-copy.
 *
 * Every "create invite link" affordance auto-copies the freshly-minted URL
 * to the clipboard and surfaces a "Copied!" state. The wrinkle is iOS
 * Safari: `navigator.clipboard.writeText` is rejected when it runs outside
 * the tap's user-activation window — and the URL only exists once the mint
 * API resolves, which is always after that window. `ClipboardItem` accepts
 * promise-valued entries for exactly this case: the write is REGISTERED
 * synchronously inside the tap handler, and the browser fills in the text
 * when the promise resolves. `copyTextFromPromise` tries that path first
 * and falls back to an awaited `writeText` (fine on Chromium/Android).
 *
 * `startInviteCreation` bundles the mint + copy so both callers share one
 * implementation:
 *   - InviteLinksSection's "+" button (mint in place on /info).
 *   - The group page's "Create Invite Link" empty-state CTA, which mints
 *     in the tap, STASHES the in-flight creation, and slides to /info —
 *     where InviteLinksSection adopts the stash and renders the fresh row
 *     in its "Copied!" state. The stash peek is non-consuming because the
 *     slide-overlay handoff mounts /info twice (overlay + real route) and
 *     both instances must render the same fresh invite.
 */

import { apiCreateGroupInvite } from "@/lib/api";
import type { GroupInvite } from "@/lib/api";

export interface PendingInviteCreation {
  invitePromise: Promise<GroupInvite>;
  /** Resolves true when the invite URL landed on the clipboard; false on
   *  any failure (mint rejected, clipboard unavailable/denied). Never
   *  rejects. */
  copiedPromise: Promise<boolean>;
  startedAt: number;
}

/** Best-effort clipboard write fed by a promise. MUST be called
 *  synchronously inside a tap/click handler for the iOS path to work. */
export function copyTextFromPromise(
  textPromise: Promise<string>,
): Promise<boolean> {
  const fallback = async (): Promise<boolean> => {
    try {
      const text = await textPromise;
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        "text/plain": textPromise.then(
          (text) => new Blob([text], { type: "text/plain" }),
        ),
      });
      // A rejected write (no permission, or the text promise itself failed)
      // falls through to the awaited-writeText path, which either succeeds
      // (non-iOS engines without the promise-entry support) or resolves
      // false.
      return navigator.clipboard.write([item]).then(() => true, fallback);
    }
  } catch {
    // ClipboardItem constructor rejected the promise-valued entry shape
    // (older engines) — fall through.
  }
  return fallback();
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

// Generous TTL so the fresh URL's Copy button survives an /info remount
// within the session window; the "Copied!" flash itself is additionally
// gated on recency by the consumer so it doesn't re-fire on late visits.
const STASH_TTL_MS = 60_000;
const stash = new Map<string, PendingInviteCreation>();

export function stashInviteCreation(
  groupId: string,
  pending: PendingInviteCreation,
): void {
  stash.set(groupId, pending);
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

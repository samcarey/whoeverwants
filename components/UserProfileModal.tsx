"use client";

/**
 * The long-press → user profile modal. Shows another user's name, a larger
 * avatar, their account age, and the EVENTS the caller and this person were
 * both confirmed into (they actually gathered), most recent first. Opened
 * via `openUserProfileCard(userId)`; mounted once by <UserProfileModalHost>
 * in the root layout.
 */

import { useEffect, useState } from "react";
import ModalPortal from "@/components/ModalPortal";
import InitialBubble from "@/components/InitialBubble";
import ConfirmationModal from "@/components/ConfirmationModal";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import {
  apiForgetUserContact,
  apiGetUserProfileCard,
  buildUserImageUrl,
  type UserProfileCard,
} from "@/lib/api/users";
import { apiBlockUser, apiUnblockUser } from "@/lib/api/friends";
import {
  FRIENDS_CHANGED_EVENT,
  USER_CONTACT_FORGOTTEN_EVENT,
  type UserContactForgottenDetail,
} from "@/lib/eventChannels";
import { haptic } from "@/lib/haptics";
import { relativeTime } from "@/lib/questionListUtils";
import { formatDayLabel } from "@/lib/timeUtils";

interface UserProfileModalProps {
  userId: string;
  /** Shown immediately (header) while the card loads. */
  fallbackName?: string | null;
  onClose: () => void;
}

export default function UserProfileModal({
  userId,
  fallbackName,
  onClose,
}: UserProfileModalProps) {
  const [card, setCard] = useState<UserProfileCard | null>(null);
  const [error, setError] = useState(false);
  // Forget-contact flow (only offered when no groups are shared — without a
  // shared group the contact row is the only reason this person keeps
  // surfacing, and the server-side reconcile won't re-add them).
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState(false);
  // Block flow — offered for EVERYONE (the modal is the universal person
  // surface, so this is how you block someone who isn't a friend and never
  // sent a request). Same swap-in confirmation shape as Forget.
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError(false);
    (async () => {
      try {
        const result = await apiGetUserProfileCard(userId);
        if (!cancelled) setCard(result);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // iOS-safe background-scroll lock (shared hook — see Document Scroll
  // Architecture notes; overflow:hidden alone doesn't block iOS PTR).
  useBodyScrollLock(true);
  // Escape closes — gated off while the forget confirmation is up, since
  // ConfirmationModal registers its own Escape→onCancel; without the gate a
  // single press would dismiss BOTH (the stacked-modal double-fire pitfall).
  // Re-registering on toggle is harmless here (plain listener, no body lock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmingForget && !confirmingBlock) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirmingForget, confirmingBlock]);

  const confirmForget = async () => {
    if (forgetting) return;
    haptic.medium();
    setForgetting(true);
    try {
      await apiForgetUserContact(userId);
      // Tell mounted contact-driven lists (the invite-members screen) to drop
      // this person — the modal lives at the layout level, so props can't.
      window.dispatchEvent(
        new CustomEvent<UserContactForgottenDetail>(
          USER_CONTACT_FORGOTTEN_EVENT,
          { detail: { userId } },
        ),
      );
      onClose();
    } catch {
      setForgetting(false);
      setConfirmingForget(false);
      setForgetError(true);
    }
  };

  const confirmBlock = async () => {
    if (blockBusy) return;
    haptic.medium();
    setBlockBusy(true);
    try {
      await apiBlockUser(userId);
      window.dispatchEvent(new Event(FRIENDS_CHANGED_EVENT));
      onClose();
    } catch {
      setBlockBusy(false);
      setConfirmingBlock(false);
      setBlockError(true);
    }
  };

  const unblock = async () => {
    if (blockBusy) return;
    setBlockBusy(true);
    try {
      await apiUnblockUser(userId);
      window.dispatchEvent(new Event(FRIENDS_CHANGED_EVENT));
      const refreshed = await apiGetUserProfileCard(userId).catch(() => null);
      if (refreshed) setCard(refreshed);
    } catch {
      setBlockError(true);
    } finally {
      setBlockBusy(false);
    }
  };

  const displayName = card?.name ?? fallbackName ?? null;
  const imageUrl = card
    ? buildUserImageUrl(card.user_id, card.image_updated_at)
    : null;

  // While confirming, render ONLY the confirmation: ConfirmationModal sits at
  // z-[70], below this modal's z-[80], so stacking the two would hide it —
  // swapping (like MemberActionsSheet's close-then-confirm) keeps the z-index
  // conventions intact, and cancel restores the still-mounted profile view.
  if (confirmingBlock) {
    return (
      <ConfirmationModal
        isOpen={true}
        onConfirm={confirmBlock}
        onCancel={() => {
          if (!blockBusy) setConfirmingBlock(false);
        }}
        message={`Block ${displayName ?? "this person"}? They won't be able to send you friend requests, and you'll never be suggested for events together.`}
        confirmText={blockBusy ? "Blocking…" : "Block"}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
      />
    );
  }

  if (confirmingForget) {
    return (
      <ConfirmationModal
        isOpen={true}
        onConfirm={confirmForget}
        onCancel={() => {
          if (!forgetting) setConfirmingForget(false);
        }}
        message={`Forget ${displayName ?? "this person"}? They'll be removed from your contacts and won't show up when you add people to a group or respond for others.`}
        confirmText={forgetting ? "Forgetting…" : "Forget"}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
      />
    );
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={onClose}
        />
        <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-sm w-full max-h-[80vh] overflow-y-auto px-5 py-5">
          <div className="flex flex-col items-center text-center">
            <InitialBubble
              name={displayName}
              imageUrl={imageUrl}
              sizeClassName="w-24 h-24"
              textSizeClassName="text-3xl"
            />
            <h2 className="mt-3 text-xl font-bold text-gray-900 dark:text-white break-words">
              {displayName ?? "Member"}
            </h2>
            {card && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Joined {relativeTime(card.created_at)}
              </p>
            )}
          </div>

          {error ? (
            <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
              Couldn&apos;t load this profile.
            </p>
          ) : !card ? (
            <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
              Loading…
            </p>
          ) : (
            <div className="mt-5">
              {/* Events BOTH people were confirmed into (they actually
                  gathered), most recent first — replaced the shared-groups
                  list (shared_groups still gates the Forget button). */}
              <h3 className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Events together
              </h3>
              {card.shared_events.length === 0 ? (
                <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
                  No events together yet.
                </p>
              ) : (
                <ul className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
                  {card.shared_events.map((e) => (
                    <li
                      key={`${e.day}#${e.activity}`}
                      className="flex items-center gap-2 px-4 py-3 text-sm"
                    >
                      <span className="shrink-0" aria-hidden="true">
                        {e.emoji ?? "📅"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-white">
                        {e.activity}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                        {formatDayLabel(e.day)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {blockError && (
                <p className="px-1 mt-2 text-xs text-red-600 dark:text-red-400" role="status">
                  Couldn&apos;t update the block. Try again.
                </p>
              )}
              {card.viewer_has_blocked ? (
                <button
                  type="button"
                  onClick={() => void unblock()}
                  disabled={blockBusy}
                  className="mt-3 w-full py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium transition-all active:scale-95 disabled:opacity-50"
                >
                  {blockBusy ? "Unblocking…" : "Blocked — tap to unblock"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingBlock(true)}
                  className="mt-3 w-full py-2.5 rounded-xl border border-red-300 dark:border-red-500/60 text-red-600 dark:text-red-400 text-sm font-medium transition-all active:scale-95"
                >
                  Block
                </button>
              )}
              {card.shared_groups.length === 0 && (
                <>
                  {forgetError && (
                    <p
                      className="px-1 mt-2 text-xs text-red-600 dark:text-red-400"
                      role="status"
                    >
                      Couldn&apos;t forget this person. Try again.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmingForget(true)}
                    className="mt-3 w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-all active:scale-95"
                  >
                    Forget
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

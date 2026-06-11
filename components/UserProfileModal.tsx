"use client";

/**
 * The long-press → user profile modal. Shows another user's name, a larger
 * avatar, their account age, and the groups the caller shares with them.
 * Opened via `openUserProfileCard(userId)`; mounted once by
 * <UserProfileModalHost> in the root layout.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  USER_CONTACT_FORGOTTEN_EVENT,
  type UserContactForgottenDetail,
} from "@/lib/eventChannels";
import { haptic } from "@/lib/haptics";
import { relativeTime } from "@/lib/questionListUtils";

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
  const router = useRouter();
  const [card, setCard] = useState<UserProfileCard | null>(null);
  const [error, setError] = useState(false);
  // Forget-contact flow (only offered when no groups are shared — without a
  // shared group the contact row is the only reason this person keeps
  // surfacing, and the server-side reconcile won't re-add them).
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState(false);

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
      if (e.key === "Escape" && !confirmingForget) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirmingForget]);

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

  const displayName = card?.name ?? fallbackName ?? null;
  const imageUrl = card
    ? buildUserImageUrl(card.user_id, card.image_updated_at)
    : null;

  const goToGroup = (routeId: string) => {
    onClose();
    router.push(`/g/${routeId}`);
  };

  // While confirming, render ONLY the confirmation: ConfirmationModal sits at
  // z-[70], below this modal's z-[80], so stacking the two would hide it —
  // swapping (like MemberActionsSheet's close-then-confirm) keeps the z-index
  // conventions intact, and cancel restores the still-mounted profile view.
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
              <h3 className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {card.shared_groups.length}{" "}
                {card.shared_groups.length === 1
                  ? "Shared group"
                  : "Shared groups"}
              </h3>
              {card.shared_groups.length === 0 ? (
                <>
                  <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
                    No groups in common.
                  </p>
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
              ) : (
                <ul className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
                  {card.shared_groups.map((g) => (
                    <li key={g.routeId}>
                      <button
                        type="button"
                        onClick={() => goToGroup(g.routeId)}
                        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-gray-700/50"
                      >
                        <span className="min-w-0 truncate">
                          {g.name ?? "Group"}
                        </span>
                        <svg
                          className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

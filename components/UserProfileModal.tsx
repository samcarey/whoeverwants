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
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import {
  apiGetUserProfileCard,
  buildUserImageUrl,
  type UserProfileCard,
} from "@/lib/api/users";
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
  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = card?.name ?? fallbackName ?? null;
  const imageUrl = card
    ? buildUserImageUrl(card.user_id, card.image_updated_at)
    : null;

  const goToGroup = (routeId: string) => {
    onClose();
    router.push(`/g/${routeId}`);
  };

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
                <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
                  No groups in common.
                </p>
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

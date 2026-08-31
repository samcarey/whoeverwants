"use client";

/**
 * Read-only preview of one of the caller's contact groups — opened by
 * tapping a group pill somewhere navigation would be disruptive (the slot
 * sheet's With/Without fields, mid-edit). Lists the group's people and
 * nested groups; tapping a person opens the shared profile modal (which
 * stacks above at z-[80]), tapping a nested group drills into it here.
 *
 * z-[75]: above the slot sheet (z-60), below UserProfileModal (z-[80]).
 */

import { useEffect, useState } from "react";
import ModalPortal from "@/components/ModalPortal";
import InitialBubble from "@/components/InitialBubble";
import { GroupGlyph } from "@/components/CandidatePicker";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { openUserProfileCard } from "@/lib/useUserProfile";
import { buildUserImageUrl } from "@/lib/api/users";
import {
  apiGetFriendsOverview,
  getCachedFriendsOverview,
  type FriendsOverview,
} from "@/lib/api/friends";

interface ContactGroupPreviewModalProps {
  groupId: string;
  onClose: () => void;
}

export default function ContactGroupPreviewModal({
  groupId,
  onClose,
}: ContactGroupPreviewModalProps) {
  // Drilling into a nested group swaps this — the ✕ still closes the whole
  // preview (one layer of modal, not a stack per nesting level).
  const [currentId, setCurrentId] = useState(groupId);
  const [overview, setOverview] = useState<FriendsOverview | null>(() =>
    getCachedFriendsOverview(),
  );

  useBodyScrollLock(true);

  useEffect(() => {
    let cancelled = false;
    apiGetFriendsOverview()
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const group = overview?.groups.find((g) => g.id === currentId) ?? null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 px-6"
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm rounded-3xl bg-white dark:bg-gray-800 p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="flex items-center gap-2 min-w-0 text-lg font-semibold text-gray-900 dark:text-white">
              <GroupGlyph className="w-5 h-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <span className="truncate">{group?.name ?? "Group"}</span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {!group ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {overview ? "This group doesn't exist anymore." : "Loading…"}
            </p>
          ) : group.members.length === 0 && group.child_groups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Empty group.</p>
          ) : (
            <ul className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-200 dark:divide-gray-700 max-h-72 overflow-y-auto">
              {group.child_groups.map((cg) => (
                <li key={cg.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentId(cg.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-gray-700/50"
                  >
                    <GroupGlyph className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500" />
                    <span className="min-w-0 flex-1 truncate">{cg.name}</span>
                    <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              ))}
              {group.members.map((m) => (
                <li key={m.user_id}>
                  <button
                    type="button"
                    onClick={() => openUserProfileCard(m.user_id, m.name ?? undefined)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm text-gray-900 dark:text-white active:bg-gray-100 dark:active:bg-gray-700/50"
                  >
                    <InitialBubble
                      name={m.name?.trim() || null}
                      imageUrl={
                        m.image_updated_at
                          ? buildUserImageUrl(m.user_id, m.image_updated_at)
                          : null
                      }
                      sizeClassName="w-7 h-7"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {m.name?.trim() || "Someone"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

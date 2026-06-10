"use client";

import type { ReactNode } from "react";

import InitialBubble from "@/components/InitialBubble";
import { useProfileLongPress } from "@/lib/useUserProfile";

/**
 * One person row in a group members / poll respondents roster: avatar + name,
 * long-pressable (desktop: click) to open their profile modal. `userId` null
 * (anonymous, or the viewer's own row) disables the trigger. `bubbleName` null
 * → the gray anonymous-fallback avatar (used for the viewer's "You" row).
 *
 * `isAdmin` (migration 142) renders an "Admin" badge; `actions` is an optional
 * right-aligned slot (the group /info page passes promote/boot buttons for
 * admins). Action buttons should `stopPropagation` on pointerdown so a press on
 * them doesn't also fire the row's long-press → profile.
 *
 * Extracted so `useProfileLongPress` is a top-level hook (callers render this
 * inside a `.map`, where the hook can't be called directly).
 */
export default function RosterRow({
  displayName,
  bubbleName,
  imageUrl,
  userId,
  isAdmin = false,
  actions,
}: {
  displayName: string;
  bubbleName: string | null;
  imageUrl: string | null;
  userId: string | null;
  isAdmin?: boolean;
  actions?: ReactNode;
}) {
  const lp = useProfileLongPress(userId, bubbleName ?? displayName);
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 text-gray-900 dark:text-white select-none${
        userId ? " cursor-pointer" : ""
      }`}
      {...lp}
    >
      <InitialBubble
        name={bubbleName}
        imageUrl={imageUrl}
        sizeClassName="w-8 h-8"
        className="shrink-0"
      />
      <span className="min-w-0 break-words flex-1">{displayName}</span>
      {isAdmin && (
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-full px-2 py-0.5">
          Admin
        </span>
      )}
      {actions}
    </li>
  );
}

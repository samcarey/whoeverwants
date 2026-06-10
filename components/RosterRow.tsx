"use client";

import InitialBubble from "@/components/InitialBubble";
import { useProfileLongPress } from "@/lib/useUserProfile";

/**
 * One person row in a group members / poll respondents roster: avatar + name,
 * long-pressable (desktop: click) to open their profile modal. `userId` null
 * (anonymous, or the viewer's own row) disables the trigger. `bubbleName` null
 * → the gray anonymous-fallback avatar (used for the viewer's "You" row).
 *
 * Extracted so `useProfileLongPress` is a top-level hook (callers render this
 * inside a `.map`, where the hook can't be called directly).
 */
export default function RosterRow({
  displayName,
  bubbleName,
  imageUrl,
  userId,
}: {
  displayName: string;
  bubbleName: string | null;
  imageUrl: string | null;
  userId: string | null;
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
      <span className="min-w-0 break-words">{displayName}</span>
    </li>
  );
}

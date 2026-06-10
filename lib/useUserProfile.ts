/**
 * Long-press → user-profile-modal plumbing.
 *
 * `useProfileLongPress(userId, name?)` returns handlers to spread onto any
 * element that renders ANOTHER user's name or avatar (group members list,
 * poll respondents, poll creator, invite-members).
 *   - Mouse (desktop): a simple CLICK opens the profile modal.
 *   - Touch: a 500ms long-press opens it (a plain tap is left for the
 *     element's own onClick, e.g. selecting an invite-members row); movement
 *     >10px (a scroll) cancels.
 * When it acts it stops propagation, so attaching it to an inner element
 * (e.g. an invite row's avatar) won't also fire the row's onClick.
 *
 * Disabled (returns no handlers) when `userId` is null/undefined — used for
 * anonymous/legacy participants and for the viewer's own entries, so you can
 * never long-press yourself.
 *
 * The open event is consumed by <UserProfileModalHost> mounted once in the
 * root layout — same module-level-event + host pattern as the slide overlay.
 */

import { useRef } from "react";
import { haptic } from "@/lib/haptics";

export const USER_PROFILE_OPEN_EVENT = "whoeverwants:open-user-profile";

export interface OpenUserProfileDetail {
  userId: string;
  /** Optional name to show immediately while the card loads. */
  name?: string | null;
}

export function openUserProfileCard(userId: string, name?: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenUserProfileDetail>(USER_PROFILE_OPEN_EVENT, {
      detail: { userId, name },
    }),
  );
}

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

type ProfileLongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
};

export function useProfileLongPress(
  userId: string | null | undefined,
  name?: string | null,
): Partial<ProfileLongPressHandlers> {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const fired = useRef(false);
  const lastPointerType = useRef<string>("");

  // Hooks above the early return keep hook-order stable across enabled flips.
  if (!userId) return {};

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      lastPointerType.current = e.pointerType;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        haptic.medium();
        openUserProfileCard(userId, name);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (
        timer.current &&
        Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
          MOVE_CANCEL_PX
      ) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // Suppress the OS context menu / iOS callout the long-press would trigger.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => {
      // A long-press already opened the modal → swallow the trailing click so
      // it doesn't also fire the element's own onClick (e.g. an invite row's
      // toggle).
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Desktop: a simple click opens the profile. (Touch taps fall through —
      // the element's own onClick, if any, handles them; long-press is the
      // touch gesture.) stopPropagation so a parent onClick doesn't also fire.
      if (lastPointerType.current === "mouse") {
        e.preventDefault();
        e.stopPropagation();
        openUserProfileCard(userId, name);
      }
    },
  };
}

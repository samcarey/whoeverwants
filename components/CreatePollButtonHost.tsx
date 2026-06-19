"use client";

/**
 * Layout-level mount of the group page's floating "Poll" button — the
 * counterpart to the home page's "+ Group" button (CreateGroupButtonHost).
 *
 * Tapping it slides to the dedicated New-Poll draft page
 * (`/g/<id>/new-poll`), where CreateQuestionContent's search box + draft-stack
 * UI is portaled in. It replaces the inline create-poll box that used to sit at
 * the top of the group scroll.
 *
 * Mounted at layout level (like CreateGroupButtonHost) so it's a single
 * persistent DOM node — its position can't jump between route states.
 *
 * Visible only on a group ROOT view with an id (`/g/<id>`) AND not during a
 * group→home swipe-back (when the home "+ Group" button is the one being
 * revealed). The two FABs share the bottom-right slot but are never visible at
 * the same time:
 *   - group root at rest      → Poll visible, Group hidden
 *   - group→home swipe-back   → Poll hidden (homeBackdrop), Group revealed
 *   - subroute / poll detail  → both hidden (pathname isn't a group root; the
 *                               slide overlay's z-60 covers the z-50 FAB during
 *                               the transition, and the committed URL hides it)
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { slideToNewPollDraft } from "@/lib/slideOverlay";
import { primeIosKeyboard } from "@/lib/iosKeyboardPrimer";
import { useHomeBackdropActive } from "@/lib/useHomeBackdropActive";
import { haptic } from "@/lib/haptics";

const IS_CAPACITOR_NATIVE =
  typeof window !== "undefined" && Capacitor.isNativePlatform();

// Matches `/g/<id>` (and a trailing slash) but NOT `/g`, `/g/`, or any
// subroute (`/g/<id>/info`, `/g/<id>/new-poll`, `/g/<id>/p/...`). So the
// button shows only on a real group root, never on the empty placeholder
// (which keeps its inline box) or the draft page itself.
const GROUP_ROOT_WITH_ID = /^\/g\/[^/]+\/?$/;

export default function CreatePollButtonHost(): React.ReactElement | null {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  // Hide during a group→home swipe-back (the home "+ Group" button is the one
  // being revealed then; this shared hook tracks that gesture).
  const homeSwipeActive = useHomeBackdropActive();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  const target = document.getElementById("floating-fab-portal");
  if (!target) return null;

  const match = pathname.match(GROUP_ROOT_WITH_ID);
  const groupId = match ? pathname.replace(/^\/g\//, "").replace(/\/$/, "") : null;
  const visible = !!groupId && !homeSwipeActive;

  const onClick = () => {
    if (!groupId) return;
    haptic.medium();
    // Claim the iOS soft keyboard synchronously in the tap so the draft page's
    // auto-focus can keep it up across the slide navigation (released there).
    primeIosKeyboard();
    slideToNewPollDraft({ groupId });
  };

  return createPortal(
    <button
      onClick={onClick}
      className="fixed h-12 px-[16.56px] rounded-full flex items-center justify-center gap-1.5 bg-blue-500 dark:bg-blue-600 active:bg-blue-600 dark:active:bg-blue-500 shadow-md shadow-black/20 cursor-pointer text-white font-normal"
      style={{
        zIndex: 50,
        right: "max(1.5rem, env(safe-area-inset-right, 0px))",
        bottom: IS_CAPACITOR_NATIVE ? "2.65rem" : "1.9rem",
        // Permanent GPU layer so the button's subpixel rasterization is stable
        // (matches CreateGroupButtonHost — avoids a 1-3px jump when sibling
        // layers promote/demote during a slide/swipe).
        transform: "translateZ(0)",
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-label="Create new poll"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <span aria-hidden="true" className="text-[28.8px] leading-none">
        +
      </span>
      <span className="text-lg leading-none">Poll</span>
    </button>,
    target,
  );
}

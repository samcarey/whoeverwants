"use client";

/**
 * Layout-level mount of the groups page's "+ Group" button.
 *
 * Previously rendered inline in `app/template.tsx` via createPortal and
 * gated on `pathname === '/'`. The group→home swipe-back gesture revealed a
 * subtle layout issue: while the gesture was in flight the home page hadn't
 * mounted yet, so the button wasn't on the page; the swipe-back backdrop
 * (HomeBackdropHost) painted a *fake* button at the matching coordinates as
 * a stand-in. After commit, the real button mounted and took over —
 * producing a small visible jump on some iOS devices because the two button
 * instances had slightly different rendering footprints.
 *
 * This host fixes that by mounting ONE persistent button at layout level
 * and toggling its visibility via opacity. The DOM node is the same the
 * entire time, so its position can't jump between states.
 *
 * Visible when the group list is showing, i.e.:
 *   - on `/groups`, OR
 *   - a group→/groups swipe-back is in flight (SHOW/HIDE events from
 *     GroupContent), so the button is revealed with the rest of that page.
 * Home is the playlist and creates slots from the "+" beside its own header,
 * so it has no floating button.
 *
 * Hidden everywhere else; the hidden state uses opacity:0 +
 * pointer-events:none so the element stays in flow with identical layout.
 *
 * Also the layout-level mount point for <NewSlotSheet> — the sheet is driven
 * by the slot-sheet event channel (the playlist's header "+" opens it), so it
 * stays mounted on every route, whether or not this button is visible.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { slideToNewGroup } from "@/lib/slideOverlay";
import { rememberCurrentScroll, GROUPS_SCROLL_KEY } from "@/lib/scrollMemory";
import { apiCreateGroup } from "@/lib/api";
import { GROUP_ID_ATTR } from "@/lib/groupDomMarkers";
import { useHomeBackdropActive, useGroupsBackdropActive } from "@/lib/useHomeBackdropActive";
import { haptic } from "@/lib/haptics";
import { getUserName } from "@/lib/userProfile";
import { isValidUserName } from "@/lib/nameValidation";
import AccountGateModal from "@/components/AccountGateModal";
import NewSlotSheet from "@/components/NewSlotSheet";

const IS_CAPACITOR_NATIVE =
  typeof window !== "undefined" && Capacitor.isNativePlatform();

export default function CreateGroupButtonHost(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const inFlight = useRef(false);
  const [mounted, setMounted] = useState(false);
  // Two gestures matter here (shared listener hooks):
  //   - group→/groups: this backdrop is what the FAB belongs to, so it must be
  //     REVEALED under the sliding group page (z-1, below).
  //   - /groups→home: the FAB is leaving with the page, so it just hides.
  const groupsBackdropActive = useGroupsBackdropActive();
  const homeBackdropActive = useHomeBackdropActive();
  const [nameModalOpen, setNameModalOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  const target = document.getElementById("floating-fab-portal");
  if (!target) return null;

  // The button belongs to the group list at /groups. Home is the playlist,
  // which creates slots from the "+" beside its own header — so no floating
  // button there. Visible on /groups (but not while it's sliding away toward
  // home), and during a group→/groups swipe so it's revealed with the rest of
  // that page.
  const isGroups = pathname === "/groups" || pathname === "/groups/";
  const visible = (isGroups && !homeBackdropActive) || groupsBackdropActive;

  const startCreate = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    haptic.medium();
    rememberCurrentScroll(GROUPS_SCROLL_KEY);
    slideToNewGroup();
    apiCreateGroup()
      .then((summary) => {
        const routeId = summary.short_id || summary.id;
        document.body.setAttribute(GROUP_ID_ATTR, summary.id);
        router.push(`/g/${routeId}`);
      })
      .catch(() => {
        router.push("/g");
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  const onClick = () => {
    if (inFlight.current) return;
    if (!isValidUserName(getUserName())) {
      setNameModalOpen(true);
      return;
    }
    startCreate();
  };

  return createPortal(
    <>
    <button
      onClick={onClick}
      className="fixed h-12 px-[16.56px] rounded-full flex items-center justify-center gap-1.5 bg-blue-500 dark:bg-blue-600 active:bg-blue-600 dark:active:bg-blue-500 shadow-md shadow-black/20 cursor-pointer text-white font-normal"
      style={{
        // z-50 normally (floats above page content). DURING a group→/groups
        // swipe-back, drop to z-1: that's above the z-0 groups backdrop but
        // below the sliding group page's z-2 wrapper, so the button is
        // REVEALED as that page slides off rather than popping on top at
        // swipe start.
        zIndex: groupsBackdropActive && !isGroups ? 1 : 50,
        right: "max(1.5rem, env(safe-area-inset-right, 0px))",
        bottom: IS_CAPACITOR_NATIVE ? "2.65rem" : "1.9rem",
        // Pin to a permanent GPU layer so the button's subpixel
        // rasterization is stable regardless of what's happening to other
        // layers. Without this, the swipe wrapper's `translate3d(...)`
        // promotion + demotion lets the browser repaint this sibling
        // button with a 1-3px subpixel shift, producing a visible jump
        // when the gesture commits.
        transform: "translateZ(0)",
        // `visibility` (not `opacity`) so there's no fade animation. A
        // 150ms opacity transition triggers GPU compositing of its own
        // and was contributing to the same subpixel-shift class of bug.
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-label="Create new group"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <span aria-hidden="true" className="text-[28.8px] leading-none">
        +
      </span>
      <span className="text-lg leading-none">Group</span>
    </button>
    <NewSlotSheet />
    <AccountGateModal
      isOpen={nameModalOpen}
      message="to create a new group"
      onSubmit={() => {
        setNameModalOpen(false);
        startCreate();
      }}
      onCancel={() => setNameModalOpen(false)}
    />
    </>,
    target,
  );
}

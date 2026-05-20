"use client";

/**
 * Mirrors HomeBackdropHost for the poll→group swipe-back. Unlike home
 * (a static GroupList snapshot), the group page is rendered via
 * GroupContent itself — same pattern the slide overlay uses. The
 * `overlayCardsOffset` prop tells GroupContent to skip window.scrollTo
 * (which would otherwise scroll the still-mounted PollDetail underneath)
 * and translate the cards wrapper instead.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GroupContent } from "@/app/g/[groupShortId]/GroupPage";
import { getRememberedScroll, groupScrollKey } from "@/lib/scrollMemory";
import {
  HIDE_GROUP_BACKDROP_EVENT,
  SHOW_GROUP_BACKDROP_EVENT,
  type GroupBackdropShowDetail,
} from "@/lib/eventChannels";

export default function GroupBackdropHost(): React.ReactElement | null {
  const [groupId, setGroupId] = useState<string | null>(null);

  useEffect(() => {
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent<GroupBackdropShowDetail>).detail;
      if (!detail?.groupId) return;
      setGroupId(detail.groupId);
    };
    const onHide = () => setGroupId(null);
    window.addEventListener(SHOW_GROUP_BACKDROP_EVENT, onShow);
    window.addEventListener(HIDE_GROUP_BACKDROP_EVENT, onHide);
    return () => {
      window.removeEventListener(SHOW_GROUP_BACKDROP_EVENT, onShow);
      window.removeEventListener(HIDE_GROUP_BACKDROP_EVENT, onHide);
    };
  }, []);

  if (!groupId || typeof document === "undefined") return null;

  // Passing a defined value (including 0) is what makes GroupContent skip
  // its own window.scrollTo — see the overlayCardsOffset gate there.
  const savedScroll = getRememberedScroll(groupScrollKey(groupId)) ?? 0;

  return createPortal(
    <div className="font-[family-name:var(--font-geist-sans)]">
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background: "var(--background)",
          overflowX: "hidden",
          overflowY: "auto",
          paddingLeft: "max(0.35rem, env(safe-area-inset-left))",
          paddingRight: "max(0.35rem, env(safe-area-inset-right))",
          // Contains the backdrop's z-20 GroupHeader so it doesn't escape
          // to body level and paint over PollDetail's still-mounted z-20
          // header. Same pattern as SlideOverlayHost.
          contain: "strict",
        }}
      >
        <div
          className="max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4"
          style={{ paddingBottom: "0.5rem" }}
        >
          <GroupContent
            key={groupId}
            groupId={groupId}
            overlayCardsOffset={savedScroll}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

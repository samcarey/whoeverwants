"use client";

/**
 * Body-level backdrop that mirrors the real group route. Mounted in
 * app/layout.tsx so it persists across the router.push that commits a
 * swipe-back gesture from /g/<group>/p/<poll> to /g/<group> — without this
 * persistence the backdrop would unmount alongside PollDetail and there'd
 * be a blank frame between PollDetail's unmount and the real group page's
 * first paint.
 *
 * Mirrors `<HomeBackdropHost />` but renders the group page instead of home.
 * Unlike home (which uses a static `<GroupList>` snapshot), the group page
 * is rendered via `<GroupContent>` itself — the slide overlay already uses
 * this exact pattern, and the `overlayCardsOffset` prop tells GroupContent
 * to skip `window.scrollTo` (which would otherwise interfere with the
 * still-mounted PollDetail's scroll) and translate the cards wrapper
 * instead.
 *
 * Lifecycle:
 *   - SHOW_GROUP_BACKDROP_EVENT (from PollDetail's swipe-lock path) → mount
 *   - HIDE_GROUP_BACKDROP_EVENT (from snap-back/cancel OR GroupPageInner's
 *     mount effect) → unmount
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

  // Pre-position to the user's saved scroll for this group (set when they
  // navigated away to the poll detail page). Passing a defined value
  // (including 0) makes GroupContent skip its own window.scrollTo, which
  // would otherwise scroll the still-mounted poll detail page underneath.
  const savedScroll = getRememberedScroll(groupScrollKey(groupId)) ?? 0;

  return createPortal(
    // Mirror template.tsx's outer wrapper so the backdrop's content lines
    // up pixel-for-pixel with the real group route. Same pattern as
    // HomeBackdropHost and SlideOverlayHost (group kind).
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
          // Contain the backdrop's fixed-positioned GroupHeader so it doesn't
          // escape to body level — without this, the backdrop's z-20 header
          // and the still-mounted PollDetail's z-20 header collide visually
          // (later DOM order wins, so the backdrop's header would paint over
          // the sliding PollDetail header). Same pattern as SlideOverlayHost.
          // Cards-wrapper positioning uses overlayCardsOffset (a transform)
          // rather than scrollTop, sidestepping the WebKit quirk where
          // position:fixed children of contain:strict scroll with content.
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

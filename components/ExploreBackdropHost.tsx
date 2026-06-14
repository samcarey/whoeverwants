"use client";

/**
 * Mirrors GroupBackdropHost for the poll-detail → /explore swipe-back (when
 * the poll was opened FROM /explore). Renders a STATIC snapshot of the cached
 * explore feed underneath the sliding poll-detail page — read-only, like
 * HomeBackdropHost (which snapshots GroupList). On swipe-commit the detail
 * page navigates to /explore and the live page replaces this snapshot.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExploreFeedList, ExploreTitleBar } from "@/components/ExploreFeed";
import { getCachedExplorePolls } from "@/lib/questionCache";
import { PANEL_HEIGHT_VAR } from "@/lib/groupDomMarkers";
import {
  HIDE_EXPLORE_BACKDROP_EVENT,
  SHOW_EXPLORE_BACKDROP_EVENT,
} from "@/lib/eventChannels";

export default function ExploreBackdropHost(): React.ReactElement | null {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onShow = () => setShown(true);
    const onHide = () => setShown(false);
    window.addEventListener(SHOW_EXPLORE_BACKDROP_EVENT, onShow);
    window.addEventListener(HIDE_EXPLORE_BACKDROP_EVENT, onHide);
    return () => {
      window.removeEventListener(SHOW_EXPLORE_BACKDROP_EVENT, onShow);
      window.removeEventListener(HIDE_EXPLORE_BACKDROP_EVENT, onHide);
    };
  }, []);

  if (!shown || typeof document === "undefined") return null;

  // ExploreFeedList sorts newest-first internally (single source of truth).
  const polls = getCachedExplorePolls() ?? [];

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
          paddingBottom: `var(${PANEL_HEIGHT_VAR}, 80px)`,
          // Contain so any descendant fixed/z-elevated chrome can't escape to
          // body level over the still-mounted poll detail page. Same pattern
          // as GroupBackdropHost / SlideOverlayHost.
          contain: "strict",
        }}
      >
        {/* In-flow title bar (shown at scroll 0 during the swipe, so it reads
            identically to the live page's fixed bar). */}
        <ExploreTitleBar />
        <ExploreFeedList polls={polls} interactive={false} />
      </div>
    </div>,
    document.body,
  );
}

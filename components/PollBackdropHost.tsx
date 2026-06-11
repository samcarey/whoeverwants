"use client";

/**
 * Mirrors GroupBackdropHost for the poll-info→poll-detail swipe-back.
 * The poll info page's swipe gesture reveals the poll DETAIL page
 * underneath; this host renders `PollDetailView` itself (same component
 * the slide overlay uses), body-portaled at z-0 so the info page's z-1
 * swipe wrapper slides over it.
 *
 * `inOverlay` tells PollDetailView to skip its window.scrollTo /
 * restore-pin (which would otherwise scroll the still-mounted info page
 * underneath); `overlayCardsOffset` positions the cards via transform to
 * the poll's saved scroll instead, so the backdrop shows the exact view
 * the user left when they opened the info page.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PollDetailView } from "@/app/g/[groupShortId]/p/[pollShortId]/PollDetailPage";
import { getRememberedScroll, pollScrollKey } from "@/lib/scrollMemory";
import {
  HIDE_POLL_BACKDROP_EVENT,
  SHOW_POLL_BACKDROP_EVENT,
  type PollBackdropShowDetail,
} from "@/lib/eventChannels";

export default function PollBackdropHost(): React.ReactElement | null {
  const [target, setTarget] = useState<PollBackdropShowDetail | null>(null);

  useEffect(() => {
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent<PollBackdropShowDetail>).detail;
      if (!detail?.groupId || !detail?.pollShortId) return;
      setTarget(detail);
    };
    const onHide = () => setTarget(null);
    window.addEventListener(SHOW_POLL_BACKDROP_EVENT, onShow);
    window.addEventListener(HIDE_POLL_BACKDROP_EVENT, onHide);
    return () => {
      window.removeEventListener(SHOW_POLL_BACKDROP_EVENT, onShow);
      window.removeEventListener(HIDE_POLL_BACKDROP_EVENT, onHide);
    };
  }, []);

  if (!target || typeof document === "undefined") return null;

  const savedScroll =
    getRememberedScroll(pollScrollKey(target.pollShortId)) ?? 0;

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
          // to body level and paint over the info page's still-mounted z-20
          // header. Same pattern as GroupBackdropHost / SlideOverlayHost.
          contain: "strict",
        }}
      >
        {/* Inner wrapper matches template.tsx's wrapper for the poll detail
            route (max-w-4xl mx-auto px-4 pb-6) so the backdrop's content
            sits exactly where the real route will render it. */}
        <div className="max-w-4xl mx-auto px-4 pb-6">
          <PollDetailView
            key={`${target.groupId}/${target.pollShortId}`}
            groupId={target.groupId}
            pollShortId={target.pollShortId}
            overlayCardsOffset={savedScroll}
            inOverlay
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

/**
 * Mirrors GroupBackdropHost for the /settings/edit → /settings swipe-back.
 * Renders the main settings page itself (`SettingsView inOverlay`) — the
 * same component the real route mounts — body-portaled at z-0 so the
 * editor's z-1 swipe wrapper slides over it.
 *
 * `inOverlay` makes SettingsView skip the page-ready signal and render its
 * floating back/Edit buttons INLINE (inside this contain:strict box, where
 * their position:fixed resolves to the box) instead of portaling them into
 * #header-portal — the portal node belongs to the editor on top and is the
 * editor's swipe transform target, so portaled copies would overlap the
 * editor's buttons and slide with them.
 *
 * Lifecycle: SHOW_SETTINGS_BACKDROP_EVENT (from the editor's swipe
 * recognition) → mount; HIDE_SETTINGS_BACKDROP_EVENT (snap-back/cancel OR
 * the real settings route's mount effect) → unmount.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SettingsView } from "@/app/settings/page";
import {
  SHOW_SETTINGS_BACKDROP_EVENT,
  HIDE_SETTINGS_BACKDROP_EVENT,
} from "@/lib/eventChannels";

export default function SettingsBackdropHost(): React.ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onShow = () => setVisible(true);
    const onHide = () => setVisible(false);
    window.addEventListener(SHOW_SETTINGS_BACKDROP_EVENT, onShow);
    window.addEventListener(HIDE_SETTINGS_BACKDROP_EVENT, onHide);
    return () => {
      window.removeEventListener(SHOW_SETTINGS_BACKDROP_EVENT, onShow);
      window.removeEventListener(HIDE_SETTINGS_BACKDROP_EVENT, onHide);
    };
  }, []);

  if (!visible || typeof document === "undefined") return null;

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
          // Anchors the backdrop's inline fixed back/Edit buttons to this
          // box and keeps them from escaping to body level over the
          // editor's identical buttons. Same pattern as GroupBackdropHost.
          contain: "strict",
        }}
      >
        {/* Inner wrapper matches template.tsx's wrapper for the settings
            route (max-w-4xl mx-auto px-4 pb-6) so the backdrop's content
            sits exactly where the real route will render it. */}
        <div className="max-w-4xl mx-auto px-4 pb-6">
          <SettingsView inOverlay />
        </div>
      </div>
    </div>,
    document.body,
  );
}

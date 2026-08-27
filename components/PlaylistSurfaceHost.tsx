"use client";

/**
 * Owns the timeline's page surface (the `html.playlist-surface` class — see
 * app/globals.css, where the page and the slot cards trade backgrounds).
 *
 * Mounted ONCE at layout level and driven by the ROUTE, deliberately: the
 * timeline itself can't own this. PlaylistTab is mounted twice during a
 * swipe-back (HomeBackdropHost's mirror under the sliding page, plus the real
 * route), so an add-on-mount/remove-on-unmount pair races — even ref-counted,
 * a slow route commit lets the mirror's teardown land BEFORE the destination
 * mounts, dropping the count to zero. The page then flashes back to
 * --background, the same white as the cards, so they briefly bleed into it.
 *
 * Deriving it from "is home visible?" has no such window: the pathname and the
 * backdrop flag are the same before, during and after the gesture, whatever
 * order the two instances happen to mount and unmount in.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useHomeBackdropActive } from "@/lib/useHomeBackdropActive";

export default function PlaylistSurfaceHost(): null {
  const pathname = usePathname();
  // Home IS the timeline. During a swipe-back the pathname is still the page
  // being dragged away, so the backdrop flag covers the gesture.
  const backdropActive = useHomeBackdropActive();
  const active = pathname === "/" || pathname === "" || backdropActive;

  useEffect(() => {
    const root = document.documentElement;
    if (active) root.classList.add("playlist-surface");
    else root.classList.remove("playlist-surface");
  }, [active]);

  return null;
}

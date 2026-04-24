"use client";

/**
 * Signal to the view-transition helper (`navigateWithTransition`) that the
 * current page has committed its first meaningful paint. Writes
 * `data-page-ready="<normalized-pathname>"` on `<html>` so the
 * MutationObserver in `lib/viewTransitions.ts:waitForNavigation` can detect
 * the destination is ready and release the transition's "new" snapshot
 * capture.
 *
 * Must be called from EVERY client page that is a navigation destination —
 * otherwise `waitForNavigation` falls back to a timeout and the browser
 * captures a stale-DOM snapshot, producing the "slide animates but new page
 * is identical to old" bug.
 *
 * Usage: pass `true` as soon as the page has rendered something worth
 * snapshotting (a loading spinner is fine — it beats stale content).
 * Called with `useLayoutEffect` so the attribute commits before paint.
 */

import { useLayoutEffect } from "react";
import { normalizePath } from "./pollId";

export function usePageReady(ready: boolean): void {
  useLayoutEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const path = normalizePath(window.location.pathname);
    document.documentElement.setAttribute("data-page-ready", path);
    return () => {
      if (document.documentElement.getAttribute("data-page-ready") === path) {
        document.documentElement.removeAttribute("data-page-ready");
      }
    };
  }, [ready]);
}

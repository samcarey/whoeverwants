"use client";

// Sets `data-page-ready=<path>` on <html> so `lib/viewTransitions.ts:waitForNavigation`
// can detect when the destination has committed.
import { useLayoutEffect } from "react";
import { normalizePath } from "./questionId";

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

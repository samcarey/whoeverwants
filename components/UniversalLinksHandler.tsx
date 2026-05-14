"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { installUniversalLinksHandler } from "@/lib/universalLinks";

/**
 * Mount point for the iOS Universal Links `appUrlOpen` listener. Lives in
 * `app/layout.tsx` so the listener is registered once per page load and
 * survives client-side navigation (template.tsx re-instantiates per route
 * and would tear the listener down). On non-Capacitor platforms this
 * component is functionally inert.
 */
export function UniversalLinksHandler() {
  const router = useRouter();
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    installUniversalLinksHandler((path) => router.push(path)).then((c) => {
      if (cancelled) {
        c?.();
      } else {
        cleanup = c;
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [router]);
  return null;
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmationModal from "./ConfirmationModal";
import {
  installClipboardLinkPrompt,
  markClipboardUrlResponded,
} from "@/lib/clipboardLinkPrompt";

interface PendingPrompt {
  path: string;
  raw: string;
}

/**
 * Mount point for the iOS clipboard-link prompt. Lives in `app/layout.tsx`
 * so the listener is registered once per WebView load and survives
 * client-side navigation. Inert on non-Capacitor platforms — the helper
 * short-circuits and this component just renders null.
 */
export function ClipboardLinkPrompt() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    installClipboardLinkPrompt((path, raw) => {
      if (!cancelled) setPending({ path, raw });
    }).then((c) => {
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
  }, []);

  if (!pending) return null;

  return (
    <ConfirmationModal
      isOpen={true}
      message="Open the link from your clipboard?"
      confirmText="Open"
      onConfirm={() => {
        markClipboardUrlResponded(pending.raw);
        const path = pending.path;
        setPending(null);
        router.push(path);
      }}
      onCancel={() => {
        markClipboardUrlResponded(pending.raw);
        setPending(null);
      }}
    />
  );
}

"use client";

import React, { Suspense, useEffect } from "react";

// Raw import — no recovery logic. Used for the speculative idle preload,
// which must NOT reload on failure (on dev servers turbopack compiles
// chunks on demand, so a 404 during idle is expected and transient).
const importCreatePollRaw = () => import("@/app/create-poll/page");

// Reload-on-chunk-error wrapper — used only for the actual lazy mount,
// where a chunk miss means the user's cached build is stale after a
// deploy and a full reload is the correct recovery.
const importCreateQuestion = () =>
  importCreatePollRaw().catch((err) => {
    if (
      err?.name === "ChunkLoadError" ||
      err?.message?.includes("Failed to load chunk") ||
      err?.message?.includes("Failed to fetch dynamically imported module")
    ) {
      if (typeof window !== "undefined" && !sessionStorage.getItem("chunkReloadAttempted")) {
        sessionStorage.setItem("chunkReloadAttempted", "1");
        window.location.reload();
      }
    }
    throw err;
  });

const LazyCreateQuestionContent = React.lazy(() =>
  importCreateQuestion().then((m) => ({ default: m.CreateQuestionContent }))
);

/**
 * Persistent mount point for `CreateQuestionContent`. Lives in
 * `app/layout.tsx` so it survives client-side navigation — `app/template.tsx`
 * is re-instantiated by Next.js App Router on every route change, which would
 * unmount + remount this component and briefly clear the bubble-bar portal
 * target, causing visible "blinks" of the bottom buttons after a slide
 * transition completes.
 *
 * CreateQuestionContent owns both the category bubble bar (portaled into
 * each group page's `#draft-poll-portal`) and the create-poll modal. It
 * renders nothing visible when there's no portal target and no open modal,
 * so mounting it on every route (including home) costs nothing visual.
 */
export function PersistentCreatePollHost() {
  // Speculatively preload the chunk during idle time so the React.lazy
  // resolution is instant when the user first lands on a page that
  // surfaces the bubble bar. Failures are swallowed — a missed
  // speculative preload must NOT trigger a page reload (dev servers
  // 404 on speculative chunk fetches during turbopack compile).
  useEffect(() => {
    const preload = () => { importCreatePollRaw().catch(() => {}); };
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(preload, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(preload, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <Suspense fallback={null}>
      <LazyCreateQuestionContent />
    </Suspense>
  );
}

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { navigateBackWithTransition, navigateWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { usePageReady } from "@/lib/usePageReady";

// Empty-thread placeholder page. The home FAB navigates here; tapping the FAB
// from this page opens the create-poll modal. The thread doesn't actually exist
// until a poll is created (at which point the new poll becomes its own thread
// root and shows up in the home thread list). Navigating away without creating
// a poll leaves nothing behind.
export default function NewThreadPage() {
  const router = useRouter();
  usePageReady(true);

  // Mirror the real thread page's header-height measurement so the message
  // sits flush below the fixed header regardless of the safe-area inset.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div
        className="fixed left-0 right-0 top-0 z-20 bg-background touch-none"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div ref={headerRef} className="max-w-4xl mx-auto pl-2 pr-4 py-2 flex items-center gap-2 overflow-hidden">
          <button
            onClick={() => {
              if (hasAppHistory()) {
                navigateBackWithTransition();
              } else {
                navigateWithTransition(router, '/', 'back');
              }
            }}
            className="w-10 h-10 -mr-1.5 flex items-center justify-center shrink-0"
            aria-label="Go back"
          >
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="font-semibold text-lg text-gray-900 dark:text-white truncate">
            New Thread
          </h1>
        </div>
      </div>

      <div
        className="px-4 text-center"
        style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }}
      >
        <p className="text-base text-gray-700 dark:text-gray-300">
          Create a poll and then share the link!
        </p>
      </div>
    </>
  );
}

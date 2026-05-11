"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import HeaderPortal from '@/components/HeaderPortal';
import { useLongPress } from '@/lib/useLongPress';
import { installClientLogForwarder } from '@/lib/clientLogForwarder';
import { usePrefetch } from '@/lib/prefetch';
import { navigateWithTransition, navigateBackWithTransition, NAV_COUNT_KEY } from '@/lib/viewTransitions';
import { getCachedQuestionById, getCachedQuestionByShortId } from '@/lib/questionCache';
import { isUuidLike, isGroupRootView } from '@/lib/questionId';

// Extract the import so it can be triggered independently for preloading.
// When called a second time, the module cache returns the already-resolved module instantly.
// Raw import — no recovery logic. Used for the speculative idle preload,
// which must NOT reload on failure (on dev servers turbopack compiles
// chunks on demand, so a 404 during idle is expected and transient).
const importCreatePollRaw = () => import('@/app/create-poll/page');

// Reload-on-chunk-error wrapper — used only for the actual lazy mount,
// where a chunk miss means the user's cached build is stale after a
// deploy and a full reload is the correct recovery.
const importCreateQuestion = () =>
  importCreatePollRaw().catch((err) => {
    if (err?.name === 'ChunkLoadError' || err?.message?.includes('Failed to load chunk') || err?.message?.includes('Failed to fetch dynamically imported module')) {
      // Guard against reload loops: only reload once per session.
      if (typeof window !== 'undefined' && !sessionStorage.getItem('chunkReloadAttempted')) {
        sessionStorage.setItem('chunkReloadAttempted', '1');
        window.location.reload();
      }
    }
    throw err;
  });

const LazyCreateQuestionContent = React.lazy(() =>
  importCreateQuestion().then(m => ({ default: m.CreateQuestionContent }))
);

interface AppTemplateProps {
  children: React.ReactNode;
}

export default function Template({ children }: AppTemplateProps) {
  return (
    <Suspense fallback={<div />}>
      <TemplateInner>{children}</TemplateInner>
    </Suspense>
  );
}

function TemplateInner({ children }: AppTemplateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { prefetchOnHover } = usePrefetch();
  const [hasAppHistory, setHasAppHistory] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Track in-app navigation for back button (runs on each client-side navigation).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const count = parseInt(sessionStorage.getItem(NAV_COUNT_KEY) || '0', 10) + 1;
    sessionStorage.setItem(NAV_COUNT_KEY, String(count));
    setHasAppHistory(count > 1);
  }, [pathname]);

  // Set mounted state for portal rendering + install client log forwarder on dev sites
  useEffect(() => {
    setIsMounted(true);
    installClientLogForwarder();

    // Reload on ChunkLoadError — stale cached chunks after a new deploy.
    // Guarded against reload loops via a sessionStorage flag (dev turbopack
    // sometimes 404s transiently on speculative chunk fetches, which would
    // otherwise trigger reload → preload → 404 → reload...).
    const handleChunkError = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      if (err?.name === 'ChunkLoadError' || err?.message?.includes('Failed to load chunk')) {
        if (!sessionStorage.getItem('chunkReloadAttempted')) {
          sessionStorage.setItem('chunkReloadAttempted', '1');
          window.location.reload();
        }
      }
    };
    window.addEventListener('unhandledrejection', handleChunkError);
    return () => window.removeEventListener('unhandledrejection', handleChunkError);
  }, []);

  // Preload the create-question chunk during idle time so it's instant when the user taps "+".
  // Uses the raw import + swallows errors — a failed speculative preload must NOT
  // trigger a page reload (that was the cause of the dev-server refresh loop).
  useEffect(() => {
    const preload = () => { importCreatePollRaw().catch(() => {}); };
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(preload, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    } else {
      const t = setTimeout(preload, 1500);
      return () => clearTimeout(t);
    }
  }, []);
  
  // Initialize questionPageTitle synchronously from the question cache on group pages,
  // so the header shows the title on the very first paint after navigation
  // (avoids the h1 being empty during a view transition slide).
  const [questionPageTitle, setQuestionPageTitle] = useState(() => {
    if (typeof window === 'undefined') return '';
    const match = pathname.match(/^\/g\/([^/]+)\/?$/);
    if (!match) return '';
    const id = match[1];
    const question = isUuidLike(id) ? getCachedQuestionById(id) : getCachedQuestionByShortId(id);
    return question?.title ?? '';
  });

  const { props: longPressProps } = useLongPress(() =>
    window.dispatchEvent(new Event('openCommitInfo'))
  );

  const pageTitle =
    pathname === '/create-poll' || pathname === '/create-poll/' ? 'Create Poll' :
    pathname.startsWith('/g/') ? questionPageTitle :
    '';

  // Listen for title changes from question pages
  useEffect(() => {
    const handleTitleChange = (event: CustomEvent) => {
      setQuestionPageTitle(event.detail.title);
    };

    window.addEventListener('pageTitleChange', handleTitleChange as EventListener);

    return () => {
      window.removeEventListener('pageTitleChange', handleTitleChange as EventListener);
    };
  }, []);

  // True for any page under `/g/...` (the canonical group route family) AND
  // legacy `/p/...` URLs (which are now thin client-side redirects to /g/).
  // Used by the fallback header gate so neither /g/ nor /p/ pages get the
  // template's centered title bar (they render their own fixed headers).
  const isGroupFamilyPage =
    pathname === '/g' || pathname === '/g/' || pathname.startsWith('/g/') ||
    pathname === '/p' || pathname === '/p/' || pathname.startsWith('/p/');
  // /g/<id> renders the group view with a card expanded; the bare /g/ route is
  // the empty placeholder. Both share the group-like layout (fixed header +
  // scroll list, bottom-padding for the floating FAB). Sub-routes
  // (/g/<id>/info, .../edit-title) render their own fixed header but opt out
  // of the group-like FAB + padding treatment via isGroupRootView.
  const isGroupLikePage = isGroupRootView(pathname);
  const isSettingsPage = pathname === '/settings' || pathname === '/settings/';

  // The draft poll card on every group-like page hosts the inline question
  // form (category/for fields + question fields) plus the staged-questions
  // list and Settings. The "+ Question" button inside the card commits the
  // in-progress form to the staged list. The home page keeps a single "+"
  // FAB which navigates to /p/ (the empty placeholder) so the user can
  // start a new poll.

  return (
    <>
      {/* Fallback header for pages without a page-specific header (not group, settings, home, or create-modal). */}
      {!isGroupFamilyPage && !isSettingsPage && pathname !== '/' && (
        <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700"
             style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="relative flex items-start justify-between pt-2 pb-2 pl-2 pr-2.5">
            <div className="w-6 h-6" />
            {pageTitle && (
              <div className="absolute left-1/2 top-1/2" style={{transform: 'translate(-50%, -50%) translateY(0.125em) translateX(-0.5rem)'}}>
                <h1
                  className="text-xl font-bold text-center break-words select-none whitespace-nowrap"
                  {...longPressProps}
                >
                  {pageTitle}
                </h1>
              </div>
            )}
            <div className="w-6 h-6" />
          </div>
        </div>
      )}

      {/* Horizontal safe-area padding; bottom padding is added per-page so
          the floating "+" button never obscures the last item. */}
      <div
        style={{
          paddingLeft: 'max(0.35rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.35rem, env(safe-area-inset-right))',
        }}>
        {/* Commit age badge portal target — anchored to the top safe-area
             boundary via .pwa-badge-top. z-30 keeps it above the group page's
             fixed header (z-20). */}
        {isMounted && <div id="commit-badge-portal" className="fixed left-0 right-0 z-30 pwa-badge-top"></div>}

        {isSettingsPage && (
          <div
            className="max-w-4xl mx-auto px-16 pb-1 page-title-safe-top"
          >
            <h1 className="text-2xl font-bold text-center break-words select-none" {...longPressProps}>
              Settings
            </h1>
          </div>
        )}

        {pathname === '/' && (
          <div
            className="max-w-4xl mx-auto px-2 pb-1"
            style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="relative text-center">
              {/* Wrapper is relative so the gear auto-centers with the h1. */}
              <button
                onClick={() => navigateWithTransition(router, '/settings', 'forward')}
                {...prefetchOnHover('/settings')}
                className="absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                style={{
                  left: 'max(0.25rem, env(safe-area-inset-left, 0px))',
                }}
                aria-label="Settings"
              >
                <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold mb-1 select-none" {...longPressProps}>
                Whoever Wants
              </h1>
            </div>
            <div className="h-7 flex items-center justify-center mb-1" id="home-phrase-content">
              {/* Blue phrase will be injected here */}
            </div>
          </div>
        )}

        <div
          className={`max-w-4xl mx-auto ${(pathname === '/' || isGroupLikePage) ? '-mx-4 sm:mx-auto sm:px-4' : 'px-4'} ${isGroupLikePage ? '' : (isSettingsPage || pathname === '/') ? 'pt-0.5 pb-6' : 'py-6'}`}
          style={pathname === '/'
            // Home reserves enough room for the floating "+" FAB to clear the
            // last card.
            ? { paddingBottom: '6rem' }
            // Group-like pages have no floating chrome past the draft form,
            // but the draft card's outer dashed border shouldn't visually
            // touch the screen edge at scroll-bottom — give it a small
            // breather below.
            : isGroupLikePage
              ? { paddingBottom: '4.5rem' }
              : undefined}
        >
          {children}
        </div>
      </div>

      {/* CreateQuestionContent owns the draft-poll-card portal AND the
           question form modal. Mount it on every group-like page so the
           draft card appears whenever drafts exist (even after navigation
           with the modal closed). The component renders nothing visible
           when there are no drafts and the form modal is closed. */}
      {isMounted && isGroupLikePage && (
        <Suspense fallback={null}>
          <LazyCreateQuestionContent />
        </Suspense>
      )}

      {/* Floating "+" FAB — home page only. Navigates to /g/ (the empty
           placeholder) where the user picks a What/When/Where bubble for what
           they want to create. Rendered via portal outside the scaling
           container so it positions against the viewport. Slides with the
           rest of the page in view transitions (no shared transition name
           with the group bubble bar). */}
      {isMounted && pathname === '/' && createPortal(
        <button
          onClick={() => navigateWithTransition(router, '/g', 'forward')}
          className="fixed z-50 h-12 px-3 rounded-full flex items-center justify-center gap-1 bg-blue-500 dark:bg-blue-600 active:bg-blue-600 dark:active:bg-blue-500 shadow-md shadow-black/20 cursor-pointer text-white font-normal"
          style={{
            right: 'max(1.5rem, env(safe-area-inset-right, 0px))',
            bottom: '1rem',
          }}
          aria-label="Create new group"
        >
          <span aria-hidden="true" className="text-4xl leading-none">+</span>
          <span className="text-lg leading-none">Group</span>
        </button>,
        document.getElementById('floating-fab-portal')!
      )}

      {/* Header elements rendered outside scaling container */}
      <HeaderPortal>
        {/* Back arrow in upper left — settings page only, when there's in-app history. */}
        {(isSettingsPage && hasAppHistory) && (
          <div className="fixed left-0 z-50" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
            <button
              onClick={() => navigateBackWithTransition()}
              className="w-12 h-16 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              aria-label="Go back"
            >
              <svg className="w-7 h-7 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}

      </HeaderPortal>
    </>
  );
}
"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLongPress } from '@/lib/useLongPress';
import { installClientLogForwarder } from '@/lib/clientLogForwarder';
import { usePrefetch } from '@/lib/prefetch';
import { navigateWithTransition, NAV_COUNT_KEY } from '@/lib/viewTransitions';
import { getCachedQuestionById, getCachedQuestionByShortId } from '@/lib/questionCache';
import { isUuidLike, isGroupRootView } from '@/lib/questionId';
import { HOME_SELECTION_MODE_CHANGE_EVENT, type HomeSelectionModeChangeDetail } from '@/lib/eventChannels';
import { getUserName } from '@/lib/userProfile';
import { SESSION_CHANGED_EVENT } from '@/lib/session';

// `CreateQuestionContent` (the bubble-bar + create-poll-modal owner) is
// mounted in `app/layout.tsx` via `<PersistentCreatePollHost />` so it
// survives client-side navigation. Don't try to re-mount it here —
// template.tsx re-instantiates on every route change, which would unmount
// the component and cause the bubble bar's portal target to be briefly
// cleared (visible as "buttons blink after slide").
//
// The home page's "+ Group" button is similarly mounted at layout level
// via `<CreateGroupButtonHost />`. One persistent DOM node toggled by
// opacity/pointer-events, so the swipe-back gesture can't observe a
// position jump as the page commits.

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
  const [isMounted, setIsMounted] = useState(false);

  // Track in-app navigation for the exported `hasAppHistory()` helper
  // in lib/viewTransitions.ts (consumed by group sub-routes' back-arrows).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const count = parseInt(sessionStorage.getItem(NAV_COUNT_KEY) || '0', 10) + 1;
    sessionStorage.setItem(NAV_COUNT_KEY, String(count));
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

  // Settings header title: the saved account/display name when set, else
  // "Settings". Init null (SSR parity → "Settings" on the first paint), then
  // read getUserName() on mount + on every session change (sign-in/out). Name
  // edits happen on /settings/edit, which navigates back here and remounts the
  // template, so the on-mount read picks those up too.
  const [settingsName, setSettingsName] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setSettingsName(getUserName()?.trim() || null);
    update();
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, [pathname]);

  // Hide the settings gear on the home page when GroupList enters
  // bulk-forget selection mode — the cancel (X) button portals into the
  // same upper-left slot and the gear's tap target would compete with it.
  const [homeSelectionMode, setHomeSelectionMode] = useState(false);
  useEffect(() => {
    const handle = (event: CustomEvent<HomeSelectionModeChangeDetail>) => {
      setHomeSelectionMode(event.detail.active);
    };
    window.addEventListener(HOME_SELECTION_MODE_CHANGE_EVENT, handle as EventListener);
    return () => {
      window.removeEventListener(HOME_SELECTION_MODE_CHANGE_EVENT, handle as EventListener);
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
  // scroll list, bottom-padding for the new group button). Sub-routes
  // (/g/<id>/info, .../edit-title) render their own fixed header but opt out
  // of the new group button + padding treatment via isGroupRootView.
  const isGroupLikePage = isGroupRootView(pathname);
  const isSettingsPage = pathname === '/settings' || pathname === '/settings/';
  // The profile editor (/settings/edit) renders its own fixed back + Save
  // buttons via HeaderPortal, so it must opt out of the fallback header.
  const isSettingsEditPage = pathname === '/settings/edit' || pathname === '/settings/edit/';
  // Phase G: /invite/<token> is a redemption landing page that renders
  // its own full-screen redirect-or-sign-in UI. The template's
  // fallback header would just sit above it as empty chrome.
  const isInvitePage = pathname.startsWith('/invite/');

  // The draft poll card on every group-like page hosts the inline question
  // form (category/for fields + question fields) plus the staged-questions
  // list and Settings. The "+ Question" button inside the card commits the
  // in-progress form to the staged list. The home page keeps the new group
  // button which navigates to /p/ (the empty placeholder) so the user can
  // start a new poll.

  return (
    <>
      {/* Fallback header for pages without a page-specific header (not group, settings, home, invite redemption, or create-modal). */}
      {!isGroupFamilyPage && !isSettingsPage && !isSettingsEditPage && !isInvitePage && pathname !== '/' && (
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
              {settingsName || 'Settings'}
            </h1>
          </div>
        )}

        {pathname === '/' && (
          <div
            className="max-w-4xl mx-auto px-2 pb-1"
            style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="relative text-center">
              {/* Wrapper is relative so the gear auto-centers with the h1.
                  Hidden while GroupList is in bulk-forget selection mode —
                  the cancel (X) portal lands in the same upper-left slot. */}
              {!homeSelectionMode && (
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
              )}
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
          className={`max-w-4xl mx-auto ${(pathname === '/' || isGroupLikePage) ? '-mx-4 sm:mx-auto sm:px-4' : 'px-4'} ${isGroupLikePage ? '' : (isSettingsPage || pathname === '/') ? 'pt-0.5 pb-6' : 'pb-6'}`}
          style={pathname === '/'
            // Home reserves enough room for the new group button to clear the
            // last card.
            ? { paddingBottom: '6rem' }
            // Group-like pages: no extra padding here. The BubbleBarPanel
            // is `position: fixed` and the cards-wrapper inside GroupContent
            // already reserves exactly the panel's measured height so the
            // last card sits flush against the panel at scroll-bottom.
            : undefined}
        >
          {children}
        </div>
      </div>

    </>
  );
}
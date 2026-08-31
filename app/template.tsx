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
import { GearIcon, GlobeIcon, GroupsIcon, LegacyGroupsIcon, GROUPS_BUTTON_RIGHT, EXPLORE_BUTTON_RIGHT, LEGACY_GROUPS_BUTTON_RIGHT } from '@/components/homeChromeIcons';
import { markAppHydrated } from '@/lib/hydration';
import { EXPLORE_BUTTON_CHANGED_EVENT, exploreParamPresent, syncExploreParam } from '@/lib/exploreButtonFlag';
import { GROUPS_BUTTON_CHANGED_EVENT, groupsParamPresent, syncGroupsParam } from '@/lib/groupsButtonFlag';

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

  // The upper-right Explore globe is gated on a persistent `?explore=1` param
  // (toggled in the Experimental tab). `showExplore` mirrors the param's
  // presence; effect-seeded (not lazy-init) to keep SSR/hydration in lockstep —
  // a one-frame flash on this experimental opt-in is fine.
  const [showExplore, setShowExplore] = useState(false);
  // Same pattern for the LEGACY groups-list button (`?groups=1`) — the
  // upper-right people button opens /contacts now, and the old /groups page
  // is reachable only through this experimental flag.
  const [showLegacyGroups, setShowLegacyGroups] = useState(false);

  // Re-apply the param after every route change (navigation strips query
  // params) and refresh `showExplore`. `syncExploreParam` re-adds/strips it to
  // match the stored intent, dispatching EXPLORE_BUTTON_CHANGED_EVENT on a flip.
  useEffect(() => {
    syncExploreParam();
    setShowExplore(exploreParamPresent());
    syncGroupsParam();
    setShowLegacyGroups(groupsParamPresent());
  }, [pathname]);

  // Toggle-driven changes (from the modal) fire the event; listener registered
  // once, not per-navigation (the effect above covers navigation).
  useEffect(() => {
    const update = () => setShowExplore(exploreParamPresent());
    window.addEventListener(EXPLORE_BUTTON_CHANGED_EVENT, update);
    return () => window.removeEventListener(EXPLORE_BUTTON_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    const update = () => setShowLegacyGroups(groupsParamPresent());
    window.addEventListener(GROUPS_BUTTON_CHANGED_EVENT, update);
    return () => window.removeEventListener(GROUPS_BUTTON_CHANGED_EVENT, update);
  }, []);

  // Set mounted state for portal rendering + install client log forwarder on dev sites
  useEffect(() => {
    setIsMounted(true);
    // The app's initial hydration is committed by the time this effect runs —
    // from here on, pages may seed useState initializers from localStorage
    // (see lib/hydration.ts; consumed by /settings for flicker-free mounts).
    markAppHydrated();
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
  // /explore renders its own title ("Explore") + floating back button via
  // HeaderPortal, so it must opt out of the fallback header.
  const isExplorePage = pathname === '/explore' || pathname === '/explore/';
  // /event (a playlist event's own page) renders its own centered title +
  // floating back button, so it opts out too.
  const isEventPage = pathname === '/event' || pathname === '/event/';
  // /groups (the group list, reached from home's upper-right button) renders
  // its own title bar + floating back button via HeaderPortal, so it opts out
  // of the fallback header too.
  const isGroupsPage = pathname === '/groups' || pathname === '/groups/';
  // /contacts (friends + requests + contact groups, reached from home's
  // upper-right button) renders its own title bar + back button too.
  const isContactsPage = pathname === '/contacts' || pathname === '/contacts/';
  // /f/<code> (the shareable friend-profile link) renders its own card UI.
  const isFriendLinkPage = pathname.startsWith('/f/');

  // The draft poll card on every group-like page hosts the inline question
  // form (category/for fields + question fields) plus the staged-questions
  // list and Settings. The "+ Question" button inside the card commits the
  // in-progress form to the staged list. The home page keeps the new group
  // button which navigates to /p/ (the empty placeholder) so the user can
  // start a new poll.

  return (
    <>
      {/* Fallback header for pages without a page-specific header (not group, settings, home, invite redemption, explore, or create-modal). */}
      {!isGroupFamilyPage && !isSettingsPage && !isSettingsEditPage && !isInvitePage && !isExplorePage && !isEventPage && !isGroupsPage && !isContactsPage && !isFriendLinkPage && pathname !== '/' && (
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

        {/* The settings title now lives inside app/settings/page.tsx (within
            its swipe-back wrapper, so it slides with the page during the
            settings→home gesture). */}

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
                <GearIcon />
              </button>
              )}
              {/* Explore — mirrors the settings gear (upper-left) at the
                  upper-right edge, same coloring + sizing. A lat/lon
                  wireframe globe (Heroicons globe-alt). Hidden during
                  bulk-forget selection mode (the trashcan portals into the
                  same upper-right slot). Gated on the persistent `?explore=1`
                  param (toggled in the Experimental tab) — hidden by default. */}
              {!homeSelectionMode && showExplore && (
              <button
                onClick={() => navigateWithTransition(router, '/explore', 'forward')}
                {...prefetchOnHover('/explore')}
                className="absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                style={{ right: EXPLORE_BUTTON_RIGHT }}
                aria-label="Explore"
              >
                <GlobeIcon />
              </button>
              )}
              {/* Legacy groups list — experimental-flag-gated (`?groups=1`,
                  toggled in the Experimental tab) now that the people button
                  opens /contacts. Sits one slot left of the globe so all
                  three right-edge buttons can coexist. */}
              {!homeSelectionMode && showLegacyGroups && (
              <button
                onClick={() => navigateWithTransition(router, '/groups', 'forward')}
                {...prefetchOnHover('/groups')}
                className="absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                // Take the globe's slot unless the explore flag is ALSO on —
                // the +5rem third slot overlaps the centered title on phones,
                // so it's only used when both experiments are enabled.
                style={{ right: showExplore ? LEGACY_GROUPS_BUTTON_RIGHT : EXPLORE_BUTTON_RIGHT }}
                aria-label="Groups"
              >
                <LegacyGroupsIcon />
              </button>
              )}
              {/* Contacts — the mirror of the settings gear at the other end
                  of the row: friends, requests, and contact groups (the
                  with/without suggestion pools). Hidden during bulk-forget
                  selection mode, like the gear (that mode's trashcan portals
                  into this same slot). */}
              {!homeSelectionMode && (
              <button
                onClick={() => navigateWithTransition(router, '/contacts', 'forward')}
                {...prefetchOnHover('/contacts')}
                className="absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
                style={{ right: GROUPS_BUTTON_RIGHT }}
                aria-label="Contacts"
              >
                <GroupsIcon />
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
          className={`max-w-4xl mx-auto ${(pathname === '/' || isGroupLikePage) ? '-mx-4 sm:mx-auto sm:px-4' : 'px-4'} ${isGroupLikePage ? '' : pathname === '/' ? 'pt-0.5 pb-6' : 'pb-6'}`}
          style={pathname === '/'
            // Home reserves enough room for the new group button to clear the
            // last card.
            ? { paddingBottom: '6rem' }
            // Group-like pages: no extra padding here. The create-poll search
            // bar is `position: fixed` and the cards-wrapper inside GroupContent
            // already reserves exactly the bar's measured height so the
            // last card sits flush against the bar at scroll-bottom.
            : undefined}
        >
          {children}
        </div>
      </div>

    </>
  );
}
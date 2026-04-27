"use client";

import React, { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import HeaderPortal from '@/components/HeaderPortal';
import { useLongPress } from '@/lib/useLongPress';
import { installClientLogForwarder } from '@/lib/clientLogForwarder';
import { usePrefetch } from '@/lib/prefetch';
import { navigateWithTransition, navigateBackWithTransition, NAV_COUNT_KEY } from '@/lib/viewTransitions';
import { getCachedQuestionById, getCachedQuestionByShortId } from '@/lib/questionCache';
import { isUuidLike, isThreadRootView } from '@/lib/questionId';

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

const BUBBLE_BUTTON_CLASS =
  "h-8 px-2.5 rounded-full flex items-center justify-center gap-1.5 bg-blue-500 dark:bg-blue-600 active:bg-blue-600 dark:active:bg-blue-500 shadow-md shadow-black/20 cursor-pointer text-white font-medium [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]";

function TemplateInner({ children }: AppTemplateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  
  // Initialize questionPageTitle synchronously from the question cache on question pages,
  // so the header shows the title on the very first paint after navigation
  // (avoids the h1 being empty during a view transition slide).
  const [questionPageTitle, setQuestionPageTitle] = useState(() => {
    if (typeof window === 'undefined') return '';
    const match = pathname.match(/^\/p\/([^/]+)\/?$/);
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
    pathname.startsWith('/p/') ? questionPageTitle :
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

  const isQuestionPage = pathname.startsWith('/p/');
  const isThreadPage = pathname.startsWith('/thread/');
  // /p/<id> now renders the thread view with a card expanded; both routes share the
  // thread-page layout (fixed header + scroll list) and the thread's own back button.
  // Thread sub-routes (/thread/<id>/info, .../edit-title) render their own fixed
  // header but opt out of the thread-like FAB + padding treatment.
  const isThreadLikePage = isThreadRootView(pathname);
  const isCreateModalOpen = searchParams.has('create');
  const isSettingsPage = pathname === '/settings' || pathname === '/settings/';
  const [modalClosing, setModalClosing] = useState(false);

  // Refs for modal drag-to-dismiss — uses direct DOM manipulation for 60fps.
  const modalSheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const modalScrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    startY: 0,
    currentTranslate: 0,
    isDragging: false,
    startedInHeader: false,
    startedInScrollableChild: false,
    isClosing: false,
    rAFPending: false,
    rAFId: 0,
    lastMoveTime: 0,
    lastMoveY: 0,
  });
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stable ref for close navigation — avoids searchParams in deps, preventing listener churn.
  const navigateCloseModalRef = useRef(() => {});
  useEffect(() => {
    navigateCloseModalRef.current = () => {
      const params = new URLSearchParams(searchParams.toString());
      ['create', 'followUpTo', 'duplicate', 'voteFromSuggestion', 'mode', 'category']
        .forEach(p => params.delete(p));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    };
  }, [router, pathname, searchParams]);

  const handleCloseCreateModal = useCallback(() => {
    if (dragState.current.isClosing) return;
    dragState.current.isClosing = true;
    setModalClosing(true);
    closeTimerRef.current = setTimeout(() => {
      navigateCloseModalRef.current();
    }, 300);
  }, []);

  // Open the create-question modal from the floating What/When/Where bubble bar.
  // The bubble bar is only shown on thread-like pages, so we always open the
  // modal in place (with auto-set followUpTo when the page exposes a
  // thread-latest-question-id on <body>). The home page uses the single "+" FAB
  // below, which navigates to /thread/new/ as before.
  const openCreateFromBubble = useCallback((extraParams: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('create', '1');
    for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
    const threadLatestQuestionId = document.body.getAttribute('data-thread-latest-question-id');
    if (threadLatestQuestionId) {
      params.set('followUpTo', threadLatestQuestionId);
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams]);

  // Drag-to-dismiss touch handling for the create question modal sheet.
  useEffect(() => {
    if (!isCreateModalOpen || !isMounted) return;
    const sheet = modalSheetRef.current;
    if (!sheet) return;

    const state = dragState.current;

    const updateDOM = () => {
      state.rAFPending = false;
      const t = state.currentTranslate;
      if (modalSheetRef.current) {
        modalSheetRef.current.style.transform = `translateY(${t}px)`;
      }
      if (backdropRef.current) {
        const h = modalSheetRef.current?.offsetHeight || window.innerHeight;
        const progress = Math.min(t / (h * 0.5), 1);
        backdropRef.current.style.opacity = String(1 - progress * 0.7);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (state.isClosing) return;
      state.startY = e.touches[0].clientY;
      state.isDragging = false;
      state.currentTranslate = 0;
      state.lastMoveTime = Date.now();
      state.lastMoveY = e.touches[0].clientY;
      const scrollEl = modalScrollRef.current;
      if (scrollEl) {
        const rect = scrollEl.getBoundingClientRect();
        state.startedInHeader = e.touches[0].clientY < rect.top;
      }
      // Check if touch started inside a scrollable child (e.g. autocomplete dropdown).
      // If so, don't engage drag-to-dismiss — let the child scroll naturally.
      // Only check for overflow-y style, not scrollHeight vs clientHeight — the height
      // check has edge cases near the max-height boundary that cause false negatives.
      state.startedInScrollableChild = false;
      if (scrollEl) {
        let el = e.target as HTMLElement | null;
        while (el && el !== scrollEl) {
          const overflowY = window.getComputedStyle(el).overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') {
            state.startedInScrollableChild = true;
            break;
          }
          el = el.parentElement;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (state.isClosing) return;
      const touchY = e.touches[0].clientY;
      const deltaY = touchY - state.startY;

      if (!state.isDragging) {
        const scrollEl = modalScrollRef.current;
        const scrollAtTop = !scrollEl || scrollEl.scrollTop <= 0;
        if (!(state.startedInHeader || (!state.startedInScrollableChild && scrollAtTop && deltaY > 5))) return;
        state.isDragging = true;
        if (scrollEl) scrollEl.style.overflowY = 'hidden';
        if (modalSheetRef.current) modalSheetRef.current.style.transition = 'none';
        if (backdropRef.current) backdropRef.current.style.transition = 'none';
      }

      // Track velocity from the last few touchmove events
      state.lastMoveTime = Date.now();
      state.lastMoveY = touchY;

      state.currentTranslate = Math.max(0, deltaY);
      if (!state.rAFPending) {
        state.rAFPending = true;
        state.rAFId = requestAnimationFrame(updateDOM);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!state.isDragging || state.isClosing) return;
      state.isDragging = false;

      // Cancel any pending rAF so it doesn't overwrite the animation.
      if (state.rAFPending) {
        cancelAnimationFrame(state.rAFId);
        state.rAFPending = false;
      }

      const scrollEl = modalScrollRef.current;
      if (scrollEl) scrollEl.style.overflowY = '';

      const modalHeight = modalSheetRef.current?.offsetHeight || window.innerHeight;
      const threshold = modalHeight * 0.33;

      // Compute downward velocity (px/ms) from the last touchmove to touchend.
      const endY = e.changedTouches[0].clientY;
      const dt = Date.now() - state.lastMoveTime;
      const velocity = dt > 0 ? (endY - state.lastMoveY) / dt : 0;
      // Dismiss if past halfway OR flicked downward fast (>0.5 px/ms ≈ 500px/s).
      const shouldClose = state.currentTranslate > threshold || (velocity > 0.5 && state.currentTranslate > 30);

      if (shouldClose) {
        // Past halfway — close. Must force reflow between setting transition
        // and target value, otherwise browser skips the animation (transition
        // was 'none' during drag).
        state.isClosing = true;
        if (modalSheetRef.current) {
          modalSheetRef.current.style.transition = 'transform 0.3s ease-in';
          modalSheetRef.current.offsetHeight; // force reflow
          modalSheetRef.current.style.transform = 'translateY(100%)';
        }
        if (backdropRef.current) {
          backdropRef.current.style.transition = 'opacity 0.3s ease-in';
          backdropRef.current.offsetHeight;
          backdropRef.current.style.opacity = '0';
        }
        closeTimerRef.current = setTimeout(() => {
          navigateCloseModalRef.current();
        }, 300);
      } else {
        // Under halfway — spring back
        if (modalSheetRef.current) {
          modalSheetRef.current.style.transition = 'transform 0.3s ease-out';
          modalSheetRef.current.offsetHeight;
          modalSheetRef.current.style.transform = '';
        }
        if (backdropRef.current) {
          backdropRef.current.style.transition = 'opacity 0.3s ease-out';
          backdropRef.current.offsetHeight;
          backdropRef.current.style.opacity = '';
        }
        setTimeout(() => {
          if (modalSheetRef.current) modalSheetRef.current.style.transition = '';
          if (backdropRef.current) backdropRef.current.style.transition = '';
        }, 300);
      }
      state.currentTranslate = 0;
    };

    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: true });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('touchend', onTouchEnd);
    };
  }, [isCreateModalOpen, isMounted]);

  // Lock body scroll when create-question modal is open to prevent browser pull-to-refresh.
  // On iOS, overflow:hidden alone doesn't prevent native PTR — position:fixed is required.
  useEffect(() => {
    if (!isCreateModalOpen) return;
    // Reset stale close state from previous dismiss
    setModalClosing(false);
    dragState.current.isClosing = false;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    html.style.overscrollBehavior = 'none';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    return () => {
      // Cancel any pending close animation timeout to prevent stale navigation.
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      html.style.overscrollBehavior = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [isCreateModalOpen]);

  return (
    <>
      {/* Fallback header for pages without a page-specific header (not question, thread, settings, home, or create-modal). */}
      {!isQuestionPage && !isThreadPage && !isSettingsPage && pathname !== '/' && (
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
             boundary via .pwa-badge-top. z-30 keeps it above the thread page's
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
          className={`max-w-4xl mx-auto ${(pathname === '/' || isThreadLikePage) ? '-mx-4 sm:mx-auto sm:px-4' : 'px-4'} ${isThreadLikePage ? '' : (isSettingsPage || pathname === '/') ? 'pt-0.5 pb-6' : 'py-6'}`}
          style={(pathname === '/' || isThreadLikePage) ? { paddingBottom: '6rem' } : undefined}
        >
          {children}
        </div>
      </div>

      {/* Create question modal - iOS-style sheet rendered via portal.
           Triggered by ?create query param so the underlying page stays mounted. */}
      {isCreateModalOpen && isMounted && createPortal(
        <div className="fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div
            ref={backdropRef}
            className={`absolute inset-0 bg-black/40 ${modalClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
            onClick={handleCloseCreateModal}
          />
          {/* Modal sheet */}
          <div
            ref={modalSheetRef}
            className={`absolute bottom-0 left-0 right-0 rounded-t-[32px] bg-white dark:bg-gray-900 flex flex-col shadow-2xl ${
              modalClosing ? 'animate-slide-down' : 'animate-slide-up'
            }`}
            style={{ maxHeight: 'calc(100% - env(safe-area-inset-top, 0px) - 15px)', overscrollBehavior: 'none' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex-shrink-0 flex justify-center pt-2.5 pb-1">
              <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>
            {/* Header */}
            <div className="flex-shrink-0 relative flex items-center justify-between px-4 pb-2">
              <button
                onClick={handleCloseCreateModal}
                className="w-[43px] h-[43px] flex items-center justify-center rounded-full bg-gray-200/80 dark:bg-gray-700/80 cursor-pointer z-10"
                aria-label="Close"
              >
                <svg className="w-[34px] h-[34px] text-black dark:text-white" fill="none" viewBox="0 0 24 24">
                  <path stroke="currentColor" strokeLinecap="round" strokeWidth={0.75} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <h2 className="absolute inset-0 flex items-center justify-center text-[17px] font-semibold pointer-events-none">New Question</h2>
              <div id="create-question-submit-portal" className="flex-shrink-0 z-10" />
            </div>
            {/* Generated title line */}
            <div id="create-question-title-portal" className="flex-shrink-0 px-4" />
            {/* Scrollable content */}
            <div ref={modalScrollRef} className="overflow-auto overscroll-contain min-h-0">
              <div className="max-w-4xl mx-auto px-4 pt-2 pb-8">
                <Suspense fallback={
                  <div className="flex justify-center items-center py-20">
                    <svg className="animate-spin h-8 w-8 text-gray-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                }>
                  <LazyCreateQuestionContent />
                </Suspense>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Floating "+" FAB — home page only. Navigates to /thread/new/ where
           the user picks a What/When/Where bubble for what they want to create.
           Rendered via portal outside the scaling container so it positions
           against the viewport. Slides with the rest of the page in view
           transitions (no shared transition name with the thread bubble bar). */}
      {isMounted && pathname === '/' && createPortal(
        <button
          onClick={() => navigateWithTransition(router, '/thread/new', 'forward')}
          className="fixed z-50 w-12 h-12 rounded-full flex items-center justify-center bg-blue-500 dark:bg-blue-600 active:bg-blue-600 dark:active:bg-blue-500 shadow-md shadow-black/20 cursor-pointer"
          style={{
            right: 'max(1.5rem, env(safe-area-inset-right, 0px))',
            bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          }}
          aria-label="Create new question"
        >
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>,
        document.getElementById('floating-fab-portal')!
      )}

      {/* Floating What/When/Where create-question bubbles — thread-like pages only
           (`/thread/<id>/`, `/p/<id>/`, `/thread/new/`). Each opens the create
           modal in place with a different preselection:
             - What  → no preselection
             - When  → ?mode=time
             - Where → ?category=restaurant (most common "where" type)
           Auto-sets followUpTo when the page exposes data-thread-latest-question-id.
           The bar is part of the root snapshot during view transitions so it
           slides in/out with the page. */}
      {isMounted && isThreadLikePage && createPortal(
        <div
          className="fixed z-50 left-1/2 -translate-x-1/2 flex items-center gap-3"
          style={{
            bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          <button
            type="button"
            onClick={() => openCreateFromBubble({})}
            className={BUBBLE_BUTTON_CLASS}
            aria-label="Create new question"
          >
            <span className="text-[1.4rem] leading-none" aria-hidden="true">+</span>
            <span className="text-[1.12rem]">what</span>
          </button>
          <button
            type="button"
            onClick={() => openCreateFromBubble({ mode: 'time' })}
            className={BUBBLE_BUTTON_CLASS}
            aria-label="Create new time question"
          >
            <span className="text-[1.4rem] leading-none" aria-hidden="true">+</span>
            <span className="text-[1.12rem]">when</span>
          </button>
          <button
            type="button"
            onClick={() => openCreateFromBubble({ category: 'restaurant' })}
            className={BUBBLE_BUTTON_CLASS}
            aria-label="Create new place question"
          >
            <span className="text-[1.4rem] leading-none" aria-hidden="true">+</span>
            <span className="text-[1.12rem]">where</span>
          </button>
        </div>,
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
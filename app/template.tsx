"use client";

import React, { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import HeaderPortal from '@/components/HeaderPortal';
import { useLongPress } from '@/lib/useLongPress';
import { installClientLogForwarder } from '@/lib/clientLogForwarder';
import { usePrefetch } from '@/lib/prefetch';
import { navigateWithTransition, navigateBackWithTransition, NAV_COUNT_KEY } from '@/lib/viewTransitions';
import { getCachedPollById, getCachedPollByShortId } from '@/lib/pollCache';
import { isUuidLike } from '@/lib/pollId';

// Extract the import so it can be triggered independently for preloading.
// When called a second time, the module cache returns the already-resolved module instantly.
const importCreatePoll = () =>
  import('@/app/create-poll/page').catch((err) => {
    if (err?.name === 'ChunkLoadError' || err?.message?.includes('Failed to load chunk') || err?.message?.includes('Failed to fetch dynamically imported module')) {
      window.location.reload();
    }
    throw err;
  });

const LazyCreatePollContent = React.lazy(() =>
  importCreatePoll().then(m => ({ default: m.CreatePollContent }))
);

interface AppTemplateProps {
  children: React.ReactNode;
}

// Pull-to-refresh constants (iOS PWA only)
const PTR_THRESHOLD = 240;  // px of raw touch movement to trigger refresh
const PTR_CIRCUMFERENCE = 2 * Math.PI * 10; // SVG arc circumference (radius=10)
const PTR_INDICATOR_SIZE = 40; // approx height of circle + padding

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
  const searchParams = useSearchParams();
  const { prefetchOnHover } = usePrefetch();
  const [hasAppHistory, setHasAppHistory] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [needsCustomPTR, setNeedsCustomPTR] = useState(false);

  // Pull-to-refresh state — uses refs + direct DOM manipulation for 60fps during drag,
  // React state only for mount/unmount of indicator and final actions (refresh/snap-back).
  const [pullActive, setPullActive] = useState(false);    // whether indicator is mounted
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullIndicatorRef = useRef<HTMLDivElement>(null);   // direct DOM ref for indicator
  const pullArcRef = useRef<SVGCircleElement>(null);       // direct DOM ref for arc
  
  // Track in-app navigation for back button (runs on each client-side navigation).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const count = parseInt(sessionStorage.getItem(NAV_COUNT_KEY) || '0', 10) + 1;
    sessionStorage.setItem(NAV_COUNT_KEY, String(count));
    setHasAppHistory(count > 1);
  }, [pathname]);

  // Detect device constants once — values never change mid-session.
  useEffect(() => {
    // Mobile touch device: has touch AND coarse pointer (excludes desktops with
    // touchscreens driven primarily by a mouse).
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    setNeedsCustomPTR(hasTouch && coarsePointer);
  }, []);

  // Set mounted state for portal rendering + install client log forwarder on dev sites
  useEffect(() => {
    setIsMounted(true);
    installClientLogForwarder();

    // Reload on ChunkLoadError — stale cached chunks after a new deploy.
    const handleChunkError = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      if (err?.name === 'ChunkLoadError' || err?.message?.includes('Failed to load chunk')) {
        window.location.reload();
      }
    };
    window.addEventListener('unhandledrejection', handleChunkError);
    return () => window.removeEventListener('unhandledrejection', handleChunkError);
  }, []);

  // Preload the create-poll chunk during idle time so it's instant when the user taps "+".
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => importCreatePoll(), { timeout: 3000 });
      return () => cancelIdleCallback(id);
    } else {
      const t = setTimeout(() => importCreatePoll(), 1500);
      return () => clearTimeout(t);
    }
  }, []);
  
  // Determine initial state based on pathname to avoid layout shift
  const getInitialPageTitle = () => {
    if (pathname === '/create-poll' || pathname === '/create-poll/') return 'Ask For…';
    return '';
  };
  
  const getInitialLeftElement = () => {
    return <div className="w-6 h-6" />; // spacer
  };
  
  const [pageTitle, setPageTitle] = useState(getInitialPageTitle());
  const [leftElement, setLeftElement] = useState<React.ReactNode>(getInitialLeftElement());
  const [rightElement, setRightElement] = useState<React.ReactNode>(<div className="w-6 h-6" />);
  // Initialize pollPageTitle synchronously from the poll cache on poll pages,
  // so the header shows the title on the very first paint after navigation
  // (avoids the h1 being empty during a view transition slide).
  const [pollPageTitle, setPollPageTitle] = useState(() => {
    if (typeof window === 'undefined') return '';
    const match = pathname.match(/^\/p\/([^/]+)\/?$/);
    if (!match) return '';
    const id = match[1];
    const poll = isUuidLike(id) ? getCachedPollById(id) : getCachedPollByShortId(id);
    return poll?.title ?? '';
  });

  // Long-press detection for opening the debug modal (replaces simple tap)
  const { props: longPressProps } = useLongPress(() =>
    window.dispatchEvent(new Event('openCommitInfo'))
  );

  // Determine page-specific header content based on pathname
  useEffect(() => {
    if (pathname === '/') {
      setPageTitle('');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname === '/create-poll' || pathname === '/create-poll/') {
      setPageTitle('Create Poll');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname.startsWith('/p/')) {
      // Poll pages - title will be set by the page content via custom event
      setPageTitle(pollPageTitle);
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else {
      setPageTitle('');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    }
  }, [pathname, pollPageTitle]);

  // Listen for title changes from poll pages
  useEffect(() => {
    const handleTitleChange = (event: CustomEvent) => {
      setPollPageTitle(event.detail.title);
    };

    window.addEventListener('pageTitleChange', handleTitleChange as EventListener);

    return () => {
      window.removeEventListener('pageTitleChange', handleTitleChange as EventListener);
    };
  }, []);

  // Pull-to-refresh for all mobile touch devices (PWA + mobile web).
  // The document is the scroller; the transform is applied to <body> so the
  // whole page translates with the drag. Native PTR is suppressed via
  // overscroll-behavior:none on html/body (globals.css).
  //
  // All listeners are PASSIVE — no e.preventDefault(). Calling preventDefault
  // on even a 1px downward touchmove causes iOS to classify the entire gesture
  // as non-scrollable, permanently blocking scroll for that touch. We track
  // pull distance purely from touch position deltas.
  useEffect(() => {
    if (typeof window === 'undefined' || !needsCustomPTR) return;

    const body = document.body;

    let startY = 0;
    let isAtTop = true;
    let isDragging = false;
    let currentPullDistance = 0;
    let refreshTriggered = false;
    let rAFId: number | null = null;
    let snapBackTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateDOM = (distance: number) => {
      const damped = distance * 0.5;
      body.style.transform = `translateY(${damped}px)`;
      body.style.transition = 'none';

      const indicator = pullIndicatorRef.current;
      if (indicator) {
        const fadeStart = PTR_INDICATOR_SIZE * 0.5;
        const fadeEnd = PTR_INDICATOR_SIZE;
        indicator.style.opacity = String(Math.min(Math.max((damped - fadeStart) / (fadeEnd - fadeStart), 0), 1));
        indicator.style.transition = 'none';
      }

      const arc = pullArcRef.current;
      if (arc) {
        const pastThreshold = distance >= PTR_THRESHOLD;
        arc.style.strokeDasharray = `${Math.min(distance / PTR_THRESHOLD, 1) * PTR_CIRCUMFERENCE} ${PTR_CIRCUMFERENCE}`;
        arc.classList.toggle('text-blue-600', pastThreshold);
        arc.classList.toggle('dark:text-blue-400', pastThreshold);
        arc.classList.toggle('text-gray-400', !pastThreshold);
        arc.classList.toggle('dark:text-gray-500', !pastThreshold);
      }
    };

    // If any nested scrollable ancestor isn't at its top, PTR must NOT fire —
    // the user is scrolling something inside (thread list, modal content,
    // dropdown, etc.). Cheap property reads (scrollTop, scrollHeight) gate
    // the expensive getComputedStyle call so non-scrolled ancestors are skipped.
    const nestedScrollerAboveTop = (target: HTMLElement): boolean => {
      let el: HTMLElement | null = target;
      while (el && el !== body) {
        if (el.scrollTop > 5 && el.scrollHeight > el.clientHeight) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (refreshTriggered) return;
      startY = e.touches[0].clientY;
      const docAtTop = window.scrollY <= 5;
      isAtTop = docAtTop && !nestedScrollerAboveTop(e.target as HTMLElement);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (refreshTriggered || !isAtTop) return;

      // Skip when a modal is open
      const target = e.target as HTMLElement;
      if (target.closest('[data-modal]')) return;

      const rawDelta = e.touches[0].clientY - startY;

      if (rawDelta > 10) {
        if (!isDragging) {
          isDragging = true;
          // Cancel any pending snap-back from a previous gesture
          if (snapBackTimeout) { clearTimeout(snapBackTimeout); snapBackTimeout = null; }
          setPullActive(true);
        }
        currentPullDistance = rawDelta;
        if (rAFId === null) {
          rAFId = requestAnimationFrame(() => {
            rAFId = null;
            updateDOM(currentPullDistance);
          });
        }
      } else if (isDragging && rawDelta <= 10) {
        isDragging = false;
        currentPullDistance = 0;
        body.style.transform = '';
        body.style.transition = '';
        setPullActive(false);
      }
    };

    const handleTouchEnd = () => {
      if (refreshTriggered) return;

      if (isDragging && currentPullDistance >= PTR_THRESHOLD) {
        refreshTriggered = true;
        setIsRefreshing(true);
        setTimeout(() => window.location.reload(), 400);
      } else if (isDragging) {
        body.style.transition = 'transform 0.3s ease';
        body.style.transform = 'translateY(0px)';
        const indicator = pullIndicatorRef.current;
        if (indicator) {
          indicator.style.transition = 'opacity 0.3s ease';
          indicator.style.opacity = '0';
        }
        snapBackTimeout = setTimeout(() => {
          body.style.transition = '';
          body.style.transform = '';
          setPullActive(false);
          snapBackTimeout = null;
        }, 300);
      } else {
        // Clear any stale transform
        body.style.transform = '';
        body.style.transition = '';
      }

      isDragging = false;
      currentPullDistance = 0;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      body.style.transform = '';
      body.style.transition = '';
      if (rAFId !== null) cancelAnimationFrame(rAFId);
      if (snapBackTimeout) clearTimeout(snapBackTimeout);
    };
  }, [needsCustomPTR]);

  const isPollPage = pathname.startsWith('/p/');
  const isThreadPage = pathname.startsWith('/thread/');
  // /p/<id> now renders the thread view with a card expanded; both routes share the
  // thread-page layout (fixed header + scroll list) and the thread's own back button.
  const isThreadLikePage = isThreadPage || isPollPage;
  const isCreateModalOpen = searchParams.has('create');
  const isProfilePage = pathname === '/profile' || pathname === '/profile/';
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
      ['create', 'followUpTo', 'fork', 'duplicate', 'voteFromSuggestion', 'mode']
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

  // Drag-to-dismiss touch handling for the create poll modal sheet.
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

  // Lock body scroll when create-poll modal is open to prevent browser pull-to-refresh.
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
      {/* Pull-to-refresh indicator — rendered via portal to escape scaling container.
           Uses refs for direct DOM updates during drag (no React re-renders). */}
      {needsCustomPTR && (pullActive || isRefreshing) && isMounted && createPortal(
        <div
          ref={pullIndicatorRef}
          className="fixed left-0 right-0 z-[9999] flex justify-center pointer-events-none"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 2px)',
            opacity: isRefreshing ? 1 : 0,
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-full shadow-lg p-2">
            {isRefreshing ? (
              <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" className="text-gray-200 dark:text-gray-600" strokeWidth="2.5" />
                <circle
                  ref={pullArcRef}
                  cx="12" cy="12" r="10" stroke="currentColor"
                  className="text-gray-400 dark:text-gray-500"
                  strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={`0 ${PTR_CIRCUMFERENCE}`}
                  transform="rotate(-90 12 12)"
                />
              </svg>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Fallback header for pages without a page-specific header (not poll, thread, profile, home, or create-modal). */}
      {!isPollPage && !isThreadPage && !isProfilePage && pathname !== '/' && (
        <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700"
             style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="relative flex items-start justify-between pt-2 pb-2 pl-2 pr-2.5">
            <div className="flex items-center justify-center">
              {leftElement}
            </div>
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
            <div className="flex items-center justify-center">
              {rightElement}
            </div>
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

        {isProfilePage && (
          <div
            className="max-w-4xl mx-auto px-16 pb-1 page-title-safe-top"
          >
            <h1 className="text-2xl font-bold text-center break-words select-none" {...longPressProps}>
              Profile
            </h1>
          </div>
        )}

        {pathname === '/' && (
          <div
            className="relative max-w-4xl mx-auto px-2 pb-1 page-title-safe-top"
          >
            {/* Profile icon — upper-right, in normal page flow so it scrolls
                off as the user scrolls down. Absolute-positioned within the
                relative title container; `top` includes the safe-area inset
                so it sits below the iOS notch. */}
            <button
              onClick={() => navigateWithTransition(router, '/profile', 'forward')}
              {...prefetchOnHover('/profile')}
              className="absolute w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 transition-colors"
              style={{
                top: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
                right: 'max(0.5rem, env(safe-area-inset-right, 0px))',
              }}
              aria-label="Profile"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-1 select-none" {...longPressProps}>
                Whoever Wants
              </h1>
              <div className="h-7 flex items-center justify-center mb-1" id="home-phrase-content">
                {/* Blue phrase will be injected here */}
              </div>
            </div>
          </div>
        )}

        <div
          className={`max-w-4xl mx-auto ${(pathname === '/' || isThreadLikePage) ? '-mx-4 sm:mx-auto sm:px-4' : 'px-4'} ${isThreadLikePage ? '' : (isProfilePage || pathname === '/') ? 'pt-0.5 pb-6' : 'py-6'}`}
          style={(pathname === '/' || isThreadLikePage) ? { paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' } : undefined}
        >
          {children}
        </div>
      </div>

      {/* Create poll modal - iOS-style sheet rendered via portal.
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
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 15px)', overscrollBehavior: 'none' }}
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
              <h2 className="absolute inset-0 flex items-center justify-center text-[17px] font-semibold pointer-events-none">New Poll</h2>
              <div id="create-poll-submit-portal" className="flex-shrink-0 z-10" />
            </div>
            {/* Generated title line */}
            <div id="create-poll-title-portal" className="flex-shrink-0 px-4" />
            {/* Scrollable content */}
            <div ref={modalScrollRef} className="flex-1 overflow-auto overscroll-contain">
              <div className="max-w-4xl mx-auto px-4 pt-2 pb-8">
                <Suspense fallback={
                  <div className="flex justify-center items-center py-20">
                    <svg className="animate-spin h-8 w-8 text-gray-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                }>
                  <LazyCreatePollContent />
                </Suspense>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Floating "+" create-poll button — fixed bottom-right, home + thread-like pages only.
           Rendered via portal outside the scaling container so it positions against
           the viewport. `view-transition-name: floating-plus` keeps it fixed (no
           slide) across home <-> thread navigation — see globals.css. */}
      {isMounted && (pathname === '/' || isThreadLikePage) && createPortal(
        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('create', '1');
            // When on a thread page, auto-set followUpTo for the latest poll
            const threadLatestPollId = document.body.getAttribute('data-thread-latest-poll-id');
            if (threadLatestPollId) {
              params.set('followUpTo', threadLatestPollId);
            }
            router.push(`${pathname}?${params.toString()}`);
          }}
          className="fixed z-50 floating-plus-button w-11 h-11 rounded-full flex items-center justify-center bg-blue-500/85 dark:bg-blue-600/85 active:bg-blue-600 dark:active:bg-blue-500 backdrop-blur-sm shadow-md shadow-black/20 cursor-pointer"
          style={{
            right: 'max(1rem, env(safe-area-inset-right, 0px))',
            bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          }}
          aria-label="Create new poll"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>,
        document.getElementById('floating-fab-portal')!
      )}

      {/* Header elements rendered outside scaling container */}
      <HeaderPortal>
        {/* Back arrow in upper left — profile page only, when there's in-app history. */}
        {(isProfilePage && hasAppHistory) && (
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